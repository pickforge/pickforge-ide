import { describe, expect, it } from "vitest";
import { compactInline, singleLine } from "../../src/lib/chatDisplay";

describe("chatDisplay", () => {
  it("normalizes multiline text into one display line", () => {
    expect(singleLine("node script.mjs\n  --model gpt\n  --cwd /repo")).toBe(
      "node script.mjs --model gpt --cwd /repo",
    );
  });

  it("clips long inline text", () => {
    expect(compactInline("1234567890", 8)).toBe("12345...");
  });
});
