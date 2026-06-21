//! Minimal Chrome DevTools Protocol (CDP) client for the web inspector.
//!
//! A web dev server run with a Chromium-based browser exposes a debugger over
//! HTTP+WebSocket. This module:
//!   1. discovers the page target via `GET http://<host>:<port>/json` (or
//!      `/json/list`) — the standard CDP target list;
//!   2. opens the target's `webSocketDebuggerUrl` and speaks CDP's JSON-RPC 2.0
//!      envelope (hand-rolled, like `vm_service.rs`);
//!   3. supports the few methods the inspector needs: `DOM.getDocument`,
//!      `DOM.getAttributes` (to read framework source attributes), and
//!      `Debugger.getScriptSource` (paired with the page's source maps).
//!
//! Source-position → authored-position mapping is done by `source_map.rs`; this
//! module only fetches the bytes. Everything is best-effort: a target that isn't
//! reachable, or a node with no source attribute, degrades to an honest empty /
//! "no exact source" result rather than an error path.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex};
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, thiserror::Error)]
pub enum CdpError {
    #[error("not attached to a CDP target")]
    NotAttached,
    #[error("CDP request timed out")]
    Timeout,
    #[error("CDP error: {0}")]
    Rpc(String),
    #[error("no debuggable page target at {0}")]
    NoTarget(String),
    #[error("websocket error: {0}")]
    WebSocket(String),
    #[error("discovery error: {0}")]
    Discovery(String),
    /// A target host/URL that isn't loopback, or a request path carrying CR/LF.
    /// The CDP client only ever talks to a local dev server, so anything else is
    /// refused before a socket is opened — closing SSRF and header-injection.
    #[error("forbidden CDP target: {0}")]
    Forbidden(String),
}

/// One discovered CDP target (a tab / page) from `/json`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdpTarget {
    #[serde(default)]
    pub id: String,
    #[serde(default, rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub web_socket_debugger_url: String,
}

type Pending = Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>;
type ConnSlot = Arc<AsyncMutex<Option<Conn>>>;

struct Conn {
    /// Monotonic id of this attach; reader/writer clear the slot only if it
    /// still holds *their* generation (a remote close mustn't tear down a newer
    /// reattach). Same pattern as `vm_service.rs`.
    generation: u64,
    target_url: String,
    out: mpsc::UnboundedSender<Message>,
    pending: Pending,
    next_id: AtomicI64,
}

/// A live CDP attachment (or none). Lives behind Tauri's managed `State`.
#[derive(Default)]
pub struct CdpClient {
    conn: ConnSlot,
    generation: AtomicU64,
}

async fn clear_connection(slot: &ConnSlot, generation: u64) {
    let mut guard = slot.lock().await;
    if guard.as_ref().map(|c| c.generation) == Some(generation) {
        if let Some(conn) = guard.take() {
            conn.pending.lock().unwrap().clear();
        }
    }
}

impl CdpClient {
    pub fn new() -> Self {
        Self::default()
    }

    /// Fetch a path over plain HTTP from `host:port` (the dev server) and return
    /// the body — used to pull a script's `.map` so `source_map.rs` can resolve a
    /// generated position. Best-effort: a non-2xx / unreachable map is an error
    /// the caller treats as "no exact source".
    pub async fn fetch_text(host: &str, port: u16, path: &str) -> Result<String, CdpError> {
        http_get_json(host, port, path).await
    }

    /// Discover the debuggable page targets on `host:port` via `GET /json`
    /// (falling back to `/json/list`). Returns only `type: "page"` targets that
    /// expose a `webSocketDebuggerUrl` — the ones we can attach to.
    pub async fn discover(host: &str, port: u16) -> Result<Vec<CdpTarget>, CdpError> {
        let body = match http_get_json(host, port, "/json").await {
            Ok(b) => b,
            Err(_) => http_get_json(host, port, "/json/list").await?,
        };
        let parsed: Vec<CdpTarget> = serde_json::from_str(&body)
            .map_err(|e| CdpError::Discovery(format!("malformed /json: {e}")))?;
        Ok(parsed
            .into_iter()
            .filter(|t| t.kind == "page" && !t.web_socket_debugger_url.is_empty())
            .collect())
    }

