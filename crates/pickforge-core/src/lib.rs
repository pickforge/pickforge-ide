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
pub mod operator;
pub mod process;
pub mod pty;
pub mod remote;
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
pub use remote::{
    decode_remote_frame, encode_remote_frame, listener_from_parts, parse_listener,
    remote_auth_store_path, spawn_remote_http_server, tailscale_serve_disable,
    tailscale_serve_enable, tailscale_ssh_set, tailscale_status, ClientTokenRecord, DaemonConfig,
    DaemonConfigError, DaemonListener, DaemonStatus, IssuedClientToken, PairingCode,
    RemoteAuthError, RemoteAuthStore, RemoteAuthStoreSnapshot, RemoteCapability, RemoteFrame,
    RemoteFrameError, RemoteHostDaemon, RemoteHttpServer, RemoteHttpServerInfo, RemoteRequest,
    RemoteResponse, RemoteServerError, TailscaleStatus, REMOTE_FRAME_MAX_BYTES,
    REMOTE_PROTOCOL_NAME, REMOTE_PROTOCOL_VERSION,
};
pub use storage::{
    load_telemetry_config, pickforge_env_vars, pickforge_home, project_id, save_telemetry_config,
    ContextStorageLocation, ContextStorageMode, ContextStorageService, ResolvedContextDirectory,
    StorageError, TelemetryConfig,
};
pub use transcript::{
    parse_ansi, strip_ansi, AnsiResult, AnsiSpan, TranscriptRecorder, TranscriptReplayer,
    TERMINAL_MODE_RESETS,
};
