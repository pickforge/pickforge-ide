//! Process/detection commands. `detect_binaries` resolves the login-shell env
//! the first time (potentially slow), so it runs on a blocking thread to keep
//! the UI responsive.

use std::time::Duration;

use pickforge_core::agents::{
    claude_auth_status_authenticated, codex_login_status_authenticated, detect_pi_kit,
    AuthPresenceProbe, AuthPresenceUnknownReason, PiKitDetection,
};
use pickforge_core::process::RunError;
use pickforge_core::{is_on_user_path, run_timeout_capped, CommandOutcome, OutputTruncation};
use serde::Serialize;

use crate::project_roots::user_home_dir;

const PROBE_CAPTURE_LIMIT_BYTES: usize = 64 * 1024;
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

#[tauri::command]
pub async fn detect_binaries(names: Vec<String>) -> Result<Vec<bool>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        names.iter().map(|name| is_on_user_path(name)).collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliProbe {
    installed: bool,
    version_output: String,
    help_output: String,
    models_output: String,
    errors: Vec<String>,
}

struct ProbeSpec {
    binary: &'static str,
    version_args: &'static [&'static str],
    help_args: &'static [&'static str],
    models_args: Option<&'static [&'static str]>,
}

fn probe_spec(agent_id: &str) -> Option<ProbeSpec> {
    match agent_id {
        "omp" => Some(ProbeSpec {
            binary: "omp",
            version_args: &["--version"],
            help_args: &["--help"],
            // `omp models --json` reads the local model cache (~/.omp/models.db)
            // rather than making a network call, so this stays read-only like
            // the other probe steps.
            models_args: Some(&["models", "--json", "--no-extensions"]),
        }),
        "pi" => Some(ProbeSpec {
            binary: "pi",
            version_args: &["--version"],
            help_args: &["--no-extensions", "--offline", "--help"],
            models_args: Some(&["--no-extensions", "--offline", "--list-models"]),
        }),
        _ => None,
    }
}

fn run_probe_step(
    binary: &str,
    args: &[&str],
    label: &str,
    errors: &mut Vec<String>,
) -> String {
    match run_timeout_capped(
        binary,
        args,
        None,
        None,
        PROBE_TIMEOUT,
        PROBE_CAPTURE_LIMIT_BYTES,
    ) {
        Ok((outcome, truncation)) => {
            if truncation.stdout {
                errors.push(format!(
                    "{label} stdout truncated at {PROBE_CAPTURE_LIMIT_BYTES} bytes"
                ));
            }
            if truncation.stderr {
                errors.push(format!(
                    "{label} stderr truncated at {PROBE_CAPTURE_LIMIT_BYTES} bytes"
                ));
            }
            if outcome.success() {
                let stdout = outcome.stdout_utf8();
                if stdout.trim().is_empty() {
                    String::from_utf8_lossy(&outcome.stderr).trim().to_owned()
                } else {
                    stdout.trim().to_owned()
                }
            } else {
                let detail = String::from_utf8_lossy(&outcome.stderr);
                let detail = detail.lines().next().unwrap_or("command failed").trim();
                errors.push(format!("{label} failed{code}: {detail}", code = outcome
                    .code
                    .map(|code| format!(" ({code})"))
                    .unwrap_or_default()));
                String::new()
            }
        }
        Err(error) => {
            errors.push(format!("{label} failed: {error}"));
            String::new()
        }
    }
}

/// Probe only the two rollout-gated CLIs with fixed, read-only argv. This never
/// accepts paths, config, tokens, or arbitrary commands from the frontend.
#[tauri::command]
pub async fn probe_agent_cli(agent_id: String) -> Result<AgentCliProbe, String> {
    let spec = probe_spec(&agent_id).ok_or_else(|| "unsupported agent probe".to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        if !is_on_user_path(spec.binary) {
            return AgentCliProbe {
                installed: false,
                version_output: String::new(),
                help_output: String::new(),
                models_output: String::new(),
                errors: Vec::new(),
            };
        }

        let mut errors = Vec::new();
        let version_output =
            run_probe_step(spec.binary, spec.version_args, "version check", &mut errors);
        let help_output =
            run_probe_step(spec.binary, spec.help_args, "capability check", &mut errors);
        let models_output = spec
            .models_args
            .map(|args| run_probe_step(spec.binary, args, "model discovery", &mut errors))
            .unwrap_or_default();
        AgentCliProbe {
            installed: true,
            version_output,
            help_output,
            models_output,
            errors,
        }
    })
    .await
    .map_err(|error| error.to_string())
}

/// Probe-only pi-kit detection: reads the user's Pi extensions directory and,
/// when a pi-kit shim is linked, the resolved checkout's `package.json`.
/// Never writes to the Pi install and never reads auth/credential files.
#[tauri::command]
pub async fn probe_pi_kit() -> Result<PiKitDetection, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(home) = user_home_dir() else {
            return PiKitDetection {
                detected: false,
                version: None,
                linked_extension_count: 0,
                checkout_path: None,
            };
        };
        detect_pi_kit(&home.join(".pi").join("agent").join("extensions"))
    })
    .await
    .map_err(|error| error.to_string())
}

