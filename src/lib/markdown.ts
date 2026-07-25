// Render chat message text as GitHub-flavored markdown, sanitized before it is
// ever injected via innerHTML. Never return HTML that hasn't passed DOMPurify.
import { marked, type Tokens } from "marked";
import createDOMPurify from "dompurify";
import { classifyChatLink } from "./chatLinkTarget";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "img",
];
const ALLOWED_ATTR = ["href", "src", "alt", "title", "data-pf-image-index", "data-pf-chat-link"];
const MARKDOWN_CACHE_LIMIT = 256;

let purifier: ReturnType<typeof createDOMPurify> | undefined;
const markdownCache = new Map<string, string>();

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// A custom link renderer that classifies each href with the SAME pure
// classifier (#234) the click handler reclassifies at click time, and
// rewrites everything except an approved `https://` URL to an inert `#`
// href carrying the raw original value only as an opaque `data-pf-chat-link`
// attribute. Two things this buys, together:
//
// - DOMPurify's default URI policy (untouched — no scheme allowlist change
//   here) only inspects `href`/`src`. A citation-shaped href like `a.ts:12`
//   would otherwise look like an unrecognized URI scheme ("a.ts:") to that
//   policy and get silently stripped; routing it through a data attribute
//   instead means DOMPurify never has an opinion on it.
// - The DOM-visible `href` is always either a real https URL or the inert
//   "#" fragment — never a value that could itself navigate the webview if
//   `preventDefault()` were somehow skipped (a defense-in-depth backstop for
//   the click handler's own responsibility, not a replacement for it).
//
// The click path re-classifies from this same attribute; nothing here
// decides what happens on click, only what's safe to put in the DOM.
marked.use({
  renderer: {
    link(this: { parser: { parseInline: (tokens: Tokens.Link["tokens"]) => string } }, token) {
      const { href, title, tokens } = token as Tokens.Link;
      const text = this.parser.parseInline(tokens);
      const titleAttr = title ? ` title="${escapeHtmlAttr(title)}"` : "";
      const target = classifyChatLink(href ?? "");
      if (target.kind === "externalHttps") {
        return `<a href="${escapeHtmlAttr(target.url)}"${titleAttr}>${text}</a>`;
      }
      return `<a href="#" data-pf-chat-link="${escapeHtmlAttr(href ?? "")}"${titleAttr}>${text}</a>`;
    },
  },
});

function sanitize(html: string): string {
  if (typeof window === "undefined") return "";
  purifier ??= createDOMPurify(window);
  return purifier.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}

export function renderMarkdown(text: string, options: { cache?: boolean } = {}): string {
  const cache = options.cache ?? true;
  if (!cache) {
    const html = marked.parse(text, { async: false, breaks: true, gfm: true });
    return sanitize(html);
  }

  const cached = markdownCache.get(text);
  if (cached !== undefined) {
    markdownCache.delete(text);
    markdownCache.set(text, cached);
    return cached;
  }
  const html = marked.parse(text, { async: false, breaks: true, gfm: true });
  const sanitized = sanitize(html);
  markdownCache.set(text, sanitized);
  if (markdownCache.size > MARKDOWN_CACHE_LIMIT) {
    const oldest = markdownCache.keys().next().value;
    if (oldest !== undefined) markdownCache.delete(oldest);
  }
  return sanitized;
}

// Replace `[Image #N]` markers (N is 1-based into a message's attachments) with a
// sanitizer-safe inline thumbnail placeholder. The placeholder carries only the
// zero-based index as a data attribute — never a file path — so the caller can
// hydrate the real src onto the DOM node after sanitization without routing an
// asset URL through DOMPurify. Markers whose N is out of range stay literal text.
export function embedImageMarkers(text: string, imageCount: number): string {
  return text.replace(/\[Image #(\d+)\]/g, (match, digits: string) => {
    const n = Number(digits);
    if (!Number.isInteger(n) || n < 1 || n > imageCount) return match;
    return `<img data-pf-image-index="${n - 1}" alt="" />`;
  });
}

/** Zero-based indexes of the attachments a message's `[Image #N]` markers
 *  reference — those render inline, so the attachment strip skips them. */
export function referencedImageIndexes(text: string, imageCount: number): Set<number> {
  const indexes = new Set<number>();
  for (const match of text.matchAll(/\[Image #(\d+)\]/g)) {
    const n = Number(match[1]);
    if (Number.isInteger(n) && n >= 1 && n <= imageCount) indexes.add(n - 1);
  }
  return indexes;
}
