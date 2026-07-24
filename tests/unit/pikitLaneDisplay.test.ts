import { describe, expect, it } from "vitest";
import type { PiKitRunEntry, PiKitRunStatus } from "../../src/lib/process";
import {
  abandonDisabledReason,
  abandonHint,
  formatCost,
  formatDuration,
  formatTokens,
  orphanNote,
  runLabel,
  runStatusTone,
} from "../../src/components/pikit/pikitLaneDisplay";

function status(overrides: Partial<PiKitRunStatus> = {}): PiKitRunStatus {
  return {
    schemaVersion: 1,
    revision: 1,
    updatedAtMs: 0,
    run: "run-1",
    state: "active",
    durationMs: 0,
    totals: { cost: 0, tokensIn: 0, tokensOut: 0 },
    lanes: [],
    ...overrides,
  };
}

function entry(overrides: Partial<PiKitRunEntry> = {}): PiKitRunEntry {
  return { run: "run-1", supported: true, orphaned: false, status: status(), ...overrides };
}

describe("pikitLaneDisplay formatting", () => {
  it("formats tokens with k/m suffixes", () => {
    expect(formatTokens(42)).toBe("42");
    expect(formatTokens(4200)).toBe("4.2k");
    expect(formatTokens(4_200_000)).toBe("4.2m");
  });

  it("formats duration compactly", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(125_000)).toBe("2m05s");
    expect(formatDuration(3_725_000)).toBe("1h02m");
    expect(formatDuration(null)).toBe("0s");
    expect(formatDuration(undefined)).toBe("0s");
  });

  it("formats cost as a dollar figure", () => {
    expect(formatCost(0.1)).toBe("$0.10");
    expect(formatCost(Number.NaN)).toBe("$0.00");
  });
});

describe("runLabel / runStatusTone", () => {
  it("labels an unsupported schema version distinctly from run state", () => {
    const unsupported = entry({ supported: false, status: null });
    expect(runLabel(unsupported)).toBe("unsupported pi-kit schema version");
    expect(runStatusTone(unsupported)).toBe("var(--pf-text-low)");
  });

  it("labels an orphaned run as orphaned regardless of its raw state", () => {
    const orphaned = entry({ orphaned: true, status: status({ state: "active" }) });
    expect(runLabel(orphaned)).toBe("orphaned");
    expect(runStatusTone(orphaned)).toBe("var(--pf-warning)");
  });

  it("distinguishes a successful end from a failed one", () => {
    const ended = entry({ status: status({ state: "ended", ok: true }) });
    expect(runStatusTone(ended)).toBe("var(--pf-connected)");
    const failed = entry({ status: status({ state: "ended", ok: false }) });
    expect(runStatusTone(failed)).toBe("var(--pf-error)");
  });
});

describe("abandonDisabledReason", () => {
  it("blocks unsupported schema versions", () => {
    expect(abandonDisabledReason(entry({ supported: false, status: null }))).toMatch(/unsupported/i);
  });

  it("blocks ended runs", () => {
    expect(abandonDisabledReason(entry({ status: status({ state: "ended" }) }))).toMatch(/already ended/i);
  });

  it("does NOT block an orphaned-but-active run — the request is harmless if nothing consumes it", () => {
    expect(abandonDisabledReason(entry({ orphaned: true }))).toBeNull();
  });

  it("still blocks an orphaned run that also already ended", () => {
    expect(
      abandonDisabledReason(entry({ orphaned: true, status: status({ state: "ended" }) })),
    ).toMatch(/already ended/i);
  });

  it("blocks a lane that already reached a terminal state", () => {
    const lane = {
      lane: "lane-1",
      model: "m",
      effort: "medium",
      mode: "read-only",
      state: "done",
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      context: 0,
    };
    expect(abandonDisabledReason(entry(), lane)).toMatch(/already done/i);
  });

  it("allows a queued or running lane on an active, non-orphaned run", () => {
    const running = {
      lane: "lane-1",
      model: "m",
      effort: "medium",
      mode: "read-only",
      state: "running",
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      context: 0,
    };
    expect(abandonDisabledReason(entry(), running)).toBeNull();
    expect(abandonDisabledReason(entry())).toBeNull();
  });
});

describe("abandonHint", () => {
  it("gives an honest caveat for an orphaned, still-active run without saying the owner is gone", () => {
    const hint = abandonHint(entry({ orphaned: true }));
    expect(hint).toMatch(/lane process\(es\) appear gone/i);
    expect(hint).not.toMatch(/owner/i);
  });

  it("has nothing to say for a non-orphaned run", () => {
    expect(abandonHint(entry())).toBeNull();
  });

  it("has nothing to say once an orphaned run has also ended (already blocked, not just hinted)", () => {
    expect(abandonHint(entry({ orphaned: true, status: status({ state: "ended" }) }))).toBeNull();
  });
});

describe("orphanNote", () => {
  it("describes lane processes, not the owner, as gone", () => {
    const note = orphanNote(entry({ orphaned: true }));
    expect(note).toMatch(/lane process\(es\) appear gone/i);
    expect(note).not.toMatch(/owner/i);
  });

  it("is null for a non-orphaned run", () => {
    expect(orphanNote(entry())).toBeNull();
  });
});
