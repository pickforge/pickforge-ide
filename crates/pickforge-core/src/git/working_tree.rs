//! Live working-tree [`ChangeSet`] assembly and lazy per-file diff fetch
//! (#231 PR2): `scope: WorkingTree`, `source: GitLive`. Shells out to `git`
//! the same bounded way the rest of `crate::git` does (`run_timeout`/
//! `run_timeout_capped`, `super::GIT_TIMEOUT`), then folds the raw output
//! through the PR1 parsers in `crate::git::diff_stat` — this module owns the
//! process spawning and result assembly, never the parsing itself.
//!
//! Two git invocation shapes, run once each for staged (`--cached`) and
//! unstaged: `--numstat -z` for exact per-file line counts and
//! `--name-status -z` for status letters, joined by
//! [`diff_stat::merge_changed_files`] exactly as PR1 intends. Untracked files
//! never appear in `git diff` output at all (they have no tracked
//! counterpart to diff against), so they're read from `crate::git::status`'s
//! porcelain listing instead and synthesized as `Add`/unstaged rows with
//! unknown stats — computing their line counts would mean reading every
//! untracked file's full content during a *listing* call, which the issue's
//! "listing must not read every file body" rule forbids; their diff (and, as
//! a side effect, their exact stats) is available through the lazy
//! [`file_diff`] fetch instead. Conflicted paths are detected the same way —
//! from `status`'s porcelain codes via [`diff_stat::classify_porcelain_status`]
//! — since `git diff --name-status` has no clean unmerged-file representation
//! of its own.
//!
//! A file with BOTH a staged and an unstaged change produces TWO rows (one
//! from each merge call, each with its own `staged`/`unstaged` flag and its
//! own stats) rather than one row trying to represent both — that's the
//! shape [`diff_stat::merge_changed_files`] already commits to (each call
//! sets exactly one of `staged`/`unstaged`), and matches the issue's own
//! acceptance criterion that "staged + unstaged changes on the same file" is
//! a state to render, not collapse. `merge_changed_files` leaves the OTHER
//! flag `None` (PR1's "not meaningful for this source" case); this module
//! tightens that to `Some(false)` on assembly, since for a git-live row the
//! opposite flag IS a known fact, not an inapplicable concept — see
//! `ChangedFile::staged`'s doc comment. The final listing is sorted by path
//! (staged before unstaged within a path) so a file with both kinds of row
//! renders them adjacent — legible pairing rather than two unrelated-looking
//! rows separated by every other staged/unstaged file (#231 PR5).
//!
//! A THIRD invocation shape, staged and unstaged (#231 PR5): `git diff --raw
//! -z --full-index`, giving old/new file MODE bits and blob shas that
//! `--numstat`/`--name-status` don't carry at all. This is the added,
//! bounded call the issue's PR5 slice calls for to distinguish a submodule
//! gitlink, a symlink, and a permissions-only change from an ordinary
//! content change — none of those are recoverable from the two calls PR1/PR2
//! already run. Parsed by [`diff_stat::parse_raw_z`] and classified by
//! [`diff_stat::classify_change_file_kind`] into [`crate::changes::ChangeFileKind`],
//! then overlaid onto the rows the numstat/name-status merge already built.
//! An untracked path has no `git diff` output at all (same reasoning as the
//! untracked block below), so its kind is read straight off the filesystem
//! instead via a plain `fs::symlink_metadata` call — cheap, bounded, and
//! reads no file content, same spirit as the rest of this module's "listing
//! must not read file bodies" discipline.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

use crate::changes::{
    ChangeDiff, ChangeFileKind, ChangeFileStatus, ChangeScope, ChangeSet, ChangeSource,
    ChangeTotals, ChangedFile,
};
use crate::process::run_timeout_capped;

use super::diff_stat::{self, MAX_DIFF_STAT_BYTES};
use super::GIT_TIMEOUT;

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// `git <args>` in `root`, bounded by both time ([`GIT_TIMEOUT`]) and stdout
/// bytes ([`MAX_DIFF_STAT_BYTES`] — the same cap `diff_stat`'s parsers apply
/// when reading the captured bytes, so process capture and parsing agree on
/// one limit rather than two independently-chosen ones). Raw bytes, not the
/// lossily-decoded `String` the rest of `crate::git` deals in — the numstat/
/// name-status parsers need the exact bytes to join on (see
/// `diff_stat::DiffStatEntry::path_bytes`). `(stdout, byte_truncated)`;
/// empty + `false` on any spawn error or timeout, matching every other
/// `git_*` helper's "no result" convention.
fn git_capped(root: &str, args: &[&str]) -> (Vec<u8>, bool) {
    match run_timeout_capped("git", args, Some(root), None, GIT_TIMEOUT, MAX_DIFF_STAT_BYTES) {
        Ok((outcome, truncation)) => (outcome.stdout, truncation.stdout),
        Err(_) => (Vec::new(), false),
    }
}

