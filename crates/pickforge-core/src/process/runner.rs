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

/// Whether a capped command discarded bytes after reaching its per-stream
/// capture limit. The child pipes are still drained to prevent deadlock.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct OutputTruncation {
    pub stdout: bool,
    pub stderr: bool,
}

#[derive(Default)]
struct CapturedStream {
    bytes: Vec<u8>,
    truncated: bool,
}

fn capture_stream(mut stream: impl Read, limit: Option<usize>) -> CapturedStream {
    let mut captured = CapturedStream {
        bytes: Vec::with_capacity(limit.unwrap_or_default().min(8 * 1024)),
        truncated: false,
    };
    let mut chunk = [0_u8; 8 * 1024];
    while let Ok(read) = stream.read(&mut chunk) {
        if read == 0 {
            break;
        }
        match limit {
            Some(limit) => {
                let stored = read.min(limit.saturating_sub(captured.bytes.len()));
                captured.bytes.extend_from_slice(&chunk[..stored]);
                captured.truncated |= stored < read;
            }
            None => captured.bytes.extend_from_slice(&chunk[..read]),
        }
    }
    captured
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
    run_timeout_inner(program, args, cwd, env, timeout, None).map(|(outcome, _)| outcome)
}

/// Like [`run_timeout`], but stores at most `max_output_bytes` from each of
/// stdout and stderr. Additional bytes are discarded while the pipes continue
/// to be drained, and the returned flags report which streams were truncated.
pub fn run_timeout_capped(
    program: &str,
    args: &[&str],
    cwd: Option<&str>,
    env: Option<&HashMap<String, String>>,
    timeout: Duration,
    max_output_bytes: usize,
) -> Result<(CommandOutcome, OutputTruncation), RunError> {
    run_timeout_inner(
        program,
        args,
        cwd,
        env,
        timeout,
        Some(max_output_bytes),
    )
}

