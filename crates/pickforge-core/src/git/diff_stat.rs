//! Pure parsing of `git diff` stat output into [`ChangedFile`] rows (#231 PR
//! 1). Two shapes come in:
//!
//! - `git diff --numstat -z`: exact per-file added/deleted line counts.
//! - `git diff --name-status -z`: status letters (A/M/D/R/C/T) and, for
//!   renames/copies, the old path.
//!
//! Git does not let one invocation emit both, so callers run two commands
//! over the same diff range and [`merge_changed_files`] joins them by path.
//! Everything here takes bytes/strings already captured by the caller — no
//! process spawning (that stays in `git::mod` / a later PR's command layer).
//!
//! Stats are parsed once, here, for both the Git path (numstat) and the
//! provider-turn path (raw unified-diff text via [`count_unified_diff_stat`],
//! used by `crate::changes::turn` when a provider event carries a diff body).
//! Diff/index/hunk header lines and the "no newline" marker never count as
//! content lines in either path.
//!
//! Every stat-bearing type in this module obeys one invariant, enforced by
//! [`known_counts`] at every construction site: `binary || truncated` means
//! `additions`/`deletions` are `None`, never a partial or stale count.

use std::collections::HashMap;

use crate::changes::{ChangeFileStatus, ChangedFile};

/// Hard cap on numstat/name-status records parsed from one git invocation. A
/// pathological change (a rebase touching a vendored tree, a bad
/// `.gitignore`) could otherwise make the parser walk unbounded memory; no
/// single reviewable change-set needs more than this many rows.
const MAX_DIFF_STAT_ENTRIES: usize = 20_000;

/// Hard cap on raw bytes scanned per invocation, ahead of the entry-count cap
/// tripping (e.g. one absurdly long path). Bytes beyond this are never
/// scanned — the crate bounds every git-derived input the same way it bounds
/// git command time. `pub(crate)` so the git-live command layer
/// (`crate::git::working_tree`, #231 PR2) can cap the *process capture* of a
/// `--numstat`/`--name-status` invocation at the same limit this module
/// already applies when parsing it — one number governs both layers instead
/// of two independently-chosen ones drifting apart.
pub(crate) const MAX_DIFF_STAT_BYTES: usize = 8 * 1024 * 1024;

/// A numstat count field above this is not a plausible line count (no real
/// text file — or even a generated one — legitimately reaches it); treat it
/// as unparsable/untrusted rather than trust an absurd value.
const MAX_PLAUSIBLE_LINE_COUNT: u64 = 50_000_000;

/// Hard cap on unified-diff body lines hand-counted by
/// [`count_unified_diff_stat`] (provider-supplied diffs, which unlike `git
/// --numstat` are not pre-counted by Git). Mirrors [`MAX_DIFF_STAT_ENTRIES`]'s
/// rationale for the line-scanning path. `pub(crate)` — also the display-text
/// line bound for [`bound_diff_display`] (#231 PR2), so a lazily-fetched
/// per-file diff's returned text and its stat-counting pass are bounded by
/// the same number.
pub(crate) const MAX_DIFF_BODY_LINES: usize = 200_000;

/// Byte-length counterpart to [`MAX_DIFF_BODY_LINES`]; also reused by
/// [`bound_diff_display`], see that constant's doc comment.
pub(crate) const MAX_DIFF_BODY_BYTES: usize = 8 * 1024 * 1024;

/// Enforces the crate's "unknown stats stay unknown" invariant at every
/// construction site in this module (and in `crate::changes::turn`'s fold,
/// which shares it): whenever content is binary or a parse/count was
/// bounded/truncated, neither count may carry a partial or stale value —
/// both collapse to `None`. Never call this only for the branches that
/// "look" unknown; call it unconditionally so the invariant holds by
/// construction, not by convention.
pub(crate) fn known_counts(
    additions: Option<u64>,
    deletions: Option<u64>,
    binary: bool,
    truncated: bool,
) -> (Option<u64>, Option<u64>) {
    if binary || truncated {
        (None, None)
    } else {
        (additions, deletions)
    }
}

/// One `--numstat -z` record: exact added/deleted line counts, or unknown for
/// binary content or an unparsable/out-of-range field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffStatEntry {
    pub path: String,
    /// Raw path bytes exactly as git emitted them, kept alongside the
    /// lossily-decoded `path` purely so [`merge_changed_files`] can join two
    /// parses by exact byte identity. Two distinct invalid-UTF-8 paths can
    /// lossily decode to the *same* `String` (both collapse to the same run
    /// of U+FFFD replacement characters), which would otherwise silently
    /// conflate their stats. This never leaves the parser layer — the
    /// contract-facing [`ChangedFile::path`] stays the lossy display string.
    pub path_bytes: Vec<u8>,
    pub old_path: Option<String>,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
    pub binary: bool,
    /// The count fields for this record could not be trusted (unparsable or
    /// beyond [`MAX_PLAUSIBLE_LINE_COUNT`]) — distinct from `binary`, whose
    /// dash markers are an expected, well-formed "no stats" case.
    pub truncated: bool,
}

