//! The local MCP endpoint, hosted inside the Tauri app.
//!
//! Transport: a Unix domain socket under `$XDG_RUNTIME_DIR/pickforge-<pid>/`
//! (temp-dir fallback), serving newline-delimited MCP JSON-RPC. The protocol +
//! tool logic live in `pickforge_core::mcp`; this file is the transport + the
//! bridge from the running app's live state to that logic.
//!
//! Live state model: the frontend is the source of truth for what is *active*
//! (selected target, device serial, current selection, project context, recent
//! run/log lines). It publishes a snapshot through `mcp_publish_state` /
//! `mcp_push_log` whenever those change. The socket server reads that snapshot
//! and, for screenshots, resolves a fresh device capture via the core ADB helper
//! (no extra app state needed). This keeps the existing 11 `vm_*` commands
//! untouched while the selection/logs stay genuinely live.
//!
//! Local-only: it binds a Unix socket on the same machine and never opens a
//! network listener. Opt-in: nothing is served until `mcp_start` is called (on a
//! run bind), and the socket file is removed on `mcp_stop`.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use pickforge_core::android;
use pickforge_core::mcp::{self, ActiveTarget, InspectorKind, LiveState, ProjectContext};
use pickforge_core::targets::Capability;
use pickforge_core::ContextStorageService;
use serde::Deserialize;
use serde_json::Value;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::Notify;

const MAX_LOG_LINES: usize = 2000;

/// The published, app-side view of the active target + context. Serialized from
/// the frontend stores; mirrors `runTargets.ts` / `runConsole` shapes.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedState {
    /// Active target id (e.g. "flutter", "native-android"); empty when none.
    #[serde(default)]
    pub target_id: String,
    #[serde(default)]
    pub target_label: String,
    /// camelCase capability names from the target (`inspectSelection`, …).
    #[serde(default)]
    pub capabilities: Vec<String>,
    /// `vmService` | `uiAutomator` | `cdp` | `none`.
    #[serde(default)]
    pub inspector_kind: String,
    #[serde(default)]
    pub support_tier: String,
    /// adb serial of the active device, when one is selected.
    #[serde(default)]
    pub device_serial: Option<String>,
    #[serde(default)]
    pub project_root: Option<String>,
    #[serde(default)]
    pub context_dir: Option<String>,
    #[serde(default)]
    pub runs_dir: Option<String>,
    #[serde(default)]
    pub chats_dir: Option<String>,
    /// The live selection, already JSON-encoded by the frontend (the Flutter
    /// `WidgetNode` or the UIAutomator `A11yNode`), or null when nothing is
    /// selected. The frontend refreshes this as the selection changes.
    #[serde(default)]
    pub selection: Option<Value>,
}

/// Shared, mutable MCP state: the latest published snapshot + a run-log ring.
#[derive(Clone)]
pub struct McpState(Arc<McpInner>);

struct McpInner {
    published: Mutex<PublishedState>,
    logs: Mutex<VecDeque<String>>,
    /// The bound socket path, if a server is running.
    socket_path: Mutex<Option<PathBuf>>,
    /// Signals the running server task to stop.
    shutdown: Notify,
    running: Mutex<bool>,
}

impl McpState {
    pub fn new() -> Self {
        Self(Arc::new(McpInner {
            published: Mutex::new(PublishedState::default()),
            logs: Mutex::new(VecDeque::with_capacity(256)),
            socket_path: Mutex::new(None),
            shutdown: Notify::new(),
            running: Mutex::new(false),
        }))
    }

    fn set_published(&self, state: PublishedState) {
        *self.0.published.lock().unwrap() = state;
    }

    fn push_logs(&self, lines: Vec<String>) {
        let mut buf = self.0.logs.lock().unwrap();
        for line in lines {
            if buf.len() >= MAX_LOG_LINES {
                buf.pop_front();
            }
            buf.push_back(line);
        }
    }

    fn snapshot(&self) -> PublishedState {
        self.0.published.lock().unwrap().clone()
    }