struct AuthProbeSpec {
    binary: &'static str,
    args: &'static [&'static str],
}

fn auth_probe_spec(agent_id: &str) -> Option<AuthProbeSpec> {
    match agent_id {
        // Verified on a real install (codex-cli 0.144.6): exit 0 + "Logged
        // in using ChatGPT" when authenticated; exit 1 + "Not logged in"
        // otherwise. See `codex_login_status_authenticated`.
        "codex" => Some(AuthProbeSpec {
            binary: "codex",
            args: &["login", "status"],
        }),
        // `--json` keeps the shape stable for parsing, but that JSON also
        // carries email/org identifiers on a real install — only the
        // `loggedIn` boolean may ever be read out of it (see
        // `claude_auth_status_authenticated`), and raw stdout must never be
        // returned from this command.
        "claudeCode" => Some(AuthProbeSpec {
            binary: "claude",
            args: &["auth", "status", "--json"],
        }),
        _ => None,
    }
}

/// Probe-only auth-presence for the Codex and claude CLIs: runs each CLI's
/// own status command with fixed, read-only argv (never accepts config,
/// tokens, or arbitrary commands from the frontend) and reduces its output to
/// a tri-state signal. Never reads credential files, keychain entries,
/// tokens, or cookies, and never returns raw command stdout/stderr — only the
/// derived [`AuthPresenceProbe`] crosses the IPC boundary. This is an
/// advisory, best-effort signal: its failures must never feed
/// `probe_agent_cli`'s capability-gating error list (see AGENTS.md on
/// capability-relevant probe errors) since Codex/Claude Code have no
/// capability gate to withhold in the first place.
#[tauri::command]
pub async fn probe_agent_auth(agent_id: String) -> Result<AuthPresenceProbe, String> {
    let spec = auth_probe_spec(&agent_id).ok_or_else(|| "unsupported agent probe".to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        if !is_on_user_path(spec.binary) {
            return AuthPresenceProbe::unknown(AuthPresenceUnknownReason::NotInstalled);
        }
        let result = run_timeout_capped(
            spec.binary,
            spec.args,
            None,
            None,
            PROBE_TIMEOUT,
            PROBE_CAPTURE_LIMIT_BYTES,
        );
        classify_auth_probe_result(spec.binary, result)
    })
    .await
    .map_err(|error| error.to_string())
}

/// Reduce a completed (or failed) status-command run to a tri-state signal.
/// Split out from [`probe_agent_auth`] as a pure function so the "logged in"
/// / "logged out" / "command missing" / "timeout" shapes are unit-testable
/// without spawning a real process.
fn classify_auth_probe_result(
    binary: &str,
    result: Result<(CommandOutcome, OutputTruncation), RunError>,
) -> AuthPresenceProbe {
    match result {
        Ok((outcome, _truncation)) => {
            let stdout = outcome.stdout_utf8();
            let stderr = String::from_utf8_lossy(&outcome.stderr);
            let authenticated = if binary == "claude" {
                claude_auth_status_authenticated(&stdout)
            } else {
                codex_login_status_authenticated(outcome.code, &stdout, &stderr)
            };
            match authenticated {
                Some(true) => AuthPresenceProbe::authenticated(),
                Some(false) => AuthPresenceProbe::not_authenticated(),
                None => AuthPresenceProbe::unknown(AuthPresenceUnknownReason::UnrecognizedOutput),
            }
        }
        Err(RunError::Timeout(_)) => AuthPresenceProbe::unknown(AuthPresenceUnknownReason::Timeout),
        Err(RunError::Io(_)) => AuthPresenceProbe::unknown(AuthPresenceUnknownReason::CommandFailed),
    }
}

#[cfg(test)]
mod tests {
    use std::io;
    use std::time::Duration;

    use pickforge_core::agents::{AuthPresenceProbe, AuthPresenceUnknownReason};
    use pickforge_core::process::RunError;
    use pickforge_core::{CommandOutcome, OutputTruncation};

    use super::{
        auth_probe_spec, classify_auth_probe_result, probe_spec, run_probe_step,
        PROBE_CAPTURE_LIMIT_BYTES,
    };

    fn outcome(code: Option<i32>, stdout: &str, stderr: &str) -> (CommandOutcome, OutputTruncation) {
        (
            CommandOutcome {
                code,
                stdout: stdout.as_bytes().to_vec(),
                stderr: stderr.as_bytes().to_vec(),
            },
            OutputTruncation::default(),
        )
    }

