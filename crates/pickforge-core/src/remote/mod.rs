//! Remote Host Mode foundation.
//!
//! This module is transport-agnostic. It defines the authenticated remote
//! protocol, pairing/token state, and daemon configuration without opening a
//! listener or adapting the existing Tauri command surface.

mod auth;
mod daemon;
mod protocol;
mod server;
mod tailscale;

pub use auth::{
    remote_auth_store_path, ClientTokenRecord, IssuedClientToken, PairingCode, RemoteAuthError,
    RemoteAuthStore, RemoteAuthStoreSnapshot,
};
pub use daemon::{
    parse_listener, DaemonConfig, DaemonConfigEnvError, DaemonConfigError, DaemonListener,
    DaemonStatus, RemoteHostDaemon,
};
pub use protocol::{
    decode_remote_frame, encode_remote_frame, RemoteCapability, RemoteFrame, RemoteFrameError,
    RemoteRequest, RemoteResponse, REMOTE_FRAME_MAX_BYTES, REMOTE_PROTOCOL_NAME,
    REMOTE_PROTOCOL_VERSION,
};
pub use server::{
    spawn_remote_http_server, RemoteHttpServer, RemoteHttpServerInfo, RemoteServerError,
};
pub use tailscale::{
    listener_from_parts, tailscale_ssh_set, tailscale_status, TailscaleStatus,
};