/// The live working-tree [`ChangeSet`] for the repo at or containing `root`
/// (same "project may sit inside a larger repo" resolution as
/// `crate::git::status`). `None` when `root` isn't a Git working tree at
/// all — the caller renders the issue's explicit "not a repository" state
/// rather than an empty change-set.
pub fn working_tree_change_set(root: &str) -> Option<ChangeSet> {
    let top = super::toplevel(root)?;
    // Bounded the same way every other invocation here is (P2-1): an
    // `--untracked-files=all` tree can otherwise materialize unbounded
    // stdout. `crate::git::status`'s own callers are untouched — this calls
    // the dedicated capped variant instead.
    let (status, status_truncated) = super::status_capped(&top, MAX_DIFF_STAT_BYTES);
    if !status.is_repo {
        return None;
    }

    let (mut files, diff_truncated) = staged_and_unstaged_files(&top);
    let truncated = status_truncated || diff_truncated;

    for entry in status.files.iter().filter(|f| f.untracked) {
        files.push(ChangedFile {
            path: entry.path.clone(),
            old_path: None,
            status: ChangeFileStatus::Add,
            staged: Some(false),
            unstaged: Some(true),
            additions: None,
            deletions: None,
            binary: false,
            truncated: false,
            diff_available: true,
            // An untracked path never appears in `git diff --raw` output
            // (nothing to diff against), so its kind is read straight off
            // the filesystem instead — a symlink_metadata stat, never a
            // content read (see this module's doc comment).
            kind: untracked_kind(&top, &entry.path),
        });
    }

    overlay_conflicts(&mut files, &status);

    // Legible pairing (#231 PR5): a file with both a staged and an unstaged
    // row is otherwise split across two unrelated-looking positions (every
    // staged row, then every unstaged row, added far apart above) — sort by
    // path so its two rows sit next to each other, staged first (matches the
    // badge order a reader scans top-to-bottom). `sort_by` is stable, so
    // rows that tie on path/staged-order keep their original relative order.
    files.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then_with(|| b.staged.unwrap_or(false).cmp(&a.staged.unwrap_or(false)))
    });

    let totals = ChangeTotals::from_files(&files);
    Some(ChangeSet {
        id: format!("workingTree:{top}"),
        scope: ChangeScope::WorkingTree,
        source: ChangeSource::GitLive,
        chat_id: None,
        turn_seq: None,
        repo_root: top,
        captured_at: now_millis(),
        // Fresh at the moment of this live read by construction — this is
        // not a cached copy going stale later. A caller layer (the store,
        // #231 PR2 TS side) tracks ITS OWN freshness against this capture,
        // independent of this field.
        stale: false,
        truncated,
        files,
        totals,
    })
}

/// Runs and merges the three staged + three unstaged `git diff` invocation
/// shapes (`--name-status`/`--numstat`/`--raw`, see this module's doc
/// comment) into one flat `Vec<ChangedFile>`, kind-classified, `staged`/
/// `unstaged` fully known-`Some` per row (P3). Split out of
/// [`working_tree_change_set`] purely to keep that function short — this is
/// still "assembly", not parsing (parsing stays in `diff_stat`).
fn staged_and_unstaged_files(top: &str) -> (Vec<ChangedFile>, bool) {
    // `--find-renames` is explicit rather than relying on the user's
    // `diff.renames` git config, so rename detection behaves the same on
    // every install regardless of that config's value.
    let (staged_name_raw, staged_name_cap_truncated) =
        git_capped(top, &["diff", "--cached", "--find-renames", "--name-status", "-z"]);
    let (staged_num_raw, staged_num_cap_truncated) =
        git_capped(top, &["diff", "--cached", "--find-renames", "--numstat", "-z"]);
    let (unstaged_name_raw, unstaged_name_cap_truncated) =
        git_capped(top, &["diff", "--find-renames", "--name-status", "-z"]);
    let (unstaged_num_raw, unstaged_num_cap_truncated) =
        git_capped(top, &["diff", "--find-renames", "--numstat", "-z"]);
    // Third invocation shape (#231 PR5): file MODE bits + blob shas, the
    // only way to tell a submodule/symlink/mode-only change apart from an
    // ordinary one — see this module's doc comment.
    let (staged_raw_raw, staged_raw_cap_truncated) = git_capped(
        top,
        &["diff", "--cached", "--find-renames", "--raw", "-z", "--full-index"],
    );
    let (unstaged_raw_raw, unstaged_raw_cap_truncated) =
        git_capped(top, &["diff", "--find-renames", "--raw", "-z", "--full-index"]);

    let staged_name_parse = diff_stat::parse_name_status_z(&staged_name_raw);
    let staged_num_parse = diff_stat::parse_numstat_z(&staged_num_raw);
    let unstaged_name_parse = diff_stat::parse_name_status_z(&unstaged_name_raw);
    let unstaged_num_parse = diff_stat::parse_numstat_z(&unstaged_num_raw);
    let staged_raw_parse = diff_stat::parse_raw_z(&staged_raw_raw);
    let unstaged_raw_parse = diff_stat::parse_raw_z(&unstaged_raw_raw);

    // (P2-2) An over-cap listing — either the process-capture byte cap or
    // the parsers' own entry-count/byte cap tripping — must never silently
    // return a prefix with no signal; OR every truncation source into the
    // change-set's honest `truncated` flag.
    let truncated = staged_name_cap_truncated
        || staged_num_cap_truncated
        || unstaged_name_cap_truncated
        || unstaged_num_cap_truncated
        || staged_raw_cap_truncated
        || unstaged_raw_cap_truncated
        || staged_name_parse.truncated
        || staged_num_parse.truncated
        || unstaged_name_parse.truncated
        || unstaged_num_parse.truncated
        || staged_raw_parse.truncated
        || unstaged_raw_parse.truncated;

    let mut files =
        diff_stat::merge_changed_files(&staged_name_parse.entries, &staged_num_parse.entries, true);
    // A row from the staged merge is never itself an unstaged row — that's a
    // known `false`, not an inapplicable concept, for a git-live source (P3).
    for file in files.iter_mut() {
        file.unstaged = Some(false);
    }
    overlay_kind(&mut files, &staged_raw_parse.entries);

    let mut unstaged_files = diff_stat::merge_changed_files(
        &unstaged_name_parse.entries,
        &unstaged_num_parse.entries,
        false,
    );
    for file in unstaged_files.iter_mut() {
        file.staged = Some(false);
    }
    overlay_kind(&mut unstaged_files, &unstaged_raw_parse.entries);

    files.extend(unstaged_files);
    (files, truncated)
}