    #[test]
    fn classifies_codex_login_status_shapes() {
        assert_eq!(
            classify_auth_probe_result(
                "codex",
                Ok(outcome(Some(0), "Logged in using ChatGPT\n", "")),
            ),
            AuthPresenceProbe::authenticated(),
        );
        assert_eq!(
            classify_auth_probe_result("codex", Ok(outcome(Some(1), "Not logged in\n", ""))),
            AuthPresenceProbe::not_authenticated(),
        );
        assert_eq!(
            classify_auth_probe_result("codex", Ok(outcome(Some(2), "", ""))),
            AuthPresenceProbe::unknown(AuthPresenceUnknownReason::UnrecognizedOutput),
        );
    }

    #[test]
    fn classifies_claude_auth_status_json_shapes() {
        assert_eq!(
            classify_auth_probe_result(
                "claude",
                Ok(outcome(
                    Some(0),
                    r#"{"loggedIn":true,"email":"user@example.com"}"#,
                    "",
                )),
            ),
            AuthPresenceProbe::authenticated(),
        );
        assert_eq!(
            classify_auth_probe_result("claude", Ok(outcome(Some(0), r#"{"loggedIn":false}"#, ""))),
            AuthPresenceProbe::not_authenticated(),
        );
        assert_eq!(
            classify_auth_probe_result("claude", Ok(outcome(Some(0), "not json", ""))),
            AuthPresenceProbe::unknown(AuthPresenceUnknownReason::UnrecognizedOutput),
        );
    }

    #[test]
    fn classifies_a_missing_command_as_command_failed() {
        let error = RunError::Io(io::Error::new(io::ErrorKind::NotFound, "no such file"));
        assert_eq!(
            classify_auth_probe_result("codex", Err(error)),
            AuthPresenceProbe::unknown(AuthPresenceUnknownReason::CommandFailed),
        );
    }

    #[test]
    fn classifies_a_timeout() {
        let error = RunError::Timeout(Duration::from_secs(10));
        assert_eq!(
            classify_auth_probe_result("claude", Err(error)),
            AuthPresenceProbe::unknown(AuthPresenceUnknownReason::Timeout),
        );
    }

    #[test]
    fn agent_probe_is_strictly_allowlisted() {
        let omp = probe_spec("omp").expect("OMP probe");
        assert_eq!(omp.binary, "omp");
        assert_eq!(omp.help_args, ["--help"]);
        assert_eq!(
            omp.models_args,
            Some(["models", "--json", "--no-extensions"].as_slice())
        );

        let pi = probe_spec("pi").expect("Pi probe");
        assert_eq!(pi.binary, "pi");
        assert_eq!(pi.help_args, ["--no-extensions", "--offline", "--help"]);
        assert_eq!(
            pi.models_args,
            Some(["--no-extensions", "--offline", "--list-models"].as_slice())
        );

        assert!(probe_spec("sh").is_none());
        assert!(probe_spec("../omp").is_none());
    }

    #[test]
    fn auth_probe_is_strictly_allowlisted() {
        let codex = auth_probe_spec("codex").expect("codex auth probe");
        assert_eq!(codex.binary, "codex");
        assert_eq!(codex.args, ["login", "status"]);

        let claude = auth_probe_spec("claudeCode").expect("claude auth probe");
        assert_eq!(claude.binary, "claude");
        assert_eq!(claude.args, ["auth", "status", "--json"]);

        assert!(auth_probe_spec("sh").is_none());
        assert!(auth_probe_spec("../codex").is_none());
        assert!(auth_probe_spec("omp").is_none());
        assert!(auth_probe_spec("pi").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn probe_step_caps_oversized_success_output_and_reports_truncation() {
        let mut errors = Vec::new();
        let output = run_probe_step(
            "/bin/sh",
            &[
                "-c",
                "i=0; while [ \"$i\" -lt 7000 ]; do printf '0123456789'; i=$((i + 1)); done",
            ],
            "capability check",
            &mut errors,
        );

        assert_eq!(output.len(), PROBE_CAPTURE_LIMIT_BYTES);
        assert_eq!(
            errors,
            [format!(
                "capability check stdout truncated at {PROBE_CAPTURE_LIMIT_BYTES} bytes"
            )]
        );
    }

    #[cfg(unix)]
    #[test]
    fn probe_step_caps_oversized_failure_output_and_reports_both_conditions() {
        let mut errors = Vec::new();
        let output = run_probe_step(
            "/bin/sh",
            &[
                "-c",
                "i=0; while [ \"$i\" -lt 7000 ]; do printf 'FAILDETAIL' >&2; i=$((i + 1)); done; exit 9",
            ],
            "model discovery",
            &mut errors,
        );

        assert!(output.is_empty());
        assert_eq!(errors.len(), 2);
        assert_eq!(
            errors[0],
            format!("model discovery stderr truncated at {PROBE_CAPTURE_LIMIT_BYTES} bytes")
        );
        assert!(errors[1].starts_with("model discovery failed (9): FAILDETAIL"));
    }
}
