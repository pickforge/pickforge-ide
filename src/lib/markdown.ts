// Render chat message text as GitHub-flavored markdown, sanitized before it is
// ever injected via innerHTML. Never return HTML that hasn't passed DOMPurify.
import { marked } from "marked";
import createDOMPurify from "dompurify";

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
const ALLOWED_ATTR = ["href", "src", "alt", "title", "data-pf-image-index"];

let purifier: ReturnType<typeof createDOMPurify> | undefined;

function sanitize(html: string): string {
  if (typeof window === "undefined") return "";
  purifier ??= createDOMPurify(window);
  return purifier.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, breaks: true, gfm: true });
  return sanitize(html);
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
