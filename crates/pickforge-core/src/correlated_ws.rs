use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{Sink, SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot, watch, Mutex as AsyncMutex};
use tokio_tungstenite::tungstenite::Message;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

type Pending = Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>;
type ConnectionSlot<M> = Arc<AsyncMutex<ConnectionState<M>>>;

struct ConnectionState<M> {
    generation: u64,
    connection: Option<Connection<M>>,
}

impl<M> Default for ConnectionState<M> {
    fn default() -> Self {
        Self {
            generation: 0,
            connection: None,
        }
    }
}

struct Connection<M> {
    generation: u64,
    url: String,
    out: mpsc::UnboundedSender<Message>,
    pending: Pending,
    next_id: i64,
    cancel: watch::Sender<bool>,
    metadata: M,
}

impl<M> Connection<M> {
    fn retire(self) {
        let _ = self.cancel.send(true);
        self.pending.lock().unwrap().clear();
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ConnectError {
    Forbidden(String),
    WebSocket(String),
    Superseded,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RequestError {
    Disconnected,
    Timeout,
}

/// Owns the common lifetime of one JSON request/response WebSocket connection.
/// Protocol adapters retain request envelopes, result parsing, and event policy.
pub(crate) struct CorrelatedWebSocket<M> {
    connection: ConnectionSlot<M>,
    request_timeout: Duration,
}

impl<M> Default for CorrelatedWebSocket<M> {
    fn default() -> Self {
        Self {
            connection: Arc::new(AsyncMutex::new(ConnectionState::default())),
            request_timeout: REQUEST_TIMEOUT,
        }
    }
}

impl<M: Send + 'static> CorrelatedWebSocket<M> {
    pub(crate) async fn connect<F>(
        &self,
        url: &str,
        metadata: M,
        on_event: F,
    ) -> Result<(), ConnectError>
    where
        F: Fn(Value) + Send + Sync + 'static,
    {
        let generation = {
            let mut state = self.connection.lock().await;
            state.generation += 1;
            state.generation
        };
        guard_loopback_ws_url(url)
            .await
            .map_err(ConnectError::Forbidden)?;
        let (websocket, _) = tokio_tungstenite::connect_async(url)
            .await
            .map_err(|error| ConnectError::WebSocket(error.to_string()))?;
        let (writer, mut reader) = websocket.split();
        let (out, outbound) = mpsc::unbounded_channel();
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (cancel, cancel_rx) = watch::channel(false);

        let replaced = {
            let mut state = self.connection.lock().await;
            if state.generation != generation {
                return Err(ConnectError::Superseded);
            }
            state.connection.replace(Connection {
                generation,
                url: url.to_string(),
                out,
                pending: Arc::clone(&pending),
                next_id: 1,
                cancel,
                metadata,
            })
        };
        if let Some(replaced) = replaced {
            replaced.retire();
        }

        let writer_slot = Arc::clone(&self.connection);
        let writer_cancel = cancel_rx.clone();
        tokio::spawn(run_writer(
            writer,
            outbound,
            writer_cancel,
            writer_slot,
            generation,
        ));

        let reader_slot = Arc::clone(&self.connection);
        let mut reader_cancel = cancel_rx;
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    changed = reader_cancel.changed() => {
                        if changed.is_err() || *reader_cancel.borrow() {
                            break;
                        }
                    }
                    message = reader.next() => {
                        let text = match message {
                            Some(Ok(Message::Text(text))) => text,
                            Some(Ok(_)) => continue,
                            Some(Err(_)) | None => break,
                        };
                        let Ok(value) = serde_json::from_str::<Value>(&text) else {
                            continue;
                        };
                        if let Some(id) = value.get("id").and_then(Value::as_i64) {
                            if let Some(sender) = pending.lock().unwrap().remove(&id) {
                                let _ = sender.send(value);
                            }
                        } else {
                            on_event(value);
                        }
                    }
                }
            }
            clear_generation(&reader_slot, generation).await;
        });

        Ok(())
    }

    pub(crate) async fn request<F>(&self, build_request: F) -> Result<Value, RequestError>
    where
        F: FnOnce(i64) -> Value,
    {
        let (receiver, pending, id, failed_generation) = {
            let mut state = self.connection.lock().await;
            let connection = state
                .connection
                .as_mut()
                .ok_or(RequestError::Disconnected)?;
            let id = connection.next_id;
            connection.next_id += 1;
            let (sender, receiver) = oneshot::channel();
            connection.pending.lock().unwrap().insert(id, sender);
            let send_failed = connection
                .out
                .send(Message::Text(build_request(id).to_string()))
                .is_err();
            if send_failed {
                connection.pending.lock().unwrap().remove(&id);
            }
            (
                receiver,
                Arc::clone(&connection.pending),
                id,
                send_failed.then_some(connection.generation),
            )
        };

        if let Some(generation) = failed_generation {
            clear_generation(&self.connection, generation).await;
            return Err(RequestError::Disconnected);
        }

        match tokio::time::timeout(self.request_timeout, receiver).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => Err(RequestError::Disconnected),
            Err(_) => {
                pending.lock().unwrap().remove(&id);
                Err(RequestError::Timeout)
            }
        }
    }

    pub(crate) async fn disconnect(&self) {
        let connection = {
            let mut state = self.connection.lock().await;
            state.generation += 1;
            state.connection.take()
        };
        if let Some(connection) = connection {
            connection.retire();
        }
    }

    pub(crate) async fn is_connected(&self) -> bool {
        self.connection.lock().await.connection.is_some()
    }

    pub(crate) async fn current_url(&self) -> Option<String> {
        self.connection
            .lock()
            .await
            .connection
            .as_ref()
            .map(|connection| connection.url.clone())
    }

    pub(crate) async fn metadata<R>(&self, read: impl FnOnce(&M) -> R) -> Option<R> {
        self.connection
            .lock()
            .await
            .connection
            .as_ref()
            .map(|connection| read(&connection.metadata))
    }
}

