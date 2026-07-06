use serde::{Deserialize, Serialize};

pub const REMOTE_PROTOCOL_NAME: &str = "pickforge.remote";
pub const REMOTE_PROTOCOL_VERSION: u16 = 1;
pub const REMOTE_FRAME_MAX_BYTES: usize = 1024 * 1024;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RemoteFrameError {
    #[error("remote frame is empty")]
    Empty,
    #[error("remote frame exceeds {max} bytes: {actual}")]
    TooLarge { actual: usize, max: usize },
    #[error("invalid remote frame json: {0}")]
    InvalidJson(String),
    #[error("unsupported remote protocol '{protocol}' version {version}")]
    UnsupportedVersion { protocol: String, version: u16 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RemoteCapability {
    HostInfo,
    WorkspaceRead,
    TerminalSessions,
    AgentChat,
    DeviceInspection,
    RunLogs,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RemoteFrame {
    Hello {
        protocol: String,
        version: u16,
        app_version: String,
    },
    Request {
        id: String,
        protocol: String,
        version: u16,
        client_id: Option<String>,
        token: Option<String>,
        body: RemoteRequest,
    },
    Response {
        id: String,
        protocol: String,
        version: u16,
        body: RemoteResponse,
    },
    Error {
        id: Option<String>,
        protocol: String,
        version: u16,
        code: String,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "camelCase")]
pub enum RemoteRequest {
    HostInfo,
    Authenticate {
        client_id: String,
        token: String,
    },
    ExchangePairingCode {
        pairing_code: String,
        client_name: String,
    },
    RevokeClient {
        client_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RemoteResponse {
    HostInfo {
        app_version: String,
        capabilities: Vec<RemoteCapability>,
    },
    Authenticated {
        client_id: String,
    },
    PairingAccepted {
        client_id: String,
        token: String,
    },
    ClientRevoked {
        client_id: String,
    },
}

pub fn encode_remote_frame(frame: &RemoteFrame) -> Result<String, RemoteFrameError> {
    validate_frame(frame)?;
    let mut out =
        serde_json::to_string(frame).map_err(|err| RemoteFrameError::InvalidJson(err.to_string()))?;
    out.push('\n');
    Ok(out)
}

pub fn decode_remote_frame(line: &str) -> Result<RemoteFrame, RemoteFrameError> {
    if line.len() > REMOTE_FRAME_MAX_BYTES {
        return Err(RemoteFrameError::TooLarge {
            actual: line.len(),
            max: REMOTE_FRAME_MAX_BYTES,
        });
    }
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Err(RemoteFrameError::Empty);
    }
    let frame: RemoteFrame =
        serde_json::from_str(trimmed).map_err(|err| RemoteFrameError::InvalidJson(err.to_string()))?;
    validate_frame(&frame)?;
    Ok(frame)
}

fn validate_frame(frame: &RemoteFrame) -> Result<(), RemoteFrameError> {
    let (protocol, version) = match frame {
        RemoteFrame::Hello {
            protocol, version, ..
        }
        | RemoteFrame::Request {
            protocol, version, ..
        }
        | RemoteFrame::Response {
            protocol, version, ..
        }
        | RemoteFrame::Error {
            protocol, version, ..
        } => (protocol, *version),
    };
    if protocol != REMOTE_PROTOCOL_NAME || version != REMOTE_PROTOCOL_VERSION {
        return Err(RemoteFrameError::UnsupportedVersion {
            protocol: protocol.clone(),
            version,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hello() -> RemoteFrame {
        RemoteFrame::Hello {
            protocol: REMOTE_PROTOCOL_NAME.into(),
            version: REMOTE_PROTOCOL_VERSION,
            app_version: "0.1.7".into(),
        }
    }

    #[test]
    fn frame_round_trips_with_a_newline_delimiter() {
        let encoded = encode_remote_frame(&hello()).unwrap();
        assert!(encoded.ends_with('\n'));
        assert_eq!(decode_remote_frame(&encoded).unwrap(), hello());
    }

    #[test]
    fn rejects_unknown_versions_before_dispatch() {
        let frame = RemoteFrame::Hello {
            protocol: REMOTE_PROTOCOL_NAME.into(),
            version: REMOTE_PROTOCOL_VERSION + 1,
            app_version: "0.1.7".into(),
        };
        assert_eq!(
            encode_remote_frame(&frame).unwrap_err(),
            RemoteFrameError::UnsupportedVersion {
                protocol: REMOTE_PROTOCOL_NAME.into(),
                version: REMOTE_PROTOCOL_VERSION + 1,
            }
        );
    }

    #[test]
    fn rejects_oversized_frames() {
        let too_large = "x".repeat(REMOTE_FRAME_MAX_BYTES + 1);
        assert_eq!(
            decode_remote_frame(&too_large).unwrap_err(),
            RemoteFrameError::TooLarge {
                actual: REMOTE_FRAME_MAX_BYTES + 1,
                max: REMOTE_FRAME_MAX_BYTES,
            }
        );
    }

    #[test]
    fn rejects_oversized_frames_before_trimming_whitespace() {
        let encoded = encode_remote_frame(&hello()).unwrap();
        let too_large = format!("{}{}", " ".repeat(REMOTE_FRAME_MAX_BYTES), encoded);
        assert_eq!(
            decode_remote_frame(&too_large).unwrap_err(),
            RemoteFrameError::TooLarge {
                actual: too_large.len(),
                max: REMOTE_FRAME_MAX_BYTES,
            }
        );
    }

    #[test]
    fn request_surface_is_typed_not_raw_tauri_commands() {
        let frame = RemoteFrame::Request {
            id: "r1".into(),
            protocol: REMOTE_PROTOCOL_NAME.into(),
            version: REMOTE_PROTOCOL_VERSION,
            client_id: None,
            token: None,
            body: RemoteRequest::HostInfo,
        };
        let encoded = encode_remote_frame(&frame).unwrap();
        assert!(encoded.contains("\"hostInfo\""));
        assert!(!encoded.contains("pty_spawn"));
        assert!(!encoded.contains("invoke"));
    }
}