    /// Attach to a target by its `webSocketDebuggerUrl`, replacing any existing
    /// attachment. The URL's host must resolve to loopback — a compromised
    /// renderer must not be able to point the CDP client at an arbitrary host.
    pub async fn attach(&self, ws_url: &str) -> Result<(), CdpError> {
        guard_ws_url_loopback(ws_url).await?;
        let (ws, _) = tokio_tungstenite::connect_async(ws_url)
            .await
            .map_err(|e| CdpError::WebSocket(e.to_string()))?;
        let (mut write, mut read) = ws.split();
        let (out, mut out_rx) = mpsc::unbounded_channel::<Message>();
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;

        let pending_read = Arc::clone(&pending);
        *self.conn.lock().await = Some(Conn {
            generation,
            target_url: ws_url.to_string(),
            out,
            pending,
            next_id: AtomicI64::new(1),
        });

        // Writer: drain the outbound queue to the socket.
        let slot_write = Arc::clone(&self.conn);
        tokio::spawn(async move {
            while let Some(msg) = out_rx.recv().await {
                if write.send(msg).await.is_err() {
                    break;
                }
            }
            clear_connection(&slot_write, generation).await;
        });

        // Reader: route id'd responses to their pending sender. CDP events
        // (no `id`, a `method`) are not needed by the inspector, so they're
        // dropped — keeping the method set minimal.
        let slot_read = Arc::clone(&self.conn);
        tokio::spawn(async move {
            while let Some(Ok(msg)) = read.next().await {
                if let Message::Text(txt) = msg {
                    if let Ok(value) = serde_json::from_str::<Value>(&txt) {
                        if let Some(id) = value.get("id").and_then(Value::as_i64) {
                            if let Some(tx) = pending_read.lock().unwrap().remove(&id) {
                                let _ = tx.send(value);
                            }
                        }
                    }
                }
            }
            clear_connection(&slot_read, generation).await;
        });

        Ok(())
    }

    /// Issue a CDP JSON-RPC call and await `result`. CDP frames are
    /// `{ id, method, params }` → `{ id, result | error }`.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, CdpError> {
        let (out, pending, id) = {
            let guard = self.conn.lock().await;
            let conn = guard.as_ref().ok_or(CdpError::NotAttached)?;
            let id = conn.next_id.fetch_add(1, Ordering::Relaxed);
            (conn.out.clone(), Arc::clone(&conn.pending), id)
        };

        let (tx, rx) = oneshot::channel();
        pending.lock().unwrap().insert(id, tx);
        let req = json!({ "id": id, "method": method, "params": params });
        if out.send(Message::Text(req.to_string())).is_err() {
            pending.lock().unwrap().remove(&id);
            return Err(CdpError::NotAttached);
        }

        let resp = match tokio::time::timeout(Duration::from_secs(10), rx).await {
            Ok(Ok(v)) => v,
            Ok(Err(_)) => return Err(CdpError::NotAttached),
            Err(_) => {
                pending.lock().unwrap().remove(&id);
                return Err(CdpError::Timeout);
            }
        };
        parse_cdp_result(resp)
    }

    pub async fn detach(&self) {
        *self.conn.lock().await = None;
    }

    pub async fn is_attached(&self) -> bool {
        self.conn.lock().await.is_some()
    }

    pub async fn current_url(&self) -> Option<String> {
        self.conn.lock().await.as_ref().map(|c| c.target_url.clone())
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

    /// Test seam: install an attachment whose outbound receiver is already
    /// dropped, so the next `call()` hits the send-error path (mirrors the
    /// vm_service leak test).
    #[cfg(test)]
    async fn install_dead_writer_conn(&self) {
        let (out, out_rx) = mpsc::unbounded_channel::<Message>();
        drop(out_rx);
        let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
        *self.conn.lock().await = Some(Conn {
            generation,
            target_url: "ws://dead/devtools".to_string(),
            out,
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicI64::new(1),
        });
    }
}

