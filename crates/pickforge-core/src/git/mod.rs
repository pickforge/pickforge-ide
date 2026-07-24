//! Git working-tree status + diffs via the `git` CLI (shell-out; no native
//! libgit2 dependency). `git` is a given on a developer's machine and matches
//! the user's mental model exactly. Each call runs `git -C <root> …` through the
//! login-shell env so PATH resolves like the user's terminal.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use crate::process::{run_timeout, CommandOutcome};

pub mod diff_stat;

/// Bound every git one-shot so a hung git (a credential/SSH prompt, a stalled
/// fetch) can't wedge the calling Tauri blocking task. These are local
/// status/diff/log queries, so 20s is comfortably generous.
const GIT_TIMEOUT: Duration = Duration::from_secs(20);

/// `git <args>` in `root`, bounded. `None` on any spawn error or timeout, which
/// every caller already folds into "no result".
fn git_run(root: &str, args: &[&str]) -> Option<CommandOutcome> {
    run_timeout("git", args, Some(root), None, GIT_TIMEOUT).ok()
}

/// Heavy / vendored dirs never worth descending into when hunting for sub-repos.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "build",
    "target",
    ".dart_tool",
    "dist",
    ".gradle",
    "Pods",
    "vendor",
    ".venv",
    "venv",
];

fn has_git(dir: &Path) -> bool {
    dir.join(".git").exists()
}

/// Discover git work-trees at or beneath `root`. If `root` itself is a repo,
/// returns just `[root]`. Otherwise scans up to two levels of subdirectories
/// (e.g. a monorepo whose `app/` and `api/` are separate repos), skipping
/// dotfiles and vendored dirs and never descending into a repo it already found.
/// Returns absolute paths, sorted.
pub fn discover_repos(root: &str) -> Vec<String> {
    let root_path = Path::new(root);
    if has_git(root_path) {
        return vec![root.to_string()];
    }
    let mut out = Vec::new();
    scan_for_repos(root_path, 2, &mut out);
    // No `.git` at or below root — but the project may sit INSIDE a larger repo
    // (`.git` in an ancestor). Fall back to root so gitStatus resolves the
    // work-tree via `rev-parse --show-toplevel` (the prior behavior).
    if out.is_empty() && is_repo(root) {
        return vec![root.to_string()];
    }
    out.sort();
    out
}

