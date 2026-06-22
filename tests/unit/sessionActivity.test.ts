import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeRunLevel,
  WORKING_WINDOW_MS,
  type ActivityState,
} from "../../src/stores/sessionActivity";

// ---- pure reducer: no store, no timers ----
describe("computeRunLevel", () => {
  const T = 10_000;

  it("is idle with no record", () => {
    expect(computeRunLevel(undefined, T)).toBe("idle");
  });

  it("is idle when the chat isn't running", () => {
    const s: ActivityState = { running: false, lastOutputAt: T };
    expect(computeRunLevel(s, T)).toBe("idle");
  });

  it("is running (calm) when live but no output has flowed", () => {
    const s: ActivityState = { running: true, lastOutputAt: null };
    expect(computeRunLevel(s, T)).toBe("running");
  });

  it("is working while output flowed within the window", () => {
    const s: ActivityState = { running: true, lastOutputAt: T - 500 };
    expect(computeRunLevel(s, T)).toBe("working");
  });

  it("relaxes from working back to running once the window passes", () => {
    const s: ActivityState = { running: true, lastOutputAt: T };
    expect(computeRunLevel(s, T + WORKING_WINDOW_MS - 1)).toBe("working");
    expect(computeRunLevel(s, T + WORKING_WINDOW_MS)).toBe("running");
    expect(computeRunLevel(s, T + WORKING_WINDOW_MS + 5000)).toBe("running");
  });
});

// ---- reactive store: timers + transitions ----
// Import after fake timers are set up; reset between tests so the module-level
// state/timers don't bleed across cases.
describe("session activity store", () => {
  let store: typeof import("../../src/stores/sessionActivity");

  beforeEach(async () => {
    vi.useFakeTimers();
    store = await import("../../src/stores/sessionActivity");
    store.__resetSessionActivity();
  });

  afterEach(() => {
    store.__resetSessionActivity();
    vi.useRealTimers();
  });

  it("marks running on spawn (calm, no output yet)", () => {
    store.markRunning("chat-1");
    expect(store.chatRunLevel("chat-1")).toBe("running");
    expect(store.chatRunning("chat-1")).toBe(true);
  });

  it("goes working on output within the debounce window, then relaxes", () => {
    store.markRunning("chat-1");
    store.noteOutput("chat-1");
    expect(store.chatRunLevel("chat-1")).toBe("working");

    // Still working just before the window elapses.
    vi.advanceTimersByTime(store.WORKING_WINDOW_MS - 1);
    expect(store.chatRunLevel("chat-1")).toBe("working");

    // Trailing timer fires → relaxes to calm running.
    vi.advanceTimersByTime(1);
    expect(store.chatRunLevel("chat-1")).toBe("running");
  });

  it("clears running (and working) on exit", () => {
    store.markRunning("chat-1");
    store.noteOutput("chat-1");
    expect(store.chatRunning("chat-1")).toBe(true);

    store.clearRunning("chat-1");
    expect(store.chatRunLevel("chat-1")).toBe("idle");
    expect(store.chatRunning("chat-1")).toBe(false);
  });

  it("clear-on-close is idempotent (close + natural exit both fire it)", () => {
    // Closing an agent pane clears via close(), and a natural PTY exit clears via
    // onExit — when a close races an exit both can fire clearRunning for the same
    // chat. The second clear must be a harmless no-op, never a thrown error or a
    // resurrected level.
    store.markRunning("chat-1");
    store.noteOutput("chat-1");
    expect(store.chatRunning("chat-1")).toBe(true);

    store.clearRunning("chat-1"); // pane closed
    store.clearRunning("chat-1"); // PTY exit lands after
    expect(store.chatRunLevel("chat-1")).toBe("idle");
    // A late relax tick after clearing must not flip it back to running.
    vi.advanceTimersByTime(store.WORKING_WINDOW_MS);
    expect(store.chatRunLevel("chat-1")).toBe("idle");
  });

  it("ignores output for a chat that isn't running", () => {
    store.noteOutput("ghost");
    expect(store.chatRunLevel("ghost")).toBe("idle");
  });

  it("throttles a burst but keeps the chat working", () => {
    store.markRunning("chat-1");
    // A byte storm: many notes inside the throttle window.
    for (let i = 0; i < 50; i++) store.noteOutput("chat-1");
    expect(store.chatRunLevel("chat-1")).toBe("working");
    // The trailing relax still measures from the last note.
    vi.advanceTimersByTime(store.WORKING_WINDOW_MS);
    expect(store.chatRunLevel("chat-1")).toBe("running");
  });

  it("rolls up running chats per project", () => {
    store.markRunning("a");
    store.markRunning("b");
    expect(store.projectRunningCount(["a", "b", "c"])).toBe(2);
    store.clearRunning("a");
    expect(store.projectRunningCount(["a", "b", "c"])).toBe(1);
  });
});
