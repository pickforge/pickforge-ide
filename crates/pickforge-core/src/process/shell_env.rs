//! Resolve the user's real interactive shell environment (PATH and friends).
//!
//! GUI apps launched outside a terminal inherit a minimal desktop-session
//! environment that omits paths added by `~/.bashrc` / `~/.zshrc` / `~/.profile`
//! (bun, npm-global, cargo, pipx, volta, asdf, mise, …). We spawn the login
//! shell once, read its `env`, and merge it over the inherited environment.
//!
//! Ported from `user_shell_environment.dart`.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

static CACHE: OnceLock<HashMap<String, String>> = OnceLock::new();

/// The resolved, enriched environment. Computed once and cached for the process
/// lifetime (matches the Dart static singleton).
pub fn user_shell_environment() -> &'static HashMap<String, String> {
    CACHE.get_or_init(|| resolve(std::env::vars().collect()))
}

fn resolve(base: HashMap<String, String>) -> HashMap<String, String> {
    if cfg!(windows) || base.get("PICKFORGE_INHERITED_ENV_ONLY").map(String::as_str) == Some("1") {
        return base;
    }

    let shell = match base.get("SHELL") {
        Some(s) if !s.is_empty() && Path::new(s).exists() => s.clone(),
        _ => return base,
    };

    match run_shell_env(&shell, Duration::from_secs(3)) {
        Some(output) => {
            let mut merged = base;
            for (key, value) in parse_env(&output) {
                merged.insert(key, value);
            }
            merged
        }
        None => base,
    }
}

/// Run `$SHELL -ilc env` with a hard timeout, draining stdout concurrently so a
/// large environment can't deadlock the pipe. Dependency-free.
fn run_shell_env(shell: &str, timeout: Duration) -> Option<String> {
    let mut child = Command::new(shell)
        .args(["-ilc", "env"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        let _ = tx.send(buf);
    });

    // Bound the stdout read by the budget.
    let output = rx.recv_timeout(timeout).ok();

    // Never block on child exit: if output arrived the shell should exit
    // promptly (small grace); otherwise kill it now. Either way it ends reaped.
    let success = match &output {
        Some(_) => wait_success_within(&mut child, Duration::from_millis(500)),
        None => {
            let _ = child.kill();
            let _ = child.wait();
            false
        }
    };

    // Join the reader only once it has finished (output present). A reader still
    // blocked on a descendant holding stdout open is detached, not joined.
    if output.is_some() {
        let _ = reader.join();
    } else {
        drop(reader);
    }

    if success {
        output
    } else {
        None
    }
}

/// Wait up to `budget` for the child to exit; returns whether it exited cleanly.
/// Kills + reaps it if it overruns so we never block.
fn wait_success_within(child: &mut std::process::Child, budget: Duration) -> bool {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if start.elapsed() < budget => {
                std::thread::sleep(Duration::from_millis(10));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

fn parse_env(raw: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut current: Option<(String, String)> = None;

    // `lines()` matches Dart's LineSplitter: splits on \n and \r\n and does not
    // emit a trailing empty element for a final newline.
    for line in raw.lines() {
        if let Some(eq) = line.find('=') {
            if eq > 0 && is_valid_env_name(&line[..eq]) {
                if let Some(pair) = current.take() {
                    out.push(pair);
                }
                current = Some((line[..eq].to_string(), line[eq + 1..].to_string()));
                continue;
            }
        }
        // Continuation line (multi-line exported function bodies, etc.).
        if let Some((_, value)) = current.as_mut() {
            value.push('\n');
            value.push_str(line);
        }
    }
    if let Some(pair) = current {
        out.push(pair);
    }
    out
}

fn is_valid_env_name(s: &str) -> bool {
    let mut chars = s.bytes();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == b'_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_assignments() {
        let env = parse_env("PATH=/usr/bin\nHOME=/home/dev\n");
        assert_eq!(env.len(), 2);
        assert_eq!(env[0], ("PATH".into(), "/usr/bin".into()));
        assert_eq!(env[1], ("HOME".into(), "/home/dev".into()));
    }

    #[test]
    fn folds_continuation_lines_into_the_previous_value() {
        let env = parse_env("FOO=line1\nstill-foo\nBAR=baz");
        assert_eq!(env[0], ("FOO".into(), "line1\nstill-foo".into()));
        assert_eq!(env[1], ("BAR".into(), "baz".into()));
    }

    #[test]
    fn ignores_lines_without_a_valid_name() {
        let env = parse_env("=leading\n123=nope\nGOOD_1=yes");
        // "=leading" and "123=nope" are not valid assignments; with no prior
        // key they are dropped.
        assert_eq!(env, vec![("GOOD_1".into(), "yes".into())]);
    }

    #[test]
    fn validates_env_names() {
        assert!(is_valid_env_name("PATH"));
        assert!(is_valid_env_name("_x9"));
        assert!(!is_valid_env_name(""));
        assert!(!is_valid_env_name("9bad"));
        assert!(!is_valid_env_name("has-dash"));
    }

    #[test]
    fn resolves_a_non_empty_environment_with_path() {
        // On a real machine the merged env always carries PATH.
        let env = user_shell_environment();
        assert!(env.contains_key("PATH") || env.contains_key("Path"));
    }
}
