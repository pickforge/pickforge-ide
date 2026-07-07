use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use super::auth::{remote_auth_store_path, RemoteAuthStore};
use super::daemon::{DaemonConfig, DaemonConfigError, RemoteHostDaemon};
use super::protocol::{
    RemoteFrame, RemoteRequest, RemoteResponse, REMOTE_FRAME_MAX_BYTES, REMOTE_PROTOCOL_NAME,
    REMOTE_PROTOCOL_VERSION,
};
use super::tailscale::TAILSCALE_SERVE_PATH;

#[derive(Debug, thiserror::Error)]
pub enum RemoteServerError {
    #[error(transparent)]
    Config(#[from] DaemonConfigError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("remote listener is disabled")]
    ListenerDisabled,
    #[error("remote auth store error: {0}")]
    Auth(String),
}

#[derive(Debug, Clone)]
pub struct RemoteHttpServerInfo {
    pub local_addr: SocketAddr,
}

pub struct RemoteHttpServer {
    info: RemoteHttpServerInfo,
    shutdown: Option<oneshot::Sender<()>>,
    join: JoinHandle<Result<(), RemoteServerError>>,
}

impl RemoteHttpServer {
    pub fn info(&self) -> RemoteHttpServerInfo {
        self.info.clone()
    }

    pub async fn shutdown(mut self) -> Result<(), RemoteServerError> {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        match self.join.await {
            Ok(result) => result,
            Err(err) => Err(RemoteServerError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                err.to_string(),
            ))),
        }
    }
}

struct ServerState {
    daemon: RemoteHostDaemon,
    auth_path: PathBuf,
}

pub async fn spawn_remote_http_server(
    config: DaemonConfig,
) -> Result<RemoteHttpServer, RemoteServerError> {
    let bind_target = config
        .listener
        .bind_target()?
        .ok_or(RemoteServerError::ListenerDisabled)?;
    let daemon = RemoteHostDaemon::new(config)?;
    let listener = TcpListener::bind(&bind_target).await?;
    let local_addr = listener.local_addr()?;
    let auth_path = remote_auth_store_path(&daemon.config().pickforge_home);
    let state = Arc::new(ServerState { daemon, auth_path });
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let join = tokio::spawn(run_accept_loop(listener, state, shutdown_rx));
    Ok(RemoteHttpServer {
        info: RemoteHttpServerInfo { local_addr },
        shutdown: Some(shutdown_tx),
        join,
    })
}

async fn run_accept_loop(
    listener: TcpListener,
    state: Arc<ServerState>,
    mut shutdown: oneshot::Receiver<()>,
) -> Result<(), RemoteServerError> {
    loop {
        tokio::select! {
            _ = &mut shutdown => return Ok(()),
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                let state = Arc::clone(&state);
                tokio::spawn(async move {
                    let _ = handle_connection(stream, state).await;
                });
            }
        }
    }
}

async fn handle_connection(
    mut stream: TcpStream,
    state: Arc<ServerState>,
) -> Result<(), RemoteServerError> {
    let request = match read_http_request(&mut stream).await {
        Ok(request) => request,
        Err(err) => {
            write_json_response(
                &mut stream,
                400,
                json!({ "error": err.to_string() }).to_string().as_bytes(),
            )
            .await?;
            return Ok(());
        }
    };

    let path = local_remote_path(&request.path);
    match (request.method.as_str(), path) {
        ("GET", "/status") => {
            let body = serde_json::to_vec(&state.daemon.status(now_ms()))
                .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err.to_string()))?;
            write_json_response(&mut stream, 200, &body).await?;
        }
        ("POST", "/remote") => {
            let body = dispatch_remote_body(&state, &request.body);
            write_json_response(&mut stream, 200, body.as_bytes()).await?;
        }
        _ => {
            write_json_response(&mut stream, 404, br#"{"error":"not found"}"#).await?;
        }
    }
    Ok(())
}

fn dispatch_remote_body(state: &ServerState, body: &[u8]) -> String {
    let frame = match std::str::from_utf8(body)
        .map_err(|err| err.to_string())
        .and_then(|raw| super::protocol::decode_remote_frame(raw).map_err(|err| err.to_string()))
    {
        Ok(frame) => frame,
        Err(err) => return remote_error(None, "invalidFrame", err),
    };

    let request = match frame {
        RemoteFrame::Request {
            id,
            client_id,
            token,
            body,
            ..
        } => (id, client_id, token, body),
        _ => {
            return remote_error(None, "invalidFrame", "expected request frame");
        }
    };

    match dispatch_request(state, request.0, request.1, request.2, request.3) {
        Ok(frame) => serde_json::to_string(&frame)
            .unwrap_or_else(|err| remote_error(None, "serializeError", err.to_string())),
        Err(frame) => serde_json::to_string(&frame)
            .unwrap_or_else(|err| remote_error(None, "serializeError", err.to_string())),
    }
}

