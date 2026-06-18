//! Stable per-project id — ported from `project_id.dart`.
//!
//! `<slug>-<fnv1a64-hex>` of the lexically-canonicalised root (plus an optional
//! repo remote). FNV-1a 64-bit, rendered as 16 lowercase hex digits.

use std::path::{Component, Path, PathBuf};

pub fn project_id(project_root: &str, repo_remote_url: Option<&str>) -> String {
    let canonical = lexical_canonicalize(project_root);
    let basis = match repo_remote_url.map(str::trim).filter(|s| !s.is_empty()) {
        Some(remote) => format!("{canonical} {remote}"),
        None => canonical.clone(),
    };
    let hash = fnv1a_hex(&basis);
    let slug = slug(basename(&canonical));
    if slug.is_empty() {
        hash
    } else {
        format!("{slug}-{hash}")
    }
}

fn fnv1a_hex(input: &str) -> String {
    const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut hash = OFFSET_BASIS;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(PRIME);
    }
    format!("{hash:016x}")
}

fn slug(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut pending_dash = false;
    for ch in input.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            pending_dash = false;
        } else if !pending_dash {
            out.push('-');
            pending_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn basename(path: &str) -> &str {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
}

/// Absolute + lexical normalisation of `.`/`..` without touching the filesystem
/// (so it works for non-existent roots and never resolves symlinks).
fn lexical_canonicalize(path: &str) -> String {
    let raw = Path::new(path);
    let absolute = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(raw))
            .unwrap_or_else(|_| raw.to_path_buf())
    };

    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::ParentDir => {
                normalized.pop();
            }
            Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_deterministic_and_slug_prefixed() {
        let a = project_id("/home/dev/My Project", None);
        let b = project_id("/home/dev/My Project", None);
        assert_eq!(a, b);
        assert!(a.starts_with("my-project-"), "got {a}");
        // 16 hex chars after the slug.
        assert_eq!(a.rsplit('-').next().unwrap().len(), 16);
    }

    #[test]
    fn remote_changes_the_hash() {
        let bare = project_id("/p", None);
        let with_remote = project_id("/p", Some("git@example.com:x.git"));
        assert_ne!(bare, with_remote);
    }

    #[test]
    fn normalizes_dot_dot() {
        assert_eq!(
            project_id("/home/dev/proj", None),
            project_id("/home/dev/sub/../proj", None)
        );
    }

    #[test]
    fn slugs_collapse_and_trim() {
        assert_eq!(slug("  Hello__World!! "), "hello-world");
        assert_eq!(slug("***"), "");
    }
}
