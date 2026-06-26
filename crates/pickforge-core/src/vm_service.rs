//! Focused Dart VM Service client (WebSocket + JSON-RPC 2.0). Ports the
//! connection + request/response boundary of `vm_service_client.dart` (the Dart
//! app used the `vm_service` package). Streaming events are read and discarded;
//! request/response is correlated by id. One connection at a time.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex as AsyncMutex};
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, thiserror::Error)]
pub enum VmError {
    #[error("not connected to a VM service")]
    NotConnected,
    #[error("vm service request timed out")]
    Timeout,
    #[error("vm service error: {0}")]
    Rpc(String),
    #[error("websocket error: {0}")]
    WebSocket(String),
    #[error("forbidden: {0}")]
    Forbidden(String),
}

type Pending = Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>;
type ConnSlot = Arc<AsyncMutex<Option<Conn>>>;

struct Conn {
    /// Monotonic id of this connection. The reader/writer tasks clear the slot
    /// on exit only if it still holds *their* generation, so a remote close
    /// can't tear down a newer reconnect that has since replaced it.
    generation: u64,
    url: String,
    out: mpsc::UnboundedSender<Message>,
    pending: Pending,
    next_id: AtomicI64,
    /// Stream events (no-id frames, e.g. Extension / ToolEvent / Isolate) are
    /// broadcast to any subscribers — the inspector needs these for device
    /// tap-to-select, navigate, and service-extension discovery.
    events: broadcast::Sender<Value>,
}

/// A live VM Service connection (or none). Lives behind Tauri's managed `State`.
#[derive(Default)]
pub struct VmServiceClient {
    conn: ConnSlot,
    /// Hands out a fresh generation per `connect()`.
    generation: AtomicU64,
}

/// Clear the stored connection if it still belongs to `generation` (a remote
/// close racing a reconnect must not evict the newer one), and drop pending
/// senders so in-flight calls fail fast instead of timing out.
async fn clear_connection(slot: &ConnSlot, generation: u64) {
    let mut guard = slot.lock().await;
    if guard.as_ref().map(|c| c.generation) == Some(generation) {
        if let Some(conn) = guard.take() {
            conn.pending.lock().unwrap().clear();
        }
    }
}

/// Accept `host` only if it resolves *exclusively* to loopback addresses. A bare
/// `127.0.0.1` / `::1` is loopback by inspection; any name (including the
/// `localhost` name) is resolved and every resulting address must be loopback —
/// so a compromised renderer can't smuggle `127.0.0.1.evil.com`, `0.0.0.0`, a
/// link-local metadata IP (`169.254.169.254`), or a name whose DNS points off-box.
/// Mirrors the CDP client's `guard_loopback_host` (see `cdp.rs`).
async fn guard_loopback_host(host: &str) -> Result<(), VmError> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return if ip.is_loopback() {
            Ok(())
        } else {
            Err(VmError::Forbidden(format!("non-loopback host: {host}")))
        };
    }

    let mut addrs = tokio::net::lookup_host((host, 0))
        .await
        .map_err(|_| VmError::Forbidden(format!("host does not resolve: {host}")))?
        .peekable();
    if addrs.peek().is_none() {
        return Err(VmError::Forbidden(format!("host does not resolve: {host}")));
    }
    for addr in addrs {
        if !addr.ip().is_loopback() {
            return Err(VmError::Forbidden(format!(
                "host {host} resolves to non-loopback {}",
                addr.ip()
            )));
        }
    }
    Ok(())
}

/// Validate a VM-service WebSocket URL before connecting: it must be a `ws`/`wss`
/// URL whose host resolves to loopback. Mirrors the CDP client's attach guard
/// (`guard_ws_url_loopback` in `cdp.rs`) so a renderer-supplied URL can't drive
/// an arbitrary outbound connection (SSRF).
async fn guard_ws_url_loopback(ws_url: &str) -> Result<(), VmError> {
    let url = url::Url::parse(ws_url)
        .map_err(|e| VmError::Forbidden(format!("invalid ws url: {e}")))?;
    match url.scheme() {
        "ws" | "wss" => {}
        other => {
            return Err(VmError::Forbidden(format!("unsupported ws scheme: {other}")));
        }
    }
    let host = url
        .host_str()
        .ok_or_else(|| VmError::Forbidden("ws url has no host".into()))?;
    // `Url::host_str` already strips a `[..]` IPv6 wrapper, so this parses clean.
    guard_loopback_host(host).await
}

