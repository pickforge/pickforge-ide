import { describe, expect, it, vi } from "vitest";

// lib/pty pulls in @tauri-apps/api/core (invoke, Channel) at module load;
// mock it so this pure-function test runs under node with no runtime
// (matches tests/unit/askpassNotice.test.ts's pattern for the same module).
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => {}, Channel: class {} }));

import {
  legacyStopConfirmTitle,
  legacyStopIsRisky,
  type LegacyStopRequest,
} from "../../src/lib/pty";

// pickforge#214 (P1 follow-up review) — a single-item Stop must go through
// the SAME confirm dialog and the SAME risk disclosure as the bulk action;
// these are the two pure decisions that dialog renders from.
describe("legacyStopConfirmTitle", () => {
  it("names the exact session for a single-item stop", () => {
    const request: LegacyStopRequest = {
      scope: "single",
      kind: "dtach",
      name: "pf-0123456789abcdef0123456789abcdef",
      risky: false,
    };
    expect(legacyStopConfirmTitle(request, 3)).toBe(
      "Stop legacy session pf-0123456789abcdef0123456789abcdef?",
    );
  });

  it("pluralizes the bulk title from the shown count, ignoring the single request shape", () => {
    expect(legacyStopConfirmTitle({ scope: "bulk" }, 1)).toBe("Stop 1 legacy session?");
    expect(legacyStopConfirmTitle({ scope: "bulk" }, 5)).toBe("Stop 5 legacy sessions?");
  });
});

describe("legacyStopIsRisky", () => {
  it("is always risky for a bulk stop, regardless of what's in the list", () => {
    expect(legacyStopIsRisky({ scope: "bulk" })).toBe(true);
  });

  it("carries a live dtach row's own risk into the confirm dialog", () => {
    expect(
      legacyStopIsRisky({ scope: "single", kind: "dtach", name: "pf-a", risky: true }),
    ).toBe(true);
  });

  it("carries an attached tmux row's own risk into the confirm dialog", () => {
    expect(
      legacyStopIsRisky({ scope: "single", kind: "tmux", name: "pf-a", risky: true }),
    ).toBe(true);
  });

  it("a stale/detached single row never shows the live-session warning", () => {
    expect(
      legacyStopIsRisky({ scope: "single", kind: "dtach", name: "pf-a", risky: false }),
    ).toBe(false);
    expect(
      legacyStopIsRisky({ scope: "single", kind: "tmux", name: "pf-a", risky: false }),
    ).toBe(false);
  });
});
