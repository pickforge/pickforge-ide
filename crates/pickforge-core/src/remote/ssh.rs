use std::time::Duration;

use crate::process::{run_timeout, CommandOutcome, RunError};

const LOGIN_SHELL_SCRIPT: &str = r#"exec "${SHELL:-/bin/sh}" -lc "$1""#;
const LOGIN_SHELL_PROBE_SCRIPT: &str = r#"printf '%s\n' '__PF_REMOTE_PROBE_BEGIN__'
"$@"
status=$?
printf '%s\n' '__PF_REMOTE_PROBE_END__'
exit "$status""#;
const PROBE_BEGIN: &str = "__PF_REMOTE_PROBE_BEGIN__";
const PROBE_END: &str = "__PF_REMOTE_PROBE_END__";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshTarget {
    pub host: String,
}

#[derive(Debug, thiserror::Error)]
pub enum SshError {
    #[error("invalid SSH host")]
    InvalidHost,
    #[error(transparent)]
    Run(#[from] RunError),
}

impl SshTarget {
    pub fn new(host: impl Into<String>) -> Result<Self, SshError> {
        let host = host.into();
        validate_host(&host)?;
        Ok(Self { host })
    }
}

pub fn ssh_run(
    target: &SshTarget,
    argv: &[&str],
    timeout: Duration,
) -> Result<CommandOutcome, SshError> {
    let args = build_ssh_args(&target.host, argv)?;
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    Ok(run_timeout("ssh", &refs, None, None, timeout)?)
}

pub(crate) fn build_ssh_args(host: &str, argv: &[&str]) -> Result<Vec<String>, SshError> {
    let target = SshTarget::new(host)?;
    Ok(ssh_one_shot_args(&target, shell_quote_argv(argv)))
}

pub(crate) fn ssh_base_args() -> Vec<String> {
    vec![
        "-o".into(),
        "ConnectTimeout=5".into(),
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
    ]
}

fn ssh_batch_args() -> Vec<String> {
    let mut args = vec!["-o".into(), "BatchMode=yes".into()];
    args.extend(ssh_base_args());
    args
}

pub(crate) fn ssh_one_shot_args(target: &SshTarget, remote_command: String) -> Vec<String> {
    let mut args = ssh_batch_args();
    args.push("--".into());
    args.push(target.host.clone());
    args.push(remote_command);
    args
}

pub(crate) fn ssh_tunnel_args(
    target: &SshTarget,
    local_port: u16,
    remote_port: u16,
) -> Vec<String> {
    let mut args = ssh_batch_args();
    args.push("-o".into());
    args.push("ExitOnForwardFailure=yes".into());
    args.push("-N".into());
    args.push("-L".into());
    args.push(format!("127.0.0.1:{local_port}:127.0.0.1:{remote_port}"));
    args.push("--".into());
    args.push(target.host.clone());
    args
}

pub(crate) fn shell_quote_argv(argv: &[&str]) -> String {
    argv.iter()
        .map(|arg| posix_single_quote(arg))
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn login_shell_argv(argv: &[&str]) -> Vec<String> {
    vec![
        "sh".into(),
        "-c".into(),
        LOGIN_SHELL_SCRIPT.into(),
        "pickforge-login-shell".into(),
        shell_quote_argv(argv),
    ]
}

pub(crate) fn login_shell_probe_argv(argv: &[&str]) -> Vec<String> {
    let mut command = vec![
        "sh".into(),
        "-c".into(),
        LOGIN_SHELL_PROBE_SCRIPT.into(),
        "pickforge-login-shell-probe".into(),
    ];
    command.extend(argv.iter().map(|arg| (*arg).to_string()));
    login_shell_argv(&command.iter().map(String::as_str).collect::<Vec<_>>())
}

pub(crate) fn probe_output(stdout: &str) -> Result<&str, &'static str> {
    let (_, output) = stdout
        .split_once(PROBE_BEGIN)
        .ok_or("remote probe output is missing its begin marker")?;
    let (output, _) = output
        .split_once(PROBE_END)
        .ok_or("remote probe output is missing its end marker")?;
    Ok(output)
}

fn validate_host(host: &str) -> Result<(), SshError> {
    if host.is_empty() || host.starts_with('-') {
        return Err(SshError::InvalidHost);
    }
    if host
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        Ok(())
    } else {
        Err(SshError::InvalidHost)
    }
}