/// Extract `result` from a CDP response frame, surfacing a CDP `error` as
/// [`CdpError::Rpc`]. Pure — fixture-testable without a live browser.
fn parse_cdp_result(resp: Value) -> Result<Value, CdpError> {
    if let Some(err) = resp.get("error") {
        let msg = err
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| err.to_string());
        return Err(CdpError::Rpc(msg));
    }
    Ok(resp.get("result").cloned().unwrap_or(Value::Null))
}

// ---- DOM model -------------------------------------------------------------

/// A DOM node distilled from CDP's `DOM.getDocument` tree for the inspector.
/// Mirrors the shape the UI tree renders (id + tag + attributes + children),
/// kept deliberately small.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DomNode {
    /// CDP `nodeId` as a string (the UI keys rows by it).
    pub node_id: String,
    /// `backendNodeId` — stable across `getDocument` calls; used for selection.
    pub backend_node_id: String,
    /// Lowercased tag name (e.g. "div"), or a synthetic name for non-elements.
    pub tag: String,
    /// `id` attribute, if any.
    pub id: Option<String>,
    /// `class` attribute, if any.
    pub class: Option<String>,
    /// A framework-injected source attribute (`data-*`) when present — the
    /// best-effort bridge from a DOM node to authored source.
    pub source_attr: Option<String>,
    /// Trimmed text content for leaf text nodes (truncated).
    pub text: Option<String>,
    pub children: Vec<DomNode>,
}

/// Attributes that frameworks inject pointing at authored source. Read in
/// order; the first present wins. (`data-v-inspector` — Vue; the rest — various
/// React/SWC/Babel "click-to-source" plugins.)
const SOURCE_ATTRS: &[&str] = &[
    "data-v-inspector",
    "data-inspector-relative-path",
    "data-source",
    "data-sourcefile",
    "data-fp", // some plugins emit "file:line:col"
];

/// CDP attribute arrays are a flat `[name, value, name, value, …]` list. Pull
/// the source attribute (first match in [`SOURCE_ATTRS`]) plus id/class.
fn read_attrs(flat: &[Value]) -> (Option<String>, Option<String>, Option<String>) {
    let mut id = None;
    let mut class = None;
    let mut source_attr = None;
    let mut i = 0;
    while i + 1 < flat.len() {
        let name = flat[i].as_str().unwrap_or("");
        let value = flat[i + 1].as_str().unwrap_or("");
        match name {
            "id" => id = Some(value.to_string()),
            "class" => class = Some(value.to_string()),
            n if source_attr.is_none() && SOURCE_ATTRS.contains(&n) => {
                source_attr = Some(value.to_string());
            }
            _ => {}
        }
        i += 2;
    }
    (id, class, source_attr)
}

/// The child containers `DOM.getDocument({ pierce: true })` exposes. Besides the
/// plain `children`, a pierced dump puts shadow trees under `shadowRoots` and an
/// `<iframe>`/`<object>`'s subtree under `contentDocument`, none of which appear
/// in `children`. Walk all three so web-component / framed subtrees aren't
/// dropped. Returns an iterator over the child `Value`s in source order.
fn child_nodes(node: &Value) -> impl Iterator<Item = &Value> {
    let plain = node.get("children").and_then(Value::as_array);
    let shadow = node.get("shadowRoots").and_then(Value::as_array);
    let content = node.get("contentDocument");
    plain
        .into_iter()
        .flatten()
        .chain(shadow.into_iter().flatten())
        .chain(content)
}

