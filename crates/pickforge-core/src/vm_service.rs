//! Focused Dart VM Service client (WebSocket + JSON-RPC 2.0). Ports the
//! connection + request/response boundary of `vm_service_client.dart` (the Dart
//! app used the `vm_service` package). Streaming events are read and discarded;
//! request/response is correlated by id. One connection at a time.

use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::correlated_ws::{ConnectError, CorrelatedWebSocket, RequestError};

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

/// A live VM Service connection (or none). Lives behind Tauri's managed `State`.
#[derive(Default)]
pub struct VmServiceClient {
    connection: CorrelatedWebSocket<broadcast::Sender<Value>>,
}

impl VmServiceClient {
    pub fn new() -> Self {
        Self::default()
    }

    /// Connect to `ws://…/ws`, replacing any existing connection. The URL's host
    /// must resolve to loopback (a renderer must not be able to point the client
    /// at an arbitrary host).
    pub async fn connect(&self, url: &str) -> Result<(), VmError> {
        let (events, _) = broadcast::channel::<Value>(256);
        let event_sender = events.clone();
        self.connection
            .connect(url, events, move |event| {
                let _ = event_sender.send(event);
            })
            .await
            .map_err(|error| match error {
                ConnectError::Forbidden(message) => VmError::Forbidden(message),
                ConnectError::WebSocket(message) => VmError::WebSocket(message),
                ConnectError::Superseded => {
                    VmError::WebSocket("connection attempt superseded".into())
                }
            })
    }

    /// Subscribe to VM service stream events (no-id frames). `None` if not
    /// connected. Pair with [`stream_listen`] to start receiving a stream.
    pub async fn events(&self) -> Option<broadcast::Receiver<Value>> {
        self.connection.metadata(|events| events.subscribe()).await
    }

    /// Ask the VM service to start delivering a named event stream (e.g.
    /// "Extension", "ToolEvent", "Isolate", "Debug").
    pub async fn stream_listen(&self, stream_id: &str) -> Result<Value, VmError> {
        self.call("streamListen", json!({ "streamId": stream_id }))
            .await
    }

    /// Issue a JSON-RPC call and await the result.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, VmError> {
        let response = self
            .connection
            .request(|id| json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await
            .map_err(|error| match error {
                RequestError::Disconnected => VmError::NotConnected,
                RequestError::Timeout => VmError::Timeout,
            })?;
        parse_vm_result(response)
    }

    pub async fn disconnect(&self) {
        self.connection.disconnect().await;
    }

    pub async fn current_url(&self) -> Option<String> {
        self.connection.current_url().await
    }

    pub async fn is_connected(&self) -> bool {
        self.connection.is_connected().await
    }
}

fn parse_vm_result(response: Value) -> Result<Value, VmError> {
    if let Some(error) = response.get("error") {
        return Err(VmError::Rpc(error.to_string()));
    }
    Ok(response.get("result").cloned().unwrap_or(Value::Null))
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::SinkExt;
    use std::time::Duration;
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;
    use tokio_tungstenite::tungstenite::Message;

    #[test]
    fn vm_service_result_parsing_stays_protocol_specific() {
        assert_eq!(
            parse_vm_result(json!({ "id": 1, "result": { "type": "VM" } })).unwrap(),
            json!({ "type": "VM" })
        );
        assert!(matches!(
            parse_vm_result(json!({ "id": 1, "error": { "code": -32601 } })),
            Err(VmError::Rpc(_))
        ));
    }

    #[tokio::test]
    async fn vm_service_delivers_no_id_events_to_subscribers() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (release, released) = oneshot::channel();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut websocket = tokio_tungstenite::accept_async(stream).await.unwrap();
            released.await.unwrap();
            websocket
                .send(Message::Text(
                    json!({ "method": "streamNotify", "params": { "streamId": "Extension" } })
                        .to_string(),
                ))
                .await
                .unwrap();
        });

        let client = VmServiceClient::new();
        client.connect(&format!("ws://{address}/ws")).await.unwrap();
        let mut events = client.events().await.unwrap();
        release.send(()).unwrap();

        let event = tokio::time::timeout(Duration::from_secs(2), events.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(event["method"], "streamNotify");
        assert_eq!(event["params"]["streamId"], "Extension");
    }
}
