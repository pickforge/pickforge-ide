// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiKitRunEntry } from "../../src/lib/process";

const testEnv = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: testEnv.invoke }));

async function loadStore() {
  vi.resetModules();
  return import("../../src/stores/pikitLanes");
}

const ACTIVE_RUN: PiKitRunEntry = {
  run: "run-1",
  supported: true,
  orphaned: false,
  status: {
    schemaVersion: 1,
    revision: 3,
    updatedAtMs: 1_000,
    run: "run-1",
    state: "active",
    durationMs: 5_000,
    totals: { cost: 0.1, tokensIn: 100, tokensOut: 50 },
    lanes: [
      {
        lane: "lane-1",
        model: "openai-codex/gpt-5.6-sol",
        effort: "medium",
        mode: "read-only",
        state: "running",
        tokensIn: 100,
        tokensOut: 50,
        cost: 0.1,
        context: 1200,
      },
    ],
  },
};

beforeEach(() => {
  testEnv.invoke.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pikitLanes store", () => {
  it("loads runs from list_pi_kit_runs and clears any prior error", async () => {
    testEnv.invoke.mockResolvedValueOnce([ACTIVE_RUN]);
    const store = await loadStore();

    await store.loadPiKitRuns();

    expect(testEnv.invoke).toHaveBeenCalledWith("list_pi_kit_runs");
    expect(store.pikitRuns()).toEqual([ACTIVE_RUN]);
    expect(store.pikitRunsError()).toBeNull();
    expect(store.pikitRunsLoading()).toBe(false);
  });

  it("surfaces a failed load as an error without clearing the existing list", async () => {
    testEnv.invoke.mockResolvedValueOnce([ACTIVE_RUN]);
    const store = await loadStore();
    await store.loadPiKitRuns();

    testEnv.invoke.mockRejectedValueOnce(new Error("pi-kit runs dir unreadable"));
    await store.loadPiKitRuns();

    expect(store.pikitRunsError()).toBe("pi-kit runs dir unreadable");
    expect(store.pikitRuns()).toEqual([ACTIVE_RUN]);
  });

  it("polls on start at a modest interval and stops cleanly", async () => {
    vi.useFakeTimers();
    testEnv.invoke.mockResolvedValue([ACTIVE_RUN]);
    const store = await loadStore();

    store.startPiKitLanesPolling();
    await vi.advanceTimersByTimeAsync(0);
    expect(testEnv.invoke).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(testEnv.invoke).toHaveBeenCalledTimes(2);

    // A second start() while already polling must not double the interval.
    store.startPiKitLanesPolling();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(testEnv.invoke).toHaveBeenCalledTimes(3);

    store.stopPiKitLanesPolling();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(testEnv.invoke).toHaveBeenCalledTimes(3);
  });

  it("requests abandonment, reports the runner's confirmation, and refreshes the list", async () => {
    testEnv.invoke.mockResolvedValueOnce({ requested: true, consumed: true });
    testEnv.invoke.mockResolvedValueOnce([ACTIVE_RUN]);
    const store = await loadStore();

    const result = await store.requestPiKitAbandon("run-1", "lane-1", "user requested");

    expect(testEnv.invoke).toHaveBeenNthCalledWith(1, "abandon_pi_kit_lane", {
      run: "run-1",
      lane: "lane-1",
      reason: "user requested",
    });
    expect(testEnv.invoke).toHaveBeenNthCalledWith(2, "list_pi_kit_runs");
    expect(result).toEqual({ ok: true, consumed: true });
  });

  it("reports a not-yet-confirmed abandon without treating it as a failure", async () => {
    testEnv.invoke.mockResolvedValueOnce({ requested: true, consumed: false });
    testEnv.invoke.mockResolvedValueOnce([]);
    const store = await loadStore();

    const result = await store.requestPiKitAbandon("run-1", null, null);

    expect(result).toEqual({ ok: true, consumed: false });
  });

  it("surfaces an abandon-write failure as an error result", async () => {
    testEnv.invoke.mockRejectedValueOnce(new Error("could not resolve the user's home directory"));
    const store = await loadStore();

    const result = await store.requestPiKitAbandon("run-1", "lane-1", null);

    expect(result).toEqual({ ok: false, error: "could not resolve the user's home directory" });
  });
});