/// Decode a `DOM.getDocument` (or a node within it) into our [`DomNode`]. Pure
/// + fixture-testable. Element nodes (`nodeType == 1`) become rows; text nodes
/// fold their content into the parent's `text`; everything else is skipped.
///
/// `DOM.getDocument` returns the `#document` node (`nodeType == 9`), not the
/// `<html>` element, so a document — or a document fragment / shadow root
/// (`nodeType == 11`), which has no element of its own — is unwrapped to its
/// first decodable element child. A missing/empty document (page not loaded,
/// target detached) yields `None`, which the UI renders as an honest empty
/// state rather than a panic or a bogus tree.
pub fn decode_dom_node(node: &Value) -> Option<DomNode> {
    let node_type = node.get("nodeType").and_then(Value::as_i64).unwrap_or(0);
    if node_type == 9 || node_type == 11 {
        return child_nodes(node).find_map(decode_dom_node);
    }
    if node_type != 1 {
        return None; // not an element — handled as text by the parent
    }
    let node_id = node
        .get("nodeId")
        .and_then(Value::as_i64)
        .map(|n| n.to_string())
        .unwrap_or_default();
    let backend_node_id = node
        .get("backendNodeId")
        .and_then(Value::as_i64)
        .map(|n| n.to_string())
        .unwrap_or_default();
    let tag = node
        .get("nodeName")
        .and_then(Value::as_str)
        .unwrap_or("node")
        .to_lowercase();
    let attrs = node
        .get("attributes")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let (id, class, source_attr) = read_attrs(attrs);

    let mut children = Vec::new();
    let mut text: Option<String> = None;
    for kid in child_nodes(node) {
        let kt = kid.get("nodeType").and_then(Value::as_i64).unwrap_or(0);
        if kt == 3 {
            // Text node: fold the first non-empty run into this element.
            if text.is_none() {
                if let Some(v) = kid.get("nodeValue").and_then(Value::as_str) {
                    let t = v.trim();
                    if !t.is_empty() {
                        text = Some(t.chars().take(120).collect());
                    }
                }
            }
        } else if let Some(child) = decode_dom_node(kid) {
            children.push(child);
        }
    }

    Some(DomNode {
        node_id,
        backend_node_id,
        tag,
        id,
        class,
        source_attr,
        text,
        children,
    })
}

/// Find a node (and its ancestor chain, root-first inclusive) by `node_id`.
pub fn find_node_path<'a>(root: &'a DomNode, node_id: &str) -> Option<Vec<&'a DomNode>> {
    fn walk<'a>(n: &'a DomNode, id: &str, acc: &mut Vec<&'a DomNode>) -> bool {
        acc.push(n);
        if n.node_id == id {
            return true;
        }
        for c in &n.children {
            if walk(c, id, acc) {
                return true;
            }
        }
        acc.pop();
        false
    }
    let mut acc = Vec::new();
    if walk(root, node_id, &mut acc) {
        Some(acc)
    } else {
        None
    }
}

// ---- Loopback / injection guards -------------------------------------------

/// Reject a string that carries a CR or LF before it's formatted into an HTTP
/// request line / header — the standard header-injection vector.
fn reject_crlf(s: &str, what: &str) -> Result<(), CdpError> {
    if s.contains('\r') || s.contains('\n') {
        return Err(CdpError::Forbidden(format!("{what} contains CR/LF")));
    }
    Ok(())
}

/// Accept `host` only if it resolves *exclusively* to loopback addresses. A bare
/// `127.0.0.1` / `::1` is loopback by inspection; anything else (including the
/// `localhost` name) is resolved and every resulting address must be loopback —
/// so a renderer can't smuggle `127.0.0.1.evil.com`, `0.0.0.0`, a link-local
/// metadata IP (`169.254.169.254`), or a name whose DNS points off-box.
async fn guard_loopback_host(host: &str) -> Result<(), CdpError> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return if ip.is_loopback() {
            Ok(())
        } else {
            Err(CdpError::Forbidden(format!("non-loopback host: {host}")))
        };
    }

    // Hostname: resolve and require ALL addresses to be loopback. Port 0 is fine
    // here — `lookup_host` just needs a `host:port` to resolve.
    let mut addrs = tokio::net::lookup_host((host, 0))
        .await
        .map_err(|_| CdpError::Forbidden(format!("host does not resolve: {host}")))?
        .peekable();
    if addrs.peek().is_none() {
        return Err(CdpError::Forbidden(format!("host does not resolve: {host}")));
    }
    for addr in addrs {
        if !addr.ip().is_loopback() {
            return Err(CdpError::Forbidden(format!(
                "host {host} resolves to non-loopback {}",
                addr.ip()
            )));
        }
    }
    Ok(())
}

