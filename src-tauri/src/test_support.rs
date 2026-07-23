//! Shared test-only helpers for tests that read or mutate the
//! process-global `PICKFORGE_HOME` environment variable.
//!
//! Rust runs unit tests in parallel threads within a single process, so any
//! test that touches ambient `PICKFORGE_HOME` (directly, or indirectly via
//! `pickforge_core::pickforge_home(None)`) must serialize on
//! [`PICKFORGE_HOME_ENV_LOCK`] to avoid cross-test interference.

use std::ffi::OsString;
use std::sync::Mutex;

/// Serializes all tests that read or mutate the process-global
/// `PICKFORGE_HOME` environment variable.
pub(crate) static PICKFORGE_HOME_ENV_LOCK: Mutex<()> = Mutex::new(());

/// RAII guard that restores `PICKFORGE_HOME` to its prior value on drop,
/// including when the test body panics.
pub(crate) struct EnvRestore {
    old: Option<OsString>,
}

impl EnvRestore {
    /// Captures the current `PICKFORGE_HOME` value so it can be restored
    /// later. Call before mutating the variable.
    pub(crate) fn capture() -> Self {
        Self {
            old: std::env::var_os("PICKFORGE_HOME"),
        }
    }
}

impl Drop for EnvRestore {
    fn drop(&mut self) {
        match &self.old {
            Some(value) => std::env::set_var("PICKFORGE_HOME", value),
            None => std::env::remove_var("PICKFORGE_HOME"),
        }
    }
}