fn scan_for_repos(dir: &Path, depth: u32, out: &mut Vec<String>) {
    if depth == 0 {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if name.starts_with('.') || SKIP_DIRS.contains(&name) {
            continue;
        }
        if has_git(&path) {
            out.push(path.to_string_lossy().into_owned());
        } else {
            scan_for_repos(&path, depth - 1, out);
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    /// Two-letter porcelain code (e.g. " M", "??", "A ", "MM", "R ").
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub files: Vec<GitFileStatus>,
}

/// One commit for the graph view. Lane/topology layout is computed in the UI
/// from `parents`; here we just hand back the commit metadata + decorations.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    pub hash: String,
    pub short: String,
    pub parents: Vec<String>,
    pub author: String,
    /// Relative date (e.g. "2 hours ago").
    pub date: String,
    /// Decoration names (e.g. "HEAD -> main", "origin/main", "tag: v1").
    pub refs: Vec<String>,
    pub subject: String,
}

/// Recent commits across all refs (newest first, date-order) for the graph view.
pub fn log_graph(root: &str, limit: u32) -> Vec<GraphCommit> {
    let top = match toplevel(root) {
        Some(t) => t,
        None => return Vec::new(),
    };
    // Unit-separator (\x1f) between fields, record-separator (\x1e) between commits
    // — neither appears in commit text, so parsing is unambiguous.
    let pretty = "--pretty=format:%H\x1f%h\x1f%P\x1f%an\x1f%ar\x1f%D\x1f%s\x1e";
    let n = limit.to_string();
    let raw = git_ok(&top, &["log", "--all", "--date-order", pretty, "-n", &n]).unwrap_or_default();
    raw.split('\x1e')
        .filter_map(|rec| {
            let rec = rec.trim_start_matches('\n');
            if rec.trim().is_empty() {
                return None;
            }
            let f: Vec<&str> = rec.split('\x1f').collect();
            if f.len() < 7 {
                return None;
            }
            let parents = f[2].split_whitespace().map(String::from).collect();
            let refs = f[5]
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            Some(GraphCommit {
                hash: f[0].to_string(),
                short: f[1].to_string(),
                parents,
                author: f[3].to_string(),
                date: f[4].to_string(),
                refs,
                subject: f[6].to_string(),
            })
        })
        .collect()
}

/// stdout of `git <args>` in `root`, only on success (trimmed by caller).
fn git_ok(root: &str, args: &[&str]) -> Option<String> {
    let out = git_run(root, args)?;
    out.success().then(|| out.stdout_utf8().into_owned())
}

/// stdout of `git <args>` regardless of exit code (diff returns 1 when files
/// differ — that is success for our purposes).
fn git_raw(root: &str, args: &[&str]) -> String {
    git_run(root, args)
        .map(|o| o.stdout_utf8().into_owned())
        .unwrap_or_default()
}

pub fn is_repo(root: &str) -> bool {
    matches!(git_ok(root, &["rev-parse", "--is-inside-work-tree"]), Some(s) if s.trim() == "true")
}

pub fn current_branch(root: &str) -> Option<String> {
    git_ok(root, &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// The repo's working-tree root. Porcelain status paths are repo-root-relative,
/// so every command must run from here for paths to line up (matters when the
/// project is a subdirectory of a larger repo).
fn toplevel(root: &str) -> Option<String> {
    git_ok(root, &["rev-parse", "--show-toplevel"])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn status(root: &str) -> GitStatus {
    let top = match toplevel(root) {
        Some(t) => t,
        None => return GitStatus { is_repo: false, branch: None, files: Vec::new() },
    };
    let branch = current_branch(&top);
    // -z: NUL-delimited, never quotes/escapes paths (handles spaces/unicode);
    // rename/copy entries are followed by their original path as a second token.
    let raw = git_ok(&top, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])
        .unwrap_or_default();

    let mut files = Vec::new();
    let mut tokens = raw.split('\0');
    while let Some(entry) = tokens.next() {
        if entry.len() < 4 {
            continue;
        }
        let code = &entry[..2]; // ASCII status bytes
        let path = entry[3..].to_string(); // byte 2 is the separator space
        let x = code.as_bytes()[0] as char;
        let y = code.as_bytes()[1] as char;
        // Rename/copy: consume the trailing original-path token.
        if x == 'R' || x == 'C' || y == 'R' || y == 'C' {
            tokens.next();
        }
        let untracked = code == "??";
        files.push(GitFileStatus {
            path,
            status: code.to_string(),
            staged: !untracked && x != ' ',
            unstaged: untracked || y != ' ',
            untracked,
        });
    }
    GitStatus { is_repo: true, branch, files }
}

fn is_tracked(root: &str, path: &str) -> bool {
    git_run(root, &["ls-files", "--error-unmatch", "--", path])
        .map(|o| o.success())
        .unwrap_or(false)
}

/// Unified diff for one file. `staged` reads the index (`--cached`); a new
/// untracked file has no tracked diff, so we diff it against the empty file so
/// its contents show as additions.
pub fn diff(root: &str, path: &str, staged: bool) -> String {
    // Run from the repo root so the repo-root-relative `path` from status() lines
    // up regardless of where the project sits in the tree.
    let top = toplevel(root).unwrap_or_else(|| root.to_string());
    let args: Vec<&str> = if staged {
        vec!["diff", "--cached", "--", path]
    } else {
        vec!["diff", "--", path]
    };
    let d = git_raw(&top, &args);
    if !staged && d.trim().is_empty() && !is_tracked(&top, path) {
        let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
        return git_raw(&top, &["diff", "--no-index", "--", null, path]);
    }
    d
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_repo_reports_not_a_repo() {
        let tmp = std::env::temp_dir().join("pickforge-git-test-not-a-repo");
        let _ = std::fs::create_dir_all(&tmp);
        let s = status(tmp.to_str().unwrap());
        assert!(!s.is_repo);
        assert!(s.files.is_empty());
    }

    #[test]
    fn parses_porcelain_z_entry_shape() {
        // -z entry: 2 status bytes, a separator space, then the (new) path.
        let entry = " M src/main.rs";
        assert_eq!(&entry[..2], " M");
        assert_eq!(&entry[3..], "src/main.rs");
        // A rename's original path is a separate NUL-delimited token.
        let z = "R  new.rs\u{0}old.rs";
        let mut toks = z.split('\u{0}');
        assert_eq!(toks.next().unwrap(), "R  new.rs");
        assert_eq!(toks.next().unwrap(), "old.rs");
    }
}