    fn recent_logs(&self, limit: usize) -> Vec<String> {
        let buf = self.0.logs.lock().unwrap();
        let n = limit.min(buf.len());
        buf.iter().skip(buf.len() - n).cloned().collect()
    }
}

impl Default for McpState {
    fn default() -> Self {
        Self::new()
    }
}

/// A read-only [`LiveState`] view over one snapshot, for a single request. The
/// screenshot path resolves a device capture lazily through the core ADB helper.
struct SnapshotLiveState<'a> {
    state: &'a McpState,
    snapshot: PublishedState,
}

impl<'a> SnapshotLiveState<'a> {
    fn new(state: &'a McpState) -> Self {
        let snapshot = state.snapshot();
        Self { state, snapshot }
    }
}

/// Map a published capability string back to the core enum (camelCase wire).
fn capability_from_wire(s: &str) -> Option<Capability> {
    Some(match s {
        "detect" => Capability::Detect,
        "launch" => Capability::Launch,
        "stop" => Capability::Stop,
        "hotReload" => Capability::HotReload,
        "hotRestart" => Capability::HotRestart,
        "captureScreenshot" => Capability::CaptureScreenshot,
        "streamLogs" => Capability::StreamLogs,
        "inspectSelection" => Capability::InspectSelection,
        "mapSelectionToSource" => Capability::MapSelectionToSource,
        "exposeMcpTools" => Capability::ExposeMcpTools,
        _ => return None,
    })
}

impl LiveState for SnapshotLiveState<'_> {
    fn active_target(&self) -> Option<ActiveTarget> {
        if self.snapshot.target_id.is_empty() {
            return None;
        }
        Some(ActiveTarget {
            id: self.snapshot.target_id.clone(),
            label: self.snapshot.target_label.clone(),
            capabilities: self
                .snapshot
                .capabilities
                .iter()
                .filter_map(|c| capability_from_wire(c))
                .collect(),
            inspector_kind: InspectorKind::from_wire(&self.snapshot.inspector_kind),
        })
    }

    fn project_context(&self) -> ProjectContext {
        ProjectContext {
            project_root: self.snapshot.project_root.clone(),
            context_dir: self.snapshot.context_dir.clone(),
            runs_dir: self.snapshot.runs_dir.clone(),
            chats_dir: self.snapshot.chats_dir.clone(),
            support_tier: self.snapshot.support_tier.clone(),
        }
    }

    fn flutter_selection(&self) -> Result<Option<Value>, String> {
        // The frontend publishes the live VM-Service selection into the snapshot
        // (it already re-reads it each frame while select mode is on).
        Ok(self.snapshot.selection.clone().filter(|v| !v.is_null()))
    }

    fn uiautomator_selection(&self) -> Result<Option<Value>, String> {
        Ok(self.snapshot.selection.clone().filter(|v| !v.is_null()))
    }

    fn capture_screenshot(&self) -> Result<Option<String>, String> {
        // A live capture via the core ADB helper, written into the context dir so
        // the agent can read it regardless of cwd. Reuses `adb_screenshot`'s path.
        let serial = self
            .snapshot
            .device_serial
            .clone()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "no active device".to_string())?;
        let dir = self
            .snapshot
            .context_dir
            .clone()
            .or_else(|| self.snapshot.project_root.clone())
            .ok_or_else(|| "no context directory resolved".to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let name = format!("mcp-screenshot-{}.png", now_millis());
        Ok(android::capture_screenshot(&serial, &dir, &name))
    }

    fn run_logs(&self, limit: usize) -> Vec<String> {
        self.state.recent_logs(limit)
    }
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Default socket path: `$XDG_RUNTIME_DIR/pickforge-<pid>/agent.sock`, falling
/// back to the system temp dir when `XDG_RUNTIME_DIR` is unset.
fn default_socket_path() -> PathBuf {
    let base = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join(format!("pickforge-{}", std::process::id())).join("agent.sock")
}

// ---- Tauri commands ----

/// Publish the active-target / context snapshot the MCP tools gate against.
#[tauri::command]
pub fn mcp_publish_state(state: State<'_, McpState>, snapshot: PublishedState) {
    state.set_published(snapshot);
}

