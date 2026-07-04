//! iOS simulator integration: simctl one-shot ops, os_log parsing, and
//! Xcode project discovery.

use std::time::Duration;

use crate::process::{run_timeout, CommandOutcome, RunError};

pub mod oslog;
pub mod simctl;
pub mod xcodebuild;

pub use oslog::{dump_recent, parse_oslog_line, OsLogEvent, OsLogLevel};
pub use simctl::{
    boot_device, capture_screenshot, install_app, launch_app, list_devices, parse_simctl_devices,
    terminate_app, SimDevice, SimState,
};
pub use xcodebuild::{
    built_app_path, bundle_id_of_app, find_container, XcodeContainer, XcodeContainerKind,
};

pub(crate) const IOS_TIMEOUT: Duration = Duration::from_secs(20);
pub(crate) const IOS_CAPTURE_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, thiserror::Error)]
pub enum IosError {
    #[error("failed to run {program}: {source}")]
    Command {
        program: String,
        #[source]
        source: RunError,
    },
    #[error("{program} exited with {code:?}: {stderr}")]
    CommandFailed {
        program: String,
        code: Option<i32>,
        stderr: String,
    },
    #[error("parse error: {0}")]
    Parse(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub(crate) fn run_ios_command(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<CommandOutcome, IosError> {
    run_timeout(program, args, None, None, timeout).map_err(|source| IosError::Command {
        program: program.to_string(),
        source,
    })
}

pub(crate) fn command_failed(program: &str, outcome: &CommandOutcome) -> IosError {
    let stderr = output_snippet(&outcome.stderr);
    let stderr = if stderr.is_empty() {
        output_snippet(&outcome.stdout)
    } else {
        stderr
    };
    IosError::CommandFailed {
        program: program.to_string(),
        code: outcome.code,
        stderr,
    }
}

fn output_snippet(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes).trim().to_string();
    if text.chars().count() <= 500 {
        return text;
    }
    let mut out: String = text.chars().take(500).collect();
    out.push_str("...");
    out
}
