//! Remote Host Mode foundation.
//!
//! This module is transport-agnostic. It defines the authenticated remote
//! protocol, pairing/token state, and daemon configuration without opening a
//! listener or adapting the existing Tauri command surface.

mod auth;
mod daemon;
mod detect;
mod health;
mod lease;
mod protocol;
mod server;
mod ssh;
mod tailscale;
mod tunnel;

pub use auth::{
    remote_auth_store_path, ClientTokenRecord, IssuedClientToken, PairingCode, RemoteAuthError,
    RemoteAuthStore, RemoteAuthStoreSnapshot,
};
pub use daemon::{
    parse_listener, DaemonConfig, DaemonConfigEnvError, DaemonConfigError, DaemonListener,
    DaemonStatus, RemoteHostDaemon,
};
pub use detect::{
    remote_detect_binaries, remote_flutter_devices, remote_nearest_pubspec,
    remote_pubspec_uses_flutter, RemoteDetectError, RemoteFlutterDevice,
};
pub use health::{probe_host, probe_tailnet_peer, ProbeState, RemoteHostHealth};
pub use protocol::{
    decode_remote_frame, encode_remote_frame, RemoteCapability, RemoteFrame, RemoteFrameError,
    RemoteRequest, RemoteResponse, REMOTE_FRAME_MAX_BYTES, REMOTE_PROTOCOL_NAME,
    REMOTE_PROTOCOL_VERSION,
};
pub use server::{
    spawn_remote_http_server, RemoteHttpServer, RemoteHttpServerInfo, RemoteServerError,
};
pub(crate) use lease::{
    remote_process_command, stop_remote_leases_bounded, RemoteLeaseHandle, RemoteLeasePayload,
};
pub(crate) use ssh::{shell_quote_argv, ssh_base_args, ssh_one_shot_args};
pub use ssh::{ssh_run, SshError, SshTarget};
pub use tailscale::{
    listener_from_parts, tailscale_ssh_set, tailscale_status, TailscaleStatus,
};
pub use tunnel::{RemoteTunnel, RemoteTunnelClosed, TunnelError, TunnelManager};
