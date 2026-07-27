// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { PiKitRunEntry } from "../../src/lib/process";

const testEnv = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: testEnv.invoke }));

const RUN = "run-20260726T101112-4821";

const ENTRY: PiKitRunEntry = {
  run: RUN,
  supported: true,
  orphaned: false,
  status: {
    schemaVersion: 1,
    revision: 3,
    updatedAtMs: 1_000,
    run: RUN,
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

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  testEnv.invoke.mockReset();
  vi.resetModules();
  vi.useFakeTimers();
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  vi.useRealTimers();
});

async function mount(live: boolean) {
  const { PiKitRunLanes } = await import("../../src/components/pikit/PiKitRunLanes");
  dispose = render(() => <PiKitRunLanes run={RUN} live={live} />, root);
  return root;
}

function pollCount() {
  return testEnv.invoke.mock.calls.filter((call) => String(call[0]).startsWith("list_pi_kit_run")).length;
}

describe("PiKitRunLanes — live in flight, frozen after (#362)", () => {
  it("polls while the call is in flight", async () => {
    testEnv.invoke.mockResolvedValue({ runs: [ENTRY], total: 1 });
    await mount(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(pollCount()).toBeGreaterThan(0);
    expect(root.querySelector(".pf-pikit-card")).not.toBeNull();

    const before = pollCount();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(pollCount()).toBeGreaterThan(before);
  });

  it("never polls once the call has finished", async () => {
    // A replayed row must not rewrite itself from a run that has moved on.
    testEnv.invoke.mockResolvedValue({ runs: [ENTRY], total: 1 });
    await mount(false);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(pollCount()).toBe(0);
  });

  it("renders the same card component Settings uses", async () => {
    testEnv.invoke.mockResolvedValue({ runs: [ENTRY], total: 1 });
    await mount(true);
    await vi.advanceTimersByTimeAsync(0);

    // The Settings panel's own selectors — proof it is one component, not a
    // second lane card that will drift.
    expect(root.querySelector(".pf-pikit-card")).not.toBeNull();
    expect(root.querySelector(".pf-pikit-summary")).not.toBeNull();
  });

  it("offers no Abandon control in a transcript", async () => {
    testEnv.invoke.mockResolvedValue({ runs: [ENTRY], total: 1 });
    await mount(true);
    await vi.advanceTimersByTimeAsync(0);
    root.querySelector<HTMLButtonElement>(".pf-pikit-summary")!.click();

    expect(root.querySelector(".pf-pikit-abandon")).toBeNull();
    expect(root.textContent).not.toContain("Abandon all lanes");
  });

  it("says so plainly when a finished run's status is gone", async () => {
    testEnv.invoke.mockResolvedValue({ runs: [], total: 0 });
    await mount(false);
    await vi.advanceTimersByTimeAsync(0);

    expect(root.textContent).toContain("No lane status retained");
    expect(root.textContent).toContain(RUN);
  });

  it("shows a waiting note rather than an empty box while in flight", async () => {
    testEnv.invoke.mockResolvedValue({ runs: [], total: 0 });
    await mount(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(root.textContent).toContain("Waiting for lane status");
  });
});
