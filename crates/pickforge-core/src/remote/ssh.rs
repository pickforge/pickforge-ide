use std::time::Duration;

use crate::process::{run_timeout, CommandOutcome, RunError};

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
    let mut args = ssh_base_args();
    args.push("--".into());
    args.push(target.host);
    args.push(shell_quote_argv(argv));
    Ok(args)
}

pub(crate) fn ssh_base_args() -> Vec<String> {
    vec![
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "ConnectTimeout=5".into(),
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
    ]
}

pub(crate) fn shell_quote_argv(argv: &[&str]) -> String {
    argv.iter()
        .map(|arg| posix_single_quote(arg))
        .collect::<Vec<_>>()
        .join(" ")
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
            let command = format!("set -- {}; printf '<%s>\\n' \"$@\"", shell_quote_argv(&case));
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