fn run_timeout_inner(
    program: &str,
    args: &[&str],
    cwd: Option<&str>,
    env: Option<&HashMap<String, String>>,
    timeout: Duration,
    output_limit: Option<usize>,
) -> Result<(CommandOutcome, OutputTruncation), RunError> {
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
    // buffer can't deadlock against us while we poll for the deadline. Capped
    // runs discard bytes beyond the limit here, before buffering or IPC.
    let out_handle = child
        .stdout
        .take()
        .map(|stream| std::thread::spawn(move || capture_stream(stream, output_limit)));
    let err_handle = child
        .stderr
        .take()
        .map(|stream| std::thread::spawn(move || capture_stream(stream, output_limit)));

    // SIGKILL the child's process group (created via `process_group(0)`, so
    // PGID == child PID), taking down any descendants too. SIGKILL is
    // unconditionally fatal. No-op on non-unix.
    let kill_group = |child: &mut std::process::Child| {
        #[cfg(unix)]
        // SAFETY: signalling our own child's process group; `pid` is the live
        // child PID we just spawned.
        unsafe {
            libc::killpg(child.id() as libc::pid_t, libc::SIGKILL);
        }
        let _ = child.kill();
        let _ = child.wait();
    };

    // Join a drain thread, but no longer than the deadline allows. Returns the
    // buffer if it finished in time, or the handle if it's still blocked (a
    // descendant is holding the pipe open past the deadline).
    fn join_by_deadline(
        handle: Option<std::thread::JoinHandle<CapturedStream>>,
        deadline: Instant,
    ) -> Result<CapturedStream, std::thread::JoinHandle<CapturedStream>> {
        let Some(handle) = handle else {
            return Ok(CapturedStream::default());
        };
        loop {
            if handle.is_finished() {
                return Ok(handle.join().unwrap_or_default());
            }
            if Instant::now() >= deadline {
                return Err(handle);
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait()? {
            Some(status) => {
                // The child is gone, but a backgrounded DESCENDANT may still
                // hold a pipe open. Bound the drain join by the same deadline.
                let stdout = match join_by_deadline(out_handle, deadline) {
                    Ok(captured) => captured,
                    Err(handle) => {
                        kill_group(&mut child);
                        let _ = handle.join();
                        if let Some(handle) = err_handle {
                            let _ = handle.join();
                        }
                        return Err(RunError::Timeout(timeout));
                    }
                };
                let stderr = match join_by_deadline(err_handle, deadline) {
                    Ok(captured) => captured,
                    Err(handle) => {
                        kill_group(&mut child);
                        let _ = handle.join();
                        return Err(RunError::Timeout(timeout));
                    }
                };
                let truncation = OutputTruncation {
                    stdout: stdout.truncated,
                    stderr: stderr.truncated,
                };
                return Ok((
                    CommandOutcome {
                        code: status.code(),
                        stdout: stdout.bytes,
                        stderr: stderr.bytes,
                    },
                    truncation,
                ));
            }
            None => {
                if Instant::now() >= deadline {
                    // Kill, then reap so no zombie/orphan survives. The reader
                    // threads unblock on the closed pipes; join them so their
                    // handles don't dangle (output is discarded on timeout).
                    kill_group(&mut child);
                    if let Some(handle) = out_handle {
                        let _ = handle.join();
                    }
                    if let Some(handle) = err_handle {
                        let _ = handle.join();
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
    fn run_timeout_capped_bounds_success_output_and_reports_each_stream() {
        let (outcome, truncation) = run_timeout_capped(
            "/bin/sh",
            &[
                "-c",
                "printf '0123456789abcdefghijklmnopqrstuvwxyz'; printf 'ABCDEFGHIJKLMNOPQRSTUVWXYZ9876543210' >&2",
            ],
            None,
            None,
            Duration::from_secs(5),
            16,
        )
        .expect("run capped command");

        assert!(outcome.success());
        assert_eq!(outcome.stdout, b"0123456789abcdef");
        assert_eq!(outcome.stderr, b"ABCDEFGHIJKLMNOP");
        assert_eq!(
            truncation,
            OutputTruncation {
                stdout: true,
                stderr: true,
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn run_timeout_capped_bounds_failure_output() {
        let (outcome, truncation) = run_timeout_capped(
            "/bin/sh",
            &[
                "-c",
                "printf 'PRIVATE_FAILURE_DETAIL_THAT_MUST_BE_CAPPED' >&2; exit 7",
            ],
            None,
            None,
            Duration::from_secs(5),
            12,
        )
        .expect("run capped failing command");

        assert_eq!(outcome.code, Some(7));
        assert_eq!(outcome.stderr, b"PRIVATE_FAIL");
        assert!(truncation.stderr);
        assert!(!truncation.stdout);
    }

    #[cfg(unix)]
    #[test]
    fn run_timeout_capped_bounds_output_until_timeout() {
        let started = Instant::now();
        let result = run_timeout_capped(
            "/bin/sh",
            &["-c", "while :; do printf '0123456789'; printf 'abcdefghij' >&2; done"],
            None,
            None,
            Duration::from_millis(200),
            32,
        );

        assert!(
            matches!(result, Err(RunError::Timeout(_))),
            "expected a timeout error, got {result:?}"
        );
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "capped timeout should return promptly"
        );
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

    #[cfg(unix)]
    #[test]
    fn run_timeout_bounds_drain_when_descendant_holds_pipe_open() {
        // The direct child (`sh`) EXITS immediately after backgrounding the
        // sleeper, but the backgrounded `sleep` inherits the stdout pipe and
        // keeps it open — so the drain's `read_to_end` never hits EOF. Without a
        // deadline on the drain join, the runner would block for the full 30s
        // (well past its 200ms timeout). The deadline must bound the TOTAL
        // operation: once exceeded, group-kill closes the pipe and the drain
        // reaches EOF.
        let marker = std::env::temp_dir().join(format!(
            "pickforge-run-timeout-drain-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_file(&marker);
        // Background a long sleeper that would write the marker if it survived,
        // then have the foreground `sh` exit promptly (after `echo done`).
        let script = format!("(sleep 30; : > {}) & echo done", marker.display());

        let started = Instant::now();
        let result = run_timeout(
            "/bin/sh",
            &["-c", &script],
            None,
            None,
            Duration::from_millis(200),
        );
        let elapsed = started.elapsed();
        // The child exits fast, but the drain can't finish (pipe still held), so
        // the deadline trips and we group-kill → timeout. Either way it must
        // return promptly, nowhere near the 30s sleep.
        assert!(
            matches!(result, Err(RunError::Timeout(_))),
            "expected a timeout once the drain overran the deadline, got {result:?}"
        );
        assert!(
            elapsed < Duration::from_secs(5),
            "drain join must be bounded by the deadline, took {elapsed:?}"
        );

        // The group-kill must have taken down the backgrounded sleeper too; a
        // survivor would still be mid-`sleep 30` and later write the marker.
        std::thread::sleep(Duration::from_millis(500));
        assert!(
            !marker.exists(),
            "backgrounded pipe-holder survived the timeout (marker was written)"
        );
        let _ = std::fs::remove_file(&marker);
    }
}