/// Validate a `webSocketDebuggerUrl` before attaching: it must be a `ws`/`wss`
/// URL whose host resolves to loopback. Closes the SSRF path on attach.
async fn guard_ws_url_loopback(ws_url: &str) -> Result<(), CdpError> {
    let url = url::Url::parse(ws_url)
        .map_err(|e| CdpError::Forbidden(format!("invalid ws url: {e}")))?;
    match url.scheme() {
        "ws" | "wss" => {}
        other => {
            return Err(CdpError::Forbidden(format!("unsupported ws scheme: {other}")));
        }
    }
    let host = url
        .host_str()
        .ok_or_else(|| CdpError::Forbidden("ws url has no host".into()))?;
    // `Url::host_str` already strips a `[..]` IPv6 wrapper, so this parses clean.
    guard_loopback_host(host).await
}

// ---- HTTP (just enough for /json discovery) --------------------------------

/// A bare HTTP/1.1 GET to `http://host:port/path`, returning the body. The CDP
/// discovery endpoint is a tiny localhost JSON response, so a full HTTP client
/// (and its dependency weight) is unwarranted — `tokio-tungstenite` already
/// pulls in `tokio::net`. Caps the body so a hostile endpoint can't OOM us.
async fn http_get_json(host: &str, port: u16, path: &str) -> Result<String, CdpError> {
    const MAX_BODY: usize = 4 * 1024 * 1024;
    // The renderer supplies host + path; both land in the request before a socket
    // is opened. CR/LF in either would inject extra HTTP headers, and a non-
    // loopback host would let a compromised renderer drive arbitrary outbound
    // connections (SSRF). Refuse both up front.
    reject_crlf(path, "request path")?;
    reject_crlf(host, "host")?;
    guard_loopback_host(host).await?;

    let mut stream = tokio::time::timeout(
        Duration::from_secs(5),
        TcpStream::connect((host, port)),
    )
    .await
    .map_err(|_| CdpError::Discovery("connect timed out".into()))?
    .map_err(|e| CdpError::Discovery(e.to_string()))?;

    let req = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(req.as_bytes())
        .await
        .map_err(|e| CdpError::Discovery(e.to_string()))?;

    let mut raw = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buf))
            .await
            .map_err(|_| CdpError::Discovery("read timed out".into()))?
            .map_err(|e| CdpError::Discovery(e.to_string()))?;
        if n == 0 {
            break;
        }
        raw.extend_from_slice(&buf[..n]);
        if raw.len() > MAX_BODY {
            return Err(CdpError::Discovery("response too large".into()));
        }
    }
    parse_http_body(&raw)
}

