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

use std::collections::{HashMap, VecDeque};
#[cfg(unix)]
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use pickforge_core::android;
use pickforge_core::is_on_user_path;
use pickforge_core::mcp::{self, ActiveTarget, InspectorKind, LiveState, ProjectContext};
use pickforge_core::targets::Capability;
use pickforge_core::ContextStorageService;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
#[cfg(unix)]
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(unix)]
use tokio::net::UnixListener;
use tokio::sync::{watch, Notify};

const MAX_LOG_LINES: usize = 2000;
const MAX_SWARM_AGENTS: u8 = 5;
const MAX_SWARM_RUNS: usize = 24;
#[cfg(not(unix))]
const MCP_SOCKET_UNSUPPORTED: &str = "MCP socket server is only supported on unix platforms";

/// The published, app-side view of the active target + context. Serialized from
/// the frontend stores; mirrors `runTargets.ts` / `runConsole` shapes.
#[derive(Debug, Clone, Deserialize)]
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
    /// `vmService` | `uiAutomator` | `iosAccessibility` | `cdp` | `none`.
    #[serde(default)]
    pub inspector_kind: String,
    #[serde(default)]
    pub support_tier: String,
    /// adb serial of the active device, when one is selected.
    #[serde(default)]
    pub device_serial: Option<String>,
    #[serde(default = "default_device_platform")]
    pub device_platform: String,
    #[serde(default)]
    pub project_root: Option<String>,
    #[serde(default)]
    pub active_chat_id: Option<String>,
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

impl Default for PublishedState {
    fn default() -> Self {
        Self {
            target_id: String::new(),
            target_label: String::new(),
            capabilities: Vec::new(),
            inspector_kind: String::new(),
            support_tier: String::new(),
            device_serial: None,
            device_platform: default_device_platform(),
            project_root: None,
            active_chat_id: None,
            context_dir: None,
            runs_dir: None,
            chats_dir: None,
            selection: None,
        }
    }
}

