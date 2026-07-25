// Pure, dependency-free classification of a chat Markdown anchor's `href`
// into one of three application intents (#234): an approved external HTTPS
// link, a workspace source citation (a project-relative or absolute path
// plus an optional line/column location), or an inert `Blocked` target.
//
// This module does no I/O and knows nothing about Tauri, a chat's project
// root, or remote-project state — it is pure syntax classification, safe to
// unit-test exhaustively in isolation. Everything security-relevant that
// requires a filesystem (existence, containment under the chat's project
// root, traversal/symlink-escape rejection) happens one layer up, at the
// Rust trust boundary (`resolve_chat_citation` in `src-tauri/src/fs_commands.rs`)
// — never here. Remote-chat gating (never falling back to a coincidentally
// matching local path) also happens one layer up, since "is this chat
// remote" is state this module deliberately doesn't have access to.
//
// #220's "Project execution routing authority" and "chat-level command
// intent" layers were never shipped (the issue depended on PRs from #220
// that landed elsewhere, if at all — see `openFileInChat` in
// `src/stores/terminalHosts.ts` for what DID land). Keeping this classifier
// pure and dependency-free means a future authority layer can adopt it
// without this module needing to change.

/** A workspace-citation location: 1-based line, optional 1-based column, and
 *  an optional 1-based end line for a `#L12-L18` range. `column` and
 *  `endLine` are mutually exclusive in the canonical grammar (a citation is
 *  either `#L12C4` or `#L12-L18`, never both) — callers that need to tell
 *  those apart can do so from which fields are set. */
export interface ChatCitationLocation {
  line?: number;
  column?: number;
  endLine?: number;
}

export type ChatLinkTarget =
  | { kind: "externalHttps"; url: string }
  | ({ kind: "workspaceCitation"; path: string } & ChatCitationLocation)
  | { kind: "blocked" };

/** The discriminated result of parsing an href as a workspace citation,
 *  independent of whether the caller ultimately routes it anywhere.
 *  `nonCitation` means the href has a recognized non-https URL scheme (it's
 *  clearly a URL, not a path attempt); `malformed` covers every citation-
 *  shaped href that fails one of the locked rejection rules (bad percent-
 *  encoding, a local-link query, NUL/control chars, an unescaped `:`/`#`
 *  delimiter that doesn't resolve to valid location syntax, an invalid/zero/
 *  overflowing position, or an invalid range). */
export type CitationParseResult =
  | ({ kind: "valid"; path: string } & ChatCitationLocation)
  | { kind: "malformed" }
  | { kind: "nonCitation" };

// Defensive length cap — no href this long is a plausible file citation or
// URL; rejecting it early avoids running regex/decode work on adversarial
// input. Not itself a locked contract rule, just cheap defense in depth.
const MAX_HREF_LENGTH = 8192;

// A curated set of well-known non-https URL schemes. Recognizing ONLY these
// (rather than any `[a-z...]+:` run) matters: a generic scheme sniff would
// misclassify a bare compat-form citation like `a.ts:12` (no directory
// separator before the colon) as scheme `a.ts` and wrongly block it. Any
// scheme NOT in this list still can't smuggle a citation through unharmed —
// the ambiguous-delimiter rule below rejects a raw `:` that isn't part of
// valid `:line[:column]` location syntax, so an unrecognized scheme like
// `vbscript:alert(1)` is rejected as malformed on that basis instead.
const KNOWN_NON_HTTPS_SCHEMES = new Set([
  "http",
  "ftp",
  "ftps",
  "mailto",
  "file",
  "javascript",
  "data",
  "tel",
  "sms",
  "ws",
  "wss",
  "ssh",
  "git",
  "vscode",
  "about",
  "blob",
]);

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const HOSTLESS_HTTPS_PREFIX = "https:///";
// A generous but finite bound (u32::MAX) — line/column never cross the Rust
// IPC boundary in this design (only the resolved PATH does; the location is
// consumed entirely client-side when constructing an editor command — see
// `stores/fileOpenSettings.ts`'s `editorCommand`), so this exists purely to
// give "overflowing position" a concrete, testable rejection threshold.
const MAX_POSITION = 0xffffffff;

