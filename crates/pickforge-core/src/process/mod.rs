//! Process integration: resolve the user's real login-shell environment,
//! detect binaries on PATH, and run commands. Ports
//! `lib/core/process/user_shell_environment.dart` + `binary_detector.dart`.

mod binary_detector;
mod runner;
mod shell_env;

pub use binary_detector::{is_binary_on_path, is_on_user_path, which_in};
pub use runner::{run, CommandOutcome};
pub use shell_env::user_shell_environment;
