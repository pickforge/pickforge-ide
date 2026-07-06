import { describe, expect, it } from "vitest";
import { compactInline, hasHiddenDetail, singleLine } from "../../src/lib/chatDisplay";

describe("chatDisplay", () => {
  it("normalizes multiline text into one display line", () => {
    expect(singleLine("node script.mjs\n  --model gpt\n  --cwd /repo")).toBe(
      "node script.mjs --model gpt --cwd /repo",
    );
  });

  it("clips long inline text", () => {
    expect(compactInline("1234567890", 8)).toBe("12345...");
  });

  it("detects hidden detail when clipped", () => {
    expect(hasHiddenDetail("1234567890", 8)).toBe(true);
  });

  it("detects hidden detail when multi-line collapses", () => {
    expect(hasHiddenDetail("line one\nline two", 200)).toBe(true);
  });

  it("returns false when the value fits on a single line", () => {
    expect(hasHiddenDetail("short", 20)).toBe(false);
  });

  it("returns false for empty or missing values", () => {
    expect(hasHiddenDetail(null)).toBe(false);
    expect(hasHiddenDetail("")).toBe(false);
    expect(hasHiddenDetail("   ")).toBe(false);
  });
});
