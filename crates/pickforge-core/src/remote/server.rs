use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Semaphore};
use tokio::task::JoinHandle;

use super::auth::{remote_auth_store_path, RemoteAuthStore};
use super::daemon::{DaemonConfig, DaemonConfigError, RemoteHostDaemon};
use super::protocol::{
    RemoteFrame, RemoteRequest, RemoteResponse, REMOTE_FRAME_MAX_BYTES, REMOTE_PROTOCOL_NAME,
    REMOTE_PROTOCOL_VERSION,
};

const REMOTE_HTTP_READ_TIMEOUT: Duration = Duration::from_secs(10);
const REMOTE_HTTP_MAX_CONNECTIONS: usize = 64;

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicRemoteStatus {
    protocol: String,
    protocol_version: u16,
    listener_enabled: bool,
    capabilities: Vec<super::protocol::RemoteCapability>,
    checked_at_ms: i64,
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
    let gate = Arc::new(Semaphore::new(REMOTE_HTTP_MAX_CONNECTIONS));
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let join = tokio::spawn(run_accept_loop(listener, state, gate, shutdown_rx));
    Ok(RemoteHttpServer {
        info: RemoteHttpServerInfo { local_addr },
        shutdown: Some(shutdown_tx),
        join,
    })
}

async fn run_accept_loop(
    listener: TcpListener,
    state: Arc<ServerState>,
    gate: Arc<Semaphore>,
    mut shutdown: oneshot::Receiver<()>,
) -> Result<(), RemoteServerError> {
    loop {
        tokio::select! {
            _ = &mut shutdown => return Ok(()),
            accepted = listener.accept() => {
                let (mut stream, _) = accepted?;
                let Ok(permit) = Arc::clone(&gate).try_acquire_owned() else {
                    tokio::spawn(async move {
                        let _ = write_json_response(&mut stream, 503, br#"{"error":"busy"}"#).await;
                    });
                    continue;
                };
                let state = Arc::clone(&state);
                tokio::spawn(async move {
                    let _permit = permit;
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
    let request = match tokio::time::timeout(
        REMOTE_HTTP_READ_TIMEOUT,
        read_http_request(&mut stream),
    )
    .await
    {
        Ok(Ok(request)) => request,
        Ok(Err(err)) => {
            write_json_response(
                &mut stream,
                400,
                json!({ "error": err.to_string() }).to_string().as_bytes(),
            )
            .await?;
            return Ok(());
        }
        Err(_) => {
            write_json_response(&mut stream, 408, br#"{"error":"request timed out"}"#).await?;
            return Ok(());
        }
    };

    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/status") => {
            let body = serde_json::to_vec(&public_status(&state.daemon, now_ms()))
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

fn public_status(daemon: &RemoteHostDaemon, checked_at_ms: i64) -> PublicRemoteStatus {
    let status = daemon.status(checked_at_ms);
    PublicRemoteStatus {
        protocol: status.protocol,
        protocol_version: status.protocol_version,
        listener_enabled: status.listener_enabled,
        capabilities: status.capabilities,
        checked_at_ms: status.checked_at_ms,
    }
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
        408 => "Request Timeout",
        503 => "Service Unavailable",
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
    use std::sync::atomic::{AtomicU64, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    static NEXT_HOME: AtomicU64 = AtomicU64::new(1);

    fn home() -> String {
        let path = std::env::temp_dir().join(format!(
            "pickforge-remote-server-{}-{}-{}",
            std::process::id(),
            now_ms(),
            NEXT_HOME.fetch_add(1, Ordering::Relaxed)
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

    async fn raw_response(addr: SocketAddr, request: &str) -> String {
        let mut stream = TcpStream::connect(addr).await.unwrap();
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        response
    }

    fn response_status(response: &str) -> u16 {
        response
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|code| code.parse::<u16>().ok())
            .unwrap()
    }

    fn response_body(response: &str) -> &str {
        response.split("\r\n\r\n").nth(1).unwrap()
    }

    fn dispatch_frame(state: &ServerState, frame: RemoteFrame) -> RemoteFrame {
        let raw = serde_json::to_vec(&frame).unwrap();
        serde_json::from_str(&dispatch_remote_body(state, &raw)).unwrap()
    }

    fn server_state(home: String) -> ServerState {
        let daemon = RemoteHostDaemon::new(DaemonConfig {
            pickforge_home: home.clone(),
            listener: DaemonListener::Disabled,
        })
        .unwrap();
        let auth_path = remote_auth_store_path(&home);
        ServerState { daemon, auth_path }
    }

    #[test]
    fn public_status_omits_private_host_fields() {
        let daemon = RemoteHostDaemon::new(DaemonConfig {
            pickforge_home: "/home/alice/.pickforge".into(),
            listener: DaemonListener::loopback("127.0.0.1", 4747).unwrap(),
        })
        .unwrap();
        let value = serde_json::to_value(public_status(&daemon, 42)).unwrap();

        assert_eq!(value["protocol"], REMOTE_PROTOCOL_NAME);
        assert_eq!(value["protocolVersion"], REMOTE_PROTOCOL_VERSION);
        assert_eq!(value["listenerEnabled"], true);
        assert_eq!(value["checkedAtMs"], 42);
        assert!(value.get("pickforgeHome").is_none());
        assert!(value.get("listener").is_none());
        assert!(!value.to_string().contains("/home/alice"));
    }

    #[test]
    fn dispatch_rejects_invalid_or_non_request_frames() {
        let state = server_state(home());
        let invalid =
            serde_json::from_str::<RemoteFrame>(&dispatch_remote_body(&state, &[0xff])).unwrap();
        assert!(matches!(
            invalid,
            RemoteFrame::Error {
                code,
                ..
            } if code == "invalidFrame"
        ));

        let hello = dispatch_frame(
            &state,
            RemoteFrame::Hello {
                protocol: REMOTE_PROTOCOL_NAME.into(),
                version: REMOTE_PROTOCOL_VERSION,
                app_version: "0.1.8".into(),
            },
        );
        assert!(matches!(
            hello,
            RemoteFrame::Error {
                code,
                ..
            } if code == "invalidFrame"
        ));
    }

    #[test]
    fn dispatch_revoke_requires_auth_and_allows_self_revoke() {
        let state = server_state(home());
        let code = RemoteAuthStore::update_path(&state.auth_path, |store| {
            store.issue_pairing_code(now_ms(), 60_000)
        })
        .unwrap();
        let issued = RemoteAuthStore::update_path(&state.auth_path, |store| {
            store.exchange_pairing_code(&code.code, "Remote client", now_ms())
        })
        .unwrap();

        let missing_client = dispatch_frame(
            &state,
            RemoteFrame::Request {
                id: "missing-client".into(),
                protocol: REMOTE_PROTOCOL_NAME.into(),
                version: REMOTE_PROTOCOL_VERSION,
                client_id: None,
                token: None,
                body: RemoteRequest::RevokeClient {
                    client_id: issued.client_id.clone(),
                },
            },
        );
        assert!(matches!(
            missing_client,
            RemoteFrame::Error {
                code,
                ..
            } if code == "authRequired"
        ));

        let missing_token = dispatch_frame(
            &state,
            RemoteFrame::Request {
                id: "missing-token".into(),
                protocol: REMOTE_PROTOCOL_NAME.into(),
                version: REMOTE_PROTOCOL_VERSION,
                client_id: Some(issued.client_id.clone()),
                token: None,
                body: RemoteRequest::RevokeClient {
                    client_id: issued.client_id.clone(),
                },
            },
        );
        assert!(matches!(
            missing_token,
            RemoteFrame::Error {
                code,
                ..
            } if code == "authRequired"
        ));

        let forbidden = dispatch_frame(
            &state,
            RemoteFrame::Request {
                id: "forbidden".into(),
                protocol: REMOTE_PROTOCOL_NAME.into(),
                version: REMOTE_PROTOCOL_VERSION,
                client_id: Some(issued.client_id.clone()),
                token: Some(issued.token.clone()),
                body: RemoteRequest::RevokeClient {
                    client_id: "other-client".into(),
                },
            },
        );
        assert!(matches!(
            forbidden,
            RemoteFrame::Error {
                code,
                ..
            } if code == "forbidden"
        ));

        let revoked = dispatch_frame(
            &state,
            RemoteFrame::Request {
                id: "revoke".into(),
                protocol: REMOTE_PROTOCOL_NAME.into(),
                version: REMOTE_PROTOCOL_VERSION,
                client_id: Some(issued.client_id.clone()),
                token: Some(issued.token),
                body: RemoteRequest::RevokeClient {
                    client_id: issued.client_id.clone(),
                },
            },
        );
        match revoked {
            RemoteFrame::Response {
                body: RemoteResponse::ClientRevoked { client_id },
                ..
            } => assert_eq!(client_id, issued.client_id),
            other => panic!("unexpected revoke response: {other:?}"),
        }
        let snapshot = RemoteAuthStore::snapshot_from_path(&state.auth_path).unwrap();
        assert!(snapshot.clients[0].revoked_at_ms.is_some());
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
    async fn remote_server_status_is_public_safe_and_routes_404s() {
        let config = DaemonConfig {
            pickforge_home: "/home/alice/.pickforge".into(),
            listener: DaemonListener::loopback("127.0.0.1", free_port()).unwrap(),
        };
        let server = spawn_remote_http_server(config).await.unwrap();
        let addr = server.info().local_addr;

        let status = raw_response(
            addr,
            &format!("GET /status HTTP/1.1\r\nhost: {addr}\r\n\r\n"),
        )
        .await;
        assert_eq!(response_status(&status), 200);
        let body = response_body(&status);
        assert!(body.contains("\"listenerEnabled\":true"));
        assert!(!body.contains("pickforgeHome"));
        assert!(!body.contains("/home/alice"));

        let missing = raw_response(
            addr,
            &format!("GET /missing HTTP/1.1\r\nhost: {addr}\r\n\r\n"),
        )
        .await;
        assert_eq!(response_status(&missing), 404);

        let bad = raw_response(addr, "BAD\r\n\r\n").await;
        assert_eq!(response_status(&bad), 400);

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