fn default_device_platform() -> String {
    "android".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmRequest {
    pub run_id: String,
    pub project_root: String,
    pub goal: String,
    pub count: u8,
    pub model: Option<String>,
    pub provider_preference: String,
    pub mode: String,
    pub source: String,
    #[serde(default)]
    pub origin_chat_id: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmLaneSnapshot {
    pub id: String,
    pub chat_id: Option<String>,
    pub provider: String,
    pub model: Option<String>,
    pub title: String,
    pub status: String,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmRunSnapshot {
    pub run_id: String,
    pub project_root: String,
    pub goal: String,
    pub requested_count: u8,
    pub model: Option<String>,
    pub provider_preference: String,
    pub mode: String,
    pub source: String,
    #[serde(default)]
    pub origin_chat_id: Option<String>,
    pub status: String,
    #[serde(default = "default_swarm_synthesis_status")]
    pub synthesis_status: String,
    #[serde(default)]
    pub synthesis_error: Option<String>,
    #[serde(default)]
    pub synthesized_at: Option<i64>,
    pub lanes: Vec<SwarmLaneSnapshot>,
    pub error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

fn default_swarm_synthesis_status() -> String {
    "idle".to_string()
}

/// One running server instance, owned by exactly one accept task. The
/// `generation` ties the bound socket to *this* task so a later server's socket
/// is never deleted by an earlier task's cleanup (the stop/restart race).
#[derive(Clone)]
struct RunningServer {
    generation: u64,
    socket_path: PathBuf,
    endpoint: String,
    /// Per-instance shutdown signal. Notifying it stops only THIS server's task.
    shutdown: Arc<Notify>,
}

/// Outcome a `Starting` bind broadcasts to concurrent waiters. A `watch` channel
/// (not `Notify`) carries it so a waiter that subscribes *before* releasing the
/// lifecycle lock can never miss the result: the latest value is always
/// observable, even if it was published before the waiter first polls — there is
/// no lost-wakeup window to reason about.
#[derive(Clone, Copy, PartialEq, Eq)]
enum StartPhase {
    /// The bind is still in flight.
    Pending,
    /// The bind finished (either `Running` now, or back to `Idle` on failure);
    /// waiters re-read the lifecycle to learn which.
    Settled,
}

/// The server lifecycle. Modeled as a state machine so a concurrent `mcp_start`
/// can never observe "running but no socket": it either reuses a `Running`
/// instance or waits on the in-flight `Starting` bind.
enum ServerLifecycle {
    Idle,
    /// A bind is in flight; concurrent starters subscribe to this channel and
    /// wait for `Settled`, then re-read the (now `Running` or `Idle`-on-failure)
    /// lifecycle.
    Starting(watch::Receiver<StartPhase>),
    Running(RunningServer),
}

impl ServerLifecycle {
    fn running(&self) -> Option<&RunningServer> {
        match self {
            ServerLifecycle::Running(s) => Some(s),
            _ => None,
        }
    }
}

/// Shared, mutable MCP state: the latest epoch-keyed projection plus swarm state.
#[derive(Clone)]
pub struct McpState(Arc<McpInner>);

struct McpProjection {
    generation: u64,
    project_root: Option<String>,
    publication_revision: u64,
    run_epoch: u64,
    published: PublishedState,
    logs: VecDeque<String>,
}

impl Default for McpProjection {
    fn default() -> Self {
        Self {
            generation: 0,
            project_root: None,
            publication_revision: 0,
            run_epoch: 0,
            published: PublishedState::default(),
            logs: VecDeque::with_capacity(256),
        }
    }
}

struct McpInner {
    projection: Mutex<McpProjection>,
    swarm_requests: Mutex<VecDeque<SwarmRequest>>,
    swarm_runs: Mutex<HashMap<String, SwarmRunSnapshot>>,
    /// The server lifecycle (Idle / Starting / Running).
    lifecycle: Mutex<ServerLifecycle>,
    /// Monotonic generation counter; each successful bind gets a fresh id.
    next_generation: AtomicU64,
    next_swarm_id: AtomicU64,
}

impl McpState {
    pub fn new() -> Self {
        Self(Arc::new(McpInner {
            projection: Mutex::new(McpProjection::default()),
            swarm_requests: Mutex::new(VecDeque::new()),
            swarm_runs: Mutex::new(HashMap::new()),
            lifecycle: Mutex::new(ServerLifecycle::Idle),
            next_generation: AtomicU64::new(1),
            next_swarm_id: AtomicU64::new(1),
        }))
    }

    fn activate_projection(&self, generation: u64, project_root: &str) -> bool {
        let mut projection = self.0.projection.lock().unwrap();
        if generation < projection.generation {
            return false;
        }
        if generation == projection.generation {
            return projection.project_root.as_deref() == Some(project_root);
        }
        projection.generation = generation;
        projection.project_root = Some(project_root.to_string());
        projection.publication_revision = 0;
        projection.run_epoch = 0;
        projection.published = PublishedState {
            project_root: Some(project_root.to_string()),
            ..Default::default()
        };
        projection.logs.clear();
        true
    }

    fn projection_is_active(&self, generation: u64, project_root: &str) -> bool {
        let projection = self.0.projection.lock().unwrap();
        projection.generation == generation
            && projection.project_root.as_deref() == Some(project_root)
    }

    fn publish_if_current(
        &self,
        generation: u64,
        publication_revision: u64,
        state: PublishedState,
    ) -> bool {
        let mut projection = self.0.projection.lock().unwrap();
        if projection.generation != generation
            || state.project_root.as_deref() != projection.project_root.as_deref()
            || publication_revision <= projection.publication_revision
        {
            return false;
        }
        projection.publication_revision = publication_revision;
        projection.published = state;
        true
    }

    fn append_logs_if_current(
        &self,
        generation: u64,
        run_epoch: u64,
        lines: Vec<String>,
    ) -> bool {
        let mut projection = self.0.projection.lock().unwrap();
        if projection.generation != generation
            || run_epoch == 0
            || run_epoch < projection.run_epoch
        {
            return false;
        }
        if run_epoch > projection.run_epoch {
            projection.run_epoch = run_epoch;
            projection.logs.clear();
        }
        for line in lines {
            if projection.logs.len() >= MAX_LOG_LINES {
                projection.logs.pop_front();
            }
            projection.logs.push_back(line);
        }
        true
    }

    /// Advance the run epoch and drop previous output. Equal epochs are an
    /// idempotent no-op so an append that arrives before its clear is preserved.
    fn start_run_if_current(&self, generation: u64, run_epoch: u64) -> bool {
        let mut projection = self.0.projection.lock().unwrap();
        if projection.generation != generation
            || run_epoch == 0
            || run_epoch < projection.run_epoch
        {
            return false;
        }
        if run_epoch > projection.run_epoch {
            projection.run_epoch = run_epoch;
            projection.logs.clear();
        }
        true
    }

    fn snapshot(&self) -> PublishedState {
        self.0.projection.lock().unwrap().published.clone()
    }

    fn recent_logs(&self, limit: usize) -> Vec<String> {
        let projection = self.0.projection.lock().unwrap();
        let n = limit.min(projection.logs.len());
        projection
            .logs
            .iter()
            .skip(projection.logs.len() - n)
            .cloned()
            .collect()
    }

    #[cfg(test)]
    fn set_published(&self, mut state: PublishedState) {
        let root = state.project_root.clone().unwrap_or_else(|| "/test".to_string());
        state.project_root = Some(root.clone());
        let (generation, revision) = {
            let projection = self.0.projection.lock().unwrap();
            let generation = if projection.project_root.as_deref() == Some(&root) {
                projection.generation.max(1)
            } else {
                projection.generation + 1
            };
            (generation, projection.publication_revision + 1)
        };
        assert!(self.activate_projection(generation, &root));
        assert!(self.publish_if_current(generation, revision, state));
    }

    #[cfg(test)]
    fn push_logs(&self, lines: Vec<String>) {
        let (generation, root, run_epoch) = {
            let projection = self.0.projection.lock().unwrap();
            (
                projection.generation.max(1),
                projection.project_root.clone().unwrap_or_else(|| "/test".to_string()),
                projection.run_epoch.max(1),
            )
        };
        assert!(self.activate_projection(generation, &root));
        assert!(self.append_logs_if_current(generation, run_epoch, lines));
    }

    #[cfg(test)]
    fn clear_logs(&self) {
        let (generation, run_epoch) = {
            let projection = self.0.projection.lock().unwrap();
            (projection.generation, projection.run_epoch + 1)
        };
        assert!(self.start_run_if_current(generation, run_epoch));
    }

    fn enqueue_swarm_request(
        &self,
        project_root: String,
        origin_chat_id: Option<String>,
        args: &Value,
    ) -> Result<Value, String> {
        let goal = string_arg(args, "goal")
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| "missing swarm goal".to_string())?;
        let count = args
            .get("count")
            .and_then(Value::as_u64)
            .map(|n| n.clamp(1, MAX_SWARM_AGENTS as u64) as u8)
            .unwrap_or(3);
        let model = string_arg(args, "model").filter(|s| !s.trim().is_empty());
        let provider_preference = enum_arg(
            args,
            "providerPreference",
            &["auto", "mixed", "claudeCode", "codex"],
            "mixed",
        );
        let mode = enum_arg(args, "mode", &["scout", "review"], "scout");
        let created_at = now_millis_i64();
        let seq = self.0.next_swarm_id.fetch_add(1, Ordering::SeqCst);
        let run_id = format!("swarm-{created_at}-{seq}");
        let request = SwarmRequest {
            run_id: run_id.clone(),
            project_root: project_root.clone(),
            goal: goal.trim().to_string(),
            count,
            model,
            provider_preference,
            mode,
            source: "mcp".to_string(),
            origin_chat_id,
            created_at,
        };
        let run = SwarmRunSnapshot {
            run_id: run_id.clone(),
            project_root,
            goal: request.goal.clone(),
            requested_count: count,
            model: request.model.clone(),
            provider_preference: request.provider_preference.clone(),
            mode: request.mode.clone(),
            source: request.source.clone(),
            origin_chat_id: request.origin_chat_id.clone(),
            status: "queued".to_string(),
            synthesis_status: "idle".to_string(),
            synthesis_error: None,
            synthesized_at: None,
            lanes: Vec::new(),
            error: None,
            created_at,
            updated_at: created_at,
        };
        self.insert_swarm_run(run);
        self.0.swarm_requests.lock().unwrap().push_back(request);
        Ok(serde_json::json!({
            "accepted": true,
            "runId": run_id,
            "status": "queued",
            "maxAgents": MAX_SWARM_AGENTS,
        }))
    }

    fn insert_swarm_run(&self, run: SwarmRunSnapshot) {
        let mut runs = self.0.swarm_runs.lock().unwrap();
        if runs
            .get(&run.run_id)
            .map(|existing| existing.status == "cancelled" && run.status != "cancelled")
            .unwrap_or(false)
        {
            return;
        }
        runs.insert(run.run_id.clone(), run);
        if runs.len() <= MAX_SWARM_RUNS {
            return;
        }
        let mut ids: Vec<(String, i64)> =
            runs.values().map(|r| (r.run_id.clone(), r.created_at)).collect();
        ids.sort_by_key(|(_, created_at)| *created_at);
        for (id, _) in ids.into_iter().take(runs.len() - MAX_SWARM_RUNS) {
            runs.remove(&id);
        }
    }

    fn take_swarm_requests(&self) -> Vec<SwarmRequest> {
        self.0.swarm_requests.lock().unwrap().drain(..).collect()
    }

    fn update_swarm_run(&self, run: SwarmRunSnapshot) {
        self.insert_swarm_run(run);
    }

    fn swarm_status_value(
        &self,
        project_root: Option<&str>,
        run_id: Option<&str>,
    ) -> Result<Value, String> {
        let runs = self.0.swarm_runs.lock().unwrap();
        if let Some(run_id) = run_id {
            let run = runs
                .get(run_id)
                .ok_or_else(|| format!("unknown swarm run '{run_id}'"))?;
            if let Some(root) = project_root {
                if run.project_root != root {
                    return Err(format!("swarm run '{run_id}' belongs to another project"));
                }
            }
            return serde_json::to_value(run).map_err(|e| e.to_string());
        }
        let mut list: Vec<_> = runs
            .values()
            .filter(|run| project_root.map(|root| run.project_root == root).unwrap_or(true))
            .cloned()
            .collect();
        list.sort_by_key(|run| run.created_at);
        list.reverse();
        serde_json::to_value(serde_json::json!({ "runs": list })).map_err(|e| e.to_string())
    }

    fn cancel_swarm_run(&self, run_id: &str, project_root: Option<&str>) -> Result<Value, String> {
        let mut runs = self.0.swarm_runs.lock().unwrap();
        let run = runs
            .get_mut(run_id)
            .ok_or_else(|| format!("unknown swarm run '{run_id}'"))?;
        if let Some(root) = project_root {
            if run.project_root != root {
                return Err(format!("swarm run '{run_id}' belongs to another project"));
            }
        }
        run.status = "cancelled".to_string();
        run.updated_at = now_millis_i64();
        self.0
            .swarm_requests
            .lock()
            .unwrap()
            .retain(|request| request.run_id != run_id);
        Ok(serde_json::json!({ "cancelled": true, "runId": run_id, "status": run.status }))
    }
}

impl Default for McpState {
    fn default() -> Self {
        Self::new()
    }
}

/// A read-only [`LiveState`] view over one snapshot, for a single request. The
/// screenshot path resolves a device capture lazily through the core ADB helper.
///
/// `pinned_root` is the project this *connection* belongs to, captured from the
/// published snapshot when the connection was accepted. The app serves one shared
/// socket per process, but the published snapshot follows whichever project is
/// active in the workbench. So a long-lived agent connection (opened while
/// project A was active) must not start reading project B's selection / logs /
/// screenshot after the user switches to B — it stays pinned to A and reports
/// "no active context" once the live project no longer matches. (A connection
/// opened *after* a switch pins the then-current project; fully isolating
/// concurrent projects would need per-project sockets — out of scope here.)
struct SnapshotLiveState<'a> {
    state: &'a McpState,
    snapshot: PublishedState,
    pinned_root: Option<String>,
    /// True when the live snapshot still belongs to this connection's project.
    matches_pin: bool,
}

impl<'a> SnapshotLiveState<'a> {
    /// Build a per-request view, gating it to `pinned_root`: if the live project
    /// has switched away from the connection's, the view is treated as empty so
    /// no tool serves another project's state.
    fn for_connection(state: &'a McpState, pinned_root: &Option<String>) -> Self {
        let snapshot = state.snapshot();
        let matches_pin = &snapshot.project_root == pinned_root;
        Self {
            state,
            snapshot,
            pinned_root: pinned_root.clone(),
            matches_pin,
        }
    }

    fn pinned_project_root(&self) -> Result<&str, String> {
        self.pinned_root
            .as_deref()
            .filter(|root| !root.trim().is_empty())
            .ok_or_else(|| "this MCP connection is not pinned to a Pickforge project".to_string())
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
        // The live project switched away from this connection's: present no
        // active target, which gates every capability-bound tool (selection,
        // screenshot, logs) to `available: false` for the stale project.
        if !self.matches_pin || self.snapshot.target_id.is_empty() {
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
        // Don't hand a stale connection the now-active *other* project's dirs.
        if !self.matches_pin {
            return ProjectContext {
                project_root: None,
                context_dir: None,
                runs_dir: None,
                chats_dir: None,
                support_tier: String::new(),
            };
        }
        ProjectContext {
            project_root: self.snapshot.project_root.clone(),
            context_dir: self.snapshot.context_dir.clone(),
            runs_dir: self.snapshot.runs_dir.clone(),
            chats_dir: self.snapshot.chats_dir.clone(),
            support_tier: self.snapshot.support_tier.clone(),
        }
    }

    fn flutter_selection(&self) -> Result<Option<Value>, String> {
        if !self.matches_pin {
            return Ok(None);
        }
        // The frontend publishes the live VM-Service selection into the snapshot
        // (it already re-reads it each frame while select mode is on).
        Ok(self.snapshot.selection.clone().filter(|v| !v.is_null()))
    }

    fn uiautomator_selection(&self) -> Result<Option<Value>, String> {
        if !self.matches_pin {
            return Ok(None);
        }
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
        Ok(match self.snapshot.device_platform.as_str() {
            "ios" => crate::ios_commands::capture_ios_screenshot(&serial, &dir, &name),
            _ => android::capture_screenshot(&serial, &dir, &name),
        })
    }

    fn run_logs(&self, limit: usize) -> Vec<String> {
        if !self.matches_pin {
            return Vec::new();
        }
        self.state.recent_logs(limit)
    }

    fn pickforge_capabilities(&self) -> Value {
        let active_project = self.matches_pin && self.snapshot.project_root.is_some();
        serde_json::json!({
            "available": true,
            "projectRoot": if active_project { self.snapshot.project_root.clone() } else { None },
            "swarm": {
                "available": active_project,
                "maxAgents": MAX_SWARM_AGENTS,
                "modes": ["scout", "review"],
                "providers": ["claudeCode", "codex", "mixed"],
                "defaultMode": "scout",
                "nativeSubagentPolicy": "Use pickforge_start_swarm for Pickforge swarm requests. Do not also start provider-native subagents or model-orchestration skill lanes for the same work unless the user explicitly asks for that fallback.",
            },
            "ollamaCloud": {
                "available": is_on_user_path("ollama"),
                "models": ["glm-5.2:cloud"],
                "commands": {
                    "claudeCode": "ollama launch claude --model glm-5.2:cloud",
                    "codex": "ollama launch codex --model glm-5.2:cloud",
                },
            },
            "pickLab": {
                "cliAvailable": is_on_user_path("picklab"),
                "mcpAvailable": is_on_user_path("picklab-mcp"),
            },
        })
    }

    fn request_swarm(&self, args: &Value) -> Result<Value, String> {
        if !self.matches_pin {
            return Err("this MCP connection is not pinned to the active project".to_string());
        }
        let project_root = self
            .snapshot
            .project_root
            .clone()
            .filter(|root| !root.trim().is_empty())
            .ok_or_else(|| "no active Pickforge project".to_string())?;
        self.state.enqueue_swarm_request(project_root, self.snapshot.active_chat_id.clone(), args)
    }

    fn swarm_status(&self, args: &Value) -> Result<Value, String> {
        let run_id = string_arg(args, "runId");
        let project_root = self.pinned_project_root()?;
        self.state.swarm_status_value(Some(project_root), run_id.as_deref())
    }

    fn cancel_swarm(&self, args: &Value) -> Result<Value, String> {
        let run_id = string_arg(args, "runId")
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| "missing swarm runId".to_string())?;
        let project_root = self.pinned_project_root()?;
        self.state.cancel_swarm_run(&run_id, Some(project_root))
    }
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn now_millis_i64() -> i64 {
    now_millis().min(i64::MAX as u128) as i64
}

fn string_arg(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
}

fn enum_arg(args: &Value, key: &str, allowed: &[&str], default: &str) -> String {
    match string_arg(args, key) {
        Some(value) if allowed.contains(&value.as_str()) => value,
        _ => default.to_string(),
    }
}

/// The base runtime directory for the socket: `$XDG_RUNTIME_DIR` (already a
/// user-private `0700` dir per the spec) or, when it is unset, the system temp
/// dir — which is world-writable, so the per-app subdir below is created and
/// verified `0700` regardless.
#[cfg(unix)]
fn runtime_base() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

/// The per-process socket path: `<runtime_base>/pickforge-<pid>/agent.sock`.
#[cfg(unix)]
fn default_socket_path() -> PathBuf {
    runtime_base()
        .join(format!("pickforge-{}", std::process::id()))
        .join("agent.sock")
}

/// Ensure the socket's parent directory exists and is a user-PRIVATE (`0700`),
/// current-user-owned real directory. Rejects a pre-existing path that is a
/// symlink, not owned by us, or group/other-accessible — defending against a
/// hostile dir planted in a shared temp dir.
#[cfg(unix)]
fn ensure_private_dir(dir: &Path) -> Result<(), String> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};

    match std::fs::symlink_metadata(dir) {
        Ok(meta) => {
            // Must be a real directory, not a symlink someone swapped in.
            if !meta.file_type().is_dir() {
                return Err(format!(
                    "MCP runtime path {} exists but is not a directory",
                    dir.display()
                ));
            }
            if meta.uid() != current_uid() {
                return Err(format!(
                    "MCP runtime dir {} is not owned by the current user",
                    dir.display()
                ));
            }
            // Reject any group/other access bits; force-tighten to 0700.
            let mode = meta.permissions().mode() & 0o777;
            if mode & 0o077 != 0 {
                std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
                    .map_err(|e| format!("cannot tighten MCP runtime dir perms: {e}"))?;
            }
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => std::fs::DirBuilder::new()
            .recursive(false)
            .mode(0o700)
            .create(dir)
            .map_err(|e| format!("cannot create private MCP runtime dir {}: {e}", dir.display())),
        Err(e) => Err(format!("cannot stat MCP runtime dir {}: {e}", dir.display())),
    }
}

/// Restrict a freshly bound socket to the owner (`0600`) so no other local user
/// can connect to the agent endpoint.
#[cfg(unix)]
fn restrict_socket(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    // The socket we just bound must be the one we own — bail if it was swapped.
    let meta = std::fs::symlink_metadata(path)
        .map_err(|e| format!("cannot stat MCP socket: {e}"))?;
    if meta.uid() != current_uid() {
        return Err("MCP socket is not owned by the current user".to_string());
    }
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("cannot restrict MCP socket perms: {e}"))
}

#[cfg(unix)]
fn current_uid() -> u32 {
    // Safe: getuid is always successful and has no preconditions.
    unsafe { libc::getuid() }
}

// ---- Tauri commands ----

/// Publish the active-target / context snapshot the MCP tools gate against.
#[tauri::command]
pub fn mcp_publish_state(
    state: State<'_, McpState>,
    generation: u64,
    publication_revision: u64,
    snapshot: PublishedState,
) -> bool {
    state.publish_if_current(generation, publication_revision, snapshot)
}

/// Append run-console / logcat lines to the MCP run-log ring buffer.
#[tauri::command]
pub fn mcp_push_log(
    state: State<'_, McpState>,
    generation: u64,
    run_epoch: u64,
    lines: Vec<String>,
) -> bool {
    state.append_logs_if_current(generation, run_epoch, lines)
}

/// Reset the run-log ring at the start of a new run, so a fresh run's
/// `get_run_logs` never returns lines left over from the previous run (the
/// common stop/fix/run-again loop). Called from `startRun` on the frontend.
#[tauri::command]
pub fn mcp_run_started(
    state: State<'_, McpState>,
    generation: u64,
    run_epoch: u64,
) -> bool {
    state.start_run_if_current(generation, run_epoch)
}

#[tauri::command]
pub fn mcp_take_swarm_requests(state: State<'_, McpState>) -> Vec<SwarmRequest> {
    state.take_swarm_requests()
}

#[tauri::command]
pub fn mcp_update_swarm_run(state: State<'_, McpState>, run: SwarmRunSnapshot) {
    state.update_swarm_run(run);
}

#[tauri::command]
pub fn mcp_swarm_status(
    state: State<'_, McpState>,
    project_root: Option<String>,
    run_id: Option<String>,
) -> Result<Value, String> {
    state.swarm_status_value(project_root.as_deref(), run_id.as_deref())
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
    pub mcp_config_path: String,
    pub mcp_command: String,
}

/// Start the MCP socket server (idempotent). Resolves `project_root`'s storage
/// layout, binds the Unix socket, writes the endpoint to
/// `<context_dir>/ipc.sock-path` (the documented discovery file), and returns the
/// endpoint + storage dirs. The caller injects `PICKFORGE_IPC_ENDPOINT` /
/// `PICKFORGE_CONTEXT_DIR` into embedded terminals. No-op if already running.
///
/// Concurrency: the lifecycle is a state machine. A second caller that arrives
/// while a bind is in flight waits on the `Starting` notifier and then reuses the
/// `Running` instance — it never sees "running but no socket".
#[cfg(unix)]
#[tauri::command]
pub async fn mcp_start(
    state: State<'_, McpState>,
    project_root: String,
    generation: u64,
) -> Result<McpStartResult, String> {
    if !state.activate_projection(generation, &project_root) {
        return Err("MCP binding was superseded by a newer project".to_string());
    }
    // Resolve (and create) the project's storage layout — the source of truth for
    // where the discovery file and context artifacts live.
    let resolved = ContextStorageService::new()
        .ensure(&project_root, None)
        .map_err(|e| e.to_string())?;

    // Claim the right to bind, or learn that another caller is already running /
    // mid-bind. Loop because a `Starting` we wait on may resolve to `Idle` (the
    // in-flight bind failed), in which case we retry the claim ourselves.
    let endpoint = loop {
        enum Claim {
            // We own the bind; carry the fresh generation + the sender that
            // settles the `Starting` phase for any waiters.
            Bind(u64, watch::Sender<StartPhase>),
            // Already running — reuse this endpoint.
            Reuse(String),
            // Someone else is binding; wait on their phase, then re-evaluate.
            Wait(watch::Receiver<StartPhase>),
        }

        // Subscribe to the in-flight bind's `watch` channel while still holding
        // the lifecycle lock for the `Starting` branch. A `watch::Receiver`
        // always observes the latest value, so even if the binder publishes
        // `Settled` between our unlock and our await, `changed()`/`borrow()` sees
        // it — there is no lost-wakeup window to guard.
        let claim = {
            let mut lc = state.0.lifecycle.lock().unwrap();
            match &*lc {
                ServerLifecycle::Running(s) => Claim::Reuse(s.endpoint.clone()),
                ServerLifecycle::Starting(rx) => Claim::Wait(rx.clone()),
                ServerLifecycle::Idle => {
                    let generation = state.0.next_generation.fetch_add(1, Ordering::SeqCst);
                    let (tx, rx) = watch::channel(StartPhase::Pending);
                    *lc = ServerLifecycle::Starting(rx);
                    Claim::Bind(generation, tx)
                }
            }
        };

        match claim {
            Claim::Reuse(endpoint) => break endpoint,
            Claim::Wait(mut rx) => {
                // Wait until the bind settles (or the sender is dropped, which
                // also resolves), then loop to re-read the lifecycle.
                while *rx.borrow_and_update() == StartPhase::Pending {
                    if rx.changed().await.is_err() {
                        break; // sender gone — re-read the lifecycle and retry.
                    }
                }
                continue;
            }
            Claim::Bind(generation, settle) => {
                match bind_server(&state, generation) {
                    Ok(server) => {
                        let endpoint = server.endpoint.clone();
                        {
                            let mut lc = state.0.lifecycle.lock().unwrap();
                            *lc = ServerLifecycle::Running(server);
                        }
                        // Settle AFTER the lifecycle is `Running`, so a woken
                        // waiter that re-reads it always sees the live instance.
                        let _ = settle.send(StartPhase::Settled);
                        break endpoint;
                    }
                    Err(e) => {
                        // Reset to Idle so waiters retry the claim themselves.
                        {
                            let mut lc = state.0.lifecycle.lock().unwrap();
                            *lc = ServerLifecycle::Idle;
                        }
                        let _ = settle.send(StartPhase::Settled);
                        return Err(e);
                    }
                }
            }
        }
    };

    if !state.projection_is_active(generation, &project_root) {
        return Err("MCP binding was superseded by a newer project".to_string());
    }

    let mcp_command = resolve_mcp_adapter_command();
    let mcp_config_path = write_mcp_config(&resolved.context_dir, &mcp_command)?;

    let _ = std::fs::write(resolved.ipc_sock_path(), &endpoint);

    Ok(McpStartResult {
        endpoint,
        context_dir: resolved.context_dir,
        runs_dir: resolved.runs_dir,
        chats_dir: resolved.chats_dir,
        mcp_config_path,
        mcp_command,
    })
}

#[cfg(not(unix))]
#[tauri::command]
pub async fn mcp_start(
    state: State<'_, McpState>,
    project_root: String,
    generation: u64,
) -> Result<McpStartResult, String> {
    if !state.activate_projection(generation, &project_root) {
        return Err("MCP binding was superseded by a newer project".to_string());
    }
    let resolved = ContextStorageService::new()
        .ensure(&project_root, None)
        .map_err(|e| e.to_string())?;
    if !state.projection_is_active(generation, &project_root) {
        return Err("MCP binding was superseded by a newer project".to_string());
    }

    Ok(McpStartResult {
        endpoint: String::new(),
        context_dir: resolved.context_dir,
        runs_dir: resolved.runs_dir,
        chats_dir: resolved.chats_dir,
        mcp_config_path: String::new(),
        mcp_command: "pickforge-mcp".to_string(),
    })
}

fn resolve_mcp_adapter_command() -> String {
    if let Some(path) = std::env::var("PICKFORGE_MCP_COMMAND")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        return path;
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in sidecar_names() {
                let candidate = dir.join(name);
                if candidate.exists() {
                    return candidate.to_string_lossy().into_owned();
                }
            }
        }
    }
    if let Some(path) = pickforge_core::which_in(
        "pickforge-mcp",
        pickforge_core::user_shell_environment(),
    ) {
        return path.to_string_lossy().into_owned();
    }
    "pickforge-mcp".to_string()
}

