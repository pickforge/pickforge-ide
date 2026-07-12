use std::time::Duration;

use crate::process::CommandOutcome;
use serde::{Deserialize, Serialize};

use super::ssh::{
    login_shell_argv, login_shell_probe_argv, probe_output as framed_probe_output, ssh_run,
    SshError, SshTarget,
};

const NEAREST_PUBSPEC_SCRIPT: &str = r#"printf '%s\n' '__PF_REMOTE_PROBE_BEGIN__'
dir=$1
is_flutter() {
  awk '
    /^[[:space:]]*dependencies:[[:space:]]*(#.*)?$/ { dependencies = 1; next }
    dependencies && /^[^[:space:]#]/ { exit }
    dependencies && /^[[:space:]]+flutter:[[:space:]]*(#.*)?$/ { flutter = 1; next }
    flutter && /^[[:space:]]+sdk:[[:space:]]*flutter([[:space:]#]|$)/ { found = 1; exit }
    END { exit !found }
  ' "$1"
}
find "$dir" \
  -type d \( -name .git -o -name .dart_tool -o -name build \) -prune -o \
  -type f -name pubspec.yaml -print |
while IFS= read -r pubspec; do
  if is_flutter "$pubspec"; then
    dirname "$pubspec"
    break
  fi
done
printf '%s\n' '__PF_REMOTE_PROBE_END__'"#;

const DETECT_BINARIES_SCRIPT: &str = r#"printf '%s\n' '__PF_REMOTE_PROBE_BEGIN__'
for name do
  if command -v "$name" >/dev/null 2>&1; then
    printf '1\n'
  else
    printf '0\n'
  fi
done
printf '%s\n' '__PF_REMOTE_PROBE_END__'"#;

const FLUTTER_APP_SCRIPT: &str = r#"awk '
  /^[[:space:]]*dependencies:[[:space:]]*(#.*)?$/ { dependencies = 1; next }
  dependencies && /^[^[:space:]#]/ { exit }
  dependencies && /^[[:space:]]+flutter:[[:space:]]*(#.*)?$/ { flutter = 1; next }
  flutter && /^[[:space:]]+sdk:[[:space:]]*flutter([[:space:]#]|$)/ { found = 1; exit }
  END { exit !found }
' "$1/pubspec.yaml""#;

#[derive(Debug, thiserror::Error)]
pub enum RemoteDetectError {
    #[error(transparent)]
    Ssh(#[from] SshError),
    #[error("{0}")]
    Command(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFlutterDevice {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub is_supported: bool,
    #[serde(default)]
    pub emulator: bool,
}

pub fn remote_nearest_pubspec(
    host: &str,
    start_dir: &str,
    timeout: Duration,
) -> Result<Option<String>, RemoteDetectError> {
    let target = SshTarget::new(host)?;
    let argv = nearest_pubspec_argv(start_dir);
    let refs = argv.iter().map(String::as_str).collect::<Vec<_>>();
    let outcome = ssh_run(&target, &refs, timeout)?;
    if !outcome.success() {
        return Err(RemoteDetectError::Command(command_summary(&outcome)));
    }
    let stdout = outcome.stdout_utf8();
    Ok(probe_output(&stdout)?
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string))
}

pub fn remote_detect_binaries(
    host: &str,
    names: &[&str],
    timeout: Duration,
) -> Result<Vec<bool>, RemoteDetectError> {
    if names.is_empty() {
        return Ok(Vec::new());
    }

    let target = SshTarget::new(host)?;
    let argv = detect_binaries_argv(names);
    let refs = argv.iter().map(String::as_str).collect::<Vec<_>>();
    let outcome = ssh_run(&target, &refs, timeout)?;
    if !outcome.success() {
        return Err(RemoteDetectError::Command(command_summary(&outcome)));
    }

    let stdout = outcome.stdout_utf8();
    let lines = probe_output(&stdout)?
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    if lines.len() != names.len() {
        return Err(RemoteDetectError::Command(format!(
            "expected {} binary probe results, got {}",
            names.len(),
            lines.len()
        )));
    }
    lines
        .into_iter()
        .map(|line| match line {
            "1" => Ok(true),
            "0" => Ok(false),
            other => Err(RemoteDetectError::Command(format!(
                "unexpected binary probe result: {other}"
            ))),
        })
        .collect()
}

pub fn remote_pubspec_uses_flutter(
    host: &str,
    project_dir: &str,
    timeout: Duration,
) -> Result<bool, RemoteDetectError> {
    let target = SshTarget::new(host)?;
    let argv = flutter_app_argv(project_dir);
    let refs = argv.iter().map(String::as_str).collect::<Vec<_>>();
    let outcome = ssh_run(&target, &refs, timeout)?;
    match outcome.code {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(RemoteDetectError::Command(command_summary(&outcome))),
    }
}

pub fn remote_flutter_devices(
    host: &str,
    timeout: Duration,
) -> Result<Vec<RemoteFlutterDevice>, RemoteDetectError> {
    let target = SshTarget::new(host)?;
    let argv = flutter_devices_argv();
    let refs = argv.iter().map(String::as_str).collect::<Vec<_>>();
    let outcome = ssh_run(&target, &refs, timeout)?;
    if !outcome.success() {
        return Err(RemoteDetectError::Command(command_summary(&outcome)));
    }

    let stdout = outcome.stdout_utf8();
    let payload = probe_output(&stdout)?.trim();
    parse_flutter_devices(payload)
}

fn parse_flutter_devices(payload: &str) -> Result<Vec<RemoteFlutterDevice>, RemoteDetectError> {
    let devices = serde_json::from_str::<Vec<RemoteFlutterDevice>>(payload).map_err(|err| {
        RemoteDetectError::Command(format!("invalid remote Flutter device list: {err}"))
    })?;
    if devices
        .iter()
        .any(|device| device.id.trim().is_empty() || device.name.trim().is_empty())
    {
        return Err(RemoteDetectError::Command(
            "remote Flutter device list contains an empty id or name".into(),
        ));
    }
    Ok(devices)
}

fn nearest_pubspec_argv(start_dir: &str) -> Vec<String> {
    vec![
        "sh".into(),
        "-c".into(),
        NEAREST_PUBSPEC_SCRIPT.into(),
        "pickforge-nearest-pubspec".into(),
        start_dir.into(),
    ]
}

fn detect_binaries_argv(names: &[&str]) -> Vec<String> {
    let mut command = vec![
        "sh".into(),
        "-c".into(),
        DETECT_BINARIES_SCRIPT.into(),
        "pickforge-detect-binaries".into(),
    ];
    command.extend(names.iter().map(|name| (*name).to_string()));
    login_shell_argv(&command.iter().map(String::as_str).collect::<Vec<_>>())
}

fn flutter_app_argv(project_dir: &str) -> Vec<String> {
    vec![
        "sh".into(),
        "-c".into(),
        FLUTTER_APP_SCRIPT.into(),
        "pickforge-flutter-app".into(),
        project_dir.into(),
    ]
}

fn flutter_devices_argv() -> Vec<String> {
    login_shell_probe_argv(&["flutter", "devices", "--machine", "--device-timeout=10"])
}

fn probe_output(stdout: &str) -> Result<&str, RemoteDetectError> {
    framed_probe_output(stdout).map_err(|message| RemoteDetectError::Command(message.to_string()))
}

fn command_summary(outcome: &CommandOutcome) -> String {
    let stderr = String::from_utf8_lossy(&outcome.stderr).trim().to_string();
    if !stderr.is_empty() {
        return truncate_summary(&stderr);
    }
    let stdout = String::from_utf8_lossy(&outcome.stdout).trim().to_string();
    if !stdout.is_empty() {
        return truncate_summary(&stdout);
    }
    format!("remote command exited with {:?}", outcome.code)
}

fn truncate_summary(value: &str) -> String {
    const MAX: usize = 240;
    if value.chars().count() <= MAX {
        value.to_string()
    } else {
        format!("{}...", value.chars().take(MAX).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nearest_pubspec_argv_is_fixed_script_plus_start_dir() {
        assert_eq!(
            nearest_pubspec_argv("/Users/dev/it's $app"),
            vec![
                "sh",
                "-c",
                NEAREST_PUBSPEC_SCRIPT,
                "pickforge-nearest-pubspec",
                "/Users/dev/it's $app",
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn nearest_pubspec_script_portably_finds_the_flutter_app_below_the_bound_root() {
        let root = std::env::temp_dir().join(format!(
            "pickforge-nearest-pubspec-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let app = root.join("apps/app");
        std::fs::create_dir_all(&app).unwrap();
        std::fs::write(root.join("pubspec.yaml"), "name: workspace\n").unwrap();
        std::fs::write(
            app.join("pubspec.yaml"),
            "name: app\ndependencies:\n  flutter:\n    sdk: flutter\n",
        )
        .unwrap();

        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg(NEAREST_PUBSPEC_SCRIPT)
            .arg("pickforge-nearest-pubspec")
            .arg(&root)
            .output()
            .unwrap();

        assert!(output.status.success());
        assert_eq!(
            probe_output(&String::from_utf8_lossy(&output.stdout))
                .unwrap()
                .trim(),
            app.display().to_string()
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn nearest_pubspec_script_avoids_gnu_find_quit() {
        assert!(NEAREST_PUBSPEC_SCRIPT.contains("find \"$dir\""));
        assert!(NEAREST_PUBSPEC_SCRIPT.contains("is_flutter \"$pubspec\""));
        assert!(!NEAREST_PUBSPEC_SCRIPT.contains("-quit"));
    }

    #[test]
    fn probe_output_ignores_login_banner_before_markers() {
        let output = "Welcome to mac-mini\n__PF_REMOTE_PROBE_BEGIN__\n1\n__PF_REMOTE_PROBE_END__\n";
        assert_eq!(probe_output(output).unwrap().trim(), "1");
    }

    #[test]
    fn nearest_pubspec_ssh_argv_quotes_script_and_start_as_one_remote_command() {
        let argv = nearest_pubspec_argv("/Users/dev/it's $app");
        let refs = argv.iter().map(String::as_str).collect::<Vec<_>>();
        assert_eq!(
            crate::remote::ssh::build_ssh_args("mac-mini", &refs).unwrap(),
            vec![
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=5",
                "-o",
                "StrictHostKeyChecking=accept-new",
                "--",
                "mac-mini",
                &crate::remote::ssh::shell_quote_argv(&refs),
            ]
        );
    }

    #[test]
    fn detect_binaries_argv_runs_the_probe_in_the_login_shell() {
        let command = crate::remote::ssh::shell_quote_argv(&[
            "sh",
            "-c",
            DETECT_BINARIES_SCRIPT,
            "pickforge-detect-binaries",
            "dart",
            "bun $bad",
            "node`bad`",
        ]);
        assert_eq!(
            detect_binaries_argv(&["dart", "bun $bad", "node`bad`"]),
            vec![
                "sh",
                "-c",
                r#"exec "${SHELL:-/bin/sh}" -lc "$1""#,
                "pickforge-login-shell",
                &command,
            ]
        );
    }

    #[test]
    fn flutter_app_argv_reads_the_detected_pubspec() {
        assert_eq!(
            flutter_app_argv("/Users/dev/it's $app"),
            vec![
                "sh",
                "-c",
                FLUTTER_APP_SCRIPT,
                "pickforge-flutter-app",
                "/Users/dev/it's $app",
            ]
        );
    }

    #[test]
    fn detect_binaries_ssh_argv_quotes_names_as_one_remote_command() {
        let argv = detect_binaries_argv(&["dart", "bun $bad", "node`bad`"]);
        let refs = argv.iter().map(String::as_str).collect::<Vec<_>>();
        assert_eq!(
            crate::remote::ssh::build_ssh_args("mac-mini", &refs).unwrap(),
            vec![
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=5",
                "-o",
                "StrictHostKeyChecking=accept-new",
                "--",
                "mac-mini",
                &crate::remote::ssh::shell_quote_argv(&refs),
            ]
        );
    }

    #[test]
    fn flutter_devices_argv_runs_machine_discovery_in_a_framed_login_shell() {
        let argv = flutter_devices_argv();
        assert_eq!(
            &argv[..4],
            [
                "sh",
                "-c",
                r#"exec "${SHELL:-/bin/sh}" -lc "$1""#,
                "pickforge-login-shell",
            ]
        );
        assert!(argv[4].ends_with("'flutter' 'devices' '--machine' '--device-timeout=10'"));
    }

    #[test]
    fn parses_current_flutter_device_json_and_ignores_unknown_fields() {
        let payload = r#"[
          {
            "name": "macOS",
            "id": "macos",
            "isSupported": true,
            "targetPlatform": "darwin",
            "emulator": false,
            "sdk": "macOS 26.5.1",
            "capabilities": { "hotReload": true },
            "futureField": "ignored"
          },
          {
            "name": "Chrome",
            "id": "chrome",
            "isSupported": true,
            "targetPlatform": "web-javascript",
            "emulator": false,
            "sdk": "Chrome 149"
          }
        ]"#;
        let devices = parse_flutter_devices(payload).unwrap();
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].id, "macos");
        assert!(devices[0].is_supported);
        assert_eq!(devices[1].name, "Chrome");
    }

    #[test]
    fn rejects_malformed_or_unsafe_flutter_device_payloads() {
        assert!(parse_flutter_devices(r#"{"id":"macos"}"#).is_err());
        assert!(parse_flutter_devices(r#"[{"id":7,"name":"macOS"}]"#).is_err());
        assert!(parse_flutter_devices(r#"[{"id":"","name":"macOS","isSupported":true}]"#).is_err());
    }
}