async fn run_writer<M, S>(
    writer: S,
    mut outbound: mpsc::UnboundedReceiver<Message>,
    mut cancel: watch::Receiver<bool>,
    slot: ConnectionSlot<M>,
    generation: u64,
) where
    M: Send + 'static,
    S: Sink<Message> + Send + 'static,
{
    futures_util::pin_mut!(writer);
    loop {
        tokio::select! {
            changed = cancel.changed() => {
                if changed.is_err() || *cancel.borrow() {
                    break;
                }
            }
            message = outbound.recv() => {
                let Some(message) = message else {
                    break;
                };
                let mut writer_ref = writer.as_mut();
                let send = writer_ref.send(message);
                tokio::pin!(send);
                let send_result = tokio::select! {
                    _ = cancel.changed() => break,
                    result = &mut send => result,
                };
                if send_result.is_err() {
                    break;
                }
            }
        }
    }
    clear_generation(&slot, generation).await;
}

async fn clear_generation<M>(slot: &ConnectionSlot<M>, generation: u64) {
    let connection = {
        let mut state = slot.lock().await;
        if state
            .connection
            .as_ref()
            .map(|connection| connection.generation)
            == Some(generation)
        {
            state.connection.take()
        } else {
            None
        }
    };
    if let Some(connection) = connection {
        connection.retire();
    }
}

pub(crate) async fn guard_loopback_host(host: &str) -> Result<(), String> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return if ip.is_loopback() {
            Ok(())
        } else {
            Err(format!("non-loopback host: {host}"))
        };
    }

    let mut addresses = tokio::net::lookup_host((host, 0))
        .await
        .map_err(|_| format!("host does not resolve: {host}"))?
        .peekable();
    if addresses.peek().is_none() {
        return Err(format!("host does not resolve: {host}"));
    }
    for address in addresses {
        if !address.ip().is_loopback() {
            return Err(format!(
                "host {host} resolves to non-loopback {}",
                address.ip()
            ));
        }
    }
    Ok(())
}