/// Conflicts are a Git-live-only concept `git diff --name-status` doesn't
/// cleanly represent; overlay the porcelain-derived truth from `status` onto
/// whatever row(s) [`staged_and_unstaged_files`] already produced for that
/// path, and synthesize a row for any unmerged path that produced none at
/// all (defensive — every unmerged path is expected to appear in at least
/// the unstaged diff).
fn overlay_conflicts(files: &mut Vec<ChangedFile>, status: &super::GitStatus) {
    let porcelain_by_path: HashMap<&str, &str> = status
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.status.as_str()))
        .collect();
    for file in files.iter_mut() {
        if let Some(code) = porcelain_by_path.get(file.path.as_str()) {
            if diff_stat::classify_porcelain_status(code) == ChangeFileStatus::Conflict {
                file.status = ChangeFileStatus::Conflict;
            }
        }
    }
    for entry in status.files.iter() {
        if diff_stat::classify_porcelain_status(&entry.status) != ChangeFileStatus::Conflict {
            continue;
        }
        if files.iter().any(|f| f.path == entry.path) {
            continue;
        }
        files.push(ChangedFile {
            path: entry.path.clone(),
            old_path: None,
            status: ChangeFileStatus::Conflict,
            // Absent from both the staged and unstaged diff merges above —
            // known `false` on both counts (P3), not "not applicable".
            staged: Some(false),
            unstaged: Some(false),
            additions: None,
            deletions: None,
            binary: false,
            truncated: false,
            diff_available: true,
            // A conflicted path's kind is left at the honest default — its
            // status already distinguishes it, and its mode isn't cleanly
            // classifiable mid-merge (multiple index stages, not a single
            // old/new mode pair).
            kind: ChangeFileKind::Regular,
        });
    }
}

/// Sets `kind` on every row in `files` whose path has a matching
/// [`diff_stat::RawModeEntry`] in `raw_entries` (#231 PR5), joined by exact
/// path bytes — same rationale as `diff_stat::merge_changed_files`'s own
/// join (two distinct invalid-UTF-8 paths can collide once lossily decoded
/// to the same `String`). A path with no matching raw entry (should not
/// happen — the raw call covers exactly the same diff range as the
/// numstat/name-status calls — but defensive) keeps its already-set default.
fn overlay_kind(files: &mut [ChangedFile], raw_entries: &[diff_stat::RawModeEntry]) {
    let raw_by_path: HashMap<&[u8], &diff_stat::RawModeEntry> = raw_entries
        .iter()
        .map(|e| (e.path_bytes.as_slice(), e))
        .collect();
    for file in files.iter_mut() {
        if let Some(entry) = raw_by_path.get(file.path.as_bytes()) {
            // The mode-only check needs THIS row's own numstat-derived
            // additions/deletions (see `classify_change_file_kind`'s doc
            // comment) — always known-precise here since a binary/truncated
            // row already carries `None`, which the classifier treats as
            // "not provably zero", never as a fabricated match.
            file.kind = diff_stat::classify_change_file_kind(entry, file.additions, file.deletions);
        }
    }
}

/// Reads an untracked path's [`ChangeFileKind`] straight off the filesystem
/// (#231 PR5) — `git diff` never emits anything for an untracked path (see
/// this module's doc comment), so there's no raw-mode record to classify
/// from. `symlink_metadata` (not `metadata`, which follows the link) so a
/// symlink is detected as itself rather than resolved through to whatever it
/// points at; a stat call, never a content read. Falls back to
/// [`ChangeFileKind::Regular`] on any I/O error (permissions, a race where
/// the path vanished between `git status` and this read) — an honest "can't
/// tell" default, not a guess.
fn untracked_kind(repo_root: &str, repo_relative_path: &str) -> ChangeFileKind {
    match std::fs::symlink_metadata(Path::new(repo_root).join(repo_relative_path)) {
        Ok(meta) if meta.file_type().is_symlink() => ChangeFileKind::Symlink,
        _ => ChangeFileKind::Regular,
    }
}

