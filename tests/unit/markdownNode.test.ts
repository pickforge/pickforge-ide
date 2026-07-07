import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/lib/markdown";

describe("renderMarkdown without a DOM", () => {
  it("returns an empty string before DOMPurify can bind to window", () => {
    expect(renderMarkdown("**server**", { cache: false })).toBe("");
  });
});
