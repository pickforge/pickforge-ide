//! PickForge core — the UI-agnostic OS-integration + pure-logic layer.
//!
//! This crate is deliberately free of any UI / IPC framework so the same core
//! can back the Tauri shell today and anything else tomorrow. Phase 0 ships the
//! PTY subsystem; later phases add transcript, process runner, device bridges,
//! target adapters, VM Service, storage and agent prep.

pub mod agents;
pub mod android;
pub mod cdp;
pub mod changes;
mod correlated_ws;
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
pub mod voice;

pub use cdp::{decode_dom_node, find_node_path, CdpClient, CdpError, CdpTarget, DomNode};
pub use inspector::{
    decode_semantic_widget_tree, decode_widget_tree, CreationLocation, SemanticWidgetNode,
    WidgetNode,
};
pub use vm_service::{VmError, VmServiceClient};

pub use targets::{
    detect_target, nearest_pubspec_dir, Capability, Confidence, SourceMap, SourceMapping,
    TargetDetection,
};

pub use db::{
    AgentRunLog, AgentSessionRow, AgentUsageSummary, Chat, Database, DbError, OperatorAuditRow,
    OrchestraTask, PickHistory, Project, ProjectSettings, RunSessionLog,
};

pub use process::{
    askpass_capability, contain_owned_root, detect_askpass_capability, guardian_main,
    guardian_requested, is_binary_on_path, is_on_user_path, local_crash_containment_enabled,
    mark_linux_dmabuf_env_synthesized, run, run_timeout, run_timeout_capped,
    start_local_crash_containment, user_shell_environment, which_in, AskpassCapability,
    CommandOutcome, ContainmentContext, OutputTruncation, StartGate, StartPermit, GUARDIAN_ARG,
    GUARDIAN_ENV,
};
pub use pty::{
    begin_recoverable_session_spawn, close_recoverable_session_spawn_gate,
    contain_recoverable_sessions, detect_legacy_dtach_sessions, detect_legacy_tmux_sessions,
    dtach_master_pids, dtach_socket_path, kill_dtach_master, kill_recoverable_sessions_on_exit,
    legacy_sessions_dir, mark_tmux_server_may_exist, parse_recoverable_session_id,
    prepare_chat_session, recoverable_tmux_server_name, select_backend, session_name, sessions_dir,
    stop_legacy_dtach_session, stop_legacy_tmux_session, terminate_owned_process_trees,
    tmux_has_session_args, tmux_kill_session_args, tmux_set_titles_args, validate_session_name,
    validated_dtach_socket_path, validated_legacy_dtach_socket_path, DtachKillError,
    LegacyDtachSession, LegacyTmuxSession, OwnedProcessIdentity, PreparedSession, PtyError,
    PtyEvent, PtyManager, PtySink, RecoverableSpawnPermit, RemotePty, SessionBackend,
    SessionStatus, SpawnOptions, LEGACY_TMUX_SERVER_NAME,
};
pub use remote::{
    decode_remote_frame, encode_remote_frame, listener_from_parts, parse_listener, probe_host,
    probe_tailnet_peer, remote_auth_store_path, remote_detect_binaries, remote_flutter_devices,
    remote_nearest_pubspec, remote_pubspec_uses_flutter, spawn_remote_http_server, ssh_run,
    tailscale_ssh_set, tailscale_status, ClientTokenRecord, DaemonConfig, DaemonConfigEnvError,
    DaemonConfigError, DaemonListener, DaemonStatus, IssuedClientToken, PairingCode, ProbeState,
    RemoteAuthError, RemoteAuthStore, RemoteAuthStoreSnapshot, RemoteCapability, RemoteDetectError,
    RemoteFlutterDevice, RemoteFrame, RemoteFrameError, RemoteHostDaemon, RemoteHostHealth,
    RemoteHttpServer, RemoteHttpServerInfo, RemoteRequest, RemoteResponse, RemoteServerError,
    RemoteTunnel, RemoteTunnelClosed, SshError, SshTarget, TailscaleStatus, TunnelError,
    TunnelManager, REMOTE_FRAME_MAX_BYTES, REMOTE_PROTOCOL_NAME, REMOTE_PROTOCOL_VERSION,
};
pub use storage::{
    amd_gpu_present, boot_linux_graphics_mode, kde_wayland_session_detected,
    load_linux_graphics_config, load_telemetry_config, pickforge_env_vars, pickforge_home,
    project_id, record_boot_linux_graphics_mode, resolve_graphics_backend_plan,
    save_linux_graphics_config, save_telemetry_config, should_recommend_compatibility,
    ContextStorageLocation, ContextStorageMode, ContextStorageService, DmabufAction,
    GraphicsBackendPlan, LinuxGraphicsConfig, LinuxGraphicsMode, PickforgeHomeError,
    ResolvedContextDirectory, StorageError, TelemetryConfig, LINUX_DMABUF_SYNTHESIZED_MARKER_ENV,
    WEBKIT_DISABLE_DMABUF_ENV,
};
pub use transcript::{
    parse_ansi, strip_ansi, AnsiResult, AnsiSpan, TranscriptRecorder, TranscriptReplayer,
    TERMINAL_MODE_RESETS,
};
pub use voice::{
    voice_availability, OsTtsBackend, RunningSpeech, SpeakEvent, SpeakEventKind, SpeakSink,
    SpeechBackend, SpeechSessionManager, VoiceAvailability, VoiceDependency, VoiceEvent,
    VoiceEventKind, VoiceSessionManager, VoiceStartRequest,
};