impl VmServiceClient {
    pub fn new() -> Self {
        Self::default()
    }

    /// Connect to `ws://…/ws`, replacing any existing connection. The URL's host
    /// must resolve to loopback (a renderer must not be able to point the client
    /// at an arbitrary host).
    pub async fn connect(&self, url: &str) -> Result<(), VmError> {
        guard_ws_url_loopback(url).await?;
        let (ws, _) = tokio_tungstenite::connect_async(url)
            .await
            .map_err(|e| VmError::WebSocket(e.to_string()))?;
        let (mut write, mut read) = ws.split();
        let (out, mut out_rx) = mpsc::unbounded_channel::<Message>();
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (events, _) = broadcast::channel::<Value>(256);
        let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;

        // Install the generation-checked `Conn` into the slot BEFORE spawning the
        // reader/writer tasks. The tasks tear the slot down via
        // `clear_connection(slot, generation)` on exit; if they ran first and the
        // socket was already closed, they'd find the slot empty (generation
        // mismatch), return, and then we'd store a dead `Conn` after them —
        // leaving `is_connected()` stuck true until a later send finally failed.
        // Installing first means any task exit always sees (and clears) its own
        // conn.
        let pending_read = Arc::clone(&pending);
        let events_read = events.clone();
        *self.conn.lock().await = Some(Conn {
            generation,
            url: url.to_string(),
            out,
            pending,
            next_id: AtomicI64::new(1),
            events,
        });

        // Writer task: drain the outbound queue to the socket. On exit (socket
        // write error or the connection being replaced) tear the slot down so
        // status flips to disconnected and future calls fail fast.
        let slot_write = Arc::clone(&self.conn);
        tokio::spawn(async move {
            while let Some(msg) = out_rx.recv().await {
                if write.send(msg).await.is_err() {
                    break;
                }
            }
            clear_connection(&slot_write, generation).await;
        });

        // Reader task: route id'd responses to their pending sender; broadcast
        // no-id stream events to subscribers.
        let slot_read = Arc::clone(&self.conn);
        tokio::spawn(async move {
            while let Some(Ok(msg)) = read.next().await {
                if let Message::Text(txt) = msg {
                    if let Ok(value) = serde_json::from_str::<Value>(&txt) {
                        if let Some(id) = value.get("id").and_then(Value::as_i64) {
                            if let Some(tx) = pending_read.lock().unwrap().remove(&id) {
                                let _ = tx.send(value);
                            }
                        } else {
                            // Stream event — ignore send error when no subscribers.
                            let _ = events_read.send(value);
                        }
                    }
                }
            }
            // Socket closed: clear the stored connection (so `is_connected`
            // reports false) and drop pending senders so in-flight calls error
            // out immediately instead of waiting the full request timeout.
            clear_connection(&slot_read, generation).await;
        });

        Ok(())
    }

    /// Subscribe to VM service stream events (no-id frames). `None` if not
    /// connected. Pair with [`stream_listen`] to start receiving a stream.
    pub async fn events(&self) -> Option<broadcast::Receiver<Value>> {
        self.conn.lock().await.as_ref().map(|c| c.events.subscribe())
    }

    /// Ask the VM service to start delivering a named event stream (e.g.
    /// "Extension", "ToolEvent", "Isolate", "Debug").
    pub async fn stream_listen(&self, stream_id: &str) -> Result<Value, VmError> {
        self.call("streamListen", json!({ "streamId": stream_id })).await
    }

    /// Issue a JSON-RPC call and await the result.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, VmError> {
        let (out, pending, id) = {
            let guard = self.conn.lock().await;
            let conn = guard.as_ref().ok_or(VmError::NotConnected)?;
            let id = conn.next_id.fetch_add(1, Ordering::Relaxed);
            (conn.out.clone(), Arc::clone(&conn.pending), id)
        };

        let (tx, rx) = oneshot::channel();
        pending.lock().unwrap().insert(id, tx);
        let req = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        // Remove the just-inserted pending entry on any send failure so a dropped
        // outbound channel (writer task gone) can't leak the id forever.
        if out.send(Message::Text(req.to_string())).is_err() {
            pending.lock().unwrap().remove(&id);
            return Err(VmError::NotConnected);
        }

