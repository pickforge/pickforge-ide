//! Detect whether a binary is available on PATH.
//!
//! The Dart version shelled out to `which`/`where`; we scan PATH natively (no
//! subprocess) against the resolved login-shell environment, so tools installed
//! by bun / npm-global / asdf / mise / volta / cargo are found even when the app
//! launches from a desktop session. Ported from `binary_detector.dart`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// True if `binary` resolves to an executable on the given environment's PATH.
pub fn is_binary_on_path(binary: &str, env: &HashMap<String, String>) -> bool {
    which_in(binary, env).is_some()
}

/// Convenience over the cached login-shell environment.
pub fn is_on_user_path(binary: &str) -> bool {
    is_binary_on_path(binary, super::user_shell_environment())
}

/// Resolve `binary` to a concrete executable path using `env`'s PATH.
pub fn which_in(binary: &str, env: &HashMap<String, String>) -> Option<PathBuf> {
    if binary.is_empty() {
        return None;
    }

    // An explicit path is checked directly, not searched.
    if binary.contains('/') || binary.contains('\\') {
        let candidate = Path::new(binary);
        return is_executable(candidate).then(|| candidate.to_path_buf());
    }

    let path = env
        .get("PATH")
        .or_else(|| env.get("Path"))
        .cloned()
        .unwrap_or_default();

    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(binary);
        if is_executable(&candidate) {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            for ext in windows_pathext(env) {
                // `ext` includes the leading dot (e.g. ".EXE").
                let with_ext = dir.join(format!("{binary}{ext}"));
                if is_executable(&with_ext) {
                    return Some(with_ext);
                }
            }
        }
    }
    None
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    match std::fs::metadata(path) {
        Ok(meta) => meta.is_file() && (meta.permissions().mode() & 0o111 != 0),
        Err(_) => false,
    }
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

#[cfg(windows)]
fn windows_pathext(env: &HashMap<String, String>) -> Vec<String> {
    env.get("PATHEXT")
        .or_else(|| env.get("Pathext"))
        .map(|value| {
            value
                .split(';')
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_else(|| {
            [".COM", ".EXE", ".BAT", ".CMD"]
                .iter()
                .map(|s| (*s).to_string())
                .collect()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn finds_an_executable_on_a_synthetic_path() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join(format!("pf-which-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("pf_fake_tool");
        std::fs::write(&bin, b"#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();

        let mut env = HashMap::new();
        env.insert("PATH".to_string(), dir.to_string_lossy().into_owned());

        assert!(is_binary_on_path("pf_fake_tool", &env));
        assert!(!is_binary_on_path("pf_missing_xyz", &env));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn empty_binary_is_never_found() {
        assert!(!is_binary_on_path("", &HashMap::new()));
    }
}
