import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../../src/lib/agentPricing";

describe("estimateCostUsd", () => {
  it("uses cached input pricing for the cached token split", () => {
    expect(
      estimateCostUsd("gpt-5.3-codex-spark", {
        inputTokens: 1_000_000,
        cachedInputTokens: 200_000,
        outputTokens: 500_000,
      }),
    ).toBeCloseTo(1.205);
  });

  it("returns null for unknown models", () => {
    expect(
      estimateCostUsd("unknown-model", {
        inputTokens: 1_000,
        cachedInputTokens: 100,
        outputTokens: 1_000,
      }),
    ).toBeNull();
  });
});
