//! Process integration: resolve the user's real login-shell environment,
//! detect binaries on PATH, and run commands. Ports
//! `lib/core/process/user_shell_environment.dart` + `binary_detector.dart`.

mod binary_detector;
mod containment;
mod runner;
mod shell_env;
mod start_gate;

pub use binary_detector::{is_binary_on_path, is_on_user_path, which_in};
pub use containment::{
    contain_owned_root, guardian_main, guardian_requested, local_crash_containment_enabled,
    start_local_crash_containment, ContainmentContext, GUARDIAN_ENV,
};
pub use runner::{
    run, run_timeout, run_timeout_capped, CommandOutcome, OutputTruncation, RunError,
};
pub use shell_env::user_shell_environment;
pub use start_gate::{StartGate, StartPermit};
