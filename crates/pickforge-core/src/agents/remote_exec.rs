use crate::remote::{
    remote_process_command, shell_quote_argv, ssh_one_shot_args, RemoteLeaseHandle,
    RemoteLeasePayload, SshError, SshTarget,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteExec {
    pub host: String,
    pub remote_root: String,
    process_leases: bool,
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
        Ok(Self {
            host,
            remote_root,
            process_leases: false,
        })
    }

    pub fn with_process_leases(mut self, enabled: bool) -> Self {
        self.process_leases = enabled;
        self
    }

    pub(crate) fn ssh_launch(
        &self,
        agent_argv: &[String],
    ) -> Result<(Vec<String>, Option<RemoteLeaseHandle>), RemoteExecError> {
        let target = SshTarget::new(&self.host)?;
        if self.remote_root.is_empty()
            || !self.remote_root.starts_with('/')
            || self.remote_root.contains('\0')
        {
            return Err(RemoteExecError::InvalidRemoteRoot);
        }
        let direct_command = self.remote_command(agent_argv);
        let (command, lease) = remote_process_command(
            &target,
            self.process_leases,
            RemoteLeasePayload::LoginArgv {
                cwd: self.remote_root.clone(),
                argv: agent_argv.to_vec(),
            },
            direct_command,
        );
        Ok((ssh_one_shot_args(&target, command), lease))
    }

    fn remote_command(&self, agent_argv: &[String]) -> String {
        let argv = agent_argv.iter().map(String::as_str).collect::<Vec<_>>();
        let agent_command = shell_quote_argv(&argv);
        format!(
            "cd {} && exec \"$SHELL\" -lc {}",
            shell_quote_argv(&[&self.remote_root]),
            shell_quote_argv(&[&agent_command])
        )
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
    fn process_lease_flag_has_one_narrow_remote_launch_seam() {
        let argv = vec![
            "codex".to_string(),
            "exec".to_string(),
            "hostile ' prompt $HOME `uname`".to_string(),
        ];
        let direct = RemoteExec::new("mac-mini", "/srv/app")
            .unwrap()
            .ssh_launch(&argv)
            .unwrap();
        assert!(direct.1.is_none());
        assert!(direct.0.last().unwrap().contains("hostile"));

        let leased = RemoteExec::new("mac-mini", "/srv/secret app")
            .unwrap()
            .with_process_leases(true)
            .ssh_launch(&argv)
            .unwrap();
        assert!(!leased.0.last().unwrap().contains("hostile"));
        assert!(!leased.0.last().unwrap().contains("/srv/secret app"));
        let lease = leased.1.expect("flag-on launch owns a lease");
        lease.finish_natural();
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
