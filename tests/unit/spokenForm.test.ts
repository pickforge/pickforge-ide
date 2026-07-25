import { describe, expect, it } from "vitest";
import { spokenForm } from "../../src/lib/spokenForm";
import type { DispatchResult } from "../../src/stores/operator";

describe("spokenForm", () => {
  describe("route outcomes (never gated by risk tier — nothing was dispatched yet)", () => {
    it("maps unclear to a literal spoken reason", () => {
      expect(spokenForm({ kind: "unclear", reason: "missing target and action" })).toBe(
        "I didn't catch that. missing target and action",
      );
    });

    it("maps error to a literal spoken message", () => {
      expect(spokenForm({ kind: "error", message: "model not found" })).toBe(
        "Something went wrong. model not found",
      );
    });

    it("maps needsCredits to a literal string", () => {
      expect(spokenForm({ kind: "needsCredits", balance: 0 })).toBe(
        "You're out of routing credits.",
      );
    });

    it("maps unconfigured to a literal string", () => {
      expect(spokenForm({ kind: "unconfigured" })).toBe("The operator router isn't set up.");
    });
  });

  describe("dispatch outcomes — the safe vs gated matrix", () => {
    const outcomes: Array<{ result: DispatchResult; expected: string }> = [
      { result: { status: "done", summary: "Opened project App" }, expected: "Opened project App" },
      { result: { status: "noop", summary: "Already on that project" }, expected: "Already on that project" },
      {
        result: { status: "denied", message: "dismissed" },
        expected: "Cancelled. dismissed",
      },
      {
        result: { status: "failed", message: "Chat \"ghost\" was not found" },
        expected: "That failed. Chat \"ghost\" was not found",
      },
      {
        result: { status: "unsupported", message: "no active run to reload" },
        expected: "I can't do that. no active run to reload",
      },
    ];

    for (const { result, expected } of outcomes) {
      it(`speaks a risk-tier-0 "${result.status}" result`, () => {
        expect(spokenForm({ kind: "dispatch", result, riskTier: 0 })).toBe(expected);
      });

      it(`never speaks a risk-tier-1 "${result.status}" result (screen-gate only)`, () => {
        expect(spokenForm({ kind: "dispatch", result, riskTier: 1 })).toBeNull();
      });
    }

    it("never speaks a needsConfirmation result at any risk tier — always on-screen", () => {
      const result: DispatchResult = {
        status: "needsConfirmation",
        summary: "Send prompt to active chat",
        auditId: "audit-1",
      };
      expect(spokenForm({ kind: "dispatch", result, riskTier: 0 })).toBeNull();
      expect(spokenForm({ kind: "dispatch", result, riskTier: 1 })).toBeNull();
    });
  });
});
