// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import type { PiKitRunEntry } from "../../src/lib/process";

const testEnv = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: testEnv.invoke }));

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

function clone(entry: PiKitRunEntry): PiKitRunEntry {
  return JSON.parse(JSON.stringify(entry)) as PiKitRunEntry;
}

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  testEnv.invoke.mockReset();
  vi.resetModules();
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  vi.useRealTimers();
});

async function mountPanel() {
  const { PiKitLanesPanel } = await import("../../src/components/pikit/PiKitLanesPanel");
  dispose = render(() => <PiKitLanesPanel />, root);
  return root;
}

function summary(): HTMLButtonElement {
  const el = root.querySelector<HTMLButtonElement>(".pf-pikit-summary");
  if (!el) throw new Error("run summary button not rendered");
  return el;
}

describe("PiKitLanesPanel", () => {
  it("keeps an expanded run open across a poll refresh (#363)", async () => {
    vi.useFakeTimers();
    testEnv.invoke.mockResolvedValue({ runs: [ACTIVE_RUN], total: 1 });
    await mountPanel();
    await vi.advanceTimersByTimeAsync(0);

    summary().click();
    expect(summary().getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector(".pf-pikit-body")).not.toBeNull();

    // The next poll delivers freshly deserialized objects — the exact
    // condition that used to dispose and recreate the row.
    testEnv.invoke.mockResolvedValue({ runs: [clone(ACTIVE_RUN)], total: 1 });
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.advanceTimersByTimeAsync(4_000);

    expect(summary().getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector(".pf-pikit-body")).not.toBeNull();
  });

  it("updates a lane's numbers in place while the run stays expanded (#363)", async () => {
    vi.useFakeTimers();
    testEnv.invoke.mockResolvedValue({ runs: [ACTIVE_RUN], total: 1 });
    await mountPanel();
    await vi.advanceTimersByTimeAsync(0);

    summary().click();
    const laneBefore = root.querySelector(".pf-pikit-lane");
    expect(laneBefore).not.toBeNull();

    const advanced = clone(ACTIVE_RUN);
    advanced.status!.lanes[0].tokensOut = 999;
    testEnv.invoke.mockResolvedValue({ runs: [advanced], total: 1 });
    await vi.advanceTimersByTimeAsync(4_000);

    // Same DOM node, new text: an update, not a remount.
    expect(root.querySelector(".pf-pikit-lane")).toBe(laneBefore);
    expect(root.querySelector(".pf-pikit-lane-meta")?.textContent).toContain("999");
    expect(summary().getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps an expanded run open across an abandon, which also forces a reload (#363)", async () => {
    vi.useFakeTimers();
    // Every call returns a FRESH clone, as a real `invoke` does — the response
    // is deserialized per call, so no entry is ever reference-equal to the last.
    // Handing back one shared object would make this test pass without the fix.
    testEnv.invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_pi_kit_run_page") return Promise.resolve({ runs: [clone(ACTIVE_RUN)], total: 1 });
      if (cmd === "list_pi_kit_runs") return Promise.resolve([clone(ACTIVE_RUN)]);
      if (cmd === "abandon_pi_kit_lane") return Promise.resolve({ requested: true, consumed: true });
      return Promise.resolve(null);
    });
    await mountPanel();
    await vi.advanceTimersByTimeAsync(0);

    summary().click();
    expect(summary().getAttribute("aria-expanded")).toBe("true");

    root.querySelector<HTMLButtonElement>(".pf-pikit-abandon")!.click();
    document.querySelector<HTMLButtonElement>(".pf-confirm-go")!.click();
    await vi.advanceTimersByTimeAsync(0);

    // `requestPiKitAbandon` forces its own reload, and the refreshed payload
    // carries new lane state — the one path that changes data and refreshes in
    // the same step.
    expect(testEnv.invoke).toHaveBeenCalledWith("abandon_pi_kit_lane", expect.anything());
    expect(summary().getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector(".pf-pikit-body")).not.toBeNull();
  });

  it("offers the rest behind a dialog instead of growing without bound (#363)", async () => {
    vi.useFakeTimers();
    const ended: PiKitRunEntry = {
      ...clone(ACTIVE_RUN),
      run: "run-old",
      status: { ...clone(ACTIVE_RUN).status!, run: "run-old", state: "ended" },
    };
    testEnv.invoke.mockImplementation((cmd: string) => {
      // The poll returns a PAGE: one run rendered, six on disk.
      if (cmd === "list_pi_kit_run_page") {
        return Promise.resolve({ runs: [clone(ACTIVE_RUN)], total: 6 });
      }
      // The dialog reads the full list separately, on demand.
      if (cmd === "list_pi_kit_runs") {
        return Promise.resolve([clone(ACTIVE_RUN), ended]);
      }
      return Promise.resolve(null);
    });
    await mountPanel();
    await vi.advanceTimersByTimeAsync(0);

    // The affordance counts what is on DISK, not what happens to be rendered.
    const viewAll = root.querySelector<HTMLButtonElement>(".pf-pikit-view-all");
    expect(viewAll).not.toBeNull();
    expect(viewAll!.textContent).toContain("6");
    expect(root.querySelectorAll(".pf-pikit-card")).toHaveLength(1);

    viewAll!.click();
    await vi.advanceTimersByTimeAsync(0);

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.querySelectorAll(".pf-pikit-card")).toHaveLength(2);
    expect(dialog!.querySelector(".pf-pikit-all-scroll")).not.toBeNull();

    // Escape closes it.
    dialog!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows no view-all affordance when nothing is hidden (#363)", async () => {
    vi.useFakeTimers();
    testEnv.invoke.mockImplementation((cmd: string) =>
      cmd === "list_pi_kit_run_page"
        ? Promise.resolve({ runs: [clone(ACTIVE_RUN)], total: 1 })
        : Promise.resolve(null),
    );
    await mountPanel();
    await vi.advanceTimersByTimeAsync(0);

    expect(root.querySelector(".pf-pikit-view-all")).toBeNull();
  });

  it("still collapses when the user asks it to", async () => {
    vi.useFakeTimers();
    testEnv.invoke.mockResolvedValue({ runs: [ACTIVE_RUN], total: 1 });
    await mountPanel();
    await vi.advanceTimersByTimeAsync(0);

    summary().click();
    expect(summary().getAttribute("aria-expanded")).toBe("true");

    summary().click();
    // The state flips at once; the body lingers just long enough for the
    // collapse to play (#372 PR 2).
    expect(summary().getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector(".pf-pikit-card--open")).toBeNull();

    await vi.advanceTimersByTimeAsync(400);
    expect(root.querySelector(".pf-pikit-body")).toBeNull();
  });
});