fn posix_single_quote(value: &str) -> String {
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('\'');
    for ch in value.chars() {
        if ch == '\'' {
            quoted.push_str("'\\''");
        } else {
            quoted.push(ch);
        }
    }
    quoted.push('\'');
    quoted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_tailnet_hostnames() {
        for host in ["mac-mini", "mac_mini", "mac.mini", "host123", "a-b_c.d"] {
            assert!(SshTarget::new(host).is_ok(), "{host}");
        }

        for host in [
            "",
            "-oProxyCommand=sh",
            "-host",
            "host name",
            "host;rm",
            "host/dir",
            "host\nname",
            "host:22",
            "máquina",
        ] {
            assert!(SshTarget::new(host).is_err(), "{host:?}");
        }
    }

    #[test]
    fn rejects_option_injection_host() {
        let safe = build_ssh_args("mac-mini", &["true"]).unwrap();
        assert_eq!(safe[6], "--");
        assert_eq!(safe[7], "mac-mini");

        assert!(matches!(
            build_ssh_args("-oProxyCommand=touch /tmp/pwn", &["true"]),
            Err(SshError::InvalidHost)
        ));
    }

    #[test]
    fn quotes_remote_argv_for_posix_shell() {
        assert_eq!(
            shell_quote_argv(&["echo", "two words", "it's", "$HOME", "`uname`", ""]),
            "'echo' 'two words' 'it'\\''s' '$HOME' '`uname`' ''"
        );
    }

    #[test]
    fn login_shell_argv_quotes_the_nested_command_as_one_argument() {
        assert_eq!(
            login_shell_argv(&["pickforged", "status; touch /tmp/pwn", "$HOME"]),
            vec![
                "sh",
                "-c",
                LOGIN_SHELL_SCRIPT,
                "pickforge-login-shell",
                "'pickforged' 'status; touch /tmp/pwn' '$HOME'",
            ]
        );
    }

    #[test]
    fn login_shell_probe_argv_passes_command_arguments_as_data() {
        let argv = login_shell_probe_argv(&["pickforged", "status; touch /tmp/pwn", "$HOME"]);
        let nested_command = shell_quote_argv(&[
            "sh",
            "-c",
            LOGIN_SHELL_PROBE_SCRIPT,
            "pickforge-login-shell-probe",
            "pickforged",
            "status; touch /tmp/pwn",
            "$HOME",
        ]);

        assert_eq!(
            argv,
            vec![
                "sh",
                "-c",
                LOGIN_SHELL_SCRIPT,
                "pickforge-login-shell",
                &nested_command,
            ]
        );
    }

    #[test]
    fn probe_output_ignores_text_outside_fixed_markers() {
        let stdout = "profile banner\n__PF_REMOTE_PROBE_BEGIN__\n{\"ok\":true}\n__PF_REMOTE_PROBE_END__\nlogout banner\n";
        assert_eq!(probe_output(stdout).unwrap().trim(), r#"{"ok":true}"#);
    }

    #[cfg(unix)]
    #[test]
    fn login_shell_probe_script_frames_stdout_and_preserves_exit_status() {
        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg(LOGIN_SHELL_PROBE_SCRIPT)
            .arg("pickforge-login-shell-probe")
            .arg("sh")
            .arg("-c")
            .arg(r#"printf '%s' '{"ok":true}'; exit 7"#)
            .output()
            .unwrap();

        assert_eq!(output.status.code(), Some(7));
        assert_eq!(
            probe_output(&String::from_utf8_lossy(&output.stdout))
                .unwrap()
                .trim(),
            r#"{"ok":true}"#
        );
    }

    #[test]
    fn tunnel_argv_keeps_batch_mode_and_binds_both_ends_to_loopback() {
        let target = SshTarget::new("mac-mini").unwrap();
        assert_eq!(
            ssh_tunnel_args(&target, 43123, 8181),
            vec![
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=5",
                "-o",
                "StrictHostKeyChecking=accept-new",
                "-o",
                "ExitOnForwardFailure=yes",
                "-N",
                "-L",
                "127.0.0.1:43123:127.0.0.1:8181",
                "--",
                "mac-mini",
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn quoted_remote_argv_round_trips_through_sh() {
        let cases = [
            vec!["two words"],
            vec!["it's"],
            vec!["$HOME"],
            vec!["`uname`"],
            vec!["", " spaced ", "quote'and$dollar"],
        ];

        for case in cases {
            let command = format!(
                "set -- {}; printf '<%s>\\n' \"$@\"",
                shell_quote_argv(&case)
            );
            let output = std::process::Command::new("sh")
                .arg("-c")
                .arg(command)
                .output()
                .expect("run sh");
            assert!(output.status.success());
            let expected = case
                .iter()
                .map(|arg| format!("<{arg}>\n"))
                .collect::<String>();
            assert_eq!(String::from_utf8_lossy(&output.stdout), expected);
        }
    }
}