/// Result of a bounded `--numstat -z` parse.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DiffStatParse {
    pub entries: Vec<DiffStatEntry>,
    /// More records existed in the input than [`MAX_DIFF_STAT_ENTRIES`] /
    /// [`MAX_DIFF_STAT_BYTES`] allowed scanning; `entries` is a prefix.
    pub truncated: bool,
}

/// One `--name-status -z` record: a status letter plus path(s).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NameStatusEntry {
    pub path: String,
    /// See [`DiffStatEntry::path_bytes`] — same rationale, same join use.
    pub path_bytes: Vec<u8>,
    pub old_path: Option<String>,
    pub status: ChangeFileStatus,
}

/// Result of a bounded `--name-status -z` parse.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct NameStatusParse {
    pub entries: Vec<NameStatusEntry>,
    pub truncated: bool,
}

/// Parses `git diff --numstat -z` output. `-z` makes each record NUL
/// (`\0`) terminated with no quoting, so paths with spaces/unicode round-trip
/// exactly; a rename record's numeric fields are followed by an *empty*
/// path token, then the old path, then the new path (verified against git
/// 2.50 — `git diff --cached --numstat -z` after `git mv a b`).
pub fn parse_numstat_z(raw: &[u8]) -> DiffStatParse {
    let (bytes, mut truncated) = bound_bytes(raw);
    let mut tokens = bytes.split(|&b| b == 0).filter(|t| !t.is_empty());
    let mut entries = Vec::new();

    while let Some(record) = tokens.next() {
        if entries.len() >= MAX_DIFF_STAT_ENTRIES {
            truncated = true;
            break;
        }
        let Some(entry) = parse_numstat_record(record, &mut tokens) else {
            truncated = true;
            break;
        };
        entries.push(entry);
    }

    DiffStatParse { entries, truncated }
}

/// Parses one numstat record (already split on the two leading tabs) plus,
/// for a rename, the two extra NUL-delimited path tokens that follow it.
fn parse_numstat_record<'a>(
    record: &[u8],
    tokens: &mut impl Iterator<Item = &'a [u8]>,
) -> Option<DiffStatEntry> {
    let first_tab = record.iter().position(|&b| b == b'\t')?;
    let rest = &record[first_tab + 1..];
    let second_tab = rest.iter().position(|&b| b == b'\t')?;
    let added_raw = &record[..first_tab];
    let deleted_raw = &rest[..second_tab];
    let path_raw = &rest[second_tab + 1..];

    let (additions, deletions, binary, truncated) = parse_stat_pair(added_raw, deleted_raw);

    if path_raw.is_empty() {
        let old_tok = tokens.next()?;
        let new_tok = tokens.next()?;
        return Some(DiffStatEntry {
            path: lossy_path(new_tok),
            path_bytes: new_tok.to_vec(),
            old_path: Some(lossy_path(old_tok)),
            additions,
            deletions,
            binary,
            truncated,
        });
    }

    Some(DiffStatEntry {
        path: lossy_path(path_raw),
        path_bytes: path_raw.to_vec(),
        old_path: None,
        additions,
        deletions,
        binary,
        truncated,
    })
}

/// Decodes added/deleted numstat fields: `-`/`-` means binary (no line
/// stats, ever); otherwise each field must be a plain decimal integer within
/// [`MAX_PLAUSIBLE_LINE_COUNT`]. If *either* field fails to parse or is out
/// of range, the record is untrustworthy as a whole — both counts become
/// `None`, never "one known, one unknown" (a single bad field must not leave
/// a half-correct row).
fn parse_stat_pair(added: &[u8], deleted: &[u8]) -> (Option<u64>, Option<u64>, bool, bool) {
    if added == b"-" && deleted == b"-" {
        return (None, None, true, false);
    }
    let additions = parse_line_count(added);
    let deletions = parse_line_count(deleted);
    let truncated = additions.is_none() || deletions.is_none();
    let (additions, deletions) = known_counts(additions, deletions, false, truncated);
    (additions, deletions, false, truncated)
}

fn parse_line_count(raw: &[u8]) -> Option<u64> {
    let text = std::str::from_utf8(raw).ok()?;
    let value: u64 = text.parse().ok()?;
    (value <= MAX_PLAUSIBLE_LINE_COUNT).then_some(value)
}

/// Parses `git diff --name-status -z` output. Same `-z` record shape as
/// numstat: a rename/copy status token (`R100`, `C100`, ...) is followed by
/// the old path then the new path; every other status is followed by one
/// path.
pub fn parse_name_status_z(raw: &[u8]) -> NameStatusParse {
    let (bytes, mut truncated) = bound_bytes(raw);
    let mut tokens = bytes.split(|&b| b == 0).filter(|t| !t.is_empty());
    let mut entries = Vec::new();

    while let Some(code_tok) = tokens.next() {
        if entries.len() >= MAX_DIFF_STAT_ENTRIES {
            truncated = true;
            break;
        }
        let Some(entry) = parse_name_status_record(code_tok, &mut tokens) else {
            truncated = true;
            break;
        };
        entries.push(entry);
    }

    NameStatusParse { entries, truncated }
}