/// Append run-console / logcat lines to the MCP run-log ring buffer.
#[tauri::command]
pub fn mcp_push_log(state: State<'_, McpState>, lines: Vec<String>) {
    state.push_logs(lines);
}

/// What `mcp_start` returns: the live socket endpoint plus the resolved storage
/// dirs, so the frontend can both inject `PICKFORGE_IPC_ENDPOINT` and publish the
/// accurate context/runs/chats dirs without re-resolving storage itself.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStartResult {
    pub endpoint: String,
    pub context_dir: String,
    pub runs_dir: String,
    pub chats_dir: String,
}

/// Start the MCP socket server (idempotent). Resolves `project_root`'s storage
/// layout, binds the Unix socket, writes the endpoint to
/// `<context_dir>/ipc.sock-path` (the documented discovery file), and returns the
/// endpoint + storage dirs. The caller injects `PICKFORGE_IPC_ENDPOINT` /
/// `PICKFORGE_CONTEXT_DIR` into embedded terminals. No-op if already running.
#[tauri::command]
pub async fn mcp_start(
    state: State<'_, McpState>,
    project_root: String,
) -> Result<McpStartResult, String> {
    // Resolve (and create) the project's storage layout — the source of truth for
    // where the discovery file and context artifacts live.
    let resolved = ContextStorageService::new()
        .ensure(&project_root, None)
        .map_err(|e| e.to_string())?;

    let already = {
        let mut running = state.0.running.lock().unwrap();
        let was = *running;
        *running = true;
        was
    };

    let path = if already {
        state
            .0
            .socket_path
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "MCP server flagged running but has no socket".to_string())?
    } else {
        let path = default_socket_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // A stale socket from a previous (crashed) run blocks bind — clear it.
        let _ = std::fs::remove_file(&path);
        let listener = UnixListener::bind(&path).map_err(|e| {
            *state.0.running.lock().unwrap() = false;
            format!("cannot bind MCP socket at {}: {e}", path.display())
        })?;
        *state.0.socket_path.lock().unwrap() = Some(path.clone());

        let inner = state.0.clone();
        let server_state = McpState(inner.clone());
        tauri::async_runtime::spawn(async move {
            serve(listener, server_state, inner).await;
        });
        path
    };

    // Write the discovery file so adapters launched outside the embedded terminal
    // (no `PICKFORGE_IPC_ENDPOINT`) can still find the live socket.
    let endpoint = path.to_string_lossy().into_owned();
    let _ = std::fs::write(resolved.ipc_sock_path(), &endpoint);

    Ok(McpStartResult {
        endpoint,
        context_dir: resolved.context_dir,
        runs_dir: resolved.runs_dir,
        chats_dir: resolved.chats_dir,
    })
}

/// Stop the MCP server and remove its socket file. Safe to call when stopped.
#[tauri::command]
pub fn mcp_stop(state: State<'_, McpState>) {
    let was_running = {
        let mut running = state.0.running.lock().unwrap();
        std::mem::replace(&mut *running, false)
    };
    if was_running {
        state.0.shutdown.notify_waiters();
    }
    if let Some(path) = state.0.socket_path.lock().unwrap().take() {
        let _ = std::fs::remove_file(path);
    }
}

/// Accept loop: each connection is handled concurrently, framing newline-
/// delimited JSON-RPC and dispatching to the core MCP handler. Ends on shutdown.
///
/// The shutdown future is created ONCE and pinned before the loop: `notified()`
/// registers interest immediately, so a `mcp_stop` that fires while this loop is
/// busy spawning a connection (not currently in the `select!`) is still observed
/// on the next poll — it is not lost the way a fresh per-iteration `notified()`
/// would be.
async fn serve(listener: UnixListener, state: McpState, inner: Arc<McpInner>) {
    let shutdown = inner.shutdown.notified();
    tokio::pin!(shutdown);
    loop {
        tokio::select! {
            _ = &mut shutdown => break,
            accepted = listener.accept() => match accepted {
                Ok((stream, _addr)) => {
                    let conn_state = state.clone();
                    tauri::async_runtime::spawn(handle_conn(stream, conn_state));
                }
                Err(_) => break, // listener gone
            },
        }
    }
    // Drop the listener so the bound socket inode is released even if `mcp_stop`
    // already unlinked the path, then best-effort remove the discovery socket.
    drop(listener);
    if let Some(path) = inner.socket_path.lock().unwrap().take() {
        let _ = std::fs::remove_file(path);
    }
}

