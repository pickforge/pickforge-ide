//! Focused Dart VM Service client (WebSocket + JSON-RPC 2.0). Ports the
//! connection + request/response boundary of `vm_service_client.dart` (the Dart
//! app used the `vm_service` package). Streaming events are read and discarded;
//! request/response is correlated by id. One connection at a time.

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex};
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
}

type Pending = Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>;

struct Conn {
    url: String,
    out: mpsc::UnboundedSender<Message>,
    pending: Pending,
    next_id: AtomicI64,
}

/// A live VM Service connection (or none). Lives behind Tauri's managed `State`.
#[derive(Default)]
pub struct VmServiceClient {
    conn: AsyncMutex<Option<Conn>>,
}

impl VmServiceClient {
    pub fn new() -> Self {
        Self::default()
    }

    /// Connect to `ws://…/ws`, replacing any existing connection.
    pub async fn connect(&self, url: &str) -> Result<(), VmError> {
        let (ws, _) = tokio_tungstenite::connect_async(url)
            .await
            .map_err(|e| VmError::WebSocket(e.to_string()))?;
        let (mut write, mut read) = ws.split();
        let (out, mut out_rx) = mpsc::unbounded_channel::<Message>();
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));

        // Writer task: drain the outbound queue to the socket.
        tokio::spawn(async move {
            while let Some(msg) = out_rx.recv().await {
                if write.send(msg).await.is_err() {
                    break;
                }
            }
        });

        // Reader task: route responses to their pending sender by id.
        let pending_read = Arc::clone(&pending);
        tokio::spawn(async move {
            while let Some(Ok(msg)) = read.next().await {
                if let Message::Text(txt) = msg {
                    if let Ok(value) = serde_json::from_str::<Value>(&txt) {
                        if let Some(id) = value.get("id").and_then(Value::as_i64) {
                            if let Some(tx) = pending_read.lock().unwrap().remove(&id) {
                                let _ = tx.send(value);
                            }
                        }
                        // Stream events (no id) are ignored for now.
                    }
                }
            }
            // Socket closed: drop pending senders so in-flight calls error out.
            pending_read.lock().unwrap().clear();
        });

        *self.conn.lock().await = Some(Conn {
            url: url.to_string(),
            out,
            pending,
            next_id: AtomicI64::new(1),
        });
        Ok(())
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
        out.send(Message::Text(req.to_string()))
            .map_err(|_| VmError::NotConnected)?;

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
}