fn dispatch_request(
    state: &ServerState,
    id: String,
    client_id: Option<String>,
    token: Option<String>,
    body: RemoteRequest,
) -> Result<RemoteFrame, RemoteFrame> {
    let now = now_ms();
    match body {
        RemoteRequest::HostInfo => Ok(RemoteFrame::Response {
            id,
            protocol: REMOTE_PROTOCOL_NAME.into(),
            version: REMOTE_PROTOCOL_VERSION,
            body: RemoteResponse::HostInfo {
                app_version: env!("CARGO_PKG_VERSION").into(),
                capabilities: state.daemon.status(now).capabilities,
            },
        }),
        RemoteRequest::ExchangePairingCode {
            pairing_code,
            client_name,
        } => {
            let issued = RemoteAuthStore::update_path(&state.auth_path, |auth| {
                auth.exchange_pairing_code(&pairing_code, &client_name, now)
            })
            .map_err(|err| {
                error_frame(
                    Some(id.clone()),
                    auth_error_code(&err, "pairingRejected"),
                    err.to_string(),
                )
            })?;
            Ok(RemoteFrame::Response {
                id,
                protocol: REMOTE_PROTOCOL_NAME.into(),
                version: REMOTE_PROTOCOL_VERSION,
                body: RemoteResponse::PairingAccepted {
                    client_id: issued.client_id,
                    token: issued.token,
                },
            })
        }
        RemoteRequest::Authenticate { client_id, token } => {
            let client = RemoteAuthStore::update_path(&state.auth_path, |auth| {
                auth.authenticate(&client_id, &token, now)
            })
            .map_err(|err| {
                error_frame(
                    Some(id.clone()),
                    auth_error_code(&err, "authRejected"),
                    err.to_string(),
                )
            })?;
            Ok(RemoteFrame::Response {
                id,
                protocol: REMOTE_PROTOCOL_NAME.into(),
                version: REMOTE_PROTOCOL_VERSION,
                body: RemoteResponse::Authenticated {
                    client_id: client.client_id,
                },
            })
        }
        RemoteRequest::RevokeClient { client_id: target } => {
            let Some(request_client_id) = client_id else {
                return Err(error_frame(
                    Some(id),
                    "authRequired",
                    "client id is required",
                ));
            };
            let Some(token) = token else {
                return Err(error_frame(
                    Some(id),
                    "authRequired",
                    "client token is required",
                ));
            };
            if request_client_id != target {
                return Err(error_frame(
                    Some(id),
                    "forbidden",
                    "remote clients can only revoke themselves",
                ));
            }
            RemoteAuthStore::update_path(&state.auth_path, |auth| {
                auth.authenticate(&request_client_id, &token, now)?;
                auth.revoke_client(&target, now)
            })
            .map_err(|err| {
                error_frame(
                    Some(id.clone()),
                    auth_error_code(&err, "revokeRejected"),
                    err.to_string(),
                )
            })?;
            Ok(RemoteFrame::Response {
                id,
                protocol: REMOTE_PROTOCOL_NAME.into(),
                version: REMOTE_PROTOCOL_VERSION,
                body: RemoteResponse::ClientRevoked { client_id: target },
            })
        }
    }
}

