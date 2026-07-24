//! Process/detection commands. `detect_binaries` resolves the login-shell env
//! the first time (potentially slow), so it runs on a blocking thread to keep
//! the UI responsive.

use std::time::Duration;

use pickforge_core::agents::{detect_pi_kit, PiKitDetection};
use pickforge_core::{is_on_user_path, run_timeout_capped};
use serde::Serialize;

use crate::project_roots::user_home_dir;

const PROBE_CAPTURE_LIMIT_BYTES: usize = 64 * 1024;

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
            help_args: &["--no-extensions", "--help"],
            // OMP has no documented switch that enforces offline/cache-only
            // model listing, so PR1 deliberately does not probe its catalog.
            models_args: None,
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
        Duration::from_secs(10),
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

#[cfg(test)]
mod tests {
    use super::{probe_spec, run_probe_step, PROBE_CAPTURE_LIMIT_BYTES};

    #[test]
    fn agent_probe_is_strictly_allowlisted() {
        let omp = probe_spec("omp").expect("OMP probe");
        assert_eq!(omp.binary, "omp");
        assert_eq!(omp.help_args, ["--no-extensions", "--help"]);
        assert!(omp.models_args.is_none());

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
