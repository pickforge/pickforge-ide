//! Pseudo-terminal subsystem: spawn `$SHELL`, stream its output, feed it input.
//!
//! Mirrors the Dart `PtyProcess` boundary (`lib/core/terminal/pty_*.dart`) but
//! built on WezTerm's `portable-pty`. The terminal is **shell-first**: it always
//! spawns the user's login shell, never an agent. Agent launches are just text
//! typed into that shell.

mod env;
mod session;
mod shell;

pub use env::normalize_pty_env;
pub use session::{PtyError, PtyEvent, PtyManager, PtySink, SpawnOptions};
pub use shell::{resolve_shell, ShellInvocation};