fn auth_error_code(err: &super::auth::RemoteAuthError, default_code: &'static str) -> &'static str {
    match err {
        super::auth::RemoteAuthError::Io(_) | super::auth::RemoteAuthError::Json(_) => {
            "authStoreError"
        }
        _ => default_code,
    }
}

fn local_remote_path(path: &str) -> &str {
    if let Some(rest) = path.strip_prefix(TAILSCALE_SERVE_PATH) {
        if rest.is_empty() {
            "/"
        } else if rest.starts_with('/') {
            rest
        } else {
            path
        }
    } else {
        path
    }
}

struct HttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

async fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, std::io::Error> {
    let mut buffer = Vec::new();
    let header_end = loop {
        let mut chunk = [0_u8; 1024];
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "connection closed before headers",
            ));
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > REMOTE_FRAME_MAX_BYTES + 8192 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "request is too large",
            ));
        }
        if let Some(pos) = find_header_end(&buffer) {
            break pos;
        }
    };

    let headers = std::str::from_utf8(&buffer[..header_end])
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err.to_string()))?;
    let mut lines = headers.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    if method.is_empty() || path.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "invalid request line",
        ));
    }
    let mut content_length = 0_usize;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("content-length") {
            content_length = value.trim().parse::<usize>().map_err(|_| {
                std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid content-length")
            })?;
        }
    }
    if content_length > REMOTE_FRAME_MAX_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "request body is too large",
        ));
    }
    let body_start = header_end + 4;
    while buffer.len() < body_start + content_length {
        let mut chunk = vec![0_u8; body_start + content_length - buffer.len()];
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "connection closed before body",
            ));
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    Ok(HttpRequest {
        method,
        path,
        body: buffer[body_start..body_start + content_length].to_vec(),
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

async fn write_json_response(
    stream: &mut TcpStream,
    status: u16,
    body: &[u8],
) -> Result<(), std::io::Error> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "Error",
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(body).await
}

fn error_frame(
    id: Option<String>,
    code: impl Into<String>,
    message: impl Into<String>,
) -> RemoteFrame {
    RemoteFrame::Error {
        id,
        protocol: REMOTE_PROTOCOL_NAME.into(),
        version: REMOTE_PROTOCOL_VERSION,
        code: code.into(),
        message: message.into(),
    }
}

fn remote_error(id: Option<String>, code: impl Into<String>, message: impl Into<String>) -> String {
    serde_json::to_string(&error_frame(id, code, message)).unwrap_or_else(|_| {
        r#"{"kind":"error","id":null,"protocol":"pickforge.remote","version":1,"code":"serializeError","message":"failed to serialize error"}"#.into()
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::{DaemonListener, RemoteFrame, RemoteRequest, RemoteResponse};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn home() -> String {
        let path = std::env::temp_dir().join(format!(
            "pickforge-remote-server-{}-{}",
            std::process::id(),
            now_ms()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn free_port() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    async fn post(addr: SocketAddr, frame: &RemoteFrame) -> RemoteFrame {
        post_path(addr, "/remote", frame).await
    }

    async fn post_path(addr: SocketAddr, path: &str, frame: &RemoteFrame) -> RemoteFrame {
        let raw = serde_json::to_string(frame).unwrap();
        let request = format!(
            "POST {path} HTTP/1.1\r\nhost: {addr}\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
            raw.len(),
            raw
        );
        let mut stream = TcpStream::connect(addr).await.unwrap();
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        let body = response.split("\r\n\r\n").nth(1).unwrap();
        serde_json::from_str(body).unwrap()
    }

    #[tokio::test]
    async fn remote_server_handles_host_info_over_loopback_http() {
        let config = DaemonConfig {
            pickforge_home: home(),
            listener: DaemonListener::loopback("127.0.0.1", free_port()).unwrap(),
        };
        let server = spawn_remote_http_server(config).await.unwrap();
        let addr = server.info().local_addr;
        let response = post(
            addr,
            &RemoteFrame::Request {
                id: "r1".into(),
                protocol: REMOTE_PROTOCOL_NAME.into(),
                version: REMOTE_PROTOCOL_VERSION,
                client_id: None,
                token: None,
                body: RemoteRequest::HostInfo,
            },
        )
        .await;
        match response {
            RemoteFrame::Response {
                body: RemoteResponse::HostInfo { capabilities, .. },
                ..
            } => assert_eq!(
                capabilities,
                vec![crate::remote::RemoteCapability::HostInfo]
            ),
            other => panic!("unexpected response: {other:?}"),
        }
        server.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn remote_server_accepts_tailscale_mount_prefix() {
        let config = DaemonConfig {
            pickforge_home: home(),
            listener: DaemonListener::loopback("127.0.0.1", free_port()).unwrap(),
        };
        let server = spawn_remote_http_server(config).await.unwrap();
        let addr = server.info().local_addr;
        let response = post_path(
            addr,
            "/pickforge/remote",
            &RemoteFrame::Request {
                id: "r1".into(),
                protocol: REMOTE_PROTOCOL_NAME.into(),
                version: REMOTE_PROTOCOL_VERSION,
                client_id: None,
                token: None,
                body: RemoteRequest::HostInfo,
            },
        )
        .await;
        assert!(matches!(
            response,
            RemoteFrame::Response {
                body: RemoteResponse::HostInfo { .. },
                ..
            }
        ));
        server.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn remote_server_exchanges_pairing_code_and_authenticates() {
        let home = home();
        let auth_path = remote_auth_store_path(&home);
        let server = spawn_remote_http_server(DaemonConfig {
            pickforge_home: home,
            listener: DaemonListener::loopback("127.0.0.1", free_port()).unwrap(),
        })
        .await
        .unwrap();
        let addr = server.info().local_addr;

        let mut auth = RemoteAuthStore::default();
        let code = auth.issue_pairing_code(now_ms(), 60_000).unwrap();
        auth.save_to_path(&auth_path).unwrap();

        let paired = post(
            addr,
            &RemoteFrame::Request {
                id: "pair".into(),
                protocol: REMOTE_PROTOCOL_NAME.into(),
                version: REMOTE_PROTOCOL_VERSION,
                client_id: None,
                token: None,
                body: RemoteRequest::ExchangePairingCode {
                    pairing_code: code.code,
                    client_name: "Test client".into(),
                },
            },
        )
        .await;
        let (client_id, token) = match paired {
            RemoteFrame::Response {
                body: RemoteResponse::PairingAccepted { client_id, token },
                ..
            } => (client_id, token),
            other => panic!("unexpected pairing response: {other:?}"),
        };

        let authed = post(
            addr,
            &RemoteFrame::Request {
                id: "auth".into(),
                protocol: REMOTE_PROTOCOL_NAME.into(),
                version: REMOTE_PROTOCOL_VERSION,
                client_id: None,
                token: None,
                body: RemoteRequest::Authenticate {
                    client_id: client_id.clone(),
                    token,
                },
            },
        )
        .await;
        match authed {
            RemoteFrame::Response {
                body: RemoteResponse::Authenticated { client_id: authed },
                ..
            } => assert_eq!(authed, client_id),
            other => panic!("unexpected auth response: {other:?}"),
        }
        server.shutdown().await.unwrap();
    }
}
