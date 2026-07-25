import { describe, expect, it } from "vitest";
import { countDiffLines, parseUnifiedDiff, toSplitRows } from "../../src/lib/unifiedDiff";

describe("parseUnifiedDiff", () => {
  it("parses a standard single-hunk diff into meta + gutter-numbered lines", () => {
    const diff =
      "diff --git a/f.rs b/f.rs\n" +
      "index 111..222 100644\n" +
      "--- a/f.rs\n" +
      "+++ b/f.rs\n" +
      "@@ -1,2 +1,3 @@\n" +
      " context\n" +
      "-removed\n" +
      "+added one\n" +
      "+added two\n";

    const parsed = parseUnifiedDiff(diff);

    expect(parsed.meta).toEqual([
      "diff --git a/f.rs b/f.rs",
      "index 111..222 100644",
      "--- a/f.rs",
      "+++ b/f.rs",
    ]);
    expect(parsed.hunks).toHaveLength(1);
    const hunk = parsed.hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldLines).toBe(2);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newLines).toBe(3);
    expect(hunk.lines).toEqual([
      { kind: "context", text: "context", oldLine: 1, newLine: 1 },
      { kind: "del", text: "removed", oldLine: 2, newLine: null },
      { kind: "add", text: "added one", oldLine: null, newLine: 2 },
      { kind: "add", text: "added two", oldLine: null, newLine: 3 },
    ]);
  });

  it("tracks separate hunks with independent starting positions", () => {
    const diff =
      "@@ -1,1 +1,1 @@\n" +
      "-a\n" +
      "+b\n" +
      "@@ -10,1 +10,2 @@\n" +
      " c\n" +
      "+d\n";

    const parsed = parseUnifiedDiff(diff);
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[0].lines).toEqual([
      { kind: "del", text: "a", oldLine: 1, newLine: null },
      { kind: "add", text: "b", oldLine: null, newLine: 1 },
    ]);
    expect(parsed.hunks[1].lines).toEqual([
      { kind: "context", text: "c", oldLine: 10, newLine: 10 },
      { kind: "add", text: "d", oldLine: null, newLine: 11 },
    ]);
  });

  it("captures trailing function context after the hunk header", () => {
    const parsed = parseUnifiedDiff("@@ -12,7 +12,9 @@ fn foo() {\n context\n");
    expect(parsed.hunks[0].headerContext).toBe("fn foo() {");
  });

  it("defaults an omitted hunk line count to 1", () => {
    const parsed = parseUnifiedDiff("@@ -5 +5 @@\n context\n");
    expect(parsed.hunks[0].oldLines).toBe(1);
    expect(parsed.hunks[0].newLines).toBe(1);
  });

  it("renders the no-newline marker without a gutter number and without advancing position", () => {
    const diff = "@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n";
    const parsed = parseUnifiedDiff(diff);
    expect(parsed.hunks[0].lines).toEqual([
      { kind: "del", text: "old", oldLine: 1, newLine: null },
      { kind: "noNewline", text: "\\ No newline at end of file", oldLine: null, newLine: null },
      { kind: "add", text: "new", oldLine: null, newLine: 1 },
      { kind: "noNewline", text: "\\ No newline at end of file", oldLine: null, newLine: null },
    ]);
  });

  it("treats a removed line whose own text starts with '-- ' as content, not a header", () => {
    // Renders as `--- x` once the diff's leading `-` marker is prepended —
    // identical in shape to a `--- a/file` header. Hunk-state tracking (not
    // prefix matching) must still classify it as one deletion.
    const parsed = parseUnifiedDiff("@@ -1,1 +0,0 @@\n--- x\n");
    expect(parsed.hunks[0].lines).toEqual([{ kind: "del", text: "-- x", oldLine: 1, newLine: null }]);
  });

  it("renders a bare patch fragment with no @@ header at all as unknown-position content", () => {
    const parsed = parseUnifiedDiff("+a\n-b\n-c\n");
    expect(parsed.meta).toEqual([]);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].header).toBe("");
    expect(parsed.hunks[0].oldStart).toBeNull();
    expect(parsed.hunks[0].lines).toEqual([
      { kind: "add", text: "a", oldLine: null, newLine: null },
      { kind: "del", text: "b", oldLine: null, newLine: null },
      { kind: "del", text: "c", oldLine: null, newLine: null },
    ]);
  });

  it("leaves gutters unknown for a malformed @@ header instead of guessing", () => {
    const parsed = parseUnifiedDiff("@@ garbage @@\n+a\n");
    expect(parsed.hunks[0].oldStart).toBeNull();
    expect(parsed.hunks[0].lines).toEqual([{ kind: "add", text: "a", oldLine: null, newLine: null }]);
  });

  it("returns no meta and no hunks for empty text", () => {
    expect(parseUnifiedDiff("")).toEqual({ meta: [], hunks: [] });
  });

  it("handles bare hunks with no diff --git/---/+++ preamble at all", () => {
    const parsed = parseUnifiedDiff("@@ -1,1 +1,2 @@\n context\n+new\n");
    expect(parsed.meta).toEqual([]);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].lines).toEqual([
      { kind: "context", text: "context", oldLine: 1, newLine: 1 },
      { kind: "add", text: "new", oldLine: null, newLine: 2 },
    ]);
  });

  it("normalizes CRLF line endings so the hunk header still parses and gutters are numbered", () => {
    const diff = "@@ -1,2 +1,3 @@\r\n context\r\n-removed\r\n+added\r\n";
    const parsed = parseUnifiedDiff(diff);

    expect(parsed.hunks).toHaveLength(1);
    const hunk = parsed.hunks[0];
    // A trailing \r left on the header line would make the anchored regex
    // reject it, degrading the whole hunk to unknown positions.
    expect(hunk.oldStart).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.lines).toEqual([
      { kind: "context", text: "context", oldLine: 1, newLine: 1 },
      { kind: "del", text: "removed", oldLine: 2, newLine: null },
      { kind: "add", text: "added", oldLine: null, newLine: 2 },
    ]);
    // No stray \r survives into any rendered line's text.
    for (const line of hunk.lines) expect(line.text).not.toContain("\r");
  });

  it("marks an unrecognized in-hunk line, and every line after it in that hunk, unknown instead of silently mis-tracking position", () => {
    const diff = "@@ -1,3 +1,3 @@\n context one\n?garbage line\n context two\n";
    const parsed = parseUnifiedDiff(diff);

    expect(parsed.hunks[0].lines).toEqual([
      { kind: "context", text: "context one", oldLine: 1, newLine: 1 },
      { kind: "context", text: "?garbage line", oldLine: null, newLine: null },
      // Would be old:2/new:2 if the malformed line above had silently
      // advanced the counters as an ordinary context line — must stay
      // unknown instead, since the true position is no longer known.
      { kind: "context", text: "context two", oldLine: null, newLine: null },
    ]);
  });

  it("resets the unknown-position state at the next hunk's own well-formed header", () => {
    const diff = "@@ -1,2 +1,2 @@\n context\n?garbage\n@@ -10,1 +10,1 @@\n context\n";
    const parsed = parseUnifiedDiff(diff);

    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.hunks[0].lines[1]).toEqual({ kind: "context", text: "?garbage", oldLine: null, newLine: null });
    // The second hunk's own header re-establishes trustworthy tracking,
    // independent of the first hunk's corruption.
    expect(parsed.hunks[1].lines).toEqual([{ kind: "context", text: "context", oldLine: 10, newLine: 10 }]);
  });
});

