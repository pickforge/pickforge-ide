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
//! a state to render, not collapse.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

use crate::changes::{
    ChangeDiff, ChangeFileStatus, ChangeScope, ChangeSet, ChangeSource, ChangeTotals, ChangedFile,
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
    let status = super::status(&top);
    if !status.is_repo {
        return None;
    }

    // `--find-renames` is explicit rather than relying on the user's
    // `diff.renames` git config, so rename detection behaves the same on
    // every install regardless of that config's value.
    let (staged_name_raw, _) =
        git_capped(&top, &["diff", "--cached", "--find-renames", "--name-status", "-z"]);
    let (staged_num_raw, _) =
        git_capped(&top, &["diff", "--cached", "--find-renames", "--numstat", "-z"]);
    let (unstaged_name_raw, _) =
        git_capped(&top, &["diff", "--find-renames", "--name-status", "-z"]);
    let (unstaged_num_raw, _) =
        git_capped(&top, &["diff", "--find-renames", "--numstat", "-z"]);

    let staged_name = diff_stat::parse_name_status_z(&staged_name_raw).entries;
    let staged_num = diff_stat::parse_numstat_z(&staged_num_raw).entries;
    let unstaged_name = diff_stat::parse_name_status_z(&unstaged_name_raw).entries;
    let unstaged_num = diff_stat::parse_numstat_z(&unstaged_num_raw).entries;

    let mut files = diff_stat::merge_changed_files(&staged_name, &staged_num, true);
    files.extend(diff_stat::merge_changed_files(&unstaged_name, &unstaged_num, false));

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
        });
    }

    // Conflicts are a Git-live-only concept `git diff --name-status` doesn't
    // cleanly represent; overlay the porcelain-derived truth onto whatever
    // row(s) the diff calls produced for that path, and synthesize a row for
    // any unmerged path that produced none at all (defensive — every
    // unmerged path is expected to appear in at least the unstaged diff).
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
            staged: None,
            unstaged: None,
            additions: None,
            deletions: None,
            binary: false,
            truncated: false,
            diff_available: true,
        });
    }

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
        files,
        totals,
    })
}

/// Resolves a repo-relative `candidate` against an already-canonical
/// `repo_root`, rejecting anything unsafe: an absolute path, any `..`
/// component, or — once joined — a path whose deepest EXISTING ancestor
/// canonicalizes outside `repo_root` (a symlinked escape). Existence is
/// checked ancestor-by-ancestor rather than requiring the leaf itself to
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
    if candidate_path
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("path must not contain parent-directory traversal".to_string());
    }

    let joined = repo_root.join(candidate_path);
    let (existing, remainder) = deepest_existing_ancestor(&joined);
    let canon_existing = std::fs::canonicalize(&existing).map_err(|e| e.to_string())?;
    if !canon_existing.starts_with(repo_root) {
        return Err("path escapes the repository root".to_string());
    }
    Ok(canon_existing.join(remainder))
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
/// per-file fetch), staged or unstaged. `root` is any directory at or inside
/// the repo (resolved to the toplevel the same as [`working_tree_change_set`]);
/// `path` is validated safe via [`resolve_repo_relative`] before ever
/// reaching a `git` invocation — traversal or a symlinked escape is rejected
/// with an error, never silently clamped. An untracked file (no staged
/// counterpart) falls back to `git diff --no-index` against the empty file,
/// same as `crate::git::diff`.
pub fn file_diff(root: &str, path: &str, staged: bool) -> Result<ChangeDiff, String> {
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

    let args: Vec<&str> = if staged {
        vec!["diff", "--cached", "--", &repo_relative]
    } else {
        vec!["diff", "--", &repo_relative]
    };
    let (raw, out_truncated) = git_capped(&top, &args);
    let text = String::from_utf8_lossy(&raw).into_owned();

    if !staged && text.trim().is_empty() && !super::is_tracked(&top, &repo_relative) {
        let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
        let (raw2, t2) = git_capped(&top, &["diff", "--no-index", "--", null, &repo_relative]);
        let text = String::from_utf8_lossy(&raw2).into_owned();
        return Ok(crate::changes::finish_change_diff(&text, out_truncated || t2));
    }
    Ok(crate::changes::finish_change_diff(&text, out_truncated))
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
        assert_eq!(file.staged, None);
        assert_eq!(file.unstaged, Some(true));
        assert_eq!(file.additions, Some(1));
        assert_eq!(file.deletions, Some(0));
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
        assert!(rows.iter().any(|f| f.staged == Some(true) && f.unstaged.is_none()));
        assert!(rows.iter().any(|f| f.unstaged == Some(true) && f.staged.is_none()));
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

        let result = file_diff(repo.to_str().unwrap(), "a.txt", false).expect("diff ok");
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

        let result = file_diff(repo.to_str().unwrap(), "new.txt", false).expect("diff ok");
        assert!(result.diff.unwrap().contains("+hello"));
    }

    #[test]
    fn file_diff_returns_binary_true_with_no_text_for_a_binary_file() {
        let repo = init_repo("diff-binary");
        std::fs::write(repo.join("a.bin"), [0u8, 1, 2, 3]).unwrap();
        commit_all(&repo, "init");
        std::fs::write(repo.join("a.bin"), [4u8, 5, 6, 7, 8]).unwrap();

        let result = file_diff(repo.to_str().unwrap(), "a.bin", false).expect("diff ok");
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

        let err = file_diff(repo.to_str().unwrap(), "../../../etc/passwd", false).unwrap_err();
        assert!(err.contains("traversal"));
        let _ = std::fs::remove_file(&secret);
    }

    #[test]
    fn file_diff_rejects_an_absolute_path() {
        let repo = init_repo("diff-absolute");
        std::fs::write(repo.join("a.txt"), "one\n").unwrap();
        commit_all(&repo, "init");

        let err = file_diff(repo.to_str().unwrap(), "/etc/passwd", false).unwrap_err();
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

        let err = file_diff(repo.to_str().unwrap(), "escape/secret.txt", false).unwrap_err();
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

        let result = file_diff(repo.to_str().unwrap(), "gone.txt", false).expect("diff ok");
        assert!(result.available);
        assert!(result.diff.unwrap().contains("-will be deleted"));
    }

    #[test]
    fn resolve_repo_relative_rejects_empty_path() {
        let repo = init_repo("resolve-empty");
        assert!(resolve_repo_relative(&repo, "").is_err());
    }
}
