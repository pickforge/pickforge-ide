import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `watchDartChanges`/`watchGitChanges` invoke `fs_watch_start`/`fs_watch_stop`
// and subscribe to `fs-changed` via `@tauri-apps/api/event` — capture both so
// a test can drive a synthetic event stream without a real Tauri backend.
const testEnv = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: new Map<string, (e: { payload: { id: number; path: string } }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: testEnv.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, cb: (e: { payload: { id: number; path: string } }) => void) => {
    testEnv.handlers.set(name, cb);
    return Promise.resolve(() => testEnv.handlers.delete(name));
  }),
}));

import { createDebouncedTrigger, fsWatchStart, watchDartChanges, watchGitChanges } from "../../src/lib/fsWatch";

function emit(id: number, path = "/repo/file.txt") {
  testEnv.handlers.get("fs-changed")?.({ payload: { id, path } });
}

beforeEach(() => {
  testEnv.invoke.mockReset();
  testEnv.handlers.clear();
});

describe("createDebouncedTrigger", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces a burst of notify() calls into a single fire after the delay", () => {
    const onFire = vi.fn();
    const trigger = createDebouncedTrigger(onFire, 400);
    trigger.notify();
    vi.advanceTimersByTime(200);
    trigger.notify();
    vi.advanceTimersByTime(200);
    trigger.notify();
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("fires again for a later, separate burst", () => {
    const onFire = vi.fn();
    const trigger = createDebouncedTrigger(onFire, 100);
    trigger.notify();
    vi.advanceTimersByTime(100);
    expect(onFire).toHaveBeenCalledTimes(1);
    trigger.notify();
    vi.advanceTimersByTime(100);
    expect(onFire).toHaveBeenCalledTimes(2);
  });

  it("cancel() drops a pending fire", () => {
    const onFire = vi.fn();
    const trigger = createDebouncedTrigger(onFire, 100);
    trigger.notify();
    trigger.cancel();
    vi.advanceTimersByTime(200);
    expect(onFire).not.toHaveBeenCalled();
  });
});

describe("fsWatchStart", () => {
  it("defaults to dart mode when omitted", async () => {
    testEnv.invoke.mockResolvedValue(1);
    await fsWatchStart("/repo");
    expect(testEnv.invoke).toHaveBeenCalledWith("fs_watch_start", { path: "/repo", mode: "dart" });
  });

  it("passes an explicit git mode through", async () => {
    testEnv.invoke.mockResolvedValue(1);
    await fsWatchStart("/repo", "git");
    expect(testEnv.invoke).toHaveBeenCalledWith("fs_watch_start", { path: "/repo", mode: "git" });
  });
});

describe("watchDartChanges / watchGitChanges", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("watchGitChanges starts a git-mode watch and debounces matching events", async () => {
    testEnv.invoke.mockImplementation((cmd: string) => {
      if (cmd === "fs_watch_start") return Promise.resolve(7);
      return Promise.resolve(undefined);
    });
    const onChange = vi.fn();
    const handle = await watchGitChanges("/repo", onChange, 300);
    expect(testEnv.invoke).toHaveBeenCalledWith("fs_watch_start", { path: "/repo", mode: "git" });

    emit(7);
    emit(7);
    vi.advanceTimersByTime(299);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);

    handle.stop();
    expect(testEnv.invoke).toHaveBeenCalledWith("fs_watch_stop", { id: 7 });
  });

  it("ignores events tagged with a different watch id", async () => {
    testEnv.invoke.mockImplementation((cmd: string) => {
      if (cmd === "fs_watch_start") return Promise.resolve(3);
      return Promise.resolve(undefined);
    });
    const onChange = vi.fn();
    await watchGitChanges("/repo", onChange, 100);

    emit(999); // a different, racing watcher's event
    vi.advanceTimersByTime(200);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("watchDartChanges defaults to a 600ms debounce", async () => {
    testEnv.invoke.mockImplementation((cmd: string) => {
      if (cmd === "fs_watch_start") return Promise.resolve(1);
      return Promise.resolve(undefined);
    });
    const onChange = vi.fn();
    await watchDartChanges("/repo", onChange);
    expect(testEnv.invoke).toHaveBeenCalledWith("fs_watch_start", { path: "/repo", mode: "dart" });

    emit(1);
    vi.advanceTimersByTime(599);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
