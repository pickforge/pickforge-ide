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
pub use session::{PtyError, PtyEvent, PtyManager, PtySink, RemotePty, SpawnOptions};
pub use sessions::{
    begin_recoverable_session_spawn, close_recoverable_session_spawn_gate, dtach_master_pids,
    dtach_socket_path, kill_dtach_master, kill_recoverable_sessions_on_exit,
    mark_tmux_server_may_exist, parse_recoverable_session_id, prepare_chat_session, select_backend,
    session_name, sessions_dir, tmux_has_session_args, tmux_kill_session_args,
    tmux_set_titles_args, validate_session_name, validated_dtach_socket_path, DtachKillError,
    PreparedSession, RecoverableSpawnPermit, SessionBackend, SessionStatus,
};
pub use shell::{resolve_shell, ShellInvocation};