/// Resolves a repo-relative `candidate` against an already-canonical
/// `repo_root`, rejecting anything unsafe: an absolute path, any `..`
/// component, a Windows drive prefix or root component (`C:foo` is
/// drive-RELATIVE and so isn't caught by `is_absolute()`; `\foo` is
/// root-relative to the current drive and isn't caught by it either —
/// defense in depth, harmless on non-Windows where `Component::Prefix`
/// never occurs), or — once joined — a path whose deepest EXISTING ancestor
/// canonicalizes outside `repo_root` (a symlinked escape, including one
/// several directories up from a leaf that doesn't itself exist). Existence
/// is checked ancestor-by-ancestor rather than requiring the leaf itself to
/// exist, so a path `git status` reports as deleted (which no longer exists
/// on disk) still resolves correctly for a `git diff -- path` invocation.
fn resolve_repo_relative(repo_root: &Path, candidate: &str) -> Result<PathBuf, String> {
    if candidate.is_empty() {
        return Err("path must not be empty".to_string());
    }
    let candidate_path = Path::new(candidate);
    if candidate_path.is_absolute() {
        return Err("path must be repo-relative".to_string());
    }
    if candidate_path.components().any(|c| {
        matches!(c, Component::ParentDir | Component::Prefix(_) | Component::RootDir)
    }) {
        return Err(
            "path must not contain parent-directory traversal or a drive/root component"
                .to_string(),
        );
    }

    let joined = repo_root.join(candidate_path);
    let (existing, remainder) = deepest_existing_ancestor(&joined);
    let canon_existing = std::fs::canonicalize(&existing).map_err(|e| e.to_string())?;
    if !canon_existing.starts_with(repo_root) {
        return Err("path escapes the repository root".to_string());
    }
    // `PathBuf::join` with an EMPTY `remainder` (the common case: `candidate`
    // itself already exists, so `deepest_existing_ancestor` walked zero
    // steps) still appends a trailing separator (`.../a.bin` ->
    // `.../a.bin/`) — a real `Path::join` quirk, not a no-op, confirmed
    // against this toolchain. That silently breaks any caller doing raw
    // filesystem I/O on the result (`fs::metadata` on a trailing-slash path
    // to a regular file fails with ENOTDIR/NotADirectory on macOS/Linux),
    // even though it happened to be harmless for the ORIGINAL caller here
    // (only ever turned into a `git diff -- <path>` pathspec string, and
    // git's own pathspec matching tolerates a trailing slash). Skip the
    // no-op join entirely rather than rely on every future caller's
    // downstream use happening to absorb it.
    if remainder.as_os_str().is_empty() {
        Ok(canon_existing)
    } else {
        Ok(canon_existing.join(remainder))
    }
}

/// Walks `path` up to the deepest ancestor that exists on disk, returning
/// `(existing_ancestor, remainder)` such that `existing_ancestor.join(remainder)
/// == path` (lexically). `repo_root` (an ancestor of every valid `path`
/// passed in here) always exists, so the walk is guaranteed to terminate.
fn deepest_existing_ancestor(path: &Path) -> (PathBuf, PathBuf) {
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let mut current = path.to_path_buf();
    while !current.exists() {
        match current.file_name() {
            Some(name) => tail.push(name.to_os_string()),
            None => break,
        }
        if !current.pop() {
            break;
        }
    }
    let mut remainder = PathBuf::new();
    for part in tail.into_iter().rev() {
        remainder.push(part);
    }
    (current, remainder)
}

