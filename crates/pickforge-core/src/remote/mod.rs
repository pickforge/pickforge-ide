//! Remote Host Mode foundation.
//!
//! This module is transport-agnostic. It defines the authenticated remote
//! protocol, pairing/token state, and daemon configuration without opening a
//! listener or adapting the existing Tauri command surface.

mod auth;
mod daemon;
mod protocol;

pub use auth::{
    ClientTokenRecord, IssuedClientToken, PairingCode, RemoteAuthError, RemoteAuthStore,
    RemoteAuthStoreSnapshot,
};
pub use daemon::{DaemonConfig, DaemonConfigError, DaemonListener, DaemonStatus, RemoteHostDaemon};
pub use protocol::{
    decode_remote_frame, encode_remote_frame, RemoteCapability, RemoteFrame, RemoteFrameError,
    RemoteRequest, RemoteResponse, REMOTE_FRAME_MAX_BYTES, REMOTE_PROTOCOL_NAME,
    REMOTE_PROTOCOL_VERSION,
};