fn parse_name_status_record<'a>(
    code_tok: &[u8],
    tokens: &mut impl Iterator<Item = &'a [u8]>,
) -> Option<NameStatusEntry> {
    let letter = *code_tok.first()?;
    let status = classify_diff_name_status(letter);
    let renamed_or_copied = letter == b'R' || letter == b'C';

    if renamed_or_copied {
        let old_tok = tokens.next()?;
        let new_tok = tokens.next()?;
        return Some(NameStatusEntry {
            path: lossy_path(new_tok),
            path_bytes: new_tok.to_vec(),
            old_path: Some(lossy_path(old_tok)),
            status,
        });
    }

    let path_tok = tokens.next()?;
    Some(NameStatusEntry {
        path: lossy_path(path_tok),
        path_bytes: path_tok.to_vec(),
        old_path: None,
        status,
    })
}

/// Maps a `--name-status` letter to the locked five-way status. `C` (copy,
/// only emitted with `--find-copies`) is mapped to `Add`: unlike a rename the
/// source file is untouched, so "rename" would misrepresent it; `T`
/// (type-change, e.g. file <-> symlink) and any other/future letter fall
/// back to `Modify` so a changed path is never silently dropped.
fn classify_diff_name_status(letter: u8) -> ChangeFileStatus {
    match letter {
        b'A' => ChangeFileStatus::Add,
        b'D' => ChangeFileStatus::Delete,
        b'R' => ChangeFileStatus::Rename,
        b'C' => ChangeFileStatus::Add,
        _ => ChangeFileStatus::Modify,
    }
}

/// The seven `XY` codes `git status` documents as "Unmerged" — the only
/// codes representing a conflict. `AA`/`DD` (both sides added/deleted) are
/// not a compositional "either side is U" pattern, so this is an exact set,
/// not a derived rule.
const UNMERGED_PORCELAIN_CODES: [&str; 7] = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"];

/// Maps a `git status --porcelain` two-letter `XY` code to the locked
/// five-way status. Conflicts are a Git-live concept (`git diff
/// --name-status` does not cleanly represent unmerged paths — see the module
/// fixtures), so this reads the same porcelain codes `crate::git::status`
/// already parses, not diff output.
pub fn classify_porcelain_status(code: &str) -> ChangeFileStatus {
    if UNMERGED_PORCELAIN_CODES.contains(&code) {
        return ChangeFileStatus::Conflict;
    }
    let bytes = code.as_bytes();
    let (x, y) = (bytes.first().copied(), bytes.get(1).copied());
    if x == Some(b'R') || y == Some(b'R') {
        return ChangeFileStatus::Rename;
    }
    if code == "??" || x == Some(b'A') || y == Some(b'A') {
        return ChangeFileStatus::Add;
    }
    if x == Some(b'D') || y == Some(b'D') {
        return ChangeFileStatus::Delete;
    }
    ChangeFileStatus::Modify
}

/// Joins a `--name-status -z` parse with a `--numstat -z` parse from the same
/// diff invocation into [`ChangedFile`] rows. `staged` reflects which single
/// invocation produced both inputs (`--cached` vs. not) — a file with both
/// staged and unstaged changes requires the caller to merge two calls, which
/// is a live working-tree (PR2) concern, not this pure join.
///
/// Joins on [`DiffStatEntry::path_bytes`] / [`NameStatusEntry::path_bytes`]
/// — the raw bytes git emitted — never on the lossily-decoded `path`
/// `String`. Two distinct invalid-UTF-8 paths can decode to an identical
/// lossy string; joining on that string would silently pair one file's
/// status with a different file's stats.
pub fn merge_changed_files(
    name_status: &[NameStatusEntry],
    numstat: &[DiffStatEntry],
    staged: bool,
) -> Vec<ChangedFile> {
    let stats_by_path: HashMap<&[u8], &DiffStatEntry> = numstat
        .iter()
        .map(|entry| (entry.path_bytes.as_slice(), entry))
        .collect();

    name_status
        .iter()
        .map(|entry| {
            let stat = stats_by_path.get(entry.path_bytes.as_slice()).copied();
            build_changed_file(entry, stat, staged)
        })
        .collect()
}

fn build_changed_file(
    entry: &NameStatusEntry,
    stat: Option<&DiffStatEntry>,
    staged: bool,
) -> ChangedFile {
    let binary = stat.is_some_and(|s| s.binary);
    let truncated = stat.is_some_and(|s| s.truncated);
    let (additions, deletions) = known_counts(
        stat.and_then(|s| s.additions),
        stat.and_then(|s| s.deletions),
        binary,
        truncated,
    );
    ChangedFile {
        path: entry.path.clone(),
        old_path: entry
            .old_path
            .clone()
            .or_else(|| stat.and_then(|s| s.old_path.clone())),
        status: entry.status,
        staged: staged.then_some(true),
        unstaged: (!staged).then_some(true),
        additions,
        deletions,
        binary,
        truncated,
        diff_available: true,
    }
}