        let resp = match tokio::time::timeout(Duration::from_secs(10), rx).await {
            Ok(Ok(v)) => v,
            Ok(Err(_)) => return Err(VmError::NotConnected),
            Err(_) => {
                pending.lock().unwrap().remove(&id);
                return Err(VmError::Timeout);
            }
        };

        if let Some(err) = resp.get("error") {
            return Err(VmError::Rpc(err.to_string()));
        }
        Ok(resp.get("result").cloned().unwrap_or(Value::Null))
    }

    pub async fn disconnect(&self) {
        *self.conn.lock().await = None;
    }

    pub async fn current_url(&self) -> Option<String> {
        self.conn.lock().await.as_ref().map(|c| c.url.clone())
    }

    pub async fn is_connected(&self) -> bool {
        self.conn.lock().await.is_some()
    }

    #[cfg(test)]
    async fn pending_len(&self) -> usize {
        self.conn
            .lock()
            .await
            .as_ref()
            .map(|c| c.pending.lock().unwrap().len())
            .unwrap_or(0)
    }

    /// Test seam: install a connection whose outbound receiver is already
    /// dropped, so the next `call()` hits the send-error path with the pending
    /// entry already inserted — exercising the leak fix in isolation.
    #[cfg(test)]
    async fn install_dead_writer_conn(&self) {
        let (out, out_rx) = mpsc::unbounded_channel::<Message>();
        drop(out_rx);
        let (events, _) = broadcast::channel::<Value>(8);
        let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
        *self.conn.lock().await = Some(Conn {
            generation,
            url: "ws://dead/ws".to_string(),
            out,
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicI64::new(1),
            events,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;
    use tokio::net::TcpListener;

    /// Accept one WS connection, then immediately close it — simulates the
    /// remote VM service going away (a `flutter run` exiting).
    async fn spawn_closing_ws_server() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            if let Ok((stream, _)) = listener.accept().await {
                if let Ok(ws) = tokio_tungstenite::accept_async(stream).await {
                    // Drop the stream right away → the client sees a clean close.
                    drop(ws);
                }
            }
        });
        format!("ws://{addr}/ws")
    }

    #[tokio::test]
    async fn remote_close_flips_disconnected_and_in_flight_calls_fail_fast() {
        let url = spawn_closing_ws_server().await;
        let client = VmServiceClient::new();
        client.connect(&url).await.expect("connect");

        // Let the reader task observe the close and clear the slot.
        let deadline = Instant::now() + Duration::from_secs(2);
        while client.is_connected().await && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(
            !client.is_connected().await,
            "status should flip to disconnected after a remote close"
        );
        assert!(client.current_url().await.is_none());

        // A call now must fail fast (NotConnected), not block the 10s timeout.
        let started = Instant::now();
        let result = client.call("getVM", json!({})).await;
        assert!(matches!(result, Err(VmError::NotConnected)));
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "in-flight call should fail fast, took {:?}",
            started.elapsed()
        );
    }

    #[tokio::test]
    async fn connect_rejects_non_loopback_ws_url() {
        let client = VmServiceClient::new();
        for ws in [
            "ws://evil.com:8181/ws",
            "ws://169.254.169.254:8181/ws",
            "ws://8.8.8.8/ws",
        ] {
            let err = client.connect(ws).await.unwrap_err();
            assert!(
                matches!(err, VmError::Forbidden(_)),
                "connect({ws}) should be Forbidden, got {err:?}"
            );
        }
        assert!(!client.is_connected().await);
    }

    #[tokio::test]
    async fn connect_rejects_non_ws_scheme() {
        let client = VmServiceClient::new();
        let err = client
            .connect("http://127.0.0.1:8181/ws")
            .await
            .unwrap_err();
        assert!(matches!(err, VmError::Forbidden(_)));
        assert!(!client.is_connected().await);
    }

    #[tokio::test]
    async fn send_failure_does_not_leak_a_pending_id() {
        let client = VmServiceClient::new();
        client.install_dead_writer_conn().await;

        let result = client.call("getVM", json!({})).await;
        assert!(matches!(result, Err(VmError::NotConnected)));
        assert_eq!(
            client.pending_len().await,
            0,
            "a send failure must remove the pending entry it inserted"
        );
    }
}
