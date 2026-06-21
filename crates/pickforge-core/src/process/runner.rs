//! Run a process to completion and capture its output. The streaming/spawn
//! variant (for logcat etc.) lands with the device bridges in Phase 3.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Captured result of a finished command.
#[derive(Debug, Clone)]
pub struct CommandOutcome {
    /// Exit code, or `None` if the process was killed by a signal.
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

/// Failure modes of a bounded run: an OS error spawning/reading, or the
/// process outliving its deadline (killed + reaped before returning).
#[derive(Debug, thiserror::Error)]
pub enum RunError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("command timed out after {0:?}")]
    Timeout(Duration),
}

impl CommandOutcome {
    pub fn success(&self) -> bool {
        self.code == Some(0)
    }

    pub fn stdout_utf8(&self) -> std::borrow::Cow<'_, str> {
        String::from_utf8_lossy(&self.stdout)
    }
}

fn configure(
    cmd: &mut Command,
    args: &[&str],
    cwd: Option<&str>,
    env: Option<&HashMap<String, String>>,
) {
    cmd.args(args).stdin(Stdio::null());

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    // Base on the enriched login-shell env (like Dart's RealProcessRunner) so
    // PATH is correct, then overlay caller-provided overrides.
    cmd.env_clear();
    let mut merged = super::user_shell_environment().clone();
    if let Some(extra) = env {
        for (key, value) in extra {
            merged.insert(key.clone(), value.clone());
        }
    }
    for (key, value) in merged {
        cmd.env(key, value);
    }
}

/// Run `program args…`, optionally in `cwd` and with an explicit environment
/// (the login-shell env, typically). `stdin` is closed.
pub fn run(
    program: &str,
    args: &[&str],
    cwd: Option<&str>,
    env: Option<&HashMap<String, String>>,
) -> std::io::Result<CommandOutcome> {
    let mut cmd = Command::new(program);
    configure(&mut cmd, args, cwd, env);

    let output = cmd.output()?;
    Ok(CommandOutcome {
        code: output.status.code(),
        stdout: output.stdout,
        stderr: output.stderr,
    })
}

/// Like [`run`], but aborts if the process outlives `timeout`. On timeout the
/// child is killed and reaped (no orphan left behind) and [`RunError::Timeout`]
/// is returned. The success-path [`CommandOutcome`] shape is unchanged.
pub fn run_timeout(
    program: &str,
    args: &[&str],
    cwd: Option<&str>,
    env: Option<&HashMap<String, String>>,
    timeout: Duration,
) -> Result<CommandOutcome, RunError> {
    let mut cmd = Command::new(program);
    configure(&mut cmd, args, cwd, env);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    // Run the child in its own process group so a timeout can take down any
    // descendants it spawned (a stuck `adb`/`git` re-exec'ing helpers), not
    // just the direct child that would otherwise orphan them.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    let mut child = cmd.spawn()?;

    // Drain stdout/stderr on their own threads so a child that fills a pipe
    // buffer can't deadlock against us while we poll for the deadline.
    let out_handle = child.stdout.take().map(|mut s| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = s.read_to_end(&mut buf);
            buf
        })
    });
    let err_handle = child.stderr.take().map(|mut s| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = s.read_to_end(&mut buf);
            buf
        })
    });

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait()? {
            Some(status) => {
                let stdout = out_handle.and_then(|h| h.join().ok()).unwrap_or_default();
                let stderr = err_handle.and_then(|h| h.join().ok()).unwrap_or_default();
                return Ok(CommandOutcome {
                    code: status.code(),
                    stdout,
                    stderr,
                });
            }
            None => {
                if Instant::now() >= deadline {
                    // Kill, then reap so no zombie/orphan survives. The reader
                    // threads unblock on the closed pipes; join them so their
                    // handles don't dangle (output is discarded on timeout).
                    #[cfg(unix)]
                    // SAFETY: signalling the child's own process group (created
                    // via `process_group(0)`, so PGID == child PID) takes down
                    // any descendants too. SIGKILL is unconditionally fatal.
                    unsafe {
                        libc::killpg(child.id() as libc::pid_t, libc::SIGKILL);
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                    if let Some(h) = out_handle {
                        let _ = h.join();
                    }
                    if let Some(h) = err_handle {
                        let _ = h.join();
                    }
                    return Err(RunError::Timeout(timeout));
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn runs_a_command_and_captures_stdout() {
        let outcome = run("/bin/echo", &["pickforge"], None, None).expect("run echo");
        assert!(outcome.success());
        assert_eq!(outcome.stdout_utf8().trim(), "pickforge");
    }

    #[cfg(unix)]
    #[test]
    fn run_timeout_returns_output_within_deadline() {
        let outcome = run_timeout(
            "/bin/echo",
            &["pickforge"],
            None,
            None,
            Duration::from_secs(5),
        )
        .expect("run echo");
        assert!(outcome.success());
        assert_eq!(outcome.stdout_utf8().trim(), "pickforge");
    }

    #[cfg(unix)]
    #[test]
    fn run_timeout_kills_a_stuck_command_and_leaves_no_child() {
        // A bare `sleep 30` would block the old `output()` path indefinitely;
        // the bounded runner must abort well before that AND reap the child's
        // process group so the marker it would write (after the sleep) never
        // appears.
        let marker = std::env::temp_dir().join(format!(
            "pickforge-run-timeout-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_file(&marker);
        let script = format!("sleep 30; : > {}", marker.display());

        let started = Instant::now();
        let result = run_timeout(
            "/bin/sh",
            &["-c", &script],
            None,
            None,
            Duration::from_millis(200),
        );
        let elapsed = started.elapsed();
        assert!(
            matches!(result, Err(RunError::Timeout(_))),
            "expected a timeout error, got {result:?}"
        );
        // Must return on the order of the timeout, nowhere near the 30s sleep
        // (generous bound tolerates scheduler jitter under parallel test load).
        assert!(
            elapsed < Duration::from_secs(5),
            "timeout should return promptly, took {elapsed:?}"
        );

        // A killed-but-surviving descendant would still be mid-`sleep 30`; a
        // correctly group-reaped one is gone and never writes the marker.
        std::thread::sleep(Duration::from_millis(500));
        assert!(
            !marker.exists(),
            "stuck child kept running after the timeout (marker was written)"
        );
        let _ = std::fs::remove_file(&marker);
    }
}