const LINE_RE = /^L(\d+)$/;
const LINE_COL_RE = /^L(\d+)C(\d+)$/;
const RANGE_RE = /^L(\d+)-L(\d+)$/;

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** The href's leading URL scheme if it's a KNOWN one (see
 *  `KNOWN_NON_HTTPS_SCHEMES`) or `"https"`, else `null` — either there's no
 *  scheme-shaped prefix, it's a single-letter Windows drive (`C:\...`,
 *  `C:/...`), or it's an unrecognized token that will be handled by the
 *  citation parser's own ambiguous-delimiter rule instead. */
function detectKnownScheme(href: string): string | null {
  const m = SCHEME_RE.exec(href);
  if (!m) return null;
  const raw = m[1];
  if (raw.length === 1) return null; // Windows drive letter, never a scheme
  const scheme = raw.toLowerCase();
  return scheme === "https" || KNOWN_NON_HTTPS_SCHEMES.has(scheme) ? scheme : null;
}

function isWindowsDriveStart(s: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(s);
}

function parsePosition(digits: string): number | null {
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length > 10) return null; // fast overflow guard
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_POSITION) return null;
  return n;
}

function parseFragmentLocation(fragment: string): ChatCitationLocation | null {
  let m = LINE_COL_RE.exec(fragment);
  if (m) {
    const line = parsePosition(m[1]);
    const column = parsePosition(m[2]);
    if (line === null || column === null) return null;
    return { line, column };
  }
  m = RANGE_RE.exec(fragment);
  if (m) {
    const line = parsePosition(m[1]);
    const endLine = parsePosition(m[2]);
    if (line === null || endLine === null) return null;
    if (endLine < line) return null; // invalid range
    // A zero-width range (`#L12-L12`) carries no more information than a
    // single line — normalize it away so callers only ever see `endLine` for
    // an ACTUAL multi-line range, never an incidental self-range.
    if (endLine === line) return { line };
    return { line, endLine };
  }
  m = LINE_RE.exec(fragment);
  if (m) {
    const line = parsePosition(m[1]);
    if (line === null) return null;
    return { line };
  }
  return null;
}

/** Peel at most two trailing `:<digits>` groups off the end of `s`, one at a
 *  time. Returns the remaining prefix and the extracted digit strings in
 *  left-to-right (line, [column]) order. Used for the `:line[:column]`
 *  compatibility form — anything left in `prefix` that still contains a raw
 *  `:` was NOT part of a recognized trailing location and is therefore an
 *  unescaped delimiter, not part of the filename (the caller rejects it). */
function splitTrailingColonDigits(s: string): { prefix: string; digits: string[] } {
  const groups: string[] = [];
  let rest = s;
  for (let i = 0; i < 2; i++) {
    const m = /:(\d+)$/.exec(rest);
    if (!m) break;
    groups.unshift(m[1]);
    rest = rest.slice(0, rest.length - m[0].length);
  }
  return { prefix: rest, digits: groups };
}

/** Parse `href` as a workspace citation. Percent escapes in the path are
 *  decoded exactly once, after structural parsing (delimiter detection,
 *  location-suffix extraction) has already happened on the RAW string — so a
 *  percent-encoded `:` or `#` (`%3A`, `%23`) decodes to a literal character
 *  in the final path rather than being treated as a delimiter, matching the
 *  rule that a literal `:`/`#` in a filename must be percent-encoded. */