/// Additions/deletions hand-counted from a full unified-diff body (as
/// opposed to Git's own pre-counted `--numstat`). Used for provider-supplied
/// diff text, which has no separate numeric stat channel and, unlike a git
/// invocation's output, is not guaranteed to include `diff --git`/`---`/
/// `+++` file headers at all — some providers hand over a bare hunk, or even
/// bare `+`/`-` lines with no `@@` header either.
///
/// Tracks hunk state rather than matching header prefixes unconditionally:
/// `---`/`+++` file headers and other metadata only ever appear *outside* a
/// hunk (before the first `@@`); once inside a hunk, only the line's leading
/// marker character (`+`, `-`, or context/other) classifies it. This matters
/// because a *removed* content line whose own text starts with `-- ` (a
/// SQL/Lua comment, say) renders as `--- ...` once the diff's leading `-`
/// marker is prepended — indistinguishable from a `--- a/file` header by
/// prefix alone. Matching by hunk state instead of prefix gets this right.
/// When the text contains no `@@` line at all, there is no header/hunk
/// structure to speak of, so every line is treated as hunk content from the
/// start (a bare patch fragment, not a headerless-but-real unified diff).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DiffBodyStat {
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
    pub binary: bool,
    pub truncated: bool,
}

pub fn count_unified_diff_stat(diff_text: &str) -> DiffBodyStat {
    if diff_text.len() > MAX_DIFF_BODY_BYTES {
        let (additions, deletions) = known_counts(None, None, false, true);
        return DiffBodyStat {
            additions,
            deletions,
            binary: false,
            truncated: true,
        };
    }

    let has_hunk_header = diff_text.lines().any(|line| line.starts_with("@@"));
    let mut additions: u64 = 0;
    let mut deletions: u64 = 0;
    let mut in_hunk = !has_hunk_header;
    for (lines_seen, line) in diff_text.lines().enumerate() {
        if lines_seen >= MAX_DIFF_BODY_LINES {
            // Never report the partial count scanned so far as if it were
            // exact (P1-1) — a bounded scan means the true total is unknown.
            let (additions, deletions) = known_counts(None, None, false, true);
            return DiffBodyStat {
                additions,
                deletions,
                binary: false,
                truncated: true,
            };
        }

        // Checked unconditionally, regardless of hunk state: a real binary
        // marker is never itself hunk content (it replaces the hunk
        // entirely, standing alone with no leading +/-/space marker
        // character), so checking it before the in-hunk short-circuit can
        // never misfire on genuine `+`/`-`/context lines — those always
        // carry that leading character and so never literally start with
        // "Binary files " or "GIT binary patch". This also covers a bare
        // diff with no `@@`/`diff --git` at all (the no-hunk-header
        // fallback below would otherwise treat the marker line itself as
        // content and never detect it).
        if is_binary_marker_line(line) {
            let (additions, deletions) = known_counts(None, None, true, false);
            return DiffBodyStat {
                additions,
                deletions,
                binary: true,
                truncated: false,
            };
        }
        if line.starts_with("diff --git") {
            in_hunk = false; // a new file section's headers follow.
            continue;
        }
        if line.starts_with("@@") {
            in_hunk = true; // the hunk header itself never counts.
            continue;
        }
        if in_hunk {
            match line.as_bytes().first() {
                Some(b'+') => additions += 1,
                Some(b'-') => deletions += 1,
                // Context lines and the "\ No newline at end of file"
                // marker (which starts with `\`) never count.
                _ => {}
            }
            continue;
        }
        // Outside a hunk: header/metadata lines (---, +++, index, mode,
        // rename/copy, similarity) are all skipped — nothing here is content.
    }

    let (additions, deletions) = known_counts(Some(additions), Some(deletions), false, false);
    DiffBodyStat {
        additions,
        deletions,
        binary: false,
        truncated: false,
    }
}

/// Bounds a unified-diff body being returned to the renderer for DISPLAY —
/// distinct from [`count_unified_diff_stat`], which bounds a body being
/// scanned for STATS. Used by the lazy per-file diff fetch (#231 PR2, both
/// the git-live and turn-snapshot sources): a diff big enough to blow the
/// stat-counting bound is also too big to hand to the renderer whole.
///
/// Cuts at [`MAX_DIFF_BODY_BYTES`] first, walking back to the nearest UTF-8
/// character boundary so the cut never splits a multi-byte character, then at
/// [`MAX_DIFF_BODY_LINES`] lines (kept together with their trailing `\n` via
/// `split_inclusive`, so re-joining the returned lines reproduces valid diff
/// text). Either bound tripping sets the returned flag; neither ever panics
/// on a pathological input (empty text, a single line longer than the byte
/// bound, text with no trailing newline).
pub(crate) fn bound_diff_display(text: &str) -> (String, bool) {
    let mut truncated = false;
    let bytes_bounded: &str = if text.len() > MAX_DIFF_BODY_BYTES {
        truncated = true;
        let mut end = MAX_DIFF_BODY_BYTES;
        while end > 0 && !text.is_char_boundary(end) {
            end -= 1;
        }
        &text[..end]
    } else {
        text
    };

    let mut out = String::with_capacity(bytes_bounded.len());
    for (lines, line) in bytes_bounded.split_inclusive('\n').enumerate() {
        if lines >= MAX_DIFF_BODY_LINES {
            truncated = true;
            break;
        }
        out.push_str(line);
    }
    (out, truncated)
}

/// Recognizes both binary shapes Git's diff output can contain: the plain
/// `Binary files a/x and b/x differ` summary line, and the `GIT binary
/// patch` section header that precedes a base85-encoded literal/delta patch
/// (emitted with `--binary`). Anchored on line start so a genuine content
/// line that merely *mentions* either phrase mid-sentence — which, inside a
/// real hunk, always carries a leading `+`/`-`/space marker character first
/// — can never match.
fn is_binary_marker_line(line: &str) -> bool {
    (line.starts_with("Binary files ") && line.contains(" differ"))
        || line.starts_with("GIT binary patch")
}

