// Pure parsing of one file's unified-diff TEXT (the body `stores/changes.ts`'s
// `loadChangeDiff` lazily fetches) into displayable hunks with old/new line
// gutters (#231 PR4's Workbench diff view). Mirrors the hunk-STATE tracking
// `crates/pickforge-core/src/git/diff_stat.rs`'s `count_unified_diff_stat`
// already uses for counting, rather than matching line prefixes unconditionally:
// a removed/added content line whose own text happens to start with
// "---"/"+++"/"@@ " is only ever preceded by its diff marker character once
// inside a hunk, so it must never be misread as a header once hunk state says
// "we're inside a hunk". The same input this module renders is exactly the
// text the Rust side already counted — parsing it a second, independent way
// here would risk the two silently disagreeing.
//
// Bare provider diffs (no `diff --git`/`---`/`+++`/`@@` structure at all, or a
// malformed `@@` header) are rendered too, with gutters honestly left `null`
// rather than guessing a starting line number — "unknown stats stay unknown"
// extends to unknown line positions.

export type DiffLineKind = "context" | "add" | "del" | "noNewline";

export interface DiffLine {
  kind: DiffLineKind;
  /** Marker character stripped for context/add/del; the raw line for
   *  `noNewline` (there is no marker to strip). */
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  /** The raw `@@ ... @@` header line, or `""` for a bare fragment with no
   *  header at all. */
  header: string;
  /** Trailing function/section context after the second `@@` (e.g. `fn foo() {`),
   *  trimmed. Empty when the header carries none, or for a bare fragment. */
  headerContext: string;
  oldStart: number | null;
  oldLines: number | null;
  newStart: number | null;
  newLines: number | null;
  lines: DiffLine[];
}

export interface ParsedDiff {
  /** Preamble lines before the first hunk (`diff --git`, `index`, `---`,
   *  `+++`, mode/rename headers) — quiet metadata, never diff content. Empty
   *  for a bare fragment (nothing before its content counts as a header). */
  meta: string[];
  hunks: DiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

function startHunk(line: string): DiffHunk {
  const match = HUNK_HEADER.exec(line);
  if (!match) {
    return {
      header: line,
      headerContext: "",
      oldStart: null,
      oldLines: null,
      newStart: null,
      newLines: null,
      lines: [],
    };
  }
  return {
    header: line,
    headerContext: (match[5] ?? "").trim(),
    oldStart: Number(match[1]),
    oldLines: match[2] !== undefined ? Number(match[2]) : 1,
    newStart: Number(match[3]),
    newLines: match[4] !== undefined ? Number(match[4]) : 1,
    lines: [],
  };
}

interface HunkPos {
  old: number;
  new: number;
  /** Set once an unrecognized in-hunk line (not `+`, `-`, ` `, or the
   *  no-newline `\` marker) is seen — the running old/new counters can no
   *  longer be trusted from that point on, so every line from here through
   *  the end of THIS hunk reports unknown gutters rather than a count that's
   *  silently off by however many unrecognized lines preceded it. Reset per
   *  hunk (a later hunk's own well-formed `@@` header re-establishes trust
   *  independent of an earlier hunk's corruption). */
  desynced: boolean;
}

function pushContentLine(hunk: DiffHunk, raw: string, pos: HunkPos): void {
  const known = hunk.oldStart !== null && !pos.desynced;
  if (raw.startsWith("\\")) {
    hunk.lines.push({ kind: "noNewline", text: raw, oldLine: null, newLine: null });
    return;
  }
  const marker = raw.charAt(0);
  if (marker === "+") {
    hunk.lines.push({ kind: "add", text: raw.slice(1), oldLine: null, newLine: known ? pos.new : null });
    if (known) pos.new += 1;
    return;
  }
  if (marker === "-") {
    hunk.lines.push({ kind: "del", text: raw.slice(1), oldLine: known ? pos.old : null, newLine: null });
    if (known) pos.old += 1;
    return;
  }
  if (marker === " ") {
    hunk.lines.push({ kind: "context", text: raw.slice(1), oldLine: known ? pos.old : null, newLine: known ? pos.new : null });
    if (known) {
      pos.old += 1;
      pos.new += 1;
    }
    return;
  }
  // Unrecognized marker: render it as best-effort context (never drop the
  // line), but position tracking is no longer trustworthy for the rest of
  // this hunk — this line and everything after it in the hunk gets unknown
  // gutters instead of a count built on a guess about what this line was.
  pos.desynced = true;
  hunk.lines.push({ kind: "context", text: raw, oldLine: null, newLine: null });
}

/** Parses one file's unified-diff body into hunks ready for gutter display.
 *  Never throws — a malformed or bare-fragment input degrades to unknown
 *  gutter numbers rather than failing to render. */
export function parseUnifiedDiff(text: string): ParsedDiff {
  if (text.length === 0) return { meta: [], hunks: [] };
  // Normalize CRLF -> LF before splitting: a trailing \r left on a hunk
  // header line makes the anchored `HUNK_HEADER` regex (which ends in `@@$`)
  // reject an otherwise-valid header, silently degrading it to unknown
  // gutters. Content lines get the same treatment for consistency (an "\r"
  // left on a context/add/del line would otherwise render as a trailing
  // invisible character).
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.replace(/\n$/, "").split("\n");
  const sawHunkHeader = lines.some((line) => line.startsWith("@@"));

  const meta: string[] = [];
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  const pos: HunkPos = { old: 0, new: 0, desynced: false };

  for (const line of lines) {
    if (line.startsWith("@@")) {
      current = startHunk(line);
      hunks.push(current);
      pos.old = current.oldStart ?? 0;
      pos.new = current.newStart ?? 0;
      pos.desynced = false;
      continue;
    }
    if (!current) {
      if (sawHunkHeader) {
        meta.push(line);
        continue;
      }
      // No `@@` anywhere in this text: a bare patch fragment. Every line —
      // including this first one — is hunk content with unknown positions.
      current = startHunk("");
      hunks.push(current);
    }
    pushContentLine(current, line, pos);
  }

  return { meta, hunks };
}
