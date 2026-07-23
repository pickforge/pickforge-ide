import { beforeEach, describe, expect, it, vi } from "vitest";

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

async function loadModules() {
  vi.resetModules();
  const fixture = await import("../../src/lib/studioUpdateFixture");
  const store = await import("../../src/stores/studioUpdate");
  return { fixture, store };
}

beforeEach(() => {
  mem.clear();
});

describe("studioUpdateFixture — VRT-only injection", () => {
  it("is a no-op when no fixture is set in localStorage", async () => {
    const { fixture, store } = await loadModules();

    fixture.installStudioUpdateFixture();

    expect(store.studioUpdateState()).toEqual({ status: "idle" });
  });

  it("swaps the shared store onto a static available-with-notes fixture", async () => {
    mem.set("pickforge.vrt.updateFixture", "available");
    const { fixture, store } = await loadModules();

    fixture.installStudioUpdateFixture();

    const state = store.studioUpdateState();
    expect(state.status).toBe("available");
    expect(state.status === "available" && state.update.version).toBe("0.2.0");
    expect(state.status === "available" && state.update.notes).toContain("Tailscale");
  });

  it("swaps the shared store onto a static downloading fixture with progress", async () => {
    mem.set("pickforge.vrt.updateFixture", "downloading");
    const { fixture, store } = await loadModules();

    fixture.installStudioUpdateFixture();

    const state = store.studioUpdateState();
    expect(state.status).toBe("downloading");
    expect(state.status === "downloading" && state.progress.percent).toBe(44);
  });

  it("ignores an unknown fixture name", async () => {
    mem.set("pickforge.vrt.updateFixture", "not-a-real-fixture");
    const { fixture, store } = await loadModules();

    fixture.installStudioUpdateFixture();

    expect(store.studioUpdateState()).toEqual({ status: "idle" });
  });
});