// eslint-disable-next-line complexity -- exhaustive, locked rejection-class parsing; see #234.
export function parseWorkspaceCitation(href: string): CitationParseResult {
  if (!href || hasControlChars(href)) return { kind: "malformed" };
  if (href.length > MAX_HREF_LENGTH) return { kind: "malformed" };
  if (detectKnownScheme(href) !== null) return { kind: "nonCitation" };

  const structuralPrefixLen = isWindowsDriveStart(href) ? 2 : 0;
  const hashIdx = href.indexOf("#", structuralPrefixLen);
  const beforeHash = hashIdx === -1 ? href : href.slice(0, hashIdx);
  const fragment = hashIdx === -1 ? null : href.slice(hashIdx + 1);

  // A local citation has no meaningful query string — reject rather than
  // silently discarding it (a "local-link query" is explicitly rejected).
  if (beforeHash.includes("?")) return { kind: "malformed" };

  let rawPath: string;
  let location: ChatCitationLocation = {};

  if (fragment !== null) {
    // Canonical `#Lxx` form: a raw `:` beyond the Windows-drive prefix is
    // ambiguous here (the compatibility form doesn't apply once `#` is
    // present) and must have been percent-encoded to be literal.
    if (beforeHash.slice(structuralPrefixLen).includes(":")) {
      return { kind: "malformed" };
    }
    const loc = parseFragmentLocation(fragment);
    if (loc === null) return { kind: "malformed" };
    rawPath = beforeHash;
    location = loc;
  } else {
    const rest = beforeHash.slice(structuralPrefixLen);
    const { prefix, digits } = splitTrailingColonDigits(rest);
    if (prefix.includes(":")) {
      // Either a raw `:` survived extraction (ambiguous — not part of a
      // recognized trailing location) or there was a `:` with no numeric
      // location at all. Either way it needed percent-encoding to be literal.
      return { kind: "malformed" };
    }
    rawPath = beforeHash.slice(0, structuralPrefixLen) + prefix;
    if (digits.length >= 1) {
      const line = parsePosition(digits[0]);
      if (line === null) return { kind: "malformed" };
      location = { line };
    }
    if (digits.length === 2) {
      const column = parsePosition(digits[1]);
      if (column === null) return { kind: "malformed" };
      location = { ...location, column };
    }
  }

  if (rawPath.length === 0) return { kind: "malformed" };

  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return { kind: "malformed" }; // malformed percent-encoding
  }
  if (path.length === 0 || hasControlChars(path)) return { kind: "malformed" };

  return { kind: "valid", path, ...location };
}

function classifyHttps(href: string): ChatLinkTarget {
  const trimmed = href.trimStart();
  if (trimmed.slice(0, HOSTLESS_HTTPS_PREFIX.length).toLowerCase() === HOSTLESS_HTTPS_PREFIX) {
    return { kind: "blocked" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { kind: "blocked" };
  }
  if (url.protocol !== "https:") return { kind: "blocked" };
  if (!url.hostname) return { kind: "blocked" };
  if (url.username !== "" || url.password !== "") return { kind: "blocked" };
  return { kind: "externalHttps", url: url.href };
}

/** Classify a raw Markdown anchor `href` into its application intent. Pure
 *  and synchronous — never touches the filesystem, Tauri, or chat/project
 *  state. HTTPS is recognized before local-path syntax; a Windows drive path
 *  (`C:\...`) is never mistaken for a URL scheme. */
export function classifyChatLink(rawHref: string): ChatLinkTarget {
  if (typeof rawHref !== "string" || rawHref.length === 0 || rawHref.length > MAX_HREF_LENGTH) {
    return { kind: "blocked" };
  }
  if (hasControlChars(rawHref)) return { kind: "blocked" };

  const scheme = detectKnownScheme(rawHref);
  if (scheme === "https") return classifyHttps(rawHref);
  if (scheme !== null) return { kind: "blocked" };

  const parsed = parseWorkspaceCitation(rawHref);
  if (parsed.kind !== "valid") return { kind: "blocked" };
  return {
    kind: "workspaceCitation",
    path: parsed.path,
    line: parsed.line,
    column: parsed.column,
    endLine: parsed.endLine,
  };
}
