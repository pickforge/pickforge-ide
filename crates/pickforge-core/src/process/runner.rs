//! Run a process to completion and capture its output. The streaming/spawn
//! variant (for logcat etc.) lands with the device bridges in Phase 3.

use std::collections::HashMap;
use std::process::{Command, Stdio};

/// Captured result of a finished command.
#[derive(Debug, Clone)]
pub struct CommandOutcome {
    /// Exit code, or `None` if the process was killed by a signal.
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl CommandOutcome {
    pub fn success(&self) -> bool {
        self.code == Some(0)
    }

    pub fn stdout_utf8(&self) -> std::borrow::Cow<'_, str> {
        String::from_utf8_lossy(&self.stdout)
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

    let output = cmd.output()?;
    Ok(CommandOutcome {
        code: output.status.code(),
        stdout: output.stdout,
        stderr: output.stderr,
    })
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
}