fn sidecar_names() -> Vec<String> {
    let mut names = vec!["pickforge-mcp".to_string()];
    if cfg!(windows) {
        names.push("pickforge-mcp.exe".to_string());
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with("pickforge-mcp-") {
                        names.push(name);
                    }
                }
            }
        }
    }
    names
}

fn write_mcp_config(context_dir: &str, command: &str) -> Result<String, String> {
    let path = PathBuf::from(context_dir).join("pickforge-mcp.json");
    let config = serde_json::json!({
        "mcpServers": {
            "pickforge": {
                "command": command,
                "args": [],
            }
        }
    });
    let text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Bind a fresh server instance: prepare a private runtime dir, bind the socket,
/// restrict it to `0600`, and spawn its accept task. Returns the owned
/// [`RunningServer`] handle (generation + path + endpoint + shutdown).
#[cfg(unix)]
fn bind_server(state: &State<'_, McpState>, generation: u64) -> Result<RunningServer, String> {
    let socket_path = default_socket_path();
    if let Some(parent) = socket_path.parent() {
        ensure_private_dir(parent)?;
    }
    // A stale socket from a previous (crashed) run blocks bind — clear it.
    let _ = std::fs::remove_file(&socket_path);
    let listener = UnixListener::bind(&socket_path)
        .map_err(|e| format!("cannot bind MCP socket at {}: {e}", socket_path.display()))?;
    // Restrict before serving any connection so the window is never open.
    if let Err(e) = restrict_socket(&socket_path) {
        let _ = std::fs::remove_file(&socket_path);
        return Err(e);
    }

    let shutdown = Arc::new(Notify::new());
    let server = RunningServer {
        generation,
        socket_path: socket_path.clone(),
        endpoint: socket_path.to_string_lossy().into_owned(),
        shutdown: shutdown.clone(),
    };

    let inner = state.0.clone();
    let server_state = McpState(inner.clone());
    tauri::async_runtime::spawn(async move {
        serve(listener, server_state, inner, generation, socket_path, shutdown).await;
    });
    Ok(server)
}

/// Stop the MCP server and remove its socket file. Safe to call when stopped.
#[cfg(unix)]
#[tauri::command]
pub fn mcp_stop(state: State<'_, McpState>) {
    // Take the running instance out of the lifecycle and signal ONLY its task.
    // Cleanup of the socket file is left to that task, which deletes only the
    // path it bound (guarded by its generation) — so a concurrent restart that
    // already rebound the shared path is never clobbered.
    let server = {
        let mut lc = state.0.lifecycle.lock().unwrap();
        match std::mem::replace(&mut *lc, ServerLifecycle::Idle) {
            ServerLifecycle::Running(s) => Some(s),
            // A bind in flight: put the Starting back so its owner can finish and
            // observe Idle itself; nothing to stop yet.
            other => {
                *lc = other;
                None
            }
        }
    };
    if let Some(server) = server {
        server.shutdown.notify_waiters();
    }
}

#[cfg(not(unix))]
#[tauri::command]
pub fn mcp_stop(_state: State<'_, McpState>) -> Result<(), String> {
    Err(MCP_SOCKET_UNSUPPORTED.to_string())
}

/// Accept loop for one server instance. Each connection is handled concurrently,
/// framing newline-delimited JSON-RPC and dispatching to the core MCP handler.
/// Ends on this instance's shutdown signal or a dead listener.
///
/// The shutdown future is created ONCE and pinned before the loop: `notified()`
/// registers interest immediately, so a `mcp_stop` that fires while this loop is
/// busy spawning a connection (not currently in the `select!`) is still observed
/// on the next poll — it is not lost the way a fresh per-iteration `notified()`
/// would be.
#[cfg(unix)]
async fn serve(
    listener: UnixListener,
    state: McpState,
    inner: Arc<McpInner>,
    generation: u64,
    socket_path: PathBuf,
    shutdown: Arc<Notify>,
) {
    let shutdown = shutdown.notified();
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
    // already unlinked the path. Then remove the socket file ONLY if a *newer*
    // running server hasn't rebound the same shared path: a restart with a higher
    // generation owns that file now, and this older task must not delete it.
    drop(listener);
    if !newer_server_owns_path(&inner, &socket_path, generation) {
        let _ = std::fs::remove_file(&socket_path);
    }
}

/// True when a server with a *higher* generation currently owns `socket_path` —
/// i.e. a restart rebound the same path. In that case the older task whose
/// generation is `generation` must NOT delete the file (it belongs to the new one).
#[cfg(unix)]
fn newer_server_owns_path(inner: &Arc<McpInner>, socket_path: &Path, generation: u64) -> bool {
    let lc = inner.lifecycle.lock().unwrap();
    match lc.running() {
        Some(s) => s.generation > generation && s.socket_path == socket_path,
        None => false,
    }
}

#[cfg(unix)]
async fn handle_conn(stream: tokio::net::UnixStream, state: McpState) {
    // Pin this connection to the project that is active when it is accepted. The
    // socket is shared per-process, but the published snapshot follows the
    // workbench's active project; pinning stops a long-lived agent from reading a
    // *different* project's live state after the user switches away. (See
    // `SnapshotLiveState`.)
    let pinned_root = state.snapshot().project_root;
    let (rx, mut tx) = stream.into_split();
    let mut lines = BufReader::new(rx).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        // Build a fresh snapshot view per request so live state is current, and
        // resolve a blocking screenshot off the async runtime when one is asked.
        let state = state.clone();
        let pinned_root = pinned_root.clone();
        let reply = tokio::task::spawn_blocking(move || {
            let live = SnapshotLiveState::for_connection(&state, &pinned_root);
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

    /// A connection-scoped view pinned to whatever project is currently
    /// published — the in-project case the existing assertions exercise.
    fn live_in_project(st: &McpState) -> SnapshotLiveState<'_> {
        let pinned = st.snapshot().project_root;
        SnapshotLiveState::for_connection(st, &pinned)
    }

    fn accepted_run_id(value: Value) -> String {
        value["runId"].as_str().unwrap().to_string()
    }

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
        let live = live_in_project(&st);
        let target = live.active_target().unwrap();
        assert_eq!(target.id, "native-android");
        assert!(target.has(Capability::InspectSelection));
        assert_eq!(target.inspector_kind, InspectorKind::UiAutomator);
        // UIAutomator selection comes straight from the published snapshot.
        let sel = live.uiautomator_selection().unwrap().unwrap();
        assert_eq!(sel["className"], json!("android.widget.Button"));
    }

    #[test]
    fn snapshot_live_state_maps_ios_accessibility_selection() {
        let st = McpState::new();
        st.set_published(PublishedState {
            target_id: "native-ios".into(),
            target_label: "Native iOS".into(),
            capabilities: vec!["inspectSelection".into(), "streamLogs".into()],
            inspector_kind: "iosAccessibility".into(),
            support_tier: "useful".into(),
            selection: Some(json!({ "className": "Button" })),
            ..Default::default()
        });
        let live = live_in_project(&st);
        let target = live.active_target().unwrap();
        assert_eq!(target.id, "native-ios");
        assert!(target.has(Capability::InspectSelection));
        assert_eq!(target.inspector_kind, InspectorKind::IosAccessibility);
        assert_eq!(
            InspectorKind::from_wire("iosAccessibility"),
            InspectorKind::IosAccessibility
        );

        let line = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_current_selection","arguments":{}}}"#;
        let response: Value =
            serde_json::from_str(&mcp::handle_line(&live, line).unwrap()).unwrap();
        assert_eq!(response["result"]["isError"], json!(false));
        let text = response["result"]["content"][0]["text"].as_str().unwrap();
        let payload: Value = serde_json::from_str(text).unwrap();
        assert_eq!(payload["kind"], json!("a11yNode"));
        assert_eq!(payload["selection"]["className"], json!("Button"));
    }

    #[test]
    fn no_target_yields_none() {
        let st = McpState::new();
        let live = live_in_project(&st);
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
    fn switching_project_clears_the_log_ring() {
        let st = McpState::new();
        st.set_published(PublishedState {
            project_root: Some("/proj/a".into()),
            ..Default::default()
        });
        st.push_logs(vec!["a-line-1".into(), "a-line-2".into()]);
        assert_eq!(st.recent_logs(10).len(), 2);

        // Switching to a different project root must drop project A's logs.
        st.set_published(PublishedState {
            project_root: Some("/proj/b".into()),
            ..Default::default()
        });
        assert!(st.recent_logs(10).is_empty(), "logs from /proj/a leaked into /proj/b");

        // Re-publishing the SAME project keeps the buffer intact.
        st.push_logs(vec!["b-line-1".into()]);
        st.set_published(PublishedState {
            project_root: Some("/proj/b".into()),
            target_label: "changed".into(),
            ..Default::default()
        });
        assert_eq!(st.recent_logs(10), vec!["b-line-1".to_string()]);
    }

    #[test]
    fn a_new_run_clears_the_log_ring_within_the_same_project() {
        let st = McpState::new();
        st.set_published(PublishedState {
            project_root: Some("/proj/a".into()),
            ..Default::default()
        });
        // First run's output.
        st.push_logs(vec!["run1-boot".into(), "run1-error".into()]);
        assert_eq!(st.recent_logs(10).len(), 2);

        // A *new run* in the SAME project (the stop/fix/run-again loop) must start
        // with an empty ring — the previous run's lines never bleed in.
        st.clear_logs();
        assert!(
            st.recent_logs(10).is_empty(),
            "previous run's logs must not survive into a new run"
        );
        st.push_logs(vec!["run2-boot".into()]);
        assert_eq!(st.recent_logs(10), vec!["run2-boot".to_string()]);
    }

    #[test]
    fn stale_binding_and_publication_cannot_replace_the_current_projection() {
        let st = McpState::new();
        assert!(st.activate_projection(1, "/proj/a"));
        assert!(st.publish_if_current(
            1,
            1,
            PublishedState {
                target_label: "A old".into(),
                project_root: Some("/proj/a".into()),
                ..Default::default()
            },
        ));

        assert!(st.activate_projection(2, "/proj/b"));
        assert!(st.publish_if_current(
            2,
            2,
            PublishedState {
                target_label: "B newest".into(),
                project_root: Some("/proj/b".into()),
                ..Default::default()
            },
        ));

        assert!(!st.activate_projection(1, "/proj/a"));
        assert!(!st.publish_if_current(
            1,
            99,
            PublishedState {
                target_label: "A late".into(),
                project_root: Some("/proj/a".into()),
                ..Default::default()
            },
        ));
        assert_eq!(st.snapshot().project_root.as_deref(), Some("/proj/b"));
        assert_eq!(st.snapshot().target_label, "B newest");
    }

    #[test]
    fn connection_pinned_during_activation_observes_initial_publication() {
        let st = McpState::new();
        assert!(st.activate_projection(3, "/proj/a"));
        let pinned = st.snapshot().project_root;
        assert_eq!(pinned.as_deref(), Some("/proj/a"));

        assert!(st.publish_if_current(
            3,
            1,
            PublishedState {
                target_id: "flutter".into(),
                project_root: Some("/proj/a".into()),
                ..Default::default()
            },
        ));
        let live = SnapshotLiveState::for_connection(&st, &pinned);
        assert_eq!(live.active_target().unwrap().id, "flutter");
    }

    #[test]
    fn stale_publication_revision_cannot_overwrite_a_newer_snapshot() {
        let st = McpState::new();
        assert!(st.activate_projection(4, "/proj/a"));
        assert!(st.publish_if_current(
            4,
            2,
            PublishedState {
                target_label: "newest".into(),
                project_root: Some("/proj/a".into()),
                ..Default::default()
            },
        ));
        assert!(!st.publish_if_current(
            4,
            1,
            PublishedState {
                target_label: "late old snapshot".into(),
                project_root: Some("/proj/a".into()),
                ..Default::default()
            },
        ));
        assert_eq!(st.snapshot().target_label, "newest");
    }

    #[test]
    fn stale_run_clear_and_append_cannot_change_newer_run_logs() {
        let st = McpState::new();
        assert!(st.activate_projection(7, "/proj/a"));
        assert!(st.start_run_if_current(7, 1));
        assert!(st.append_logs_if_current(7, 1, vec!["run-1".into()]));

        assert!(st.start_run_if_current(7, 2));
        assert!(st.append_logs_if_current(7, 2, vec!["run-2".into()]));
        assert!(!st.start_run_if_current(7, 1));
        assert!(!st.append_logs_if_current(7, 1, vec!["run-1-late".into()]));
        assert_eq!(st.recent_logs(10), vec!["run-2".to_string()]);
    }

    #[test]
    fn same_run_append_before_clear_is_preserved() {
        let st = McpState::new();
        assert!(st.activate_projection(3, "/proj/a"));
        assert!(st.append_logs_if_current(3, 1, vec!["early".into()]));
        assert!(st.start_run_if_current(3, 1));
        assert_eq!(st.recent_logs(10), vec!["early".to_string()]);
    }

    #[test]
    fn cancelling_a_queued_swarm_removes_the_pending_request() {
        let st = McpState::new();
        let run_id = accepted_run_id(
            st.enqueue_swarm_request(
                "/proj/a".into(),
                Some("chat-a".into()),
                &json!({ "goal": "review the app" }),
            )
            .unwrap(),
        );

        let cancelled = st.cancel_swarm_run(&run_id, Some("/proj/a")).unwrap();
        assert_eq!(cancelled["status"], json!("cancelled"));
        assert!(st.take_swarm_requests().is_empty());

        let status = st.swarm_status_value(Some("/proj/a"), Some(&run_id)).unwrap();
        assert_eq!(status["status"], json!("cancelled"));
        assert_eq!(status["originChatId"], json!("chat-a"));

        let mut stale_update: SwarmRunSnapshot = serde_json::from_value(status).unwrap();
        stale_update.status = "running".to_string();
        st.update_swarm_run(stale_update);
        let status = st.swarm_status_value(Some("/proj/a"), Some(&run_id)).unwrap();
        assert_eq!(status["status"], json!("cancelled"));
    }

    #[test]
    fn mcp_swarm_request_keeps_the_active_chat_origin() {
        let st = McpState::new();
        st.set_published(PublishedState {
            project_root: Some("/proj/a".into()),
            active_chat_id: Some("chat-origin".into()),
            ..Default::default()
        });
        let live = SnapshotLiveState::for_connection(&st, &Some("/proj/a".to_string()));

        let run_id = accepted_run_id(live.request_swarm(&json!({ "goal": "map it" })).unwrap());
        let requests = st.take_swarm_requests();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].origin_chat_id.as_deref(), Some("chat-origin"));

        let status = st.swarm_status_value(Some("/proj/a"), Some(&run_id)).unwrap();
        assert_eq!(status["originChatId"], json!("chat-origin"));
        assert_eq!(status["synthesisStatus"], json!("idle"));
    }

    #[test]
    fn stale_connection_swarm_tools_stay_project_scoped() {
        let st = McpState::new();
        let run_a = accepted_run_id(
            st.enqueue_swarm_request(
                "/proj/a".into(),
                Some("chat-a".into()),
                &json!({ "goal": "review A" }),
            )
            .unwrap(),
        );
        let run_b = accepted_run_id(
            st.enqueue_swarm_request(
                "/proj/b".into(),
                Some("chat-b".into()),
                &json!({ "goal": "review B" }),
            )
            .unwrap(),
        );

        st.set_published(PublishedState {
            project_root: Some("/proj/b".into()),
            ..Default::default()
        });
        let live = SnapshotLiveState::for_connection(&st, &Some("/proj/a".to_string()));

        let status = live.swarm_status(&json!({})).unwrap();
        let runs = status["runs"].as_array().unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0]["runId"], json!(run_a));

        let err = live.cancel_swarm(&json!({ "runId": run_b })).unwrap_err();
        assert!(err.contains("belongs to another project"));
        assert_eq!(
            live.cancel_swarm(&json!({ "runId": run_a })).unwrap()["status"],
            json!("cancelled")
        );
    }

    #[test]
    fn a_connection_pinned_to_a_project_is_gated_after_a_switch() {
        let st = McpState::new();
        // Project A is active when the agent's connection is accepted.
        st.set_published(PublishedState {
            target_id: "flutter".into(),
            capabilities: vec!["inspectSelection".into(), "streamLogs".into()],
            inspector_kind: "vmService".into(),
            project_root: Some("/proj/a".into()),
            context_dir: Some("/proj/a/.pickforge".into()),
            selection: Some(json!({ "className": "Text" })),
            ..Default::default()
        });
        st.push_logs(vec!["a-log".into()]);
        let pinned = Some("/proj/a".to_string());

        // While still on A, the pinned connection sees A's live state.
        {
            let live = SnapshotLiveState::for_connection(&st, &pinned);
            assert!(live.active_target().is_some());
            assert_eq!(live.project_context().project_root.as_deref(), Some("/proj/a"));
            assert!(live.flutter_selection().unwrap().is_some());
            assert_eq!(live.run_logs(10).len(), 1);
        }

        // The user switches the workbench to project B. A connection STILL pinned
        // to A must not start reading B's target / selection / logs / dirs.
        st.set_published(PublishedState {
            target_id: "native-android".into(),
            capabilities: vec!["inspectSelection".into(), "streamLogs".into()],
            inspector_kind: "uiAutomator".into(),
            project_root: Some("/proj/b".into()),
            context_dir: Some("/proj/b/.pickforge".into()),
            selection: Some(json!({ "className": "android.widget.Button" })),
            ..Default::default()
        });
        st.push_logs(vec!["b-log".into()]);

        let live = SnapshotLiveState::for_connection(&st, &pinned);
        assert!(live.active_target().is_none(), "stale connection must see no active target");
        assert!(live.flutter_selection().unwrap().is_none(), "must not leak B's selection");
        assert!(live.uiautomator_selection().unwrap().is_none());
        assert!(live.run_logs(10).is_empty(), "must not leak B's logs");
        let ctx = live.project_context();
        assert!(ctx.project_root.is_none(), "must not leak B's project root");
        assert!(ctx.context_dir.is_none(), "must not leak B's context dir");

        // A *fresh* connection accepted now pins B and sees B's state.
        let live_b = SnapshotLiveState::for_connection(&st, &Some("/proj/b".to_string()));
        assert_eq!(live_b.active_target().unwrap().id, "native-android");
        assert_eq!(live_b.run_logs(10), vec!["b-log".to_string()]);
    }

    #[tokio::test]
    async fn a_concurrent_waiter_is_woken_when_the_bind_settles() {
        // Models finding #4: a caller that subscribes to the `Starting` phase
        // while holding the lifecycle lock must never miss the settle, even if it
        // is published before the waiter first polls. The watch channel guarantees
        // this — `borrow`/`changed` always observe the latest value.
        let (tx, mut rx) = watch::channel(StartPhase::Pending);
        // Settle is published BEFORE the waiter ever awaits (the lost-wakeup window
        // for a bare Notify). A watch receiver still observes it.
        tx.send(StartPhase::Settled).unwrap();

        let wait = async move {
            while *rx.borrow_and_update() == StartPhase::Pending {
                if rx.changed().await.is_err() {
                    break;
                }
            }
        };
        // Must resolve promptly, not hang.
        tokio::time::timeout(std::time::Duration::from_secs(1), wait)
            .await
            .expect("waiter must observe a settle published before it polled");
    }

    #[cfg(unix)]
    fn unique_tmp(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "pf-mcp-test-{}-{}-{}",
            tag,
            std::process::id(),
            now_millis()
        ))
    }

    #[cfg(unix)]
    fn mode_of(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::symlink_metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[cfg(unix)]
    #[test]
    fn ensure_private_dir_creates_0700() {
        let dir = unique_tmp("dir0700");
        let _ = std::fs::remove_dir_all(&dir);
        ensure_private_dir(&dir).expect("creates private dir");
        assert_eq!(mode_of(&dir), 0o700, "runtime dir must be 0700");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn ensure_private_dir_tightens_a_loose_existing_dir() {
        use std::os::unix::fs::PermissionsExt;
        let dir = unique_tmp("dirloose");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        // We own it but it is group/other-readable: ensure_private_dir tightens it.
        ensure_private_dir(&dir).expect("tightens own dir");
        assert_eq!(mode_of(&dir), 0o700, "loose dir must be tightened to 0700");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn ensure_private_dir_rejects_a_symlink() {
        let target = unique_tmp("symtgt");
        let link = unique_tmp("symlink");
        let _ = std::fs::remove_dir_all(&target);
        let _ = std::fs::remove_file(&link);
        std::fs::create_dir(&target).unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        // A symlink standing in for the runtime dir must be refused.
        assert!(ensure_private_dir(&link).is_err(), "symlinked runtime dir must be rejected");
        let _ = std::fs::remove_file(&link);
        let _ = std::fs::remove_dir_all(&target);
    }

    #[cfg(unix)]
    #[test]
    fn bound_socket_is_restricted_to_0600() {
        let dir = unique_tmp("sock0600");
        let _ = std::fs::remove_dir_all(&dir);
        ensure_private_dir(&dir).unwrap();
        let sock = dir.join("agent.sock");
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let _listener = rt.block_on(async { UnixListener::bind(&sock).unwrap() });
        restrict_socket(&sock).expect("restrict to 0600");
        assert_eq!(mode_of(&sock), 0o600, "socket must be owner-only (0600)");
        drop(_listener);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn newer_generation_owning_the_path_blocks_old_task_cleanup() {
        let st = McpState::new();
        let path = PathBuf::from("/run/pickforge-x/agent.sock");
        // A gen-5 server currently owns the path.
        *st.0.lifecycle.lock().unwrap() = ServerLifecycle::Running(RunningServer {
            generation: 5,
            socket_path: path.clone(),
            endpoint: path.to_string_lossy().into_owned(),
            shutdown: Arc::new(Notify::new()),
        });
        // An OLDER (gen-3) task finishing must NOT delete the file: gen 5 > 3.
        assert!(newer_server_owns_path(&st.0, &path, 3), "older task must defer to newer owner");
        // The current owner (gen 5) is NOT 'newer than itself' → it may clean up.
        assert!(!newer_server_owns_path(&st.0, &path, 5));
        // After a stop (lifecycle Idle), the orphaned path is the old task's to remove.
        *st.0.lifecycle.lock().unwrap() = ServerLifecycle::Idle;
        assert!(!newer_server_owns_path(&st.0, &path, 3));
    }

    #[test]
    fn lifecycle_starts_idle_and_reuse_endpoint_after_running() {
        let st = McpState::new();
        assert!(matches!(*st.0.lifecycle.lock().unwrap(), ServerLifecycle::Idle));
        let server = RunningServer {
            generation: 1,
            socket_path: PathBuf::from("/run/x/agent.sock"),
            endpoint: "/run/x/agent.sock".into(),
            shutdown: Arc::new(Notify::new()),
        };
        *st.0.lifecycle.lock().unwrap() = ServerLifecycle::Running(server);
        // A concurrent caller observing Running reuses the live endpoint.
        let endpoint = st.0.lifecycle.lock().unwrap().running().map(|s| s.endpoint.clone());
        assert_eq!(endpoint.as_deref(), Some("/run/x/agent.sock"));
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
        let live = live_in_project(&st);
        // No device serial → an Err (genuine failure to capture).
        assert!(live.capture_screenshot().is_err());
    }
}
