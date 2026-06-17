//! PickForge core — the UI-agnostic OS-integration + pure-logic layer.
//!
//! This crate is deliberately free of any UI / IPC framework so the same core
//! can back the Tauri shell today and anything else tomorrow. Phase 0 ships the
//! PTY subsystem; later phases add transcript, process runner, device bridges,
//! target adapters, VM Service, storage and agent prep.

pub mod db;
pub mod process;
pub mod pty;
pub mod storage;
pub mod targets;
pub mod transcript;

pub use targets::{SourceMap, SourceMapping};

pub use db::{
    AgentRunLog, Chat, Database, DbError, PickHistory, Project, ProjectSettings, RunSessionLog,
};

pub use process::{
    is_binary_on_path, is_on_user_path, run, user_shell_environment, which_in, CommandOutcome,
};
pub use storage::{
    pickforge_env_vars, pickforge_home, project_id, ContextStorageLocation, ContextStorageMode,
    ContextStorageService, ResolvedContextDirectory, StorageError,
};
pub use pty::{PtyError, PtyEvent, PtyManager, PtySink, SpawnOptions};
pub use transcript::{
    parse_ansi, strip_ansi, AnsiResult, AnsiSpan, TranscriptRecorder, TranscriptReplayer,
    TERMINAL_MODE_RESETS,
};