/// The live unified diff for one repo-relative `path` (#231 PR2 lazy
/// per-file fetch, extended #231 PR5), staged or unstaged. `root` is any
/// directory at or inside the repo (resolved to the toplevel the same as
/// [`working_tree_change_set`]); `path` is validated safe via
/// [`resolve_repo_relative`] before ever reaching a `git` invocation —
/// traversal or a symlinked escape is rejected with an error, never silently
/// clamped. An untracked file (no staged counterpart) falls back to `git
/// diff --no-index` against the empty file, same as `crate::git::diff`.
///
/// `skip_lines` is the "load more" affordance for a truncated diff (#231
/// PR5): `0` for the initial fetch; a caller that already has N lines of a
/// `truncated: true` result passes N to get the NEXT bounded chunk. Cheap by
/// this crate's existing convention (re-runs `git diff` fresh rather than
/// caching anything server-side — the same choice
/// `changes_turn_file_diff`'s doc comment makes for the turn-snapshot side).
///
/// Two honesty signals a caller can't get any other way (#231 PR5): when the
/// raw captured bytes were not valid UTF-8, the returned diff's
/// `invalid_utf8` is `true` (the text still renders, lossily decoded, rather
/// than failing); when the diff is `binary`, `size_bytes` is filled from a
/// plain `fs::metadata` stat of the still-existing working-tree file (never
/// a content read, and never attempted for a file that no longer exists).
pub fn file_diff(root: &str, path: &str, staged: bool, skip_lines: u32) -> Result<ChangeDiff, String> {
    let top = super::toplevel(root).ok_or_else(|| "not a git repository".to_string())?;
    let top_path = Path::new(&top);
    let resolved = resolve_repo_relative(top_path, path)?;
    let repo_relative = resolved
        .strip_prefix(top_path)
        .map_err(|_| "path escapes the repository root".to_string())?
        .to_string_lossy()
        .into_owned();
    if repo_relative.is_empty() {
        return Err("path must not be empty".to_string());
    }
    let skip_lines = skip_lines as usize;

    let args: Vec<&str> = if staged {
        vec!["diff", "--cached", "--", &repo_relative]
    } else {
        vec!["diff", "--", &repo_relative]
    };
    let (raw, out_truncated) = git_capped(&top, &args);
    let invalid_utf8 = std::str::from_utf8(&raw).is_err();
    let text = String::from_utf8_lossy(&raw).into_owned();

    let mut result = if !staged && text.trim().is_empty() && !super::is_tracked(&top, &repo_relative) {
        let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
        let (raw2, t2) = git_capped(&top, &["diff", "--no-index", "--", null, &repo_relative]);
        let invalid_utf8_2 = std::str::from_utf8(&raw2).is_err();
        let text2 = String::from_utf8_lossy(&raw2).into_owned();
        let mut result =
            crate::changes::finish_change_diff_from(&text2, out_truncated || t2, skip_lines);
        result.invalid_utf8 = invalid_utf8 || invalid_utf8_2;
        result
    } else {
        let mut result = crate::changes::finish_change_diff_from(&text, out_truncated, skip_lines);
        result.invalid_utf8 = invalid_utf8;
        result
    };

    if result.binary {
        result.size_bytes = std::fs::metadata(&resolved).ok().map(|m| m.len());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn run_git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(dir)
            .status()
            .expect("git available for tests");
        assert!(status.success(), "git {args:?} failed");
    }

    fn init_repo(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pf-workingtree-{}-{tag}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        run_git(&dir, &["init", "-q"]);
        run_git(&dir, &["config", "user.email", "test@pickforge.dev"]);
        run_git(&dir, &["config", "user.name", "PickForge Test"]);
        std::fs::canonicalize(&dir).unwrap()
    }

    fn commit_all(dir: &Path, message: &str) {
        run_git(dir, &["add", "-A"]);
        run_git(dir, &["commit", "-q", "-m", message]);
    }

    fn head_sha(dir: &Path) -> String {
        let out = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(dir)
            .output()
            .expect("git rev-parse HEAD");
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    /// The branch `git init` created — depends on the test machine's
    /// `init.defaultBranch` config (`master` vs `main`), so tests that need
    /// to check it back out must not hardcode either name.
    fn current_branch(dir: &Path) -> String {
        let out = Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(dir)
            .output()
            .expect("git rev-parse");
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    // ---- working_tree_change_set: staged/unstaged/untracked/rename/binary ----

    #[test]
    fn not_a_repo_returns_none() {
        let dir = std::env::temp_dir().join(format!("pf-workingtree-not-a-repo-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        assert!(working_tree_change_set(dir.to_str().unwrap()).is_none());
    }

    #[test]
    fn reports_an_unstaged_modification_with_exact_stats() {
        let repo = init_repo("unstaged");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.txt"), "one\ntwo\n").unwrap();

        let cs = working_tree_change_set(repo.to_str().unwrap()).expect("repo");
        assert_eq!(cs.scope, ChangeScope::WorkingTree);
        assert_eq!(cs.source, ChangeSource::GitLive);
        assert!(!cs.stale);
        let file = cs.files.iter().find(|f| f.path == "a.txt").expect("a.txt row");
        assert_eq!(file.status, ChangeFileStatus::Modify);
        // Known false, not "not applicable" — staged/unstaged is always
        // meaningful for a git-live row (P3).
        assert_eq!(file.staged, Some(false));
        assert_eq!(file.unstaged, Some(true));
        assert_eq!(file.additions, Some(1));
        assert_eq!(file.deletions, Some(0));
        assert!(!cs.truncated);
    }

    #[test]
    fn reports_a_staged_addition_separately_from_an_unstaged_one() {
        let repo = init_repo("staged-unstaged-split");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.txt"), "one\ntwo\n").unwrap();
        run_git(&repo, &["add", "a.txt"]);
        std::fs::write(repo.join("a.txt"), "one\ntwo\nthree\n").unwrap();

        let cs = working_tree_change_set(repo.to_str().unwrap()).expect("repo");
        let rows: Vec<_> = cs.files.iter().filter(|f| f.path == "a.txt").collect();
        assert_eq!(rows.len(), 2, "staged and unstaged changes on one file are two rows");
        // Each row's OWN opposite flag is a known `false`, not `None` — a
        // staged row is definitively not itself an unstaged row (P3).
        assert!(rows.iter().any(|f| f.staged == Some(true) && f.unstaged == Some(false)));
        assert!(rows.iter().any(|f| f.unstaged == Some(true) && f.staged == Some(false)));

        // Legible pairing (#231 PR5): the two rows for one path sit ADJACENT
        // in the listing, staged first — not split apart by every other
        // staged/unstaged file in the change-set.
        let idx = cs
            .files
            .iter()
            .position(|f| f.path == "a.txt" && f.staged == Some(true))
            .expect("staged row");
        assert_eq!(cs.files[idx + 1].path, "a.txt");
        assert_eq!(cs.files[idx + 1].unstaged, Some(true));
    }

    #[test]
    fn reports_an_untracked_file_with_unknown_stats_and_no_body_read() {
        let repo = init_repo("untracked");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("new.txt"), "brand new content\nsecond line\n").unwrap();

        let cs = working_tree_change_set(repo.to_str().unwrap()).expect("repo");
        let file = cs.files.iter().find(|f| f.path == "new.txt").expect("new.txt row");
        assert_eq!(file.status, ChangeFileStatus::Add);
        assert_eq!(file.staged, Some(false));
        assert_eq!(file.unstaged, Some(true));
        assert_eq!(file.additions, None, "listing must not read the file body to count lines");
        assert_eq!(file.deletions, None);
        assert!(file.diff_available);
    }

    #[test]
    fn reports_a_rename_with_old_path() {
        let repo = init_repo("rename");
        std::fs::write(repo.join("old.txt"), "some content here to satisfy the rename heuristic\n").unwrap();
        commit_all(&repo, "init");
        std::fs::rename(repo.join("old.txt"), repo.join("new.txt")).unwrap();
        run_git(&repo, &["add", "-A"]);

        let cs = working_tree_change_set(repo.to_str().unwrap()).expect("repo");
        let file = cs.files.iter().find(|f| f.path == "new.txt").expect("new.txt row");
        assert_eq!(file.status, ChangeFileStatus::Rename);
        assert_eq!(file.old_path.as_deref(), Some("old.txt"));
    }

    #[test]
    fn reports_a_binary_file_with_unknown_stats() {
        let repo = init_repo("binary");
        std::fs::write(repo.join("a.bin"), [0u8, 1, 2, 3]).unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.bin"), [4u8, 5, 6, 7, 8]).unwrap();

        let cs = working_tree_change_set(repo.to_str().unwrap()).expect("repo");
        let file = cs.files.iter().find(|f| f.path == "a.bin").expect("a.bin row");
        assert!(file.binary);
        assert_eq!(file.additions, None);
        assert_eq!(file.deletions, None);
    }

    #[test]
    fn reports_a_merge_conflict_as_conflict_status() {
        let repo = init_repo("conflict");
        std::fs::write(repo.join("a.txt"), "base\n").unwrap();
        commit_all(&repo, "init");
        let base_branch = current_branch(&repo);
        run_git(&repo, &["checkout", "-qb", "feature"]);
        std::fs::write(repo.join("a.txt"), "feature change\n").unwrap();
        commit_all(&repo, "feature change");
        run_git(&repo, &["checkout", "-q", &base_branch]);
        std::fs::write(repo.join("a.txt"), "main change\n").unwrap();
        commit_all(&repo, "main change");
        // Merge is expected to conflict; ignore its non-zero exit.
        let _ = Command::new("git")
            .args(["merge", "-q", "feature"])
            .current_dir(&repo)
            .status();

        let cs = working_tree_change_set(repo.to_str().unwrap()).expect("repo");
        let file = cs.files.iter().find(|f| f.path == "a.txt").expect("a.txt row");
        assert_eq!(file.status, ChangeFileStatus::Conflict);
    }

    // ---- file_diff: lazy per-file fetch, path-escape rejection ----

    #[test]
    fn file_diff_returns_unified_text_for_an_unstaged_change() {
        let repo = init_repo("diff-unstaged");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.txt"), "one\ntwo\n").unwrap();

        let result = file_diff(repo.to_str().unwrap(), "a.txt", false, 0).expect("diff ok");
        assert!(result.available);
        assert!(!result.binary);
        assert!(!result.truncated);
        assert!(result.diff.unwrap().contains("+two"));
    }

    #[test]
    fn file_diff_returns_the_staged_body_for_an_untracked_new_file() {
        let repo = init_repo("diff-untracked");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("new.txt"), "hello\n").unwrap();

        let result = file_diff(repo.to_str().unwrap(), "new.txt", false, 0).expect("diff ok");
        assert!(result.diff.unwrap().contains("+hello"));
    }

    #[test]
    fn file_diff_returns_binary_true_with_no_text_for_a_binary_file() {
        let repo = init_repo("diff-binary");
        std::fs::write(repo.join("a.bin"), [0u8, 1, 2, 3]).unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.bin"), [4u8, 5, 6, 7, 8]).unwrap();

        let result = file_diff(repo.to_str().unwrap(), "a.bin", false, 0).expect("diff ok");
        assert!(result.binary);
        assert!(result.diff.is_none());
    }

    #[test]
    fn file_diff_rejects_dotdot_traversal() {
        let repo = init_repo("diff-traversal");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");

        let secret = std::env::temp_dir().join(format!("pf-workingtree-secret-{}.txt", std::process::id()));
        std::fs::write(&secret, "top secret").unwrap();

        let err = file_diff(repo.to_str().unwrap(), "../../../etc/passwd", false, 0).unwrap_err();
        assert!(err.contains("traversal"));
        let _ = std::fs::remove_file(&secret);
    }

    #[test]
    fn file_diff_rejects_an_absolute_path() {
        let repo = init_repo("diff-absolute");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");

        let err = file_diff(repo.to_str().unwrap(), "/etc/passwd", false, 0).unwrap_err();
        assert!(err.contains("repo-relative"));
    }

    #[cfg(unix)]
    #[test]
    fn file_diff_rejects_a_symlinked_escape_out_of_the_repo() {
        use std::os::unix::fs::symlink;
        let repo = init_repo("diff-symlink-escape");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");

        let outside = std::env::temp_dir().join(format!("pf-workingtree-outside-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&outside);
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), "top secret").unwrap();
        let link = repo.join("escape");
        let _ = std::fs::remove_file(&link);
        symlink(&outside, &link).unwrap();

        let err = file_diff(repo.to_str().unwrap(), "escape/secret.txt", false, 0).unwrap_err();
        assert!(err.contains("escapes"));
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn file_diff_resolves_a_deleted_files_path_without_requiring_it_to_exist() {
        // A deleted file no longer exists on disk, but its diff must still be
        // fetchable — the safety check must not require the leaf to exist.
        let repo = init_repo("diff-deleted");
        std::fs::write(repo.join("gone.txt"), "will be deleted\n").unwrap();
        commit_all(&repo, "init");
        std::fs::remove_file(repo.join("gone.txt")).unwrap();

        let result = file_diff(repo.to_str().unwrap(), "gone.txt", false, 0).expect("diff ok");
        assert!(result.available);
        assert!(result.diff.unwrap().contains("-will be deleted"));
    }

    #[test]
    fn resolve_repo_relative_rejects_empty_path() {
        let repo = init_repo("resolve-empty");
        assert!(resolve_repo_relative(&repo, "").is_err());
    }

    #[test]
    fn resolve_repo_relative_never_appends_a_trailing_separator_for_an_existing_leaf() {
        // `PathBuf::join` with an EMPTY remainder still appends a trailing
        // separator (confirmed against this toolchain) — harmless for the
        // ORIGINAL caller (only ever turned into a `git diff -- <path>`
        // pathspec string), but breaks a raw `fs::metadata`/`fs::symlink_metadata`
        // call on the result (`ENOTDIR` on macOS/Linux for a regular file).
        // #231 PR5 adds exactly that kind of caller (`file_diff`'s binary
        // size stat), so this is a real regression guard, not a hypothetical.
        let repo = init_repo("resolve-no-trailing-slash");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");

        let resolved = resolve_repo_relative(&repo, "a.txt").expect("resolves");
        assert!(
            !resolved.to_string_lossy().ends_with('/'),
            "resolved path must not carry a trailing separator: {resolved:?}"
        );
        assert!(std::fs::metadata(&resolved).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn file_diff_rejects_a_deleted_leaf_under_a_symlinked_ancestor_dir() {
        use std::os::unix::fs::symlink;
        let repo = init_repo("diff-symlink-deleted-leaf");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");

        let outside = std::env::temp_dir()
            .join(format!("pf-workingtree-outside-deleted-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&outside);
        std::fs::create_dir_all(&outside).unwrap();
        let link = repo.join("escape2");
        let _ = std::fs::remove_file(&link);
        symlink(&outside, &link).unwrap();

        // "gone.txt" never existed under `outside` — the LEAF doesn't exist
        // (same shape as a deleted file), but its ancestor directory is a
        // symlink resolving outside the repo. The deepest-existing-ancestor
        // walk must still find that symlinked dir (which DOES exist) and
        // reject on its resolved, out-of-root target.
        let err = file_diff(repo.to_str().unwrap(), "escape2/gone.txt", false, 0).unwrap_err();
        assert!(err.contains("escapes"));
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn file_diff_rejects_a_candidate_that_resolves_to_the_repo_root_itself() {
        let repo = init_repo("diff-dot");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");

        // "." is repo-relative and contains no `..`/prefix/root component, so
        // it passes the component check, but it resolves to the repo root
        // itself — an empty repo-relative string once the root prefix is
        // stripped, which is not a file `git diff -- <path>` can target.
        let err = file_diff(repo.to_str().unwrap(), ".", false, 0).unwrap_err();
        assert!(err.contains("empty"));
    }

    #[test]
    fn file_diff_fails_closed_on_a_nul_byte_in_the_path() {
        let repo = init_repo("diff-nul-byte");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");
        let secret_outside = std::env::temp_dir()
            .join(format!("pf-workingtree-nul-secret-{}.txt", std::process::id()));
        std::fs::write(&secret_outside, "TOP SECRET CONTENT").unwrap();

        // A NUL byte can never appear in a real OS path; `git`/the OS will
        // refuse it. The primitive must not panic and must never leak
        // content from outside the repo — either an explicit rejection, or
        // a diff whose text (if any) never contains the outside secret.
        let candidate = "a.txt\0../../../../../../etc/passwd";
        let result = file_diff(repo.to_str().unwrap(), candidate, false, 0);
        if let Ok(diff) = result {
            let text = diff.diff.unwrap_or_default();
            assert!(
                !text.contains("TOP SECRET"),
                "a NUL-byte path must never leak content from outside the repo"
            );
        }
        let _ = std::fs::remove_file(&secret_outside);
    }

    #[cfg(windows)]
    #[test]
    fn file_diff_rejects_a_drive_relative_path_component() {
        // "C:a.txt" is drive-RELATIVE (relative to the current directory on
        // the C: drive), not absolute — `Path::is_absolute()` alone would
        // let it through. The explicit `Component::Prefix` rejection is the
        // only thing catching this shape.
        let repo = init_repo("diff-drive-relative");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");

        let err = file_diff(repo.to_str().unwrap(), "C:a.txt", false, 0).unwrap_err();
        assert!(err.contains("drive") || err.contains("root"));
    }

    #[test]
    fn working_tree_change_set_marks_truncated_when_the_entry_count_bound_is_exceeded() {
        let repo = init_repo("truncated-entries");
        let count = super::diff_stat::MAX_DIFF_STAT_ENTRIES + 5;
        for i in 0..count {
            std::fs::write(repo.join(format!("f{i}.txt")), "a\n").unwrap();
        }
        commit_all(&repo, "init many files");
        for i in 0..count {
            std::fs::write(repo.join(format!("f{i}.txt")), "a\nb\n").unwrap();
        }

        let cs = working_tree_change_set(repo.to_str().unwrap()).expect("repo");
        assert!(
            cs.truncated,
            "an over-cap listing must surface truncated=true, never a silent prefix"
        );
    }

    // ---- ChangeFileKind classification (#231 PR5) ----

    #[test]
    fn reports_a_submodule_addition_as_submodule_kind() {
        let repo = init_repo("submodule-add");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");
        let head = head_sha(&repo);
        run_git(
            &repo,
            &["update-index", "--add", "--cacheinfo", &format!("160000,{head},subrepo")],
        );

        let cs = working_tree_change_set(repo.to_str().unwrap()).expect("repo");
        let file = cs.files.iter().find(|f| f.path == "subrepo").expect("subrepo row");
        assert_eq!(file.kind, ChangeFileKind::Submodule);
        assert_eq!(file.staged, Some(true));
    }

    #[cfg(unix)]
    #[test]
    fn reports_a_tracked_symlink_target_change_as_symlink_kind() {
        use std::os::unix::fs::symlink;
        let repo = init_repo("symlink-kind");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        std::fs::write(repo.join("b.txt"), "two\n").unwrap();
        symlink("a.txt", repo.join("link.txt")).unwrap();
        commit_all(&repo, "init");
        std::fs::remove_file(repo.join("link.txt")).unwrap();
        symlink("b.txt", repo.join("link.txt")).unwrap();

        let cs = working_tree_change_set(repo.to_str().unwrap()).expect("repo");
        let file = cs.files.iter().find(|f| f.path == "link.txt").expect("link.txt row");
        assert_eq!(file.kind, ChangeFileKind::Symlink);
    }

    #[cfg(unix)]
    #[test]
    fn reports_an_untracked_symlink_as_symlink_kind_via_filesystem_stat() {
        use std::os::unix::fs::symlink;
        let repo = init_repo("untracked-symlink-kind");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");
        symlink("a.txt", repo.join("newlink.txt")).unwrap();

        let cs = working_tree_change_set(repo.to_str().unwrap()).expect("repo");
        let file = cs.files.iter().find(|f| f.path == "newlink.txt").expect("row");
        assert_eq!(file.status, ChangeFileStatus::Add);
        assert_eq!(file.kind, ChangeFileKind::Symlink);
    }

    #[cfg(unix)]
    #[test]
    fn reports_a_permissions_only_change_as_mode_only_kind() {
        use std::os::unix::fs::PermissionsExt;
        let repo = init_repo("mode-only-kind");
        std::fs::write(repo.join("run.sh"), "echo hi\n").unwrap();
        commit_all(&repo, "init");
        let mut perms = std::fs::metadata(repo.join("run.sh")).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(repo.join("run.sh"), perms).unwrap();

        let cs = working_tree_change_set(repo.to_str().unwrap()).expect("repo");
        let file = cs.files.iter().find(|f| f.path == "run.sh").expect("row");
        assert_eq!(file.status, ChangeFileStatus::Modify);
        assert_eq!(file.kind, ChangeFileKind::ModeOnly);
    }

    #[test]
    fn reports_an_ordinary_content_change_as_regular_kind() {
        let repo = init_repo("regular-kind");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.txt"), "one\ntwo\n").unwrap();

        let cs = working_tree_change_set(repo.to_str().unwrap()).expect("repo");
        let file = cs.files.iter().find(|f| f.path == "a.txt").expect("a.txt row");
        assert_eq!(file.kind, ChangeFileKind::Regular);
    }

    // ---- file_diff: load-more (skip_lines), invalid UTF-8, binary size ----

    #[test]
    fn file_diff_load_more_returns_the_remaining_lines_after_skip() {
        let repo = init_repo("diff-load-more");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.txt"), "one\ntwo\nthree\n").unwrap();

        let full = file_diff(repo.to_str().unwrap(), "a.txt", false, 0)
            .expect("diff ok")
            .diff
            .unwrap();
        let full_lines: Vec<&str> = full.lines().collect();
        assert!(full_lines.len() >= 2, "fixture must produce at least two diff lines");

        let rest = file_diff(repo.to_str().unwrap(), "a.txt", false, 1)
            .expect("diff ok")
            .diff
            .unwrap();
        let rest_lines: Vec<&str> = rest.lines().collect();
        assert_eq!(rest_lines, full_lines[1..], "skip_lines=1 drops exactly the first line");
    }

    #[test]
    fn file_diff_load_more_past_the_end_returns_empty_not_an_error() {
        let repo = init_repo("diff-load-more-past-end");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.txt"), "one\ntwo\n").unwrap();

        let result = file_diff(repo.to_str().unwrap(), "a.txt", false, 10_000).expect("diff ok");
        assert_eq!(result.diff.as_deref(), Some(""));
        assert!(!result.truncated);
    }

    #[test]
    fn file_diff_flags_invalid_utf8_content_without_failing() {
        let repo = init_repo("diff-invalid-utf8");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");
        // Invalid UTF-8 bytes with no NUL byte: git's own binary heuristic
        // doesn't trip, so this diffs as text with a lossily-decoded body.
        std::fs::write(repo.join("a.txt"), [b'o', b'n', b'e', b'\n', 0xFFu8, 0xFE, b'\n']).unwrap();

        let result = file_diff(repo.to_str().unwrap(), "a.txt", false, 0).expect("diff ok");
        assert!(!result.binary, "no NUL byte, so git treats this as text");
        assert!(result.invalid_utf8);
        assert!(result.diff.unwrap().contains('\u{FFFD}'));
    }

    #[test]
    fn file_diff_does_not_flag_invalid_utf8_for_ordinary_text() {
        let repo = init_repo("diff-valid-utf8");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.txt"), "one\ntwo\n").unwrap();

        let result = file_diff(repo.to_str().unwrap(), "a.txt", false, 0).expect("diff ok");
        assert!(!result.invalid_utf8);
    }

    #[test]
    fn file_diff_reports_size_bytes_for_a_binary_file_still_on_disk() {
        let repo = init_repo("diff-binary-size");
        std::fs::write(repo.join("a.bin"), [0u8, 1, 2, 3]).unwrap();
        commit_all(&repo, "init");
        let new_content = [4u8, 5, 6, 7, 8, 9, 10];
        std::fs::write(repo.join("a.bin"), new_content).unwrap();

        let result = file_diff(repo.to_str().unwrap(), "a.bin", false, 0).expect("diff ok");
        assert!(result.binary);
        assert_eq!(result.size_bytes, Some(new_content.len() as u64));
    }

    #[test]
    fn file_diff_leaves_size_bytes_unknown_for_a_deleted_binary_file() {
        let repo = init_repo("diff-binary-deleted-size");
        std::fs::write(repo.join("a.bin"), [0u8, 1, 2, 3]).unwrap();
        commit_all(&repo, "init");
        std::fs::remove_file(repo.join("a.bin")).unwrap();

        let result = file_diff(repo.to_str().unwrap(), "a.bin", false, 0).expect("diff ok");
        assert!(result.binary);
        assert_eq!(
            result.size_bytes, None,
            "no live file to stat — never guess a stale size"
        );
    }
}
