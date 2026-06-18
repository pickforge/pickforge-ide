//! Git working-tree status + diffs via the `git` CLI (shell-out; no native
//! libgit2 dependency). `git` is a given on a developer's machine and matches
//! the user's mental model exactly. Each call runs `git -C <root> …` through the
//! login-shell env so PATH resolves like the user's terminal.

use serde::Serialize;

use crate::process::run;

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

/// stdout of `git <args>` in `root`, only on success (trimmed by caller).
fn git_ok(root: &str, args: &[&str]) -> Option<String> {
    let out = run("git", args, Some(root), None).ok()?;
    out.success().then(|| out.stdout_utf8().into_owned())
}

/// stdout of `git <args>` regardless of exit code (diff returns 1 when files
/// differ — that is success for our purposes).
fn git_raw(root: &str, args: &[&str]) -> String {
    run("git", args, Some(root), None)
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

pub fn status(root: &str) -> GitStatus {
    if !is_repo(root) {
        return GitStatus { is_repo: false, branch: None, files: Vec::new() };
    }
    let branch = current_branch(root);
    // -z: NUL-delimited, never quotes/escapes paths (handles spaces/unicode);
    // rename/copy entries are followed by their original path as a second token.
    let raw = git_ok(root, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])
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
    run("git", &["ls-files", "--error-unmatch", "--", path], Some(root), None)
        .map(|o| o.success())
        .unwrap_or(false)
}

/// Unified diff for one file. `staged` reads the index (`--cached`); a new
/// untracked file has no tracked diff, so we diff it against the empty file so
/// its contents show as additions.
pub fn diff(root: &str, path: &str, staged: bool) -> String {
    let args: Vec<&str> = if staged {
        vec!["diff", "--cached", "--", path]
    } else {
        vec!["diff", "--", path]
    };
    let d = git_raw(root, &args);
    if !staged && d.trim().is_empty() && !is_tracked(root, path) {
        let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
        return git_raw(root, &["diff", "--no-index", "--", null, path]);
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
