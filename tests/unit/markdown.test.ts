// @vitest-environment jsdom
// DOMPurify needs a real DOM. The default unit env is node (vitest.config.ts),
// so this file opts into jsdom — the environment DOMPurify officially supports.
import { describe, expect, it } from "vitest";
import { embedImageMarkers, referencedImageIndexes, renderMarkdown } from "../../src/lib/markdown";

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

  it("neutralizes a javascript: link to an inert '#' href (#234)", () => {
    // The chat-link renderer (#234) rewrites every non-https href to an inert
    // "#" href before DOMPurify ever runs, carrying the original value only
    // in a non-navigable `data-pf-chat-link` attribute the click handler
    // reclassifies — so the raw scheme text can appear in that attribute's
    // VALUE without ever reaching a navigable href/src.
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).toContain('href="#"');
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it("can skip the shared render cache for streaming prefixes", () => {
    const first = renderMarkdown("stream **one**", { cache: false });
    const second = renderMarkdown("stream **one**", { cache: false });

    expect(first).toBe(second);
    expect(second).toContain("<strong>one</strong>");
  });

  it("reuses cached final markdown renders", () => {
    const first = renderMarkdown("cached **final**");
    const second = renderMarkdown("cached **final**");

    expect(first).toBe(second);
    expect(second).toContain("<strong>final</strong>");
  });

  it("evicts old cached markdown entries", () => {
    for (let i = 0; i < 260; i += 1) {
      expect(renderMarkdown(`cached entry ${i}`)).toContain(`cached entry ${i}`);
    }
  });
});

describe("renderMarkdown: chat-link classification (#234)", () => {
  it("keeps an approved https href navigable as-is", () => {
    const html = renderMarkdown("[docs](https://example.com/a?b=1)");
    expect(html).toContain('href="https://example.com/a?b=1"');
    expect(html).not.toContain("data-pf-chat-link");
  });

  it("rewrites a workspace-citation-shaped href to the inert marker, preserving the raw value", () => {
    const html = renderMarkdown("[a.ts](src/a.ts#L12C4)");
    expect(html).toContain('href="#"');
    expect(html).toContain('data-pf-chat-link="src/a.ts#L12C4"');
  });

  it("rewrites an http (non-https) href to the inert marker too", () => {
    const html = renderMarkdown("[insecure](http://example.com)");
    expect(html).toContain('href="#"');
    expect(html).toContain('data-pf-chat-link="http://example.com"');
  });

  it("survives sanitization for a bare-filename compat citation DOMPurify's default policy would otherwise scheme-sniff and strip", () => {
    // "a.ts:12" looks like an unrecognized URI scheme ("a.ts:") to
    // DOMPurify's default ALLOWED_URI_REGEXP if it ever reached `href`
    // directly — routing it through the data attribute avoids that entirely.
    const html = renderMarkdown("[a](a.ts:12)");
    expect(html).toContain('href="#"');
    expect(html).toContain('data-pf-chat-link="a.ts:12"');
  });

  it("preserves a link title", () => {
    const html = renderMarkdown('[a](src/a.ts#L1 "open a.ts")');
    expect(html).toContain('title="open a.ts"');
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

describe("referencedImageIndexes", () => {
  it("collects zero-based indexes of in-range markers only", () => {
    const refs = referencedImageIndexes("see [Image #1] and [Image #3] and [Image #9]", 3);
    expect([...refs].sort()).toEqual([0, 2]);
  });

  it("returns an empty set for markerless text", () => {
    expect(referencedImageIndexes("plain text", 2).size).toBe(0);
  });
});
