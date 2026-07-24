// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: env.invoke }));

interface FakeProject {
  projectRoot: string;
  displayName: string;
}

const workspaceMock = vi.hoisted(() => ({
  setState: null as unknown as (...args: unknown[]) => void,
}));

vi.mock("../../src/stores/workspace", async () => {
  const { createStore } = await import("solid-js/store");
  const [state, setState] = createStore<{ activeRoot: string | null; projects: FakeProject[] }>({
    activeRoot: null,
    projects: [],
  });
  workspaceMock.setState = setState as (...args: unknown[]) => void;
  return {
    workspace: state,
    activeProject: () => state.projects.find((p) => p.projectRoot === state.activeRoot) ?? null,
  };
});

const mem = vi.hoisted(() => {
  const m = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return m;
});

async function loadStore() {
  vi.resetModules();
  const flags = await import("../../src/stores/flags");
  await import("../../src/stores/workspace");
  const store = await import("../../src/stores/forgeContext");
  return { flags, store };
}

function setWorkspace(activeRoot: string | null, projects: FakeProject[] = []) {
  workspaceMock.setState({ activeRoot, projects });
}

let disposers: Array<() => void> = [];

/** Installs the bootstrap and tracks its disposer so afterEach can tear down
 * the reactive root — otherwise a prior test's live createRoot/effect can
 * still be subscribed (and its pending debounce timer still armed) when the
 * next test's fake-timer clock advances. */
function install(store: Awaited<ReturnType<typeof loadStore>>["store"]): () => void {
  const dispose = store.installForgeContextBootstrap();
  disposers.push(dispose);
  return dispose;
}

beforeEach(() => {
  mem.clear();
  env.invoke.mockReset();
  env.invoke.mockResolvedValue(null);
  disposers = [];
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  vi.clearAllTimers();
  vi.useRealTimers();
});

const DEBOUNCE_MS = 750;

