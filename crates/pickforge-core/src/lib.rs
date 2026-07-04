//! PickForge core — the UI-agnostic OS-integration + pure-logic layer.
//!
//! This crate is deliberately free of any UI / IPC framework so the same core
//! can back the Tauri shell today and anything else tomorrow. Phase 0 ships the
//! PTY subsystem; later phases add transcript, process runner, device bridges,
//! target adapters, VM Service, storage and agent prep.

pub mod agents;
pub mod android;
pub mod cdp;
pub mod db;
pub mod git;
pub mod inspector;
pub mod ios;
pub mod mcp;
pub mod process;
pub mod pty;
pub mod storage;
pub mod targets;
pub mod transcript;
pub mod vm_service;

pub use cdp::{decode_dom_node, find_node_path, CdpClient, CdpError, CdpTarget, DomNode};
pub use inspector::{decode_widget_tree, CreationLocation, WidgetNode};
pub use vm_service::{VmError, VmServiceClient};

pub use targets::{
    detect_target, nearest_pubspec_dir, Capability, Confidence, SourceMap, SourceMapping,
    TargetDetection,
};

pub use db::{
    AgentRunLog, AgentUsageSummary, Chat, Database, DbError, OrchestraTask, PickHistory, Project,
    ProjectSettings, RunSessionLog,
};

pub use process::{
    is_binary_on_path, is_on_user_path, run, run_timeout, user_shell_environment, which_in,
    CommandOutcome,
};
pub use pty::{
    dtach_socket_path, kill_dtach_master, prepare_chat_session, select_backend, session_name,
    sessions_dir, tmux_has_session_args, tmux_kill_session_args, tmux_set_titles_args,
    PreparedSession, PtyError, PtyEvent, PtyManager, PtySink, SessionBackend, SessionStatus,
    SpawnOptions,
};
pub use storage::{
    pickforge_env_vars, pickforge_home, project_id, ContextStorageLocation, ContextStorageMode,
    ContextStorageService, ResolvedContextDirectory, StorageError,
};
pub use transcript::{
    parse_ansi, strip_ansi, AnsiResult, AnsiSpan, TranscriptRecorder, TranscriptReplayer,
    TERMINAL_MODE_RESETS,
};
