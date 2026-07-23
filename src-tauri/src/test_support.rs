//! Shared test-only helpers for tests that read or mutate process-global
//! home-directory environment variables (`PICKFORGE_HOME`, and — for tests
//! that exercise the no-override fallback — `HOME` itself).
//!
//! Rust runs unit tests in parallel threads within a single process, so any
//! test that touches ambient `PICKFORGE_HOME` or `HOME` (directly, or
//! indirectly via `pickforge_core::pickforge_home(None)`) must serialize on
//! [`PICKFORGE_HOME_ENV_LOCK`] — for its *entire* mutation scope, held until
//! the last mutating call returns — and restore every var it touched via an
//! [`EnvRestore`] RAII guard, including on panic. Two independent locks, or
//! any unguarded mutation of `HOME`/`PICKFORGE_HOME` in this test binary, is
//! a known flake class: an unrestored `HOME` leaks into later tests even
//! without a race, and a lock held by a panicking test poisons it, cascading
//! failures into every other test that also asserts on that lock (#237
//! review, PR #257 CI).

use std::ffi::OsString;
use std::sync::Mutex;

/// Serializes all tests that read or mutate process-global home-directory
/// environment variables (`PICKFORGE_HOME`, `HOME`).
pub(crate) static PICKFORGE_HOME_ENV_LOCK: Mutex<()> = Mutex::new(());

/// RAII guard that restores one or more environment variables to their prior
/// values on drop, including when the test body panics.
pub(crate) struct EnvRestore {
    saved: Vec<(&'static str, Option<OsString>)>,
}

impl EnvRestore {
    /// Captures `PICKFORGE_HOME` only — the common case for tests that never
    /// touch `HOME` itself. Call before mutating the variable.
    pub(crate) fn capture() -> Self {
        Self::capture_many(["PICKFORGE_HOME"])
    }

    /// Captures an arbitrary set of env vars so they're all restored
    /// together on drop. Use this whenever a test mutates `HOME` as well as
    /// `PICKFORGE_HOME` (e.g. to exercise the no-override fallback) — a bare
    /// `capture()` only ever restores `PICKFORGE_HOME`, silently leaking any
    /// other var the test removed or changed into later tests.
    pub(crate) fn capture_many(names: impl IntoIterator<Item = &'static str>) -> Self {
        let saved = names
            .into_iter()
            .map(|name| (name, std::env::var_os(name)))
            .collect();
        Self { saved }
    }
}

impl Drop for EnvRestore {
    fn drop(&mut self) {
        for (name, value) in &self.saved {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }
}