/// Bounds raw `-z` output to [`MAX_DIFF_STAT_BYTES`], reporting whether that
/// cut anything. A trailing partial record inside the bound is fine — the
/// caller's token loop simply fails to complete it and stops.
fn bound_bytes(raw: &[u8]) -> (&[u8], bool) {
    if raw.len() > MAX_DIFF_STAT_BYTES {
        (&raw[..MAX_DIFF_STAT_BYTES], true)
    } else {
        (raw, false)
    }
}

fn lossy_path(raw: &[u8]) -> String {
    String::from_utf8_lossy(raw).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn joined(records: &[&[u8]]) -> Vec<u8> {
        let mut out = Vec::new();
        for record in records {
            out.extend_from_slice(record);
            out.push(0);
        }
        out
    }

    #[test]
    fn known_counts_enforces_binary_or_truncated_implies_both_none() {
        assert_eq!(
            known_counts(Some(3), Some(4), false, false),
            (Some(3), Some(4))
        );
        assert_eq!(known_counts(Some(3), Some(4), true, false), (None, None));
        assert_eq!(known_counts(Some(3), Some(4), false, true), (None, None));
        assert_eq!(known_counts(Some(3), None, true, true), (None, None));
        assert_eq!(known_counts(None, None, false, false), (None, None));
    }

    #[test]
    fn numstat_parses_add_modify_delete() {
        let raw = joined(&[b"5\t0\tnew.rs", b"2\t3\tlib.rs", b"0\t7\told.rs"]);
        let parse = parse_numstat_z(&raw);
        assert!(!parse.truncated);
        assert_eq!(
            parse.entries,
            vec![
                DiffStatEntry {
                    path: "new.rs".into(),
                    path_bytes: b"new.rs".to_vec(),
                    old_path: None,
                    additions: Some(5),
                    deletions: Some(0),
                    binary: false,
                    truncated: false,
                },
                DiffStatEntry {
                    path: "lib.rs".into(),
                    path_bytes: b"lib.rs".to_vec(),
                    old_path: None,
                    additions: Some(2),
                    deletions: Some(3),
                    binary: false,
                    truncated: false,
                },
                DiffStatEntry {
                    path: "old.rs".into(),
                    path_bytes: b"old.rs".to_vec(),
                    old_path: None,
                    additions: Some(0),
                    deletions: Some(7),
                    binary: false,
                    truncated: false,
                },
            ]
        );
    }

    #[test]
    fn numstat_parses_rename_old_then_new_path_order() {
        // Verified against git 2.50: `git diff --cached --numstat -z` after
        // `git mv AAAA_source.txt ZZZZ_dest.txt` emits the OLD name first.
        let mut raw = b"0\t0\t\0".to_vec();
        raw.extend_from_slice(b"AAAA_source.txt\0");
        raw.extend_from_slice(b"ZZZZ_dest.txt\0");
        let parse = parse_numstat_z(&raw);
        assert_eq!(
            parse.entries,
            vec![DiffStatEntry {
                path: "ZZZZ_dest.txt".into(),
                path_bytes: b"ZZZZ_dest.txt".to_vec(),
                old_path: Some("AAAA_source.txt".into()),
                additions: Some(0),
                deletions: Some(0),
                binary: false,
                truncated: false,
            }]
        );
    }

    #[test]
    fn numstat_parses_binary_dash_markers_as_unknown_not_zero() {
        let raw = joined(&[b"-\t-\tbin.dat"]);
        let parse = parse_numstat_z(&raw);
        let entry = &parse.entries[0];
        assert!(entry.binary);
        assert!(!entry.truncated);
        assert_eq!(entry.additions, None);
        assert_eq!(entry.deletions, None);
    }

    #[test]
    fn numstat_parses_mode_only_change_as_zero_zero() {
        let raw = joined(&[b"0\t0\tnew.txt"]);
        let parse = parse_numstat_z(&raw);
        assert_eq!(parse.entries[0].additions, Some(0));
        assert_eq!(parse.entries[0].deletions, Some(0));
        assert!(!parse.entries[0].binary);
    }

    #[test]
    fn numstat_empty_input_yields_no_entries() {
        let parse = parse_numstat_z(b"");
        assert!(parse.entries.is_empty());
        assert!(!parse.truncated);
    }

    #[test]
    fn numstat_one_bad_field_makes_both_counts_none_not_half_known() {
        // added is unparsable (out of range); deleted is a perfectly valid
        // `1`. The record as a whole must be untrusted — never "one known,
        // one unknown" (P2-1).
        let raw = joined(&[b"999999999999999999999\t1\tbig.rs"]);
        let parse = parse_numstat_z(&raw);
        let entry = &parse.entries[0];
        assert!(entry.truncated);
        assert!(!entry.binary);
        assert_eq!(entry.additions, None);
        assert_eq!(entry.deletions, None);
    }

    #[test]
    fn numstat_bounds_entry_count_and_marks_truncated() {
        let mut records = Vec::new();
        let lines: Vec<Vec<u8>> = (0..(MAX_DIFF_STAT_ENTRIES + 10))
            .map(|i| format!("1\t1\tfile{i}.rs").into_bytes())
            .collect();
        for line in &lines {
            records.push(line.as_slice());
        }
        let raw = joined(&records);
        let parse = parse_numstat_z(&raw);
        assert_eq!(parse.entries.len(), MAX_DIFF_STAT_ENTRIES);
        assert!(parse.truncated);
    }

    #[test]
    fn numstat_handles_invalid_utf8_path_without_panicking() {
        let mut raw = b"3\t2\t".to_vec();
        raw.extend_from_slice(&[0xFF, 0xFE]);
        raw.extend_from_slice(b"badpath.txt");
        raw.push(0);
        let parse = parse_numstat_z(&raw);
        let entry = &parse.entries[0];
        // Stats parse correctly regardless of the path's byte validity...
        assert_eq!(entry.additions, Some(3));
        assert_eq!(entry.deletions, Some(2));
        // ...and the lossily-decoded path never panics and carries a
        // replacement character rather than the raw invalid bytes, while the
        // raw bytes are preserved separately for joins.
        assert!(entry.path.contains('\u{FFFD}'));
        assert!(entry.path.ends_with("badpath.txt"));
        assert_eq!(entry.path_bytes[0], 0xFF);
        assert_eq!(entry.path_bytes[1], 0xFE);
    }

    #[test]
    fn name_status_parses_add_modify_delete() {
        let raw = joined(&[b"A\0new.rs", b"M\0lib.rs", b"D\0old.rs"]);
        let parse = parse_name_status_z(&raw);
        assert!(!parse.truncated);
        assert_eq!(
            parse.entries,
            vec![
                NameStatusEntry {
                    path: "new.rs".into(),
                    path_bytes: b"new.rs".to_vec(),
                    old_path: None,
                    status: ChangeFileStatus::Add,
                },
                NameStatusEntry {
                    path: "lib.rs".into(),
                    path_bytes: b"lib.rs".to_vec(),
                    old_path: None,
                    status: ChangeFileStatus::Modify,
                },
                NameStatusEntry {
                    path: "old.rs".into(),
                    path_bytes: b"old.rs".to_vec(),
                    old_path: None,
                    status: ChangeFileStatus::Delete,
                },
            ]
        );
    }

    #[test]
    fn name_status_parses_rename_old_then_new_path_order() {
        let raw = joined(&[b"R100\0old.txt\0new.txt"]);
        let parse = parse_name_status_z(&raw);
        assert_eq!(
            parse.entries,
            vec![NameStatusEntry {
                path: "new.txt".into(),
                path_bytes: b"new.txt".to_vec(),
                old_path: Some("old.txt".into()),
                status: ChangeFileStatus::Rename,
            }]
        );
    }

    #[test]
    fn name_status_empty_input_yields_no_entries() {
        let parse = parse_name_status_z(b"");
        assert!(parse.entries.is_empty());
    }

    #[test]
    fn classify_porcelain_maps_conflict_combinations() {
        for code in ["UU", "AA", "DD", "AU", "UA", "UD", "DU"] {
            assert_eq!(
                classify_porcelain_status(code),
                ChangeFileStatus::Conflict,
                "expected {code} to classify as conflict"
            );
        }
    }

    #[test]
    fn classify_porcelain_maps_non_conflict_statuses() {
        assert_eq!(classify_porcelain_status(" M"), ChangeFileStatus::Modify);
        assert_eq!(classify_porcelain_status("M "), ChangeFileStatus::Modify);
        assert_eq!(classify_porcelain_status("??"), ChangeFileStatus::Add);
        assert_eq!(classify_porcelain_status("A "), ChangeFileStatus::Add);
        assert_eq!(classify_porcelain_status(" D"), ChangeFileStatus::Delete);
        assert_eq!(classify_porcelain_status("R "), ChangeFileStatus::Rename);
    }

    #[test]
    fn merge_joins_status_and_stats_by_path() {
        let statuses = vec![NameStatusEntry {
            path: "lib.rs".into(),
            path_bytes: b"lib.rs".to_vec(),
            old_path: None,
            status: ChangeFileStatus::Modify,
        }];
        let stats = vec![DiffStatEntry {
            path: "lib.rs".into(),
            path_bytes: b"lib.rs".to_vec(),
            old_path: None,
            additions: Some(4),
            deletions: Some(1),
            binary: false,
            truncated: false,
        }];
        let files = merge_changed_files(&statuses, &stats, true);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].additions, Some(4));
        assert_eq!(files[0].deletions, Some(1));
        assert_eq!(files[0].staged, Some(true));
        assert_eq!(files[0].unstaged, None);
    }

    #[test]
    fn merge_carries_rename_old_path_and_marks_unstaged() {
        let statuses = vec![NameStatusEntry {
            path: "new.txt".into(),
            path_bytes: b"new.txt".to_vec(),
            old_path: Some("old.txt".into()),
            status: ChangeFileStatus::Rename,
        }];
        let files = merge_changed_files(&statuses, &[], false);
        assert_eq!(files[0].old_path.as_deref(), Some("old.txt"));
        assert_eq!(files[0].unstaged, Some(true));
        assert_eq!(files[0].staged, None);
        // No matching numstat entry: stats stay unknown, never zero.
        assert_eq!(files[0].additions, None);
    }

    #[test]
    fn merge_keys_on_raw_bytes_not_lossy_path_to_avoid_conflating_distinct_paths() {
        // Two different invalid leading bytes that each collapse to a single
        // U+FFFD replacement character under lossy decoding, followed by an
        // identical suffix: both entries display the same `path` string but
        // must never be treated as the same file (P2-3).
        let path_a_bytes = [&[0xFFu8][..], b"file.txt"].concat();
        let path_b_bytes = [&[0xFEu8][..], b"file.txt"].concat();
        let lossy_a = String::from_utf8_lossy(&path_a_bytes).into_owned();
        let lossy_b = String::from_utf8_lossy(&path_b_bytes).into_owned();
        assert_eq!(
            lossy_a, lossy_b,
            "fixture must actually collide under lossy decoding"
        );

        let statuses = vec![
            NameStatusEntry {
                path: lossy_a.clone(),
                path_bytes: path_a_bytes.clone(),
                old_path: None,
                status: ChangeFileStatus::Modify,
            },
            NameStatusEntry {
                path: lossy_b.clone(),
                path_bytes: path_b_bytes.clone(),
                old_path: None,
                status: ChangeFileStatus::Modify,
            },
        ];
        let stats = vec![
            DiffStatEntry {
                path: lossy_a,
                path_bytes: path_a_bytes,
                old_path: None,
                additions: Some(1),
                deletions: Some(1),
                binary: false,
                truncated: false,
            },
            DiffStatEntry {
                path: lossy_b,
                path_bytes: path_b_bytes,
                old_path: None,
                additions: Some(9),
                deletions: Some(9),
                binary: false,
                truncated: false,
            },
        ];

        let files = merge_changed_files(&statuses, &stats, true);
        assert_eq!(files.len(), 2);
        assert_eq!(
            files[0].additions,
            Some(1),
            "first path keeps its own stats"
        );
        assert_eq!(
            files[1].additions,
            Some(9),
            "second path keeps its own stats, not the first's"
        );
    }

    #[test]
    fn diff_body_counts_additions_and_deletions_only() {
        let diff = "diff --git a/f.rs b/f.rs\n\
index 111..222 100644\n\
--- a/f.rs\n\
+++ b/f.rs\n\
@@ -1,2 +1,3 @@\n\
 context\n\
-removed\n\
+added one\n\
+added two\n";
        let stat = count_unified_diff_stat(diff);
        assert_eq!(stat.additions, Some(2));
        assert_eq!(stat.deletions, Some(1));
        assert!(!stat.binary);
        assert!(!stat.truncated);
    }

    #[test]
    fn diff_body_ignores_no_newline_marker() {
        let diff = "diff --git a/f.rs b/f.rs\n\
--- a/f.rs\n\
+++ b/f.rs\n\
@@ -1,1 +1,1 @@\n\
-old\n\
\\ No newline at end of file\n\
+new\n\
\\ No newline at end of file\n";
        let stat = count_unified_diff_stat(diff);
        assert_eq!(stat.additions, Some(1));
        assert_eq!(stat.deletions, Some(1));
    }

    #[test]
    fn diff_body_detects_binary_marker() {
        let diff = "diff --git a/img.png b/img.png\n\
index 111..222 100644\n\
Binary files a/img.png and b/img.png differ\n";
        let stat = count_unified_diff_stat(diff);
        assert!(stat.binary);
        assert_eq!(stat.additions, None);
        assert_eq!(stat.deletions, None);
    }

    #[test]
    fn diff_body_bare_binary_marker_with_no_hunk_header_is_detected() {
        // No `@@`/`diff --git` at all: the no-hunk-header fallback treats
        // every line as content, so binary detection must be checked before
        // that fallback ever gets a chance to swallow the marker line.
        let stat = count_unified_diff_stat("Binary files a/img.png and b/img.png differ\n");
        assert!(stat.binary);
        assert_eq!(stat.additions, None);
        assert_eq!(stat.deletions, None);
    }

    #[test]
    fn diff_body_git_binary_patch_section_with_headers_is_detected() {
        let diff = "diff --git a/img.bin b/img.bin\n\
index 111..222 100644\n\
GIT binary patch\n\
literal 12\n\
deadbeefdata\n";
        let stat = count_unified_diff_stat(diff);
        assert!(stat.binary);
        assert_eq!(stat.additions, None);
        assert_eq!(stat.deletions, None);
    }

    #[test]
    fn diff_body_content_line_mentioning_binary_files_mid_hunk_does_not_trigger() {
        // An added line whose own text happens to mention "Binary files"
        // mid-sentence renders with a leading `+` marker, so it never
        // literally starts with "Binary files " — must count as ordinary
        // content, not be misdetected as the binary summary line.
        let diff = "diff --git a/notes.md b/notes.md\n\
--- a/notes.md\n\
+++ b/notes.md\n\
@@ -0,0 +1,1 @@\n\
+note: Binary files are skipped by this importer\n";
        let stat = count_unified_diff_stat(diff);
        assert!(!stat.binary);
        assert_eq!(stat.additions, Some(1));
        assert_eq!(stat.deletions, Some(0));
    }

    #[test]
    fn diff_body_mode_only_change_has_zero_stats() {
        let diff = "diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n";
        let stat = count_unified_diff_stat(diff);
        assert_eq!(stat.additions, Some(0));
        assert_eq!(stat.deletions, Some(0));
        assert!(!stat.binary);
    }

    #[test]
    fn diff_body_empty_input_has_zero_stats() {
        let stat = count_unified_diff_stat("");
        assert_eq!(stat.additions, Some(0));
        assert_eq!(stat.deletions, Some(0));
        assert!(!stat.truncated);
    }

    #[test]
    fn diff_body_truncates_at_line_bound_never_reports_a_partial_count() {
        let mut diff = String::from(
            "diff --git a/f.rs b/f.rs\n--- a/f.rs\n+++ b/f.rs\n@@ -0,0 +1,999999 @@\n",
        );
        for _ in 0..(MAX_DIFF_BODY_LINES + 5) {
            diff.push_str("+line\n");
        }
        let stat = count_unified_diff_stat(&diff);
        assert!(stat.truncated);
        // P1-1: a bounded/truncated scan must never report the partial count
        // it happened to reach as if it were the true total.
        assert_eq!(stat.additions, None);
        assert_eq!(stat.deletions, None);
    }

    #[test]
    fn diff_body_truncates_at_byte_bound_never_reports_a_partial_count() {
        let diff = "+".repeat(MAX_DIFF_BODY_BYTES + 1);
        let stat = count_unified_diff_stat(&diff);
        assert!(stat.truncated);
        assert_eq!(stat.additions, None);
        assert_eq!(stat.deletions, None);
    }

    #[test]
    fn diff_body_in_hunk_removed_line_starting_with_double_dash_counts_as_content() {
        // A removed line whose own text is `-- x` (e.g. a SQL/Lua comment)
        // renders as `--- x` once the diff's leading `-` marker is
        // prepended — identical in shape to a `--- a/file` header line.
        // Hunk-state tracking must still count it as one deletion (P2-2).
        let diff = "diff --git a/f.sql b/f.sql\n\
--- a/f.sql\n\
+++ b/f.sql\n\
@@ -1,1 +0,0 @@\n\
--- x\n";
        let stat = count_unified_diff_stat(diff);
        assert_eq!(stat.deletions, Some(1));
        assert_eq!(stat.additions, Some(0));
        assert!(!stat.binary);
    }

    #[test]
    fn diff_body_in_hunk_added_line_starting_with_double_plus_counts_as_content() {
        // An added line whose own text is `++ y` renders as `+++ y` once the
        // diff's leading `+` marker is prepended — identical in shape to a
        // `+++ b/file` header line.
        let diff = "diff --git a/f.c b/f.c\n\
--- a/f.c\n\
+++ b/f.c\n\
@@ -0,0 +1,1 @@\n\
+++ y\n";
        let stat = count_unified_diff_stat(diff);
        assert_eq!(stat.additions, Some(1));
        assert_eq!(stat.deletions, Some(0));
        assert!(!stat.binary);
    }

    #[test]
    fn diff_body_with_no_hunk_header_at_all_treats_every_line_as_content() {
        // Some providers hand over a bare patch fragment with no `diff
        // --git`/`---`/`+++`/`@@` structure at all — just `+`/`-` lines. With
        // no `@@` anywhere, there is no header/hunk boundary to speak of, so
        // every line must still count (this is what `changes::turn`'s fold
        // relies on for provider-supplied `FileChangeEntry.diff` text).
        let stat = count_unified_diff_stat("+a\n-b\n-c\n");
        assert_eq!(stat.additions, Some(1));
        assert_eq!(stat.deletions, Some(2));
        assert!(!stat.binary);
    }

    #[test]
    fn bound_diff_display_passes_through_small_text_untouched() {
        let (text, truncated) = bound_diff_display("+a\n-b\n context\n");
        assert_eq!(text, "+a\n-b\n context\n");
        assert!(!truncated);
    }

    #[test]
    fn bound_diff_display_cuts_at_the_line_bound() {
        let mut diff = String::new();
        for i in 0..(MAX_DIFF_BODY_LINES + 5) {
            diff.push_str(&format!("+line {i}\n"));
        }
        let (text, truncated) = bound_diff_display(&diff);
        assert!(truncated);
        assert_eq!(text.lines().count(), MAX_DIFF_BODY_LINES);
    }

    #[test]
    fn bound_diff_display_cuts_at_the_byte_bound_without_splitting_a_utf8_char() {
        // Pad the text so the byte cap lands mid multi-byte character
        // ("é" is 2 bytes); the cut must back off to a valid boundary rather
        // than panicking or producing invalid UTF-8.
        let mut diff = "x".repeat(MAX_DIFF_BODY_BYTES - 1);
        diff.push('é');
        diff.push('\n');
        let (text, truncated) = bound_diff_display(&diff);
        assert!(truncated);
        assert!(text.len() <= MAX_DIFF_BODY_BYTES);
        assert!(std::str::from_utf8(text.as_bytes()).is_ok());
    }

    #[test]
    fn bound_diff_display_handles_empty_input() {
        let (text, truncated) = bound_diff_display("");
        assert_eq!(text, "");
        assert!(!truncated);
    }
}
