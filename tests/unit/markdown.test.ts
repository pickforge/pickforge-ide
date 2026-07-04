// @vitest-environment jsdom
// DOMPurify needs a real DOM. The default unit env is node (vitest.config.ts),
// so this file opts into jsdom — the environment DOMPurify officially supports.
import { describe, expect, it } from "vitest";
import { embedImageMarkers, renderMarkdown } from "../../src/lib/markdown";

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

describe("embedImageMarkers", () => {
  it("replaces in-range markers with indexed thumbnail placeholders", () => {
    const out = embedImageMarkers("compare [Image #1] with [Image #2]", 2);
    expect(out).toContain('data-pf-image-index="0"');
    expect(out).toContain('data-pf-image-index="1"');
    expect(out).not.toContain("[Image #1]");
    expect(out).not.toContain("[Image #2]");
    // The path never enters the markup — only the zero-based index does.
    expect(out).not.toContain("src=");
  });

  it("leaves out-of-range and zero markers as literal text", () => {
    expect(embedImageMarkers("see [Image #3]", 2)).toBe("see [Image #3]");
    expect(embedImageMarkers("see [Image #0]", 2)).toBe("see [Image #0]");
    expect(embedImageMarkers("none [Image #1]", 0)).toBe("none [Image #1]");
  });

  it("survives markdown sanitization without escaping the placeholder", () => {
    const html = renderMarkdown(embedImageMarkers("here: [Image #1]", 1));
    expect(html).toContain("<img");
    expect(html).toContain('data-pf-image-index="0"');
    expect(html).not.toContain("&lt;img");
  });
});