async fn guard_loopback_ws_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|error| format!("invalid ws url: {error}"))?;
    match parsed.scheme() {
        "ws" | "wss" => {}
        scheme => return Err(format!("unsupported ws scheme: {scheme}")),
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "ws url has no host".to_string())?;
    let host = host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(host);
    guard_loopback_host(host).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::sink;
    use serde_json::json;
    use std::future;
    use std::time::Instant;
    use tokio::net::TcpListener;

    fn fake_connection<M>(
        generation: u64,
        url: &str,
        out: mpsc::UnboundedSender<Message>,
        pending: Pending,
        metadata: M,
    ) -> Connection<M> {
        let (cancel, _) = watch::channel(false);
        Connection {
            generation,
            url: url.to_string(),
            out,
            pending,
            next_id: 1,
            cancel,
            metadata,
        }
    }

    async fn wait_until_disconnected(socket: &CorrelatedWebSocket<()>) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while socket.is_connected().await && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(!socket.is_connected().await);
    }

    #[tokio::test]
    async fn cdp_vm_service_generation_checked_teardown_preserves_replacement() {
        let socket = CorrelatedWebSocket::<()>::default();
        let (out, _receiver) = mpsc::unbounded_channel();
        let pending = Arc::new(Mutex::new(HashMap::new()));
        {
            let mut state = socket.connection.lock().await;
            state.generation = 2;
            state.connection = Some(fake_connection(
                2,
                "ws://127.0.0.1/new",
                out,
                Arc::clone(&pending),
                (),
            ));
        }

        clear_generation(&socket.connection, 1).await;

        assert!(socket.is_connected().await);
        assert_eq!(
            socket.current_url().await.as_deref(),
            Some("ws://127.0.0.1/new")
        );
    }

    #[tokio::test]
    async fn cdp_vm_service_reader_close_disconnects_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let websocket = tokio_tungstenite::accept_async(stream).await.unwrap();
            drop(websocket);
        });

        let socket = CorrelatedWebSocket::<()>::default();
        socket
            .connect(&format!("ws://{address}/ws"), (), |_| {})
            .await
            .unwrap();
        wait_until_disconnected(&socket).await;
        assert!(socket.current_url().await.is_none());
    }

    #[tokio::test]
    async fn cdp_vm_service_writer_failure_clears_pending_and_disconnects() {
        let socket = CorrelatedWebSocket::<()>::default();
        let (out, outbound) = mpsc::unbounded_channel();
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (pending_sender, pending_receiver) = oneshot::channel();
        pending.lock().unwrap().insert(7, pending_sender);
        let (cancel, cancel_rx) = watch::channel(false);
        {
            let mut state = socket.connection.lock().await;
            state.generation = 1;
            state.connection = Some(Connection {
                generation: 1,
                url: "ws://127.0.0.1/failing-writer".to_string(),
                out: out.clone(),
                pending: Arc::clone(&pending),
                next_id: 1,
                cancel,
                metadata: (),
            });
        }
        let failing_writer = sink::unfold((), |(), _message: Message| async { Err::<(), ()>(()) });
        let writer = tokio::spawn(run_writer(
            failing_writer,
            outbound,
            cancel_rx,
            Arc::clone(&socket.connection),
            1,
        ));

        out.send(Message::Text("request".to_string())).unwrap();
        writer.await.unwrap();

        assert!(pending_receiver.await.is_err());
        assert!(pending.lock().unwrap().is_empty());
        assert!(!socket.is_connected().await);
    }

    #[tokio::test]
    async fn cdp_vm_service_retirement_cancels_blocked_writer() {
        let socket = CorrelatedWebSocket::<()>::default();
        let (out, outbound) = mpsc::unbounded_channel();
        let (cancel, cancel_rx) = watch::channel(false);
        let (started, started_rx) = oneshot::channel();
        {
            let mut state = socket.connection.lock().await;
            state.generation = 1;
            state.connection = Some(Connection {
                generation: 1,
                url: "ws://127.0.0.1/blocked-writer".to_string(),
                out: out.clone(),
                pending: Arc::new(Mutex::new(HashMap::new())),
                next_id: 1,
                cancel,
                metadata: (),
            });
        }
        let blocked_writer = sink::unfold(Some(started), |started, _message: Message| async {
            if let Some(started) = started {
                started.send(()).unwrap();
            }
            future::pending::<Result<Option<oneshot::Sender<()>>, ()>>().await
        });
        let writer = tokio::spawn(run_writer(
            blocked_writer,
            outbound,
            cancel_rx,
            Arc::clone(&socket.connection),
            1,
        ));
        out.send(Message::Text("request".to_string())).unwrap();
        started_rx.await.unwrap();

        socket.disconnect().await;

        tokio::time::timeout(Duration::from_secs(1), writer)
            .await
            .expect("retirement should cancel a blocked writer")
            .unwrap();
    }

    #[tokio::test]
    async fn cdp_vm_service_timeout_removes_pending_request() {
        let socket = CorrelatedWebSocket::<()> {
            request_timeout: Duration::from_millis(20),
            ..Default::default()
        };
        let (out, _receiver) = mpsc::unbounded_channel();
        let pending = Arc::new(Mutex::new(HashMap::new()));
        {
            let mut state = socket.connection.lock().await;
            state.generation = 1;
            state.connection = Some(fake_connection(
                1,
                "ws://127.0.0.1/silent",
                out,
                Arc::clone(&pending),
                (),
            ));
        }

        let result = socket.request(|id| json!({ "id": id })).await;

        assert_eq!(result, Err(RequestError::Timeout));
        assert!(pending.lock().unwrap().is_empty());
        assert!(socket.is_connected().await);
    }

    #[tokio::test]
    async fn cdp_vm_service_receiver_disconnect_fails_in_flight_request() {
        let socket = Arc::new(CorrelatedWebSocket::<()> {
            request_timeout: Duration::from_secs(2),
            ..Default::default()
        });
        let (out, _receiver) = mpsc::unbounded_channel();
        let pending = Arc::new(Mutex::new(HashMap::new()));
        {
            let mut state = socket.connection.lock().await;
            state.generation = 1;
            state.connection = Some(fake_connection(
                1,
                "ws://127.0.0.1/pending",
                out,
                Arc::clone(&pending),
                (),
            ));
        }
        let request_socket = Arc::clone(&socket);
        let request =
            tokio::spawn(async move { request_socket.request(|id| json!({ "id": id })).await });
        let deadline = Instant::now() + Duration::from_secs(1);
        while pending.lock().unwrap().is_empty() && Instant::now() < deadline {
            tokio::task::yield_now().await;
        }
        assert_eq!(pending.lock().unwrap().len(), 1);

        socket.disconnect().await;

        assert_eq!(request.await.unwrap(), Err(RequestError::Disconnected));
        assert!(!socket.is_connected().await);
    }

    #[tokio::test]
    async fn cdp_vm_service_admission_allows_only_loopback_websockets() {
        for url in [
            "ws://127.0.0.1:8181/ws",
            "wss://[::1]:8181/ws",
            "ws://localhost:8181/ws",
        ] {
            assert!(guard_loopback_ws_url(url).await.is_ok(), "{url}");
        }
        for url in [
            "ws://0.0.0.0:8181/ws",
            "ws://169.254.169.254:8181/ws",
            "ws://8.8.8.8/ws",
            "http://127.0.0.1:8181/ws",
        ] {
            assert!(guard_loopback_ws_url(url).await.is_err(), "{url}");
        }
    }

    #[tokio::test]
    async fn cdp_vm_service_disconnect_supersedes_in_flight_handshake() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (accepted, accepted_rx) = oneshot::channel();
        let (release, release_rx) = oneshot::channel();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            accepted.send(()).unwrap();
            release_rx.await.unwrap();
            tokio_tungstenite::accept_async(stream).await.unwrap()
        });
        let socket = Arc::new(CorrelatedWebSocket::<()>::default());
        let connecting_socket = Arc::clone(&socket);
        let connect = tokio::spawn(async move {
            connecting_socket
                .connect(&format!("ws://{address}/ws"), (), |_| {})
                .await
        });
        accepted_rx.await.unwrap();

        socket.disconnect().await;
        release.send(()).unwrap();

        assert_eq!(connect.await.unwrap(), Err(ConnectError::Superseded));
        assert!(!socket.is_connected().await);
    }

    #[tokio::test]
    async fn cdp_vm_service_correlates_response_by_request_id() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut websocket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let Message::Text(request) = websocket.next().await.unwrap().unwrap() else {
                panic!("expected text request");
            };
            let request: Value = serde_json::from_str(&request).unwrap();
            websocket
                .send(Message::Text(
                    json!({ "id": request["id"], "result": "ok" }).to_string(),
                ))
                .await
                .unwrap();
        });
        let socket = CorrelatedWebSocket::<()>::default();
        socket
            .connect(&format!("ws://{address}/ws"), (), |_| {})
            .await
            .unwrap();

        let response = socket
            .request(|id| json!({ "id": id, "method": "get" }))
            .await
            .unwrap();

        assert_eq!(response["result"], "ok");
    }
}