describe("forgeContext store", () => {
  it("writes the active project after the debounce once the flag is on", async () => {
    vi.useFakeTimers();
    const { flags, store } = await loadStore();
    flags.setFlagOverride("pikitContext", true);
    setWorkspace("/home/dev/acme", [{ projectRoot: "/home/dev/acme", displayName: "Acme" }]);

    install(store);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(env.invoke).toHaveBeenCalledWith("write_forge_context", {
      projectRoot: "/home/dev/acme",
      lastOpenedFile: null,
      displayName: "Acme",
    });
  });

  it("never writes while the flag stays off", async () => {
    vi.useFakeTimers();
    const { store } = await loadStore();
    setWorkspace("/home/dev/acme", [{ projectRoot: "/home/dev/acme", displayName: "Acme" }]);

    install(store);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(env.invoke).not.toHaveBeenCalledWith("write_forge_context", expect.anything());
  });

  it("clears instead of writing when no project is active, flag on", async () => {
    vi.useFakeTimers();
    const { flags, store } = await loadStore();
    flags.setFlagOverride("pikitContext", true);
    setWorkspace(null);

    install(store);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(env.invoke).toHaveBeenCalledWith("clear_forge_context");
    expect(env.invoke).not.toHaveBeenCalledWith("write_forge_context", expect.anything());
  });

  it("clears when the active project goes null after having written", async () => {
    vi.useFakeTimers();
    const { flags, store } = await loadStore();
    flags.setFlagOverride("pikitContext", true);
    setWorkspace("/home/dev/acme", [{ projectRoot: "/home/dev/acme", displayName: "Acme" }]);
    install(store);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(env.invoke).toHaveBeenCalledWith("write_forge_context", expect.anything());

    env.invoke.mockClear();
    setWorkspace(null);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(env.invoke).toHaveBeenCalledWith("clear_forge_context");
    expect(env.invoke).not.toHaveBeenCalledWith("write_forge_context", expect.anything());
  });

  it("clears when the flag is turned off after having written", async () => {
    vi.useFakeTimers();
    const { flags, store } = await loadStore();
    flags.setFlagOverride("pikitContext", true);
    setWorkspace("/home/dev/acme", [{ projectRoot: "/home/dev/acme", displayName: "Acme" }]);
    install(store);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(env.invoke).toHaveBeenCalledWith("write_forge_context", expect.anything());

    env.invoke.mockClear();
    flags.setFlagOverride("pikitContext", false);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(env.invoke).toHaveBeenCalledWith("clear_forge_context");
    expect(env.invoke).not.toHaveBeenCalledWith("write_forge_context", expect.anything());
  });

  it("debounces a burst of project switches into a single write for the latest root", async () => {
    vi.useFakeTimers();
    const { flags, store } = await loadStore();
    flags.setFlagOverride("pikitContext", true);
    setWorkspace("/home/dev/acme", [
      { projectRoot: "/home/dev/acme", displayName: "Acme" },
      { projectRoot: "/home/dev/other", displayName: "Other" },
    ]);
    install(store);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS / 2);
    setWorkspace("/home/dev/other", [
      { projectRoot: "/home/dev/acme", displayName: "Acme" },
      { projectRoot: "/home/dev/other", displayName: "Other" },
    ]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    const writeCalls = env.invoke.mock.calls.filter(([cmd]) => cmd === "write_forge_context");
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0][1]).toMatchObject({ projectRoot: "/home/dev/other" });
  });

  it("reports the last file opened in the active project, path-only", async () => {
    vi.useFakeTimers();
    const { flags, store } = await loadStore();
    flags.setFlagOverride("pikitContext", true);
    setWorkspace("/home/dev/acme", [{ projectRoot: "/home/dev/acme", displayName: "Acme" }]);
    install(store);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    env.invoke.mockClear();

    store.noteFileOpened("/home/dev/acme", "lib/main.dart");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(env.invoke).toHaveBeenCalledWith("write_forge_context", {
      projectRoot: "/home/dev/acme",
      lastOpenedFile: "lib/main.dart",
      displayName: "Acme",
    });
  });

  it("drops a stale last-opened-file path after switching to a different project", async () => {
    vi.useFakeTimers();
    const { flags, store } = await loadStore();
    flags.setFlagOverride("pikitContext", true);
    setWorkspace("/home/dev/acme", [
      { projectRoot: "/home/dev/acme", displayName: "Acme" },
      { projectRoot: "/home/dev/other", displayName: "Other" },
    ]);
    install(store);
    store.noteFileOpened("/home/dev/acme", "lib/main.dart");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    env.invoke.mockClear();

    setWorkspace("/home/dev/other", [
      { projectRoot: "/home/dev/acme", displayName: "Acme" },
      { projectRoot: "/home/dev/other", displayName: "Other" },
    ]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(env.invoke).toHaveBeenCalledWith("write_forge_context", {
      projectRoot: "/home/dev/other",
      lastOpenedFile: null,
      displayName: "Other",
    });
  });

  it("cancels a pending debounced write when the bootstrap is disposed", async () => {
    vi.useFakeTimers();
    const { flags, store } = await loadStore();
    flags.setFlagOverride("pikitContext", true);
    setWorkspace("/home/dev/acme", [{ projectRoot: "/home/dev/acme", displayName: "Acme" }]);

    const dispose = install(store);
    dispose();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(env.invoke).not.toHaveBeenCalled();
  });

  it("flushes a pending clear immediately on disposal instead of dropping it", async () => {
    vi.useFakeTimers();
    const { flags, store } = await loadStore();
    flags.setFlagOverride("pikitContext", true);
    // No active project — the effect arms a debounced CLEAR.
    setWorkspace(null);

    const dispose = install(store);
    // Tear down before the debounce elapses (e.g. the app quitting right
    // after the last project closed). A dropped clear here would leave a
    // stale context.json behind for pi-kit to keep reading.
    dispose();
    await vi.waitFor(() => expect(env.invoke).toHaveBeenCalledWith("clear_forge_context"));

    // The (already-cancelled) debounce timer firing later must not clear a
    // second time.
    env.invoke.mockClear();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(env.invoke).not.toHaveBeenCalled();
  });

  it("serializes IPC calls so a slow write settling after a later clear cannot resurrect the file", async () => {
    vi.useFakeTimers();
    const { flags, store } = await loadStore();

    let resolveWrite: (() => void) | undefined;
    env.invoke.mockImplementation((cmd: string) => {
      if (cmd === "write_forge_context") {
        return new Promise((resolve) => {
          resolveWrite = () => resolve(null);
        });
      }
      return Promise.resolve(null);
    });

    flags.setFlagOverride("pikitContext", true);
    setWorkspace("/home/dev/acme", [{ projectRoot: "/home/dev/acme", displayName: "Acme" }]);
    install(store);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(env.invoke).toHaveBeenCalledWith("write_forge_context", expect.anything());
    expect(resolveWrite).toBeDefined();

    // The write's IPC call is in flight (held). Before it settles, the
    // project closes: a clear is scheduled and its own debounce elapses too.
    setWorkspace(null);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    // The clear action has FIRED (its debounce elapsed) but must not have
    // reached invoke yet — it's queued behind the still-pending write.
    expect(env.invoke).not.toHaveBeenCalledWith("clear_forge_context");

    // Now let the slow write settle.
    resolveWrite?.();
    await vi.waitFor(() => expect(env.invoke).toHaveBeenCalledWith("clear_forge_context"));

    const order = env.invoke.mock.calls.map(([cmd]) => cmd);
    expect(order).toEqual(["write_forge_context", "clear_forge_context"]);
  });

  it("is idempotent — a second install call returns the same disposer and does not double-write", async () => {
    vi.useFakeTimers();
    const { flags, store } = await loadStore();
    flags.setFlagOverride("pikitContext", true);
    setWorkspace("/home/dev/acme", [{ projectRoot: "/home/dev/acme", displayName: "Acme" }]);

    const first = install(store);
    const second = store.installForgeContextBootstrap();
    expect(second).toBe(first);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    const writeCalls = env.invoke.mock.calls.filter(([cmd]) => cmd === "write_forge_context");
    expect(writeCalls).toHaveLength(1);
  });

  it("swallows a failed write instead of throwing", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { flags, store } = await loadStore();
      env.invoke.mockRejectedValueOnce(new Error("disk full"));
      flags.setFlagOverride("pikitContext", true);
      setWorkspace("/home/dev/acme", [{ projectRoot: "/home/dev/acme", displayName: "Acme" }]);

      install(store);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    } finally {
      errorSpy.mockRestore();
    }
  });
});