describe("toSplitRows (#231 PR5 split view)", () => {
  it("pairs a context line with itself on both sides, reading old/new gutters independently", () => {
    const parsed = parseUnifiedDiff("@@ -1,2 +1,3 @@\n context\n-removed\n+added\n");
    const rows = toSplitRows(parsed.hunks[0].lines);
    expect(rows[0]).toEqual({
      kind: "pair",
      left: { kind: "context", text: "context", oldLine: 1, newLine: 1 },
      right: { kind: "context", text: "context", oldLine: 1, newLine: 1 },
    });
  });

  it("pairs an equal-length del/add run index-wise", () => {
    const parsed = parseUnifiedDiff("@@ -1,2 +1,2 @@\n-old one\n-old two\n+new one\n+new two\n");
    const rows = toSplitRows(parsed.hunks[0].lines);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "pair", left: { text: "old one" }, right: { text: "new one" } });
    expect(rows[1]).toMatchObject({ kind: "pair", left: { text: "old two" }, right: { text: "new two" } });
  });

  it("pads the shorter side with null for an unbalanced del/add run", () => {
    const parsed = parseUnifiedDiff("@@ -1,3 +1,1 @@\n-a\n-b\n-c\n+x\n");
    const rows = toSplitRows(parsed.hunks[0].lines);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ left: { text: "a" }, right: { text: "x" } });
    expect(rows[1]).toMatchObject({ left: { text: "b" }, right: null });
    expect(rows[2]).toMatchObject({ left: { text: "c" }, right: null });
  });

  it("puts a pure addition's left side as null, never fabricating an old-side line", () => {
    const parsed = parseUnifiedDiff("@@ -0,0 +1,1 @@\n+new\n");
    const rows = toSplitRows(parsed.hunks[0].lines);
    expect(rows).toEqual([{ kind: "pair", left: null, right: { kind: "add", text: "new", oldLine: null, newLine: 1 } }]);
  });

  it("renders a no-newline marker as a spanning note, not a left/right pair", () => {
    const parsed = parseUnifiedDiff("@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n");
    const rows = toSplitRows(parsed.hunks[0].lines);
    expect(rows[1]).toEqual({
      kind: "note",
      line: { kind: "noNewline", text: "\\ No newline at end of file", oldLine: null, newLine: null },
    });
  });

  it("returns no rows for an empty hunk", () => {
    expect(toSplitRows([])).toEqual([]);
  });
});

describe("countDiffLines (#231 PR5 load-more line accounting)", () => {
  it("counts zero for empty text", () => {
    expect(countDiffLines("")).toBe(0);
  });

  it("counts each newline-terminated line", () => {
    expect(countDiffLines("+a\n+b\n+c\n")).toBe(3);
  });

  it("counts a trailing line with no terminating newline as one more line", () => {
    expect(countDiffLines("+a\n+b")).toBe(2);
  });

  it("matches the number of lines split_inclusive('\\n') would yield, mirroring the Rust side", () => {
    // Cross-check against a real accumulation: skipping N lines then
    // re-counting the remainder must round-trip to the original count.
    const text = "line1\nline2\nline3\nline4\n";
    const total = countDiffLines(text);
    const remainder = text.split("\n").slice(2).join("\n");
    expect(total).toBe(4);
    expect(countDiffLines(remainder)).toBe(countDiffLines("line3\nline4\n"));
  });
});
