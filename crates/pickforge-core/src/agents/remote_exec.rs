use crate::remote::{shell_quote_argv, ssh_one_shot_args, SshError, SshTarget};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteExec {
    pub host: String,
    pub remote_root: String,
}

#[derive(Debug, thiserror::Error)]
pub enum RemoteExecError {
    #[error(transparent)]
    Ssh(#[from] SshError),
    #[error("invalid remote agent root")]
    InvalidRemoteRoot,
}

impl RemoteExec {
    pub fn new(host: impl Into<String>, remote_root: impl Into<String>) -> Result<Self, RemoteExecError> {
        let host = host.into();
        let remote_root = remote_root.into();
        SshTarget::new(&host)?;
        if remote_root.is_empty() || !remote_root.starts_with('/') || remote_root.contains('\0') {
            return Err(RemoteExecError::InvalidRemoteRoot);
        }
        Ok(Self { host, remote_root })
    }

    pub(crate) fn ssh_args(&self, agent_argv: &[String]) -> Result<Vec<String>, RemoteExecError> {
        let target = SshTarget::new(&self.host)?;
        if self.remote_root.is_empty()
            || !self.remote_root.starts_with('/')
            || self.remote_root.contains('\0')
        {
            return Err(RemoteExecError::InvalidRemoteRoot);
        }
        let argv = agent_argv.iter().map(String::as_str).collect::<Vec<_>>();
        let agent_command = shell_quote_argv(&argv);
        let remote_command = format!(
            "cd {} && exec \"$SHELL\" -lc {}",
            shell_quote_argv(&[&self.remote_root]),
            shell_quote_argv(&[&agent_command])
        );
        Ok(ssh_one_shot_args(&target, remote_command))
    }
}

pub(crate) fn remote_ssh_exit_error(host: &str) -> String {
    format!(
        "ssh:{host} exited 255: transport failure or remote exit 255. Open the project's Remote panel and choose Test connection."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_batch_ssh_command_with_one_quoted_remote_command() {
        let remote = RemoteExec::new("mac-mini", "/Users/dev/it's $root").unwrap();
        let args = remote
            .ssh_args(&[
                "codex".to_string(),
                "exec".to_string(),
                "prompt with spaces".to_string(),
            ])
            .unwrap();

        assert_eq!(
            args,
            vec![
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=5",
                "-o",
                "StrictHostKeyChecking=accept-new",
                "--",
                "mac-mini",
                "cd '/Users/dev/it'\\''s $root' && exec \"$SHELL\" -lc ''\\''codex'\\'' '\\''exec'\\'' '\\''prompt with spaces'\\'''",
            ]
        );
    }

    #[test]
    fn rejects_invalid_remote_parts() {
        assert!(RemoteExec::new("-host", "/srv/app").is_err());
        assert!(RemoteExec::new("mac-mini", "relative/app").is_err());
    }

    #[test]
    fn exit_255_points_to_the_remote_connection_check() {
        assert_eq!(
            remote_ssh_exit_error("mac-mini"),
            "ssh:mac-mini exited 255: transport failure or remote exit 255. Open the project's Remote panel and choose Test connection."
        );
    }
}
