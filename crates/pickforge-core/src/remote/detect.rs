use std::time::Duration;

use crate::process::CommandOutcome;

use super::ssh::{ssh_run, SshError, SshTarget};

const NEAREST_PUBSPEC_SCRIPT: &str = r#"dir=$1
while [ -n "$dir" ]; do
  if [ -f "$dir/pubspec.yaml" ]; then
    printf '%s\n' "$dir"
    exit 0
  fi
  parent=$(dirname "$dir")
  if [ "$parent" = "$dir" ]; then
    exit 0
  fi
  dir=$parent
done"#;

const DETECT_BINARIES_SCRIPT: &str = r#"for name do
  if command -v "$name" >/dev/null 2>&1; then
    printf '1\n'
  else
    printf '0\n'
  fi
done"#;

#[derive(Debug, thiserror::Error)]
pub enum RemoteDetectError {
    #[error(transparent)]
    Ssh(#[from] SshError),
    #[error("{0}")]
    Command(String),
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
    Ok(outcome
        .stdout_utf8()
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
    let lines = stdout
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
    let mut argv = vec![
        "sh".into(),
        "-c".into(),
        DETECT_BINARIES_SCRIPT.into(),
        "pickforge-detect-binaries".into(),
    ];
    argv.extend(names.iter().map(|name| (*name).to_string()));
    argv
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
    fn detect_binaries_argv_is_fixed_script_plus_names() {
        assert_eq!(
            detect_binaries_argv(&["dart", "bun $bad", "node`bad`"]),
            vec![
                "sh",
                "-c",
                DETECT_BINARIES_SCRIPT,
                "pickforge-detect-binaries",
                "dart",
                "bun $bad",
                "node`bad`",
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
}
