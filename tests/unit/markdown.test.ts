// @vitest-environment jsdom
// DOMPurify needs a real DOM. The default unit env is node (vitest.config.ts),
// so this file opts into jsdom — the environment DOMPurify officially supports.
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/lib/markdown";

describe("renderMarkdown", () => {
  it("renders bold, headings, and code fences to the expected tags", () => {
    expect(renderMarkdown("**bold**")).toContain("<strong>bold</strong>");
    expect(renderMarkdown("# Title")).toContain("<h1>Title</h1>");
    const fence = renderMarkdown("```\ncode\n```");
    expect(fence).toContain("<pre>");
    expect(fence).toContain("<code>");
    expect(fence).toContain("code");
  });

  it("turns a single newline into a <br> (chat line breaks)", () => {
    expect(renderMarkdown("line one\nline two")).toContain("line one<br>line two");
  });

  it("strips <script> tags and their content", () => {
    const html = renderMarkdown("hi <script>alert(1)</script> there");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
  });

  it("strips event-handler attributes", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("strips javascript: URLs from links", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });
});
