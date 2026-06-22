//! Pseudo-terminal subsystem: spawn `$SHELL`, stream its output, feed it input.
//!
//! Mirrors the Dart `PtyProcess` boundary (`lib/core/terminal/pty_*.dart`) but
//! built on WezTerm's `portable-pty`. The terminal is **shell-first**: it always
//! spawns the user's login shell, never an agent. Agent launches are just text
//! typed into that shell.

mod env;
mod session;
mod sessions;
mod shell;

pub use env::normalize_pty_env;
pub use session::{PtyError, PtyEvent, PtyManager, PtySink, SpawnOptions};
pub use sessions::{
    dtach_master_pids, dtach_socket_path, kill_dtach_master, prepare_chat_session, select_backend,
    session_name, sessions_dir, tmux_has_session_args, tmux_kill_session_args, tmux_set_titles_args,
    PreparedSession, SessionBackend, SessionStatus,
};
pub use shell::{resolve_shell, ShellInvocation};