/// Split an HTTP/1.1 response into (status-line check) + body. CDP's endpoint
/// always returns the JSON in one shot with `Connection: close`, so we only
/// need to find the header/body boundary and confirm a 2xx status. Pure +
/// testable.
fn parse_http_body(raw: &[u8]) -> Result<String, CdpError> {
    let text = String::from_utf8_lossy(raw);
    let (head, body) = text
        .split_once("\r\n\r\n")
        .ok_or_else(|| CdpError::Discovery("no header/body boundary".into()))?;
    let status_ok = head
        .lines()
        .next()
        .map(|l| l.contains(" 200") || l.contains(" 2"))
        .unwrap_or(false);
    if !status_ok {
        let status = head.lines().next().unwrap_or("");
        return Err(CdpError::Discovery(format!("non-2xx status: {status}")));
    }
    Ok(body.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- JSON-RPC envelope ----

    #[test]
    fn parse_cdp_result_returns_result_payload() {
        let frame = json!({ "id": 7, "result": { "root": { "nodeId": 1 } } });
        let r = parse_cdp_result(frame).unwrap();
        assert_eq!(r["root"]["nodeId"], json!(1));
    }

    #[test]
    fn parse_cdp_result_surfaces_an_error() {
        let frame = json!({ "id": 7, "error": { "code": -32000, "message": "boom" } });
        let err = parse_cdp_result(frame).unwrap_err();
        assert!(matches!(err, CdpError::Rpc(m) if m == "boom"));
    }

    #[test]
    fn parse_cdp_result_missing_result_is_null() {
        let frame = json!({ "id": 1 });
        assert_eq!(parse_cdp_result(frame).unwrap(), Value::Null);
    }

    // ---- /json discovery parsing ----

    #[test]
    fn discovery_keeps_only_attachable_pages() {
        let body = r#"[
            {"id":"A","type":"page","title":"App","url":"http://localhost:5173/","webSocketDebuggerUrl":"ws://localhost:9222/devtools/page/A"},
            {"id":"B","type":"page","title":"No WS","url":"http://x/","webSocketDebuggerUrl":""},
            {"id":"C","type":"service_worker","title":"sw","url":"http://x/","webSocketDebuggerUrl":"ws://x"}
        ]"#;
        let parsed: Vec<CdpTarget> = serde_json::from_str(body).unwrap();
        let pages: Vec<_> = parsed
            .into_iter()
            .filter(|t| t.kind == "page" && !t.web_socket_debugger_url.is_empty())
            .collect();
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].id, "A");
        assert_eq!(pages[0].web_socket_debugger_url, "ws://localhost:9222/devtools/page/A");
    }

    // ---- HTTP body parsing ----

    #[test]
    fn parse_http_body_splits_on_2xx() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n[{\"id\":\"A\"}]";
        assert_eq!(parse_http_body(raw).unwrap(), "[{\"id\":\"A\"}]");
    }

    #[test]
    fn parse_http_body_rejects_non_2xx() {
        let raw = b"HTTP/1.1 404 Not Found\r\n\r\nnope";
        assert!(parse_http_body(raw).is_err());
    }

    // ---- DOM decode ----

    fn doc_fixture() -> Value {
        // A trimmed `DOM.getDocument` result: html > body > (div#app.card
        // [data-v-inspector="src/App.tsx:3:1"] > "Hi").
        json!({
            "nodeType": 1, "nodeId": 1, "backendNodeId": 10, "nodeName": "HTML",
            "children": [{
                "nodeType": 1, "nodeId": 2, "backendNodeId": 11, "nodeName": "BODY",
                "children": [{
                    "nodeType": 1, "nodeId": 3, "backendNodeId": 12, "nodeName": "DIV",
                    "attributes": ["id","app","class","card","data-v-inspector","src/App.tsx:3:1"],
                    "children": [
                        { "nodeType": 3, "nodeValue": "  Hi  " }
                    ]
                }]
            }]
        })
    }

    #[test]
    fn decode_dom_extracts_tag_id_class_source_and_text() {
        let root = decode_dom_node(&doc_fixture()).unwrap();
        assert_eq!(root.tag, "html");
        let body = &root.children[0];
        let div = &body.children[0];
        assert_eq!(div.tag, "div");
        assert_eq!(div.id.as_deref(), Some("app"));
        assert_eq!(div.class.as_deref(), Some("card"));
        assert_eq!(div.source_attr.as_deref(), Some("src/App.tsx:3:1"));
        assert_eq!(div.text.as_deref(), Some("Hi"));
        assert_eq!(div.node_id, "3");
        assert_eq!(div.backend_node_id, "12");
    }

    #[test]
    fn decode_dom_skips_non_elements_at_root() {
        let text_only = json!({ "nodeType": 3, "nodeValue": "x" });
        assert!(decode_dom_node(&text_only).is_none());
    }

    #[test]
    fn decode_dom_unwraps_the_document_root_to_html() {
        // `DOM.getDocument` returns the `#document` node (nodeType 9), not the
        // `<html>` element. The decoder must descend to `documentElement`,
        // otherwise a successful attach renders as an empty DOM.
        let document = json!({
            "nodeType": 9, "nodeId": 1, "nodeName": "#document",
            "children": [{
                "nodeType": 10, "nodeName": "html" // a DOCTYPE — must be skipped
            }, {
                "nodeType": 1, "nodeId": 2, "backendNodeId": 20, "nodeName": "HTML",
                "children": [{
                    "nodeType": 1, "nodeId": 3, "backendNodeId": 21, "nodeName": "BODY"
                }]
            }]
        });
        let root = decode_dom_node(&document).expect("document unwraps to <html>");
        assert_eq!(root.tag, "html");
        assert_eq!(root.children[0].tag, "body");
    }

    #[test]
    fn decode_dom_empty_document_root_is_none() {
        // Page not loaded / detached: a document with no element child must
        // degrade to None (empty state), never panic.
        let empty_doc = json!({ "nodeType": 9, "nodeId": 1, "nodeName": "#document" });
        assert!(decode_dom_node(&empty_doc).is_none());
        let only_doctype = json!({
            "nodeType": 9, "nodeId": 1, "nodeName": "#document",
            "children": [{ "nodeType": 10, "nodeName": "html" }]
        });
        assert!(decode_dom_node(&only_doctype).is_none());
    }

    #[test]
    fn decode_dom_pierces_shadow_roots_and_content_documents() {
        // With `pierce: true`, CDP hangs shadow trees off `shadowRoots` and an
        // <iframe>'s subtree off `contentDocument`, not `children`. Both must be
        // walked so web-component / framed UI isn't dropped.
        let host = json!({
            "nodeType": 1, "nodeId": 1, "backendNodeId": 10, "nodeName": "MY-WIDGET",
            "children": [
                { "nodeType": 1, "nodeId": 2, "backendNodeId": 11, "nodeName": "SPAN" }
            ],
            "shadowRoots": [{
                "nodeType": 11, "nodeId": 3, "nodeName": "#document-fragment",
                "children": [
                    { "nodeType": 1, "nodeId": 4, "backendNodeId": 13, "nodeName": "BUTTON",
                      "attributes": ["id","shadow-btn"] }
                ]
            }],
            "contentDocument": {
                "nodeType": 9, "nodeId": 5, "nodeName": "#document",
                "children": [
                    { "nodeType": 1, "nodeId": 6, "backendNodeId": 15, "nodeName": "IFRAME-BODY" }
                ]
            }
        });
        let root = decode_dom_node(&host).expect("element decodes");
        let tags: Vec<&str> = root.children.iter().map(|c| c.tag.as_str()).collect();
        // light-DOM span, then the shadow root's button, then the framed body.
        assert_eq!(tags, vec!["span", "button", "iframe-body"]);
        assert_eq!(root.children[1].id.as_deref(), Some("shadow-btn"));
    }

    #[test]
    fn find_node_path_returns_ancestor_chain() {
        let root = decode_dom_node(&doc_fixture()).unwrap();
        let path = find_node_path(&root, "3").unwrap();
        let tags: Vec<&str> = path.iter().map(|n| n.tag.as_str()).collect();
        assert_eq!(tags, vec!["html", "body", "div"]);
        assert!(find_node_path(&root, "999").is_none());
    }

    // ---- attach lifecycle (mirrors vm_service) ----

    #[tokio::test]
    async fn send_failure_does_not_leak_a_pending_id() {
        let client = CdpClient::new();
        client.install_dead_writer_conn().await;
        let result = client.call("DOM.getDocument", json!({})).await;
        assert!(matches!(result, Err(CdpError::NotAttached)));
        assert_eq!(client.pending_len().await, 0);
    }

    #[tokio::test]
    async fn call_without_attach_is_not_attached() {
        let client = CdpClient::new();
        assert!(!client.is_attached().await);
        assert!(matches!(
            client.call("DOM.getDocument", json!({})).await,
            Err(CdpError::NotAttached)
        ));
    }

    // ---- loopback allowlist + header-injection guards ----

    // The CDP client only ever talks to a local dev server. A compromised
    // renderer that hands us a non-loopback host must be refused before any
    // socket is opened — for discovery / source-map fetch AND for ws attach.
    #[tokio::test]
    async fn non_loopback_host_is_forbidden_for_discovery() {
        for host in ["169.254.169.254", "evil.com", "0.0.0.0", "8.8.8.8"] {
            let err = CdpClient::discover(host, 9222).await.unwrap_err();
            assert!(
                matches!(err, CdpError::Forbidden(_)),
                "discover({host}) should be Forbidden, got {err:?}"
            );
            // The source-map fetch shares the same HTTP path — also refused.
            let err = CdpClient::fetch_text(host, 9222, "/app.js.map").await.unwrap_err();
            assert!(
                matches!(err, CdpError::Forbidden(_)),
                "fetch_text({host}) should be Forbidden, got {err:?}"
            );
        }
    }

    #[tokio::test]
    async fn loopback_host_passes_the_guard() {
        // No server is listening, so these fail to connect — but with a
        // *connect/timeout* error, proving they cleared the loopback guard
        // (a Forbidden would mean the allowlist wrongly rejected loopback).
        for host in ["127.0.0.1", "::1", "localhost"] {
            let err = CdpClient::discover(host, 1).await.unwrap_err();
            assert!(
                !matches!(err, CdpError::Forbidden(_)),
                "loopback host {host} must pass the guard, got {err:?}"
            );
        }
    }

    #[tokio::test]
    async fn attach_rejects_non_loopback_ws_url() {
        let client = CdpClient::new();
        for ws in [
            "ws://evil.com:9222/devtools/page/A",
            "ws://169.254.169.254:9222/devtools/page/A",
            "ws://8.8.8.8/devtools/page/A",
        ] {
            let err = client.attach(ws).await.unwrap_err();
            assert!(
                matches!(err, CdpError::Forbidden(_)),
                "attach({ws}) should be Forbidden, got {err:?}"
            );
        }
        assert!(!client.is_attached().await);
    }

    #[tokio::test]
    async fn attach_rejects_non_ws_scheme() {
        let client = CdpClient::new();
        let err = client
            .attach("http://127.0.0.1:9222/devtools/page/A")
            .await
            .unwrap_err();
        assert!(matches!(err, CdpError::Forbidden(_)));
    }

    // A path / Host carrying CR-LF would inject extra HTTP headers; refuse it
    // before it reaches the request line.
    #[tokio::test]
    async fn crlf_in_path_is_forbidden() {
        let err = CdpClient::fetch_text("127.0.0.1", 9222, "/a\r\nX-Evil: 1")
            .await
            .unwrap_err();
        assert!(matches!(err, CdpError::Forbidden(_)), "got {err:?}");

        // Bare reject helper: CR or LF anywhere is refused, clean paths pass.
        assert!(reject_crlf("/json", "path").is_ok());
        assert!(reject_crlf("/a\rb", "path").is_err());
        assert!(reject_crlf("/a\nb", "path").is_err());
    }

    #[tokio::test]
    async fn guard_loopback_host_classifies_addresses() {
        assert!(guard_loopback_host("127.0.0.1").await.is_ok());
        assert!(guard_loopback_host("127.0.0.5").await.is_ok());
        assert!(guard_loopback_host("::1").await.is_ok());
        assert!(guard_loopback_host("169.254.169.254").await.is_err());
        assert!(guard_loopback_host("10.0.0.1").await.is_err());
    }
}