async fn handle_conn(stream: tokio::net::UnixStream, state: McpState) {
    let (rx, mut tx) = stream.into_split();
    let mut lines = BufReader::new(rx).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        // Build a fresh snapshot view per request so live state is current, and
        // resolve a blocking screenshot off the async runtime when one is asked.
        let state = state.clone();
        let reply = tokio::task::spawn_blocking(move || {
            let live = SnapshotLiveState::new(&state);
            mcp::handle_line(&live, &line)
        })
        .await
        .ok()
        .flatten();
        if let Some(mut reply) = reply {
            reply.push('\n');
            if tx.write_all(reply.as_bytes()).await.is_err() {
                break;
            }
            let _ = tx.flush().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn published_state_deserializes_camel_case() {
        let s: PublishedState = serde_json::from_value(json!({
            "targetId": "flutter",
            "targetLabel": "Flutter",
            "capabilities": ["inspectSelection", "captureScreenshot"],
            "inspectorKind": "vmService",
            "supportTier": "deep",
            "deviceSerial": "emulator-5554",
            "projectRoot": "/p",
            "contextDir": "/c",
            "selection": { "className": "Text" }
        }))
        .unwrap();
        assert_eq!(s.target_id, "flutter");
        assert_eq!(s.capabilities.len(), 2);
        assert_eq!(s.device_serial.as_deref(), Some("emulator-5554"));
        assert_eq!(s.selection.unwrap()["className"], json!("Text"));
    }

    #[test]
    fn snapshot_live_state_maps_capabilities_and_inspector() {
        let st = McpState::new();
        st.set_published(PublishedState {
            target_id: "native-android".into(),
            target_label: "Native Android".into(),
            capabilities: vec!["inspectSelection".into(), "streamLogs".into()],
            inspector_kind: "uiAutomator".into(),
            support_tier: "useful".into(),
            selection: Some(json!({ "className": "android.widget.Button" })),
            ..Default::default()
        });
        let live = SnapshotLiveState::new(&st);
        let target = live.active_target().unwrap();
        assert_eq!(target.id, "native-android");
        assert!(target.has(Capability::InspectSelection));
        assert_eq!(target.inspector_kind, InspectorKind::UiAutomator);
        // UIAutomator selection comes straight from the published snapshot.
        let sel = live.uiautomator_selection().unwrap().unwrap();
        assert_eq!(sel["className"], json!("android.widget.Button"));
    }

    #[test]
    fn no_target_yields_none() {
        let st = McpState::new();
        let live = SnapshotLiveState::new(&st);
        assert!(live.active_target().is_none());
    }

    #[test]
    fn log_ring_caps_and_orders() {
        let st = McpState::new();
        st.push_logs((0..(MAX_LOG_LINES + 50)).map(|i| format!("l{i}")).collect());
        let recent = st.recent_logs(10);
        assert_eq!(recent.len(), 10);
        // Newest preserved; oldest evicted.
        assert_eq!(recent.last().unwrap(), &format!("l{}", MAX_LOG_LINES + 49));
        let all = st.recent_logs(MAX_LOG_LINES * 2);
        assert_eq!(all.len(), MAX_LOG_LINES);
    }

    #[test]
    fn screenshot_unavailable_without_a_device() {
        let st = McpState::new();
        st.set_published(PublishedState {
            target_id: "flutter".into(),
            capabilities: vec!["captureScreenshot".into()],
            inspector_kind: "vmService".into(),
            context_dir: Some("/tmp".into()),
            ..Default::default()
        });
        let live = SnapshotLiveState::new(&st);
        // No device serial → an Err (genuine failure to capture).
        assert!(live.capture_screenshot().is_err());
    }
}
