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
const ALLOWED_ATTR = ["href", "src", "alt", "title"];

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
