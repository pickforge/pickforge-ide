use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::event::{
    AgentEvent, ApprovalKind, CommandStatus, FileChangeEntry, FileChangeKind, PlanItem,
    ToolCallStatus, TurnStatus,
};

const ACP_PROTOCOL_VERSION: u64 = 1;
const SUPPORTED_OMP_VERSION: &str = "16.4.8";
const MAX_FRAME_BYTES: usize = 1024 * 1024;
const MAX_PENDING_REQUESTS: usize = 128;
const MAX_RETIRED_REQUESTS: usize = 256;
const MAX_QUEUED_UPDATES: usize = 128;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const SHUTDOWN_GRACE: Duration = Duration::from_millis(250);

/// Environment inherited by the OMP ACP child. Authentication remains OMP-owned:
/// home/config roots are retained so OMP can discover its own credential store,
/// while provider tokens, extension variables, and arbitrary injected config are
/// absent because the command environment is cleared before this allowlist is
/// restored.
pub const OMP_ENV_ALLOWLIST: &[&str] = &[
    "PATH",
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "COLORTERM",
    "NO_COLOR",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OmpAcpSessionOpen {
    New,
    Resume(String),
    Load(String),
}

#[derive(Clone)]
pub struct OmpAcpOptions {
    pub binary: PathBuf,
    pub project_root: PathBuf,
    pub session: OmpAcpSessionOpen,
    pub model: Option<String>,
    /// Complete, session-scoped ACP MCP grants. PickForge never merges these
    /// with OMP's global configuration and never logs their secret-bearing data.
    pub mcp_servers: Vec<Value>,
    pub sink: Arc<dyn Fn(AgentEvent) + Send + Sync>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OmpAcpHandshake {
    pub agent_version: String,
    pub raw: Value,
}

pub struct OmpAcpClient {
    state: Arc<ClientState>,
}

#[derive(Debug, thiserror::Error)]
pub enum OmpAcpError {
    #[error("failed to spawn OMP ACP: {0}")]
    Spawn(#[from] std::io::Error),
    #[error("OMP ACP transport closed: {0}")]
    Closed(String),
    #[error("OMP ACP request timed out: {0}")]
    Timeout(&'static str),
    #[error("OMP ACP protocol error: {0}")]
    Protocol(String),
    #[error("OMP ACP session open failed: {0}")]
    SessionOpen(String),
    #[error("OMP ACP operation is unsupported: {0}")]
    Unsupported(String),
    #[error("OMP ACP permission request not found: {0}")]
    UnknownApproval(String),
}

struct ClientState {
    writer: Mutex<Option<mpsc::SyncSender<WriterMessage>>>,
    child: Mutex<Option<Child>>,
    #[cfg(windows)]
    job: Mutex<Option<isize>>,
    pending: Mutex<HashMap<u64, PendingRequest>>,
    retired_response_ids: Mutex<HashSet<String>>,
    next_id: AtomicU64,
    closed: AtomicBool,
    session_id: Mutex<Option<String>>,
    sink: Mutex<Arc<dyn Fn(AgentEvent) + Send + Sync>>,
    queued_updates: Mutex<Vec<Value>>,
    permissions: Mutex<HashMap<String, PendingPermission>>,
    tools: Mutex<HashMap<String, ToolRuntime>>,
    handshake: Mutex<Option<OmpAcpHandshake>>,
    available_modes: Mutex<HashSet<String>>,
    available_models: Mutex<HashSet<String>>,
    turn_text: Mutex<String>,
    turn_thought: Mutex<String>,
}

enum PendingRequest {
    Wait(mpsc::Sender<Result<Value, String>>),
    Prompt,
}

struct PendingPermission {
    request_id: Value,
    options: Vec<PermissionOption>,
}

#[derive(Clone)]
struct PermissionOption {
    option_id: String,
    kind: String,
}

#[derive(Clone)]
struct ToolRuntime {
    title: String,
    kind: String,
    locations: Vec<String>,
}

enum WriterMessage {
    Json(Value),
    Close,
}

impl OmpAcpClient {
    pub fn spawn(options: OmpAcpOptions) -> Result<Self, OmpAcpError> {
        if !options.project_root.is_absolute() {
            return Err(OmpAcpError::Protocol(
                "session cwd must be an absolute path".to_string(),
            ));
        }
        validate_omp_mcp_servers(&options.mcp_servers)?;

        let mut command = Command::new(&options.binary);
        command
            .arg("acp")
            .arg("--no-extensions")
            .arg("--approval-mode=always-ask")
            .env_clear()
            .envs(controlled_omp_environment())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // Deliberately pass no --config, --auto-approve, or --yolo override.
        // The runtime-only always-ask override defeats an unsafe global yolo
        // setting while preserving ACP permission callbacks. OMP may discover
        // its own auth/config below the allowlisted home roots; --no-extensions
        // prevents global or project extension code from loading.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command.spawn()?;
        // Crash containment: no-op unless the guardian/job is active.
        crate::process::contain_owned_root(child.id());
        #[cfg(windows)]
        let job = match create_kill_on_close_job(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(OmpAcpError::Spawn(error));
            }
        };
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| OmpAcpError::Protocol("OMP ACP stdin was not piped".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| OmpAcpError::Protocol("OMP ACP stdout was not piped".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| OmpAcpError::Protocol("OMP ACP stderr was not piped".to_string()))?;
        let (writer_tx, writer_rx) = mpsc::sync_channel(64);
        let state = Arc::new(ClientState {
            writer: Mutex::new(Some(writer_tx)),
            child: Mutex::new(Some(child)),
            #[cfg(windows)]
            job: Mutex::new(Some(job)),
            pending: Mutex::new(HashMap::new()),
            retired_response_ids: Mutex::new(HashSet::new()),
            next_id: AtomicU64::new(1),
            closed: AtomicBool::new(false),
            session_id: Mutex::new(None),
            sink: Mutex::new(options.sink),
            queued_updates: Mutex::new(Vec::new()),
            permissions: Mutex::new(HashMap::new()),
            tools: Mutex::new(HashMap::new()),
            handshake: Mutex::new(None),
            available_modes: Mutex::new(HashSet::new()),
            available_models: Mutex::new(HashSet::new()),
            turn_text: Mutex::new(String::new()),
            turn_thought: Mutex::new(String::new()),
        });
        let writer_state = Arc::clone(&state);
        thread::spawn(move || write_loop(stdin, writer_rx, writer_state));
        let reader_state = Arc::clone(&state);
        thread::spawn(move || read_loop(stdout, reader_state));
        thread::spawn(move || drain(stderr));

        let client = Self { state };
        let initialize = client.request(
            "initialize",
            json!({
                "protocolVersion": ACP_PROTOCOL_VERSION,
                // Minimum honest capabilities. File, terminal, auth-terminal,
                // form elicitation, and plan are deliberately not advertised:
                // PickForge does not yet expose safe callbacks for them.
                "clientCapabilities": {}
            }),
            "initialize",
        )?;
        let handshake = validate_initialize(&initialize)?;
        *client
            .state
            .handshake
            .lock()
            .map_err(|_| OmpAcpError::Closed("handshake state poisoned".to_string()))? =
            Some(handshake);

        let (method, requested_session_id) = match options.session {
            OmpAcpSessionOpen::New => ("session/new", None),
            OmpAcpSessionOpen::Resume(session_id) => ("session/resume", Some(session_id)),
            OmpAcpSessionOpen::Load(session_id) => ("session/load", Some(session_id)),
        };
        if requested_session_id
            .as_deref()
            .is_some_and(|session_id| session_id.trim().is_empty())
        {
            return Err(OmpAcpError::SessionOpen(
                "requested sessionId must be nonempty".to_string(),
            ));
        }
        let mut params = json!({
            "cwd": options.project_root,
            "mcpServers": options.mcp_servers,
        });
        if let Some(provider_session_id) = requested_session_id.as_ref() {
            params["sessionId"] = Value::String(provider_session_id.clone());
        }
        let opened = client
            .request(method, params, "open session")
            .map_err(|error| OmpAcpError::SessionOpen(error.to_string()))?;
        let session_id = if let Some(requested) = requested_session_id {
            match opened.get("sessionId") {
                None => requested,
                Some(Value::String(provided)) if provided == &requested => requested,
                Some(Value::String(provided)) => {
                    return Err(OmpAcpError::SessionOpen(format!(
                        "{method} returned sessionId {provided}, expected {requested}"
                    )));
                }
                Some(_) => {
                    return Err(OmpAcpError::SessionOpen(format!(
                        "{method} returned a non-string sessionId"
                    )));
                }
            }
        } else {
            opened
                .get("sessionId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    OmpAcpError::SessionOpen(
                        "session/new response omitted nonempty sessionId".to_string(),
                    )
                })?
                .to_string()
        };
        *client
            .state
            .available_modes
            .lock()
            .map_err(|_| OmpAcpError::Closed("mode state poisoned".to_string()))? =
            advertised_modes(&opened);
        *client
            .state
            .available_models
            .lock()
            .map_err(|_| OmpAcpError::Closed("model state poisoned".to_string()))? =
            advertised_models(&opened);
        *client
            .state
            .session_id
            .lock()
            .map_err(|_| OmpAcpError::Closed("session state poisoned".to_string()))? =
            Some(session_id.clone());
        if let Some(model) = options.model.as_deref().filter(|model| !model.trim().is_empty()) {
            client.set_model(model)?;
        }
        emit(
            &client.state,
            AgentEvent::SessionStarted {
                provider_session_id: session_id,
            },
        );
        emit(
            &client.state,
            AgentEvent::ProviderPayload {
                provider: "omp".to_string(),
                method: method.to_string(),
                payload: opened,
            },
        );
        client.replay_queued_updates();
        Ok(client)
    }

    pub fn handshake(&self) -> Result<OmpAcpHandshake, OmpAcpError> {
        self.state
            .handshake
            .lock()
            .map_err(|_| OmpAcpError::Closed("handshake state poisoned".to_string()))?
            .clone()
            .ok_or_else(|| OmpAcpError::Closed("initialize did not complete".to_string()))
    }

    pub fn provider_session_id(&self) -> Result<String, OmpAcpError> {
        self.state
            .session_id
            .lock()
            .map_err(|_| OmpAcpError::Closed("session state poisoned".to_string()))?
            .clone()
            .ok_or_else(|| OmpAcpError::Closed("session is not open".to_string()))
    }

    pub fn is_closed(&self) -> bool {
        self.state.closed.load(Ordering::SeqCst)
    }

    pub fn set_sink(
        &self,
        sink: Arc<dyn Fn(AgentEvent) + Send + Sync>,
    ) -> Result<(), OmpAcpError> {
        *self
            .state
            .sink
            .lock()
            .map_err(|_| OmpAcpError::Closed("event sink state poisoned".to_string()))? = sink;
        Ok(())
    }

    pub fn prompt(&self, text: &str, images: &[String]) -> Result<(), OmpAcpError> {
        if self.state.closed.load(Ordering::SeqCst) {
            return Err(OmpAcpError::Closed("client is closed".to_string()));
        }
        if text.trim().is_empty() && images.is_empty() {
            return Err(OmpAcpError::Protocol("prompt is empty".to_string()));
        }
        let session_id = self.provider_session_id()?;
        let mut content = Vec::new();
        if !text.is_empty() {
            content.push(json!({"type": "text", "text": text}));
        }
        for image in images {
            let bytes = std::fs::read(image).map_err(OmpAcpError::Spawn)?;
            if bytes.len() > MAX_FRAME_BYTES / 2 {
                return Err(OmpAcpError::Protocol(
                    "image is too large for bounded ACP framing".to_string(),
                ));
            }
            content.push(json!({
                "type": "image",
                "mimeType": image_mime_type(image),
                "data": base64_encode(&bytes),
            }));
        }
        self.state
            .turn_text
            .lock()
            .map_err(|_| OmpAcpError::Closed("turn text state poisoned".to_string()))?
            .clear();
        self.state
            .turn_thought
            .lock()
            .map_err(|_| OmpAcpError::Closed("turn thought state poisoned".to_string()))?
            .clear();
        let id = self.reserve_pending(PendingRequest::Prompt)?;
        emit(&self.state, AgentEvent::TurnStarted);
        if let Err(error) = self.send_json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "session/prompt",
            "params": {"sessionId": session_id, "prompt": content}
        })) {
            if remove_pending(&self.state, id) {
                retire_request(&self.state, id);
                emit(
                    &self.state,
                    AgentEvent::TurnFailed {
                        error: error.to_string(),
                    },
                );
            }
            return Err(error);
        }
        Ok(())
    }

    pub fn cancel(&self) -> Result<(), OmpAcpError> {
        self.cancel_permissions()?;
        self.send_json(json!({
            "jsonrpc": "2.0",
            "method": "session/cancel",
            "params": {"sessionId": self.provider_session_id()?}
        }))
    }

    pub fn approve(&self, approval_id: &str, decision: &str) -> Result<(), OmpAcpError> {
        let mut permissions = self
            .state
            .permissions
            .lock()
            .map_err(|_| OmpAcpError::Closed("permission state poisoned".to_string()))?;
        let pending = permissions
            .get(approval_id)
            .ok_or_else(|| OmpAcpError::UnknownApproval(approval_id.to_string()))?;
        let outcome = if decision == "cancel" {
            json!({"outcome": "cancelled"})
        } else {
            let wanted = match decision {
                "accept" => "allow_once",
                "acceptForSession" => "allow_always",
                "decline" => "reject_once",
                other => {
                    return Err(OmpAcpError::Unsupported(format!(
                        "unknown approval decision {other}"
                    )))
                }
            };
            let option_id = pending
                .options
                .iter()
                .find(|option| option.kind == wanted)
                .map(|option| option.option_id.clone())
                .ok_or_else(|| {
                    OmpAcpError::Unsupported(format!(
                        "OMP did not advertise an exact {wanted} permission action"
                    ))
                })?;
            json!({"outcome": "selected", "optionId": option_id})
        };
        let pending = permissions.remove(approval_id).expect("permission exists");
        drop(permissions);
        self.send_json(json!({
            "jsonrpc": "2.0",
            "id": pending.request_id,
            "result": {"outcome": outcome}
        }))
    }

    pub fn set_model(&self, model: &str) -> Result<(), OmpAcpError> {
        let advertised = self
            .state
            .available_models
            .lock()
            .map_err(|_| OmpAcpError::Closed("model state poisoned".to_string()))?;
        if !advertised.contains(model) {
            return Err(OmpAcpError::Unsupported(format!(
                "OMP did not advertise model {model}"
            )));
        }
        drop(advertised);
        self.request(
            "session/set_config_option",
            json!({
                "sessionId": self.provider_session_id()?,
                "configId": "model",
                "value": model,
            }),
            "set model",
        )?;
        Ok(())
    }

    pub fn set_mode(&self, mode: &str) -> Result<(), OmpAcpError> {
        let advertised = self
            .state
            .available_modes
            .lock()
            .map_err(|_| OmpAcpError::Closed("mode state poisoned".to_string()))?;
        if !advertised.contains(mode) {
            return Err(OmpAcpError::Unsupported(format!(
                "OMP did not advertise mode {mode}"
            )));
        }
        drop(advertised);
        self.request(
            "session/set_mode",
            json!({"sessionId": self.provider_session_id()?, "modeId": mode}),
            "set mode",
        )?;
        Ok(())
    }

    pub fn close(&self) {
        if self.state.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Ok(mut permissions) = self.state.permissions.lock() {
            permissions.clear();
        }
        let writer = self
            .state
            .writer
            .lock()
            .ok()
            .and_then(|mut writer| writer.take());
        if let Some(writer) = writer {
            if let Ok(session_id) = self.provider_session_id() {
                let id = self.state.next_id.fetch_add(1, Ordering::SeqCst);
                let (close_tx, close_rx) = mpsc::channel();
                if let Ok(mut pending) = self.state.pending.lock() {
                    pending.insert(id, PendingRequest::Wait(close_tx));
                }
                if writer
                    .try_send(WriterMessage::Json(json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "method": "session/close",
                        "params": {"sessionId": session_id},
                    })))
                    .is_ok()
                {
                    let _ = close_rx.recv_timeout(SHUTDOWN_GRACE);
                }
                remove_pending(&self.state, id);
                retire_request(&self.state, id);
            }
            let _ = writer.try_send(WriterMessage::Close);
        }
        terminate_and_reap(&self.state);
        fail_pending(&self.state, "OMP ACP client closed");
    }

    fn request(
        &self,
        method: &'static str,
        params: Value,
        label: &'static str,
    ) -> Result<Value, OmpAcpError> {
        if self.state.closed.load(Ordering::SeqCst) {
            return Err(OmpAcpError::Closed("client is closed".to_string()));
        }
        self.request_inner(method, params, label, REQUEST_TIMEOUT)
    }


    fn request_inner(
        &self,
        method: &'static str,
        params: Value,
        label: &'static str,
        timeout: Duration,
    ) -> Result<Value, OmpAcpError> {
        let (tx, rx) = mpsc::channel();
        let id = self.reserve_pending(PendingRequest::Wait(tx))?;
        if let Err(error) = self.send_json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        })) {
            remove_pending(&self.state, id);
            retire_request(&self.state, id);
            return Err(error);
        }
        match rx.recv_timeout(timeout) {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => Err(OmpAcpError::Protocol(error)),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                remove_pending(&self.state, id);
                retire_request(&self.state, id);
                Err(OmpAcpError::Timeout(label))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(OmpAcpError::Closed(
                format!("{label} response channel closed"),
            )),
        }
    }

    fn reserve_pending(&self, pending: PendingRequest) -> Result<u64, OmpAcpError> {
        let mut requests = self
            .state
            .pending
            .lock()
            .map_err(|_| OmpAcpError::Closed("pending request state poisoned".to_string()))?;
        if self.state.closed.load(Ordering::SeqCst) {
            return Err(OmpAcpError::Closed("client is closed".to_string()));
        }
        if requests.len() >= MAX_PENDING_REQUESTS {
            return Err(OmpAcpError::Protocol(
                "too many pending ACP requests".to_string(),
            ));
        }
        let id = self.state.next_id.fetch_add(1, Ordering::SeqCst);
        requests.insert(id, pending);
        Ok(id)
    }

    fn send_json(&self, value: Value) -> Result<(), OmpAcpError> {
        if self.state.closed.load(Ordering::SeqCst) {
            return Err(OmpAcpError::Closed("client is closed".to_string()));
        }
        let encoded = serde_json::to_vec(&value)
            .map_err(|error| OmpAcpError::Protocol(error.to_string()))?;
        if encoded.len() > MAX_FRAME_BYTES {
            return Err(OmpAcpError::Protocol(
                "outgoing ACP frame exceeds size limit".to_string(),
            ));
        }
        let send_result = {
            let writer = self
                .state
                .writer
                .lock()
                .map_err(|_| OmpAcpError::Closed("writer state poisoned".to_string()))?
                .as_ref()
                .cloned()
                .ok_or_else(|| OmpAcpError::Closed("writer is closed".to_string()))?;
            if self.state.closed.load(Ordering::SeqCst) {
                return Err(OmpAcpError::Closed("client is closed".to_string()));
            }
            writer.try_send(WriterMessage::Json(value))
        };
        match send_result {
            Ok(()) => Ok(()),
            Err(mpsc::TrySendError::Full(_)) => {
                let message = "OMP ACP writer queue is full".to_string();
                transport_failed(&self.state, message.clone());
                Err(OmpAcpError::Closed(message))
            }
            Err(mpsc::TrySendError::Disconnected(_)) => {
                transport_failed(&self.state, "OMP ACP writer thread stopped".to_string());
                Err(OmpAcpError::Closed(
                    "OMP ACP writer thread stopped".to_string(),
                ))
            }
        }
    }

    fn replay_queued_updates(&self) {
        let updates = self
            .state
            .queued_updates
            .lock()
            .map(|mut updates| std::mem::take(&mut *updates))
            .unwrap_or_default();
        for update in updates {
            handle_session_update(&self.state, update);
        }
    }

    fn cancel_permissions(&self) -> Result<(), OmpAcpError> {
        let pending = self
            .state
            .permissions
            .lock()
            .map_err(|_| OmpAcpError::Closed("permission state poisoned".to_string()))?
            .drain()
            .map(|(_, pending)| pending)
            .collect::<Vec<_>>();
        for pending in pending {
            self.send_json(json!({
                "jsonrpc": "2.0",
                "id": pending.request_id,
                "result": {"outcome": {"outcome": "cancelled"}}
            }))?;
        }
        Ok(())
    }
}

impl Drop for OmpAcpClient {
    fn drop(&mut self) {
        self.close();
    }
}
fn advertised_modes(opened: &Value) -> HashSet<String> {
    opened
        .get("modes")
        .and_then(|modes| modes.get("availableModes"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|mode| mode.get("id").and_then(Value::as_str) == Some("default"))
        .filter_map(|mode| mode.get("id").and_then(Value::as_str).map(str::to_string))
        .collect()
}

fn advertised_models(opened: &Value) -> HashSet<String> {
    opened
        .get("configOptions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|option| option.get("id").and_then(Value::as_str) == Some("model"))
        .filter_map(|option| option.get("options").and_then(Value::as_array))
        .flatten()
        .filter_map(|option| {
            option
                .get("value")
                .or_else(|| option.get("id"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect()
}


fn validate_initialize(value: &Value) -> Result<OmpAcpHandshake, OmpAcpError> {
    let protocol = value.get("protocolVersion").and_then(Value::as_u64);
    if protocol != Some(ACP_PROTOCOL_VERSION) {
        return Err(OmpAcpError::Protocol(format!(
            "unsupported ACP protocol version {}; expected {ACP_PROTOCOL_VERSION}",
            protocol
                .map(|value| value.to_string())
                .unwrap_or_else(|| "missing".to_string())
        )));
    }
    let info = value
        .get("agentInfo")
        .and_then(Value::as_object)
        .ok_or_else(|| OmpAcpError::Protocol("initialize omitted agentInfo".to_string()))?;
    if info.get("name").and_then(Value::as_str) != Some("oh-my-pi") {
        return Err(OmpAcpError::Protocol(
            "ACP peer is not Oh My Pi".to_string(),
        ));
    }
    let version = info
        .get("version")
        .and_then(Value::as_str)
        .ok_or_else(|| OmpAcpError::Protocol("initialize omitted OMP version".to_string()))?;
    if version != SUPPORTED_OMP_VERSION {
        return Err(OmpAcpError::Protocol(format!(
            "unsupported OMP ACP version {version}; expected {SUPPORTED_OMP_VERSION}"
        )));
    }
    let capabilities = value
        .get("agentCapabilities")
        .and_then(Value::as_object)
        .ok_or_else(|| OmpAcpError::Protocol("initialize omitted agentCapabilities".to_string()))?;
    if capabilities.get("loadSession").and_then(Value::as_bool) != Some(true) {
        return Err(OmpAcpError::Protocol(
            "OMP ACP does not support session loading".to_string(),
        ));
    }
    let session_capabilities = capabilities
        .get("sessionCapabilities")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            OmpAcpError::Protocol("OMP ACP omitted session capabilities".to_string())
        })?;
    for required in ["resume", "close"] {
        if !session_capabilities.contains_key(required) {
            return Err(OmpAcpError::Protocol(format!(
                "OMP ACP does not advertise required session capability {required}"
            )));
        }
    }
    Ok(OmpAcpHandshake {
        agent_version: version.to_string(),
        raw: value.clone(),
    })
}

pub fn validate_omp_mcp_servers(servers: &[Value]) -> Result<(), OmpAcpError> {
    for server in servers {
        let object = server.as_object().ok_or_else(|| {
            OmpAcpError::Protocol("ACP MCP grant must be an object".to_string())
        })?;
        if object.get("type").and_then(Value::as_str) == Some("acp") {
            return Err(OmpAcpError::Unsupported(
                "nested ACP MCP transports are unsupported".to_string(),
            ));
        }
        if object
            .get("name")
            .and_then(Value::as_str)
            .is_none_or(|name| name.trim().is_empty())
        {
            return Err(OmpAcpError::Protocol(
                "ACP MCP grant must have a non-empty name".to_string(),
            ));
        }
        let transport = object.get("type").and_then(Value::as_str).unwrap_or("stdio");
        match transport {
            "stdio"
                if object
                    .get("command")
                    .and_then(Value::as_str)
                    .is_some_and(|value| !value.trim().is_empty()) =>
            {
                validate_named_values(object.get("env"), "env")?;
            }
            "http" | "sse"
                if object
                    .get("url")
                    .and_then(Value::as_str)
                    .is_some_and(|value| !value.trim().is_empty()) =>
            {
                validate_named_values(object.get("headers"), "headers")?;
            }
            "stdio" => {
                return Err(OmpAcpError::Protocol(
                    "stdio MCP grant must have a command".to_string(),
                ))
            }
            "http" | "sse" => {
                return Err(OmpAcpError::Protocol(
                    "HTTP MCP grant must have a URL".to_string(),
                ))
            }
            other => {
                return Err(OmpAcpError::Unsupported(format!(
                    "unsupported MCP transport {other}"
                )))
            }
        }
    }
    Ok(())
}

fn validate_named_values(value: Option<&Value>, field: &str) -> Result<(), OmpAcpError> {
    let Some(value) = value else {
        return Ok(());
    };
    let values = value.as_array().ok_or_else(|| {
        OmpAcpError::Protocol(format!("ACP MCP {field} must be an array of name/value objects"))
    })?;
    for value in values {
        let object = value.as_object().ok_or_else(|| {
            OmpAcpError::Protocol(format!("ACP MCP {field} entry must be an object"))
        })?;
        if object
            .get("name")
            .and_then(Value::as_str)
            .is_none_or(|name| name.trim().is_empty())
            || object.get("value").and_then(Value::as_str).is_none()
        {
            return Err(OmpAcpError::Protocol(format!(
                "ACP MCP {field} entries require string name and value"
            )));
        }
    }
    Ok(())
}

fn write_loop(mut stdin: ChildStdin, rx: mpsc::Receiver<WriterMessage>, state: Arc<ClientState>) {
    while let Ok(message) = rx.recv() {
        match message {
            WriterMessage::Json(value) => {
                let result = serde_json::to_writer(&mut stdin, &value)
                    .and_then(|_| stdin.write_all(b"\n").map_err(serde_json::Error::io))
                    .and_then(|_| stdin.flush().map_err(serde_json::Error::io));
                if let Err(error) = result {
                    transport_failed(&state, format!("failed to write ACP frame: {error}"));
                    break;
                }
            }
            WriterMessage::Close => break,
        }
    }
}

fn read_loop(mut stdout: impl Read, state: Arc<ClientState>) {
    let mut frame = Vec::with_capacity(4096);
    let mut chunk = [0_u8; 8192];
    loop {
        match stdout.read(&mut chunk) {
            Ok(0) => {
                if !frame.is_empty() {
                    if let Err(error) = parse_frame(&state, &frame) {
                        transport_failed(&state, error);
                        return;
                    }
                }
                transport_failed(&state, "OMP ACP stdout reached EOF".to_string());
                return;
            }
            Ok(count) => {
                for byte in &chunk[..count] {
                    if *byte == b'\n' {
                        if !frame.iter().all(u8::is_ascii_whitespace) {
                            if let Err(error) = parse_frame(&state, &frame) {
                                transport_failed(&state, error);
                                return;
                            }
                        }
                        frame.clear();
                    } else {
                        frame.push(*byte);
                        if frame.len() > MAX_FRAME_BYTES {
                            transport_failed(
                                &state,
                                "OMP ACP frame exceeds size limit".to_string(),
                            );
                            return;
                        }
                    }
                }
            }
            Err(error) => {
                transport_failed(&state, format!("failed to read ACP stdout: {error}"));
                return;
            }
        }
    }
}

fn parse_frame(state: &Arc<ClientState>, frame: &[u8]) -> Result<(), String> {
    let value: Value = serde_json::from_slice(frame)
        .map_err(|error| format!("malformed ACP JSON frame: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "ACP frame must be a JSON object".to_string())?;
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Err("ACP frame omitted jsonrpc 2.0".to_string());
    }
    if object.contains_key("method") {
        handle_method(state, value)
    } else if object.contains_key("id") {
        handle_response(state, value)
    } else {
        Err("ACP frame was neither request, notification, nor response".to_string())
    }
}

fn handle_method(state: &Arc<ClientState>, value: Value) -> Result<(), String> {
    let method = value
        .get("method")
        .and_then(Value::as_str)
        .ok_or_else(|| "ACP method must be a string".to_string())?;
    match method {
        "session/update" => {
            let params = value.get("params").cloned().unwrap_or(Value::Null);
            if state
                .session_id
                .lock()
                .map_err(|_| "session state poisoned".to_string())?
                .is_none()
            {
                let mut queued = state
                    .queued_updates
                    .lock()
                    .map_err(|_| "queued update state poisoned".to_string())?;
                if queued.len() >= MAX_QUEUED_UPDATES {
                    return Err("too many ACP updates before session open".to_string());
                }
                queued.push(params);
            } else {
                handle_session_update(state, params);
            }
            Ok(())
        }
        "session/request_permission" => handle_permission_request(state, value),
        // These callbacks were deliberately not advertised. Reject instead of
        // reading/writing user files, inheriting secrets, or starting terminals.
        "fs/read_text_file"
        | "fs/write_text_file"
        | "terminal/create"
        | "terminal/output"
        | "terminal/wait_for_exit"
        | "terminal/kill"
        | "terminal/release"
        | "unstable_createElicitation" => reply_error(
            state,
            value.get("id").cloned(),
            -32601,
            "client capability was not advertised",
        ),
        _ if value.get("id").is_some() => reply_error(
            state,
            value.get("id").cloned(),
            -32601,
            "unsupported OMP ACP callback",
        ),
        _ => Ok(()),
    }
}

fn handle_permission_request(state: &Arc<ClientState>, value: Value) -> Result<(), String> {
    let request_id = value
        .get("id")
        .cloned()
        .ok_or_else(|| "permission callback omitted request id".to_string())?;
    let params = value
        .get("params")
        .cloned()
        .ok_or_else(|| "permission callback omitted params".to_string())?;
    let expected_session = state
        .session_id
        .lock()
        .map_err(|_| "session state poisoned".to_string())?
        .clone();
    let actual_session = params.get("sessionId").and_then(Value::as_str);
    if expected_session.as_deref() != actual_session {
        return reply_error(
            state,
            Some(request_id),
            -32602,
            "permission callback belongs to an unknown session",
        );
    }
    let options = params
        .get("options")
        .and_then(Value::as_array)
        .ok_or_else(|| "permission callback omitted options".to_string())?
        .iter()
        .filter_map(|option| {
            Some(PermissionOption {
                option_id: option.get("optionId")?.as_str()?.to_string(),
                kind: option.get("kind")?.as_str()?.to_string(),
            })
        })
        .collect::<Vec<_>>();
    if options.is_empty() {
        return reply_error(
            state,
            Some(request_id),
            -32602,
            "permission callback has no selectable options",
        );
    }
    let approval_id = format!(
        "omp-permission-{}",
        state.next_id.fetch_add(1, Ordering::SeqCst)
    );
    let detail = serde_json::to_string(&params).unwrap_or_else(|_| "OMP permission request".into());
    state
        .permissions
        .lock()
        .map_err(|_| "permission state poisoned".to_string())?
        .insert(
            approval_id.clone(),
            PendingPermission {
                request_id,
                options,
            },
        );
    emit(state, AgentEvent::ProviderPayload {
        provider: "omp".to_string(),
        method: "session/request_permission".to_string(),
        payload: params.clone(),
    });
    emit(state, AgentEvent::ApprovalRequest {
        approval_id,
        kind: approval_kind(&params),
        detail,
    });
    Ok(())
}

fn handle_response(state: &Arc<ClientState>, value: Value) -> Result<(), String> {
    let Some(id) = value.get("id").and_then(Value::as_u64) else {
        retire_response_id(state, value.get("id"));
        return Ok(());
    };
    let pending = state
        .pending
        .lock()
        .map_err(|_| "pending request state poisoned".to_string())?
        .remove(&id);
    retire_request(state, id);
    let Some(pending) = pending else {
        return Ok(());
    };
    let result = if let Some(error) = value.get("error") {
        Err(rpc_error_message(error))
    } else {
        value
            .get("result")
            .cloned()
            .ok_or_else(|| "ACP response omitted result".to_string())
    };
    match pending {
        PendingRequest::Wait(sender) => {
            let _ = sender.send(result);
        }
        PendingRequest::Prompt => match result {
            Ok(prompt) => {
                emit_turn_finals(state);
                if let Some(usage) = prompt.get("usage") {
                    emit_prompt_usage(state, usage);
                }
                let stop_reason = prompt
                    .get("stopReason")
                    .and_then(Value::as_str)
                    .unwrap_or("end_turn");
                let status = if stop_reason == "cancelled" {
                    TurnStatus::Interrupted
                } else {
                    TurnStatus::Completed
                };
                emit(state, AgentEvent::ProviderPayload {
                    provider: "omp".to_string(),
                    method: "session/prompt".to_string(),
                    payload: prompt,
                });
                emit(state, AgentEvent::TurnDone { status });
            }
            Err(error) => {
                emit_turn_finals(state);
                emit(state, AgentEvent::TurnFailed { error });
            }
        },
    }
    Ok(())
}

fn emit_turn_finals(state: &Arc<ClientState>) {
    let text = state
        .turn_text
        .lock()
        .map(|mut text| std::mem::take(&mut *text))
        .unwrap_or_default();
    if !text.is_empty() {
        emit(state, AgentEvent::TextFinal {
            item_id: None,
            text,
        });
    }
    let thought = state
        .turn_thought
        .lock()
        .map(|mut thought| std::mem::take(&mut *thought))
        .unwrap_or_default();
    if !thought.is_empty() {
        emit(state, AgentEvent::ThinkingFinal {
            item_id: None,
            text: thought,
        });
    }
}

fn handle_session_update(state: &Arc<ClientState>, params: Value) {
    let expected = state.session_id.lock().ok().and_then(|session| session.clone());
    if expected.as_deref() != params.get("sessionId").and_then(Value::as_str) {
        transport_failed(state, "ACP update belongs to an unknown session".to_string());
        return;
    }
    emit(state, AgentEvent::ProviderPayload {
        provider: "omp".to_string(),
        method: "session/update".to_string(),
        payload: params.clone(),
    });
    let Some(update) = params.get("update") else {
        return;
    };
    match update.get("sessionUpdate").and_then(Value::as_str) {
        Some("agent_message_chunk") => {
            if let Some(text) = content_text(update.get("content")) {
                if let Ok(mut buffer) = state.turn_text.lock() {
                    buffer.push_str(&text);
                }
                emit(state, AgentEvent::TextDelta { item_id: None, text });
            }
        }
        Some("agent_thought_chunk") => {
            if let Some(text) = content_text(update.get("content")) {
                if let Ok(mut buffer) = state.turn_thought.lock() {
                    buffer.push_str(&text);
                }
                emit(state, AgentEvent::ThinkingDelta { item_id: None, text });
            }
        }
        Some("tool_call") => emit_tool_start(state, update),
        Some("tool_call_update") => emit_tool_update(state, update),
        Some("plan") => {
            let items = update
                .get("entries")
                .and_then(Value::as_array)
                .map(|entries| {
                    entries
                        .iter()
                        .filter_map(|entry| {
                            Some(PlanItem {
                                text: entry.get("content")?.as_str()?.to_string(),
                                completed: matches!(
                                    entry.get("status").and_then(Value::as_str),
                                    Some("completed")
                                ),
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            emit(state, AgentEvent::PlanUpdate { items });
        }
        Some("usage_update") => {
            let size = update.get("size").and_then(Value::as_u64);
            let used = update.get("used").and_then(Value::as_u64);
            emit(state, AgentEvent::Usage {
                input_tokens: 0,
                cached_input_tokens: 0,
                output_tokens: 0,
                cost_usd: update.get("cost").and_then(Value::as_f64),
                context_used: used,
                context_window: size,
            });
        }
        Some("session_info_update") => {
            if let Some(title) = update.get("title").and_then(Value::as_str) {
                emit(state, AgentEvent::SessionTitle {
                    title: title.to_string(),
                });
            }
        }
        _ => {}
    }
}

fn emit_tool_start(state: &Arc<ClientState>, update: &Value) {
    let item_id = update
        .get("toolCallId")
        .and_then(Value::as_str)
        .unwrap_or("omp-tool")
        .to_string();
    let title = update
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("OMP tool")
        .to_string();
    let kind = update
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("other")
        .to_string();
    let locations = tool_locations(update);
    if let Ok(mut tools) = state.tools.lock() {
        tools.insert(
            item_id.clone(),
            ToolRuntime {
                title: title.clone(),
                kind: kind.clone(),
                locations,
            },
        );
    }
    if kind == "execute" {
        let command = update
            .get("rawInput")
            .and_then(|input| input.get("command"))
            .and_then(Value::as_str)
            .unwrap_or(&title)
            .to_string();
        let cwd = update
            .get("rawInput")
            .and_then(|input| input.get("cwd"))
            .and_then(Value::as_str)
            .map(str::to_string);
        emit(state, AgentEvent::CommandStarted {
            item_id,
            command,
            cwd,
        });
    } else if kind == "search" {
        let query = update
            .get("rawInput")
            .and_then(|input| input.get("query"))
            .and_then(Value::as_str)
            .unwrap_or(&title)
            .to_string();
        emit(state, AgentEvent::WebSearch { item_id, query });
    } else {
        emit(state, AgentEvent::ToolUse {
            item_id,
            name: title,
            status: ToolCallStatus::InProgress,
            detail: update.get("rawInput").map(Value::to_string),
        });
    }
}

fn emit_tool_update(state: &Arc<ClientState>, update: &Value) {
    let item_id = update
        .get("toolCallId")
        .and_then(Value::as_str)
        .unwrap_or("omp-tool")
        .to_string();
    let runtime = state.tools.lock().ok().and_then(|tools| tools.get(&item_id).cloned());
    let status = update
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("in_progress");
    let tail = update
        .get("rawOutput")
        .map(|value| value.as_str().map(str::to_string).unwrap_or_else(|| value.to_string()));
    if runtime.as_ref().map(|tool| tool.kind.as_str()) == Some("execute") {
        let command_status = match status {
            "completed" => CommandStatus::Completed,
            "failed" => CommandStatus::Failed,
            _ => return,
        };
        emit(state, AgentEvent::CommandDone {
            item_id,
            exit_code: update
                .get("rawOutput")
                .and_then(|output| output.get("exitCode"))
                .and_then(Value::as_i64)
                .and_then(|code| i32::try_from(code).ok()),
            status: command_status,
            output_tail: tail,
        });
    } else if let Some(runtime) = runtime
        .as_ref()
        .filter(|tool| matches!(tool.kind.as_str(), "edit" | "delete" | "move"))
    {
        if status == "completed" {
            let change_kind = match runtime.kind.as_str() {
                "delete" => FileChangeKind::Delete,
                "move" => FileChangeKind::Rename,
                _ => FileChangeKind::Modify,
            };
            let locations = if runtime.locations.is_empty() {
                tool_locations(update)
            } else {
                runtime.locations.clone()
            };
            if !locations.is_empty() {
                emit(state, AgentEvent::FileChange {
                    item_id: item_id.clone(),
                    changes: locations
                        .into_iter()
                        .map(|path| FileChangeEntry {
                            path,
                            kind: change_kind.clone(),
                            diff: None,
                        })
                        .collect(),
                });
            }
        }
        let tool_status = match status {
            "completed" => ToolCallStatus::Completed,
            "failed" => ToolCallStatus::Failed,
            _ => ToolCallStatus::InProgress,
        };
        emit(state, AgentEvent::ToolUse {
            item_id,
            name: runtime.title.clone(),
            status: tool_status,
            detail: tail,
        });
    } else {
        let tool_status = match status {
            "completed" => ToolCallStatus::Completed,
            "failed" => ToolCallStatus::Failed,
            _ => ToolCallStatus::InProgress,
        };
        emit(state, AgentEvent::ToolUse {
            item_id,
            name: runtime
                .map(|tool| tool.title)
                .or_else(|| update.get("title").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_else(|| "OMP tool".to_string()),
            status: tool_status,
            detail: tail,
        });
    }
}

fn tool_locations(update: &Value) -> Vec<String> {
    update
        .get("locations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|location| {
            location
                .get("path")
                .and_then(Value::as_str)
                .or_else(|| location.as_str())
                .map(str::to_string)
        })
        .collect()
}

fn emit_prompt_usage(state: &Arc<ClientState>, usage: &Value) {
    emit(state, AgentEvent::Usage {
        input_tokens: usage
            .get("inputTokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        cached_input_tokens: usage
            .get("cachedReadTokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        output_tokens: usage
            .get("outputTokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        cost_usd: None,
        // Prompt usage is a per-turn delta. Only ACP usage_update carries the
        // cumulative context occupancy used by the context meter.
        context_used: None,
        context_window: None,
    });
}

fn content_text(content: Option<&Value>) -> Option<String> {
    let content = content?;
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    content
        .get("text")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn approval_kind(params: &Value) -> ApprovalKind {
    match params
        .get("toolCall")
        .and_then(|tool| tool.get("kind"))
        .and_then(Value::as_str)
    {
        Some("execute") => ApprovalKind::Command,
        Some("edit" | "delete" | "move") => ApprovalKind::FileChange,
        _ => ApprovalKind::ToolUse,
    }
}

fn reply_error(
    state: &Arc<ClientState>,
    id: Option<Value>,
    code: i64,
    message: &str,
) -> Result<(), String> {
    let Some(id) = id else {
        return Ok(());
    };
    send_from_state(
        state,
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {"code": code, "message": message}
        }),
    )
}

fn send_from_state(state: &Arc<ClientState>, value: Value) -> Result<(), String> {
    if state.closed.load(Ordering::SeqCst) {
        return Err("client is closed".to_string());
    }
    let encoded = serde_json::to_vec(&value).map_err(|error| error.to_string())?;
    if encoded.len() > MAX_FRAME_BYTES {
        return Err("outgoing ACP frame exceeds size limit".to_string());
    }
    let send_result = {
        let writer = state
            .writer
            .lock()
            .map_err(|_| "writer state poisoned".to_string())?
            .as_ref()
            .cloned()
            .ok_or_else(|| "writer is closed".to_string())?;
        if state.closed.load(Ordering::SeqCst) {
            return Err("client is closed".to_string());
        }
        writer.try_send(WriterMessage::Json(value))
    };
    match send_result {
        Ok(()) => Ok(()),
        Err(mpsc::TrySendError::Full(_)) => {
            let message = "OMP ACP writer queue is full".to_string();
            transport_failed(state, message.clone());
            Err(message)
        }
        Err(mpsc::TrySendError::Disconnected(_)) => {
            let message = "OMP ACP writer thread stopped".to_string();
            transport_failed(state, message.clone());
            Err(message)
        }
    }
}

fn emit(state: &Arc<ClientState>, event: AgentEvent) {
    let sink = state.sink.lock().ok().map(|sink| Arc::clone(&sink));
    if let Some(sink) = sink {
        sink(event);
    }
}

fn rpc_error_message(error: &Value) -> String {
    let code = error.get("code").and_then(Value::as_i64).unwrap_or(-32000);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("unknown ACP error");
    format!("ACP error {code}: {message}")
}

fn remove_pending(state: &Arc<ClientState>, id: u64) -> bool {
    state
        .pending
        .lock()
        .map(|mut pending| pending.remove(&id).is_some())
        .unwrap_or(false)
}

fn retire_request(state: &Arc<ClientState>, id: u64) {
    let id = id.to_string();
    retire_response_id(state, Some(&Value::String(id)));
}

fn retire_response_id(state: &Arc<ClientState>, id: Option<&Value>) {
    let key = id
        .map(|value| serde_json::to_string(value).unwrap_or_else(|_| "null".to_string()))
        .unwrap_or_else(|| "<missing>".to_string());
    if let Ok(mut retired) = state.retired_response_ids.lock() {
        if retired.len() >= MAX_RETIRED_REQUESTS {
            retired.clear();
        }
        retired.insert(key);
    }
}

fn take_pending(state: &Arc<ClientState>) -> Vec<PendingRequest> {
    state
        .pending
        .lock()
        .map(|mut pending| pending.drain().map(|(_, pending)| pending).collect())
        .unwrap_or_default()
}

fn take_pending_on_first_transport_failure(state: &Arc<ClientState>) -> Option<Vec<PendingRequest>> {
    let mut pending = state.pending.lock().ok()?;
    if state.closed.swap(true, Ordering::SeqCst) {
        return None;
    }
    Some(pending.drain().map(|(_, pending)| pending).collect())
}

fn fail_requests(state: &Arc<ClientState>, pending: Vec<PendingRequest>, message: &str) {
    for pending in pending {
        match pending {
            PendingRequest::Wait(sender) => {
                let _ = sender.send(Err(message.to_string()));
            }
            PendingRequest::Prompt => {
                emit_turn_finals(state);
                emit(state, AgentEvent::TurnFailed {
                    error: message.to_string(),
                });
            }
        }
    }
}

fn fail_pending(state: &Arc<ClientState>, message: &str) {
    fail_requests(state, take_pending(state), message);
}

fn transport_failed(state: &Arc<ClientState>, message: String) {
    // The closed transition and pending drain share one lock acquisition. A
    // response that won before this transition may complete normally; after it,
    // neither a response nor a prompt cleanup can observe a pending request.
    let Some(pending) = take_pending_on_first_transport_failure(state) else {
        return;
    };
    if let Ok(mut writer) = state.writer.lock() {
        writer.take();
    }
    if let Ok(mut permissions) = state.permissions.lock() {
        permissions.clear();
    }
    terminate_and_reap(state);
    fail_requests(state, pending, &message);
}

fn terminate_and_reap(state: &Arc<ClientState>) {
    let child = state.child.lock().ok().and_then(|mut child| child.take());
    #[cfg(windows)]
    let job = state.job.lock().ok().and_then(|mut job| job.take());

    if let Some(mut child) = child {
        let child_id = child.id();
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        while Instant::now() < deadline {
            match child.try_wait() {
                Ok(Some(_)) | Err(_) => break,
                Ok(None) => thread::sleep(Duration::from_millis(10)),
            }
        }
        // Always terminate the ownership boundary, even if the direct child has
        // already exited. Descendants can keep the process group/job alive after
        // their parent is gone.
        #[cfg(unix)]
        unsafe {
            libc::killpg(child_id as libc::pid_t, libc::SIGKILL);
        }
        #[cfg(windows)]
        if let Some(job) = job {
            terminate_and_close_job(job);
        }
        let _ = child.kill();
        let _ = child.wait();
    } else {
        #[cfg(windows)]
        if let Some(job) = job {
            terminate_and_close_job(job);
        }
    }
}

fn controlled_omp_environment(
) -> Vec<(std::ffi::OsString, std::ffi::OsString)> {
    std::env::vars_os()
        .filter(|(name, _)| {
            let name = name.to_string_lossy();
            OMP_ENV_ALLOWLIST
                .iter()
                .any(|allowed| name.eq_ignore_ascii_case(allowed))
        })
        .collect()
}

#[cfg(windows)]
fn create_kill_on_close_job(child: &Child) -> std::io::Result<isize> {
    use std::mem::{size_of, zeroed};
    use std::os::windows::io::AsRawHandle;

    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&raw const limits).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
            || AssignProcessToJobObject(job, child.as_raw_handle().cast()) == 0
        {
            let error = std::io::Error::last_os_error();
            CloseHandle(job);
            return Err(error);
        }
        Ok(job as isize)
    }
}

#[cfg(windows)]
fn terminate_and_close_job(job: isize) {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::TerminateJobObject;

    unsafe {
        let job = job as HANDLE;
        let _ = TerminateJobObject(job, 1);
        let _ = CloseHandle(job);
    }
}

fn drain(mut stderr: impl Read) {
    let mut buffer = [0_u8; 8192];
    while let Ok(count) = stderr.read(&mut buffer) {
        if count == 0 {
            break;
        }
    }
}

fn image_mime_type(path: &str) -> &'static str {
    match PathBuf::from(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "image/png",
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let a = chunk[0];
        let b = chunk.get(1).copied().unwrap_or(0);
        let c = chunk.get(2).copied().unwrap_or(0);
        out.push(TABLE[(a >> 2) as usize] as char);
        out.push(TABLE[(((a & 0x03) << 4) | (b >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(((b & 0x0f) << 2) | (c >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(c & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    #[cfg(any(unix, windows))]
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    #[cfg(unix)]
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::path::Path;
    use std::sync::{Barrier, Mutex};
    #[cfg(any(unix, windows))]
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    #[cfg(unix)]
    struct Fixture {
        dir: PathBuf,
        binary: PathBuf,
        log: PathBuf,
    }

    #[cfg(unix)]
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    #[cfg(unix)]
    static FIXTURE_SEQUENCE: AtomicU64 = AtomicU64::new(0);


    #[cfg(unix)]
    fn fixture(body: &str) -> Fixture {
        let sequence = FIXTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "pickforge-omp-acp-{}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let binary = dir.join("omp");
        let log = dir.join("stdin.jsonl");
        fs::write(
            &binary,
            format!(
                "#!/bin/sh\nlog='{}'\nprintf 'argv:%s\\n' \"$*\" >> \"$log\"\nprintf 'synthetic:%s\\n' \"${{PICKFORGE_OMP_TEST_SECRET-unset}}\" >> \"$log\"\nprintf 'home:%s\\n' \"${{HOME+present}}\" >> \"$log\"\n{}\n",
                log.display(),
                body
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&binary).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&binary, permissions).unwrap();
        Fixture { dir, binary, log }
    }

    #[cfg(unix)]
    fn standard_script(extra_prompt: &str) -> Fixture {
        fixture(&format!(
            r#"while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentInfo":{{"name":"oh-my-pi","title":"Oh My Pi","version":"16.4.8"}},"agentCapabilities":{{"loadSession":true,"sessionCapabilities":{{"resume":{{}},"close":{{}}}}}},"_meta":{{"fixture":true}}}}}}'
      ;;
    *'"method":"session/new"'*)
      printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{"sessionId":"omp-session-1","modes":{{"availableModes":[{{"id":"default"}},{{"id":"plan"}}]}},"configOptions":[{{"id":"model","options":[{{"value":"openai/gpt-test"}}]}}]}}}}'
      ;;
    *'"method":"session/resume"'*)
      printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{"modes":{{"availableModes":[{{"id":"default"}}]}}}}}}'
      ;;
    *'"method":"session/load"'*)
      printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{"modes":{{"availableModes":[{{"id":"default"}}]}}}}}}'
      ;;
    *'"method":"session/set_config_option"'*)
      printf '%s\n' '{{"jsonrpc":"2.0","id":3,"result":{{"configOptions":[]}}}}'
      ;;
    *'"method":"session/set_mode"'*)
      printf '%s\n' '{{"jsonrpc":"2.0","id":4,"result":{{}}}}'
      ;;
    *'"method":"session/prompt"'*)
      {extra_prompt}
      ;;
    *'"method":"session/cancel"'*)
      printf '%s\n' '{{"jsonrpc":"2.0","id":3,"result":{{"stopReason":"cancelled"}}}}'
      ;;
    *'"method":"session/close"'*)
      printf '%s\n' '{{"jsonrpc":"2.0","id":4,"result":{{}}}}'
      exit 0
      ;;
  esac
done"#
        ))
    }

    #[cfg(unix)]
    fn options(
        fixture: &Fixture,
        events: Arc<Mutex<Vec<AgentEvent>>>,
        resume: Option<&str>,
    ) -> OmpAcpOptions {
        OmpAcpOptions {
            binary: fixture.binary.clone(),
            project_root: fixture.dir.clone(),
            session: resume
                .map(|session| OmpAcpSessionOpen::Resume(session.to_string()))
                .unwrap_or(OmpAcpSessionOpen::New),
            model: None,
            mcp_servers: vec![json!({
                "name": "pickforge",
                "command": "/tmp/pickforge-mcp",
                "args": []
            })],
            sink: Arc::new(move |event| events.lock().unwrap().push(event)),
        }
    }

    #[cfg(unix)]
    fn spawn_fixture(options: OmpAcpOptions) -> Result<OmpAcpClient, OmpAcpError> {
        for attempt in 0..10 {
            match OmpAcpClient::spawn(options.clone()) {
                Err(OmpAcpError::Spawn(error))
                    if error.raw_os_error() == Some(libc::ETXTBSY) && attempt < 9 =>
                {
                    thread::sleep(Duration::from_millis(10));
                }
                result => return result,
            }
        }
        unreachable!("retry loop always returns")
    }

    fn wait_for(events: &Arc<Mutex<Vec<AgentEvent>>>, predicate: impl Fn(&AgentEvent) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if events.lock().is_ok_and(|events| events.iter().any(&predicate)) {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        let observed = events
            .lock()
            .map(|events| format!("{events:?}"))
            .unwrap_or_else(|poison| format!("{:?}", poison.into_inner()));
        panic!("event not observed: {observed}");
    }

    #[cfg(unix)]
    fn wait_for_event(
        events: &mpsc::Receiver<AgentEvent>,
        predicate: impl Fn(&AgentEvent) -> bool,
    ) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
            match events.recv_timeout(remaining) {
                Ok(event) if predicate(&event) => return,
                Ok(_) => {}
                Err(mpsc::RecvTimeoutError::Timeout | mpsc::RecvTimeoutError::Disconnected) => {
                    break;
                }
            }
        }
        panic!("event not received");
    }

    #[cfg(unix)]
    #[test]
    fn handshake_streams_updates_and_preserves_raw_payloads() {
        let fixture = standard_script(
            r#"printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"omp-session-1","update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"think"}}}}'
printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"omp-session-1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}}}}'
printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"omp-session-1","update":{"sessionUpdate":"plan","entries":[{"content":"ship","priority":"medium","status":"completed"}]}}}'
printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"omp-session-1","update":{"sessionUpdate":"usage_update","size":100,"used":25,"cost":0.01}}}'
printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"omp-session-1","update":{"sessionUpdate":"session_info_update","title":"Fixture title","updatedAt":"now"}}}'
printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"omp-session-1","update":{"sessionUpdate":"tool_call","toolCallId":"edit-1","title":"Edit file","kind":"edit","status":"pending","locations":[{"path":"/tmp/project/src/lib.rs"}]}}}'
printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"omp-session-1","update":{"sessionUpdate":"tool_call_update","toolCallId":"edit-1","status":"completed"}}}'
printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"omp-session-1","update":{"sessionUpdate":"tool_call","toolCallId":"exec-1","title":"Run tests","kind":"execute","status":"pending","rawInput":{"command":"cargo test","cwd":"/tmp/project"}}}}'
printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"omp-session-1","update":{"sessionUpdate":"tool_call_update","toolCallId":"exec-1","status":"completed","rawOutput":{"exitCode":0,"output":"ok"}}}}'
printf '%s\n' '{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn","usage":{"inputTokens":2,"outputTokens":3,"totalTokens":5,"cachedReadTokens":1}}}'"#,
        );
        let events = Arc::new(Mutex::new(Vec::new()));
        let client = spawn_fixture(options(&fixture, Arc::clone(&events), None)).unwrap();
        assert_eq!(client.handshake().unwrap().agent_version, "16.4.8");
        client.prompt("hello", &[]).unwrap();
        wait_for(&events, |event| matches!(event, AgentEvent::TurnDone { .. }));
        let events = events.lock().unwrap();
        assert!(events.iter().any(|event| matches!(event, AgentEvent::ThinkingDelta { text, .. } if text == "think")));
        assert!(events.iter().any(|event| matches!(event, AgentEvent::TextDelta { text, .. } if text == "hello")));
        assert!(events.iter().any(|event| matches!(event, AgentEvent::PlanUpdate { items } if items[0].completed)));
        assert!(events.iter().any(|event| matches!(
            event,
            AgentEvent::FileChange { item_id, changes }
                if item_id == "edit-1"
                    && changes[0].path == "/tmp/project/src/lib.rs"
                    && changes[0].kind == FileChangeKind::Modify
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            AgentEvent::CommandStarted { item_id, command, .. }
                if item_id == "exec-1" && command == "cargo test"
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            AgentEvent::CommandDone { item_id, status, .. }
                if item_id == "exec-1" && *status == CommandStatus::Completed
        )));
        assert!(events.iter().any(|event| matches!(event, AgentEvent::SessionTitle { title } if title == "Fixture title")));
        assert!(events.iter().any(|event| matches!(event, AgentEvent::ProviderPayload { method, .. } if method == "session/update")));
        let usage_events = events
            .iter()
            .filter_map(|event| match event {
                AgentEvent::Usage {
                    input_tokens,
                    output_tokens,
                    context_used,
                    context_window,
                    ..
                } => Some((*input_tokens, *output_tokens, *context_used, *context_window)),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(usage_events.contains(&(0, 0, Some(25), Some(100))));
        assert!(usage_events.contains(&(2, 3, None, None)));
    }

    #[cfg(unix)]
    #[test]
    fn permission_round_trip_selects_exact_advertised_action() {
        let fixture = standard_script(
            r#"printf '%s\n' '{"jsonrpc":"2.0","id":"permission-7","method":"session/request_permission","params":{"sessionId":"omp-session-1","toolCall":{"toolCallId":"tool-1","title":"Run tests","kind":"execute","status":"pending"},"options":[{"optionId":"once-7","name":"Allow once","kind":"allow_once"},{"optionId":"always-7","name":"Always","kind":"allow_always"},{"optionId":"reject-7","name":"Reject","kind":"reject_once"}]}}'"#,
        );
        let events = Arc::new(Mutex::new(Vec::new()));
        let client = spawn_fixture(options(&fixture, Arc::clone(&events), None)).unwrap();
        client.prompt("permission", &[]).unwrap();
        wait_for(&events, |event| matches!(event, AgentEvent::ApprovalRequest { .. }));
        let approval_id = events
            .lock()
            .unwrap()
            .iter()
            .find_map(|event| match event {
                AgentEvent::ApprovalRequest { approval_id, .. } => Some(approval_id.clone()),
                _ => None,
            })
            .unwrap();
        client.approve(&approval_id, "accept").unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        while Instant::now() < deadline {
            let log = fs::read_to_string(&fixture.log).unwrap_or_default();
            if log.contains("\\\"optionId\\\":\\\"once-7\\\"") || log.contains("\"optionId\":\"once-7\"") {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("permission response missing: {}", fs::read_to_string(&fixture.log).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn resume_cancel_and_close_are_protocol_exact() {
        let fixture = standard_script(":");
        let events = Arc::new(Mutex::new(Vec::new()));
        let client = spawn_fixture(options(
            &fixture,
            Arc::clone(&events),
            Some("  opaque/OMP session  "),
        ))
        .unwrap();
        assert_eq!(client.provider_session_id().unwrap(), "  opaque/OMP session  ");
        client.prompt("wait", &[]).unwrap();
        client.cancel().unwrap();
        wait_for(&events, |event| matches!(event, AgentEvent::TurnDone { status: TurnStatus::Interrupted }));
        client.close();
        let log = fs::read_to_string(&fixture.log).unwrap();
        assert!(log.contains("\"method\":\"session/resume\""));
        assert!(log.contains("\"sessionId\":\"  opaque/OMP session  \""));
        assert!(log.contains("\"method\":\"session/cancel\""));
        assert!(log.contains("\"method\":\"session/close\""));
        assert!(log.contains("\"mcpServers\":[{\"args\":[],\"command\":\"/tmp/pickforge-mcp\",\"name\":\"pickforge\"}]"));
        assert!(log.contains("argv:acp --no-extensions --approval-mode=always-ask"));
    }

    #[cfg(unix)]
    #[test]
    fn switches_only_advertised_models_and_modes() {
        let fixture = standard_script(":");
        let events = Arc::new(Mutex::new(Vec::new()));
        let client = spawn_fixture(options(&fixture, events, None)).unwrap();

        client.set_model("openai/gpt-test").unwrap();
        client.set_mode("default").unwrap();
        assert!(matches!(
            client.set_model("provider/not-advertised"),
            Err(OmpAcpError::Unsupported(_))
        ));
        assert!(matches!(
            client.set_mode("plan"),
            Err(OmpAcpError::Unsupported(_))
        ));
        let log = fs::read_to_string(&fixture.log).unwrap();
        assert!(log.contains("\"configId\":\"model\""));
        assert!(log.contains("\"value\":\"openai/gpt-test\""));
        assert!(log.contains("\"method\":\"session/set_mode\""));
        assert!(log.contains("\"modeId\":\"default\""));
        assert!(!log.contains("provider/not-advertised"));
        assert!(!log.contains("\"modeId\":\"plan\""));
        drop(client);
    }

    #[cfg(unix)]
    #[test]
    fn load_uses_the_distinct_acp_restore_method() {
        let fixture = standard_script(":");
        let events = Arc::new(Mutex::new(Vec::new()));
        let mut opts = options(&fixture, events, None);
        opts.session = OmpAcpSessionOpen::Load("opaque/load#session".to_string());
        let client = spawn_fixture(opts).unwrap();
        assert_eq!(client.provider_session_id().unwrap(), "opaque/load#session");

        let log = fs::read_to_string(&fixture.log).unwrap();
        assert!(log.contains("\"method\":\"session/load\""));
        assert!(!log.contains("\"method\":\"session/resume\""));
        drop(client);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_wrong_version_and_unsupported_mcp_without_mutating_session() {
        let fixture = fixture(
            r#"while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":2,"agentInfo":{"name":"oh-my-pi","version":"16.4.8"},"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{},"close":{}}}}}' ;;
  esac
done"#,
        );
        let events = Arc::new(Mutex::new(Vec::new()));
        assert!(matches!(
            spawn_fixture(options(&fixture, events, None)),
            Err(OmpAcpError::Protocol(_))
        ));
        assert!(matches!(
            validate_omp_mcp_servers(&[json!({"name":"nested","type":"acp","url":"x"})]),
            Err(OmpAcpError::Unsupported(_))
        ));
        assert!(matches!(
            validate_omp_mcp_servers(&[json!({
                "name": "pickforge",
                "command": "pickforge-mcp",
                "env": {"PICKFORGE_IPC_ENDPOINT": "/tmp/socket"}
            })]),
            Err(OmpAcpError::Protocol(_))
        ));
        validate_omp_mcp_servers(&[json!({
            "name": "pickforge",
            "command": "pickforge-mcp",
            "env": [{"name": "PICKFORGE_IPC_ENDPOINT", "value": "/tmp/socket"}]
        })])
        .unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn late_duplicate_and_unknown_responses_do_not_close_an_active_prompt() {
        let marker_sequence = FIXTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let slow_requested = std::env::temp_dir().join(format!(
            "pickforge-omp-acp-slow-requested-{}-{marker_sequence}",
            std::process::id()
        ));
        let release_slow = std::env::temp_dir().join(format!(
            "pickforge-omp-acp-release-slow-{}-{marker_sequence}",
            std::process::id()
        ));
        let _ = fs::remove_file(&slow_requested);
        let _ = fs::remove_file(&release_slow);
        let fixture = fixture(
            &r#"while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"oh-my-pi","version":"16.4.8"},"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{},"close":{}}}}}' ;;
    *'"method":"session/new"'*) printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"sessionId":"omp-session-1"}}' ;;
    *'"method":"test/slow"'*)
      request_id=${line#*\"id\":}; request_id=${request_id%%,*}
      printf requested > "__PICKFORGE_SLOW_REQUESTED__"
      while [ ! -e "__PICKFORGE_RELEASE_SLOW__" ]; do sleep 0.01; done
      printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":$request_id,\"result\":{\"late\":true}}"
      ;;
    *'"method":"session/prompt"'*)
      request_id=${line#*\"id\":}; request_id=${request_id%%,*}
      (
        sleep 0.20
        printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"duplicate":true}}'
        printf '%s\n' '{"jsonrpc":"2.0","id":"never-issued","result":{"unknown":true}}'
        printf '%s\n' '{"jsonrpc":"2.0","id":999999,"result":{"unknown":true}}'
        printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":$request_id,\"result\":{\"stopReason\":\"end_turn\"}}"
      ) &
      ;;
  esac
done"#
                .replace(
                    "__PICKFORGE_SLOW_REQUESTED__",
                    &slow_requested.to_string_lossy(),
                )
                .replace("__PICKFORGE_RELEASE_SLOW__", &release_slow.to_string_lossy()),
        );
        let events = Arc::new(Mutex::new(Vec::new()));
        let client = spawn_fixture(options(&fixture, Arc::clone(&events), None)).unwrap();

        thread::scope(|scope| {
            let (result_tx, result_rx) = mpsc::channel();
            let client = &client;
            scope.spawn(move || {
                let _ = result_tx.send(client.request_inner(
                    "test/slow",
                    json!({}),
                    "deliberately slow request",
                    Duration::from_secs(1),
                ));
            });
            let deadline = Instant::now() + Duration::from_secs(2);
            while !slow_requested.exists() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(10));
            }
            let marker_seen = slow_requested.exists();
            let before_release = result_rx.try_recv();
            let unavailable_before_release =
                matches!(&before_release, Err(mpsc::TryRecvError::Empty));
            let slow_result = match before_release {
                Ok(result) => Some(result),
                Err(mpsc::TryRecvError::Empty) => result_rx
                    .recv_timeout(Duration::from_secs(2))
                    .ok(),
                Err(mpsc::TryRecvError::Disconnected) => None,
            };
            fs::write(&release_slow, "").unwrap();
            assert!(marker_seen, "slow request never reached fixture");
            assert!(
                unavailable_before_release,
                "slow request completed before its release marker"
            );
            assert!(matches!(
                slow_result,
                Some(Err(OmpAcpError::Timeout("deliberately slow request")))
            ));
        });
        client.prompt("first", &[]).unwrap();
        wait_for(&events, |event| matches!(event, AgentEvent::TurnDone { .. }));
        assert!(!client.is_closed());
        assert!(client.state.pending.lock().unwrap().is_empty());
        assert!(client.state.retired_response_ids.lock().unwrap().len() >= 4);

        client.prompt("second", &[]).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            let done = events
                .lock()
                .unwrap()
                .iter()
                .filter(|event| matches!(event, AgentEvent::TurnDone { .. }))
                .count();
            if done == 2 {
                assert!(!client.is_closed());
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|event| matches!(event, AgentEvent::TurnDone { .. }))
                .count(),
            2,
            "second prompt did not complete after retired responses"
        );
        let _ = fs::remove_file(&slow_requested);
        let _ = fs::remove_file(&release_slow);
    }

    #[cfg(unix)]
    #[test]
    fn malformed_and_oversize_frames_fail_closed_and_reap() {
        for body in [
            r#"printf '%s\n' 'not-json'"#.to_string(),
            format!("printf '%{}s\\n' x", MAX_FRAME_BYTES + 1),
        ] {
            let fixture = fixture(&body);
            let events = Arc::new(Mutex::new(Vec::new()));
            assert!(matches!(
                spawn_fixture(options(&fixture, events, None)),
                Err(OmpAcpError::Protocol(_) | OmpAcpError::Closed(_))
            ));
        }
    }

    #[cfg(unix)]
    #[test]
    fn crash_during_prompt_closes_transport_drains_races_and_reaps_child() {
        let fixture = standard_script("exit 9");
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink_events = Arc::clone(&events);
        let (event_tx, event_rx) = mpsc::channel();
        let mut opts = options(&fixture, Arc::clone(&events), None);
        opts.sink = Arc::new(move |event| {
            if let Ok(mut events) = sink_events.lock() {
                events.push(event.clone());
            }
            let _ = event_tx.send(event);
        });
        let client = spawn_fixture(opts).unwrap();
        client.prompt("crash", &[]).unwrap();
        wait_for_event(&event_rx, |event| matches!(event, AgentEvent::TurnFailed { .. }));
        assert!(client.is_closed());
        assert!(client.state.child.lock().unwrap().is_none());
        assert!(client.state.writer.lock().unwrap().is_none());
        assert!(client.state.pending.lock().unwrap().is_empty());

        let events_before_buffered_response = events.lock().unwrap().len();
        handle_response(
            &client.state,
            json!({"jsonrpc": "2.0", "id": 3, "result": {"stopReason": "end_turn"}}),
        )
        .unwrap();
        assert_eq!(
            events.lock().unwrap().len(),
            events_before_buffered_response,
            "a buffered response after the pending drain must be ignored"
        );

        let starts_before = events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| matches!(event, AgentEvent::TurnStarted))
            .count();
        assert!(matches!(
            client.prompt("must reject synchronously", &[]),
            Err(OmpAcpError::Closed(_))
        ));
        assert!(matches!(
            client.send_json(json!({"jsonrpc": "2.0", "method": "test"})),
            Err(OmpAcpError::Closed(_))
        ));
        assert_eq!(
            events
                .lock()
                .unwrap()
                .iter()
                .filter(|event| matches!(event, AgentEvent::TurnStarted))
                .count(),
            starts_before
        );

        let (wait_tx, wait_rx) = mpsc::channel();
        {
            let mut pending = client.state.pending.lock().unwrap();
            pending.insert(900, PendingRequest::Wait(wait_tx));
            pending.insert(901, PendingRequest::Prompt);
        }
        transport_failed(&client.state, "repeated transport failure".to_string());
        assert!(matches!(
            wait_rx.recv_timeout(Duration::from_millis(100)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        assert_eq!(client.state.pending.lock().unwrap().len(), 2);
        assert!(matches!(
            event_rx.recv_timeout(Duration::from_millis(100)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        let _ = take_pending(&client.state);

        let deadline = Instant::now() + Duration::from_secs(2);
        while Arc::strong_count(&client.state) != 1 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            Arc::strong_count(&client.state),
            1,
            "writer/reader transport ownership cycle survived failure"
        );
    }

    #[cfg(unix)]
    #[test]
    fn concurrent_transport_failures_have_one_terminal_owner() {
        let (event_tx, event_rx) = mpsc::channel();
        let state = Arc::new(ClientState {
            writer: Mutex::new(None),
            child: Mutex::new(None),
            pending: Mutex::new(HashMap::from([(1, PendingRequest::Prompt)])),
            retired_response_ids: Mutex::new(HashSet::new()),
            next_id: AtomicU64::new(2),
            closed: AtomicBool::new(false),
            session_id: Mutex::new(None),
            sink: Mutex::new(Arc::new(move |event| {
                let _ = event_tx.send(event);
            })),
            queued_updates: Mutex::new(Vec::new()),
            permissions: Mutex::new(HashMap::new()),
            tools: Mutex::new(HashMap::new()),
            handshake: Mutex::new(None),
            available_modes: Mutex::new(HashSet::new()),
            available_models: Mutex::new(HashSet::new()),
            turn_text: Mutex::new(String::new()),
            turn_thought: Mutex::new(String::new()),
        });
        let barrier = Arc::new(Barrier::new(3));
        thread::scope(|scope| {
            for message in ["first failure", "second failure"] {
                let state = Arc::clone(&state);
                let barrier = Arc::clone(&barrier);
                scope.spawn(move || {
                    barrier.wait();
                    transport_failed(&state, message.to_string());
                });
            }
            barrier.wait();
        });

        assert!(matches!(
            event_rx.recv_timeout(Duration::from_secs(1)),
            Ok(AgentEvent::TurnFailed { .. })
        ));
        assert!(matches!(
            event_rx.recv_timeout(Duration::from_millis(100)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        assert!(state.closed.load(Ordering::SeqCst));
        assert!(state.pending.lock().unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn full_writer_queue_fails_closed_drains_pending_and_reaps_process_tree() {
        use std::os::unix::process::CommandExt;

        let fixture = fixture(":");
        let ready = fixture.dir.join("backpressure.ready");
        let survivor = fixture.dir.join("backpressure.survived");
        let script = format!(
            "(sleep 0.4; printf survived > '{}') & printf ready > '{}'; wait",
            survivor.display(),
            ready.display(),
        );
        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg(script)
            .process_group(0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = command.spawn().unwrap();
        let ready_deadline = Instant::now() + Duration::from_secs(2);
        while !ready.exists() && Instant::now() < ready_deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(ready.exists(), "backpressure process fixture did not start");

        let (writer, writer_rx) = mpsc::sync_channel(1);
        writer
            .try_send(WriterMessage::Json(json!({"queued": true})))
            .unwrap();
        let (wait_tx, wait_rx) = mpsc::channel();
        let events = Arc::new(Mutex::new(Vec::new()));
        let event_sink = Arc::clone(&events);
        let state = Arc::new(ClientState {
            writer: Mutex::new(Some(writer)),
            child: Mutex::new(Some(child)),
            pending: Mutex::new(HashMap::from([
                (1, PendingRequest::Wait(wait_tx)),
                (2, PendingRequest::Prompt),
            ])),
            retired_response_ids: Mutex::new(HashSet::new()),
            next_id: AtomicU64::new(3),
            closed: AtomicBool::new(false),
            session_id: Mutex::new(Some("backpressure-session".to_string())),
            sink: Mutex::new(Arc::new(move |event| {
                event_sink.lock().unwrap().push(event);
            })),
            queued_updates: Mutex::new(Vec::new()),
            permissions: Mutex::new(HashMap::new()),
            tools: Mutex::new(HashMap::new()),
            handshake: Mutex::new(None),
            available_modes: Mutex::new(HashSet::new()),
            available_models: Mutex::new(HashSet::new()),
            turn_text: Mutex::new(String::new()),
            turn_thought: Mutex::new(String::new()),
        });
        let client = OmpAcpClient { state };

        assert!(matches!(
            client.send_json(json!({"jsonrpc": "2.0", "method": "session/prompt"})),
            Err(OmpAcpError::Closed(message)) if message == "OMP ACP writer queue is full"
        ));
        assert!(client.is_closed());
        assert!(client.state.writer.lock().unwrap().is_none());
        assert!(client.state.child.lock().unwrap().is_none());
        assert!(client.state.pending.lock().unwrap().is_empty());
        assert_eq!(
            wait_rx.recv_timeout(Duration::from_millis(100)).unwrap(),
            Err("OMP ACP writer queue is full".to_string())
        );
        assert!(events.lock().unwrap().iter().any(|event| matches!(
            event,
            AgentEvent::TurnFailed { error } if error == "OMP ACP writer queue is full"
        )));
        assert!(matches!(
            client.send_json(json!({"jsonrpc": "2.0", "method": "initialize"})),
            Err(OmpAcpError::Closed(_))
        ));

        drop(writer_rx);
        thread::sleep(Duration::from_millis(700));
        assert!(!survivor.exists(), "writer backpressure left an OMP descendant alive");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_unadvertised_callbacks_safely() {
        let fixture = standard_script(
            r#"printf '%s\n' '{"jsonrpc":"2.0","id":91,"method":"fs/read_text_file","params":{"sessionId":"omp-session-1","path":"/etc/shadow"}}'
printf '%s\n' '{"jsonrpc":"2.0","id":92,"method":"terminal/create","params":{"sessionId":"omp-session-1","command":"env"}}'
printf '%s\n' '{"jsonrpc":"2.0","id":93,"method":"unstable_createElicitation","params":{"sessionId":"omp-session-1","message":"authenticate"}}'"#,
        );
        let events = Arc::new(Mutex::new(Vec::new()));
        let client = spawn_fixture(options(&fixture, events, None)).unwrap();
        client.prompt("callback", &[]).unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        while Instant::now() < deadline {
            let log = fs::read_to_string(&fixture.log).unwrap_or_default();
            if log
                .matches("client capability was not advertised")
                .count()
                == 3
            {
                client.cancel().unwrap();
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("callback rejection missing");
    }

    #[test]
    fn environment_allowlist_is_exact_and_excludes_provider_secrets() {
        assert_eq!(
            OMP_ENV_ALLOWLIST,
            [
                "PATH", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
                "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "APPDATA",
                "LOCALAPPDATA", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT",
                "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM",
                "COLORTERM", "NO_COLOR",
            ]
        );
        for secret in [
            "ANTHROPIC_API_KEY",
            "OPENAI_API_KEY",
            "GEMINI_API_KEY",
            "AWS_SECRET_ACCESS_KEY",
            "OMP_CONFIG",
            "OMP_EXTENSIONS",
        ] {
            assert!(!OMP_ENV_ALLOWLIST.iter().any(|name| name.eq_ignore_ascii_case(secret)));
        }
    }

    #[cfg(unix)]
    #[test]
    fn child_gets_safe_argv_and_auth_roots_but_not_arbitrary_environment() {
        std::env::set_var("PICKFORGE_OMP_TEST_SECRET", "must-not-leak");
        let fixture = standard_script(":");
        let events = Arc::new(Mutex::new(Vec::new()));
        let client = spawn_fixture(options(&fixture, events, None)).unwrap();
        std::env::remove_var("PICKFORGE_OMP_TEST_SECRET");
        client.close();

        let log = fs::read_to_string(&fixture.log).unwrap();
        assert!(log.contains("argv:acp --no-extensions --approval-mode=always-ask"));
        assert!(log.contains("synthetic:unset"));
        assert!(log.contains("home:present"));
    }

    #[cfg(unix)]
    #[test]
    fn resume_and_load_reject_a_different_response_session_id() {
        let fixture = fixture(
            r#"while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"oh-my-pi","version":"16.4.8"},"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{},"close":{}}}}}' ;;
    *'"method":"session/resume"'*|*'"method":"session/load"'*) printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"sessionId":"wrong-session"}}' ;;
  esac
done"#,
        );
        for session in [
            OmpAcpSessionOpen::Resume("expected-session".to_string()),
            OmpAcpSessionOpen::Load("expected-session".to_string()),
        ] {
            let events = Arc::new(Mutex::new(Vec::new()));
            let mut opts = options(&fixture, events, None);
            opts.session = session;
            assert!(matches!(
                spawn_fixture(opts),
                Err(OmpAcpError::SessionOpen(message)) if message.contains("expected-session")
            ));
        }
    }

    #[cfg(unix)]
    #[test]
    fn session_new_still_requires_a_nonempty_response_session_id() {
        for result in [r#"{}"#, r#"{"sessionId":""}"#] {
            let fixture = fixture(&format!(
                r#"while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentInfo":{{"name":"oh-my-pi","version":"16.4.8"}},"agentCapabilities":{{"loadSession":true,"sessionCapabilities":{{"resume":{{}},"close":{{}}}}}}}}}}' ;;
    *'"method":"session/new"'*) printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{result}}}' ;;
  esac
done"#
            ));
            let events = Arc::new(Mutex::new(Vec::new()));
            assert!(matches!(
                spawn_fixture(options(&fixture, events, None)),
                Err(OmpAcpError::SessionOpen(message)) if message.contains("nonempty sessionId")
            ));
        }
    }

    #[cfg(unix)]
    #[test]
    fn initial_model_is_validated_and_applied_before_spawn_returns() {
        let fixture = standard_script(":");
        let events = Arc::new(Mutex::new(Vec::new()));
        let mut opts = options(&fixture, events, None);
        opts.model = Some("openai/gpt-test".to_string());
        let client = spawn_fixture(opts).unwrap();
        let log = fs::read_to_string(&fixture.log).unwrap();
        assert!(log.contains("\"method\":\"session/set_config_option\""));
        assert!(log.contains("\"value\":\"openai/gpt-test\""));
        drop(client);

        let events = Arc::new(Mutex::new(Vec::new()));
        let mut invalid = options(&fixture, events, None);
        invalid.model = Some("provider/not-advertised".to_string());
        assert!(matches!(
            spawn_fixture(invalid),
            Err(OmpAcpError::Unsupported(message)) if message.contains("not-advertised")
        ));
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_kills_descendant_after_direct_parent_exits() {
        let fixture = fixture(
            r#"survivor="$log.survived"
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*) printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"oh-my-pi","version":"16.4.8"},"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{},"close":{}}}}}' ;;
    *'"method":"session/new"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"sessionId":"omp-session-1"}}'
      (sleep 0.4; printf survived > "$survivor") &
      exit 0
      ;;
  esac
done"#,
        );
        let survivor = PathBuf::from(format!("{}.survived", fixture.log.display()));
        let events = Arc::new(Mutex::new(Vec::new()));
        let _ = spawn_fixture(options(&fixture, events, None));
        thread::sleep(Duration::from_millis(700));
        assert!(!survivor.exists(), "descendant survived ACP parent exit");
    }

    #[cfg(windows)]
    #[test]
    fn windows_job_cleanup_kills_descendant_after_direct_parent_exits() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "pickforge-omp-job-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let gate = dir.join("gate");
        let survivor = dir.join("survived");
        let grandchild = dir.join("grandchild.ps1");
        let parent = dir.join("parent.ps1");
        let ps_literal = |path: &Path| path.to_string_lossy().replace('\'', "''");
        fs::write(
            &grandchild,
            format!(
                "Start-Sleep -Milliseconds 800\nSet-Content -LiteralPath '{}' -Value survived\n",
                ps_literal(&survivor)
            ),
        )
        .unwrap();
        fs::write(
            &parent,
            format!(
                "while (-not (Test-Path -LiteralPath '{}')) {{ Start-Sleep -Milliseconds 10 }}\nStart-Process powershell.exe -ArgumentList @('-NoProfile', '-NonInteractive', '-File', '{}')\n",
                ps_literal(&gate),
                ps_literal(&grandchild)
            ),
        )
        .unwrap();

        let mut child = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-File"])
            .arg(&parent)
            .spawn()
            .unwrap();
        let job = create_kill_on_close_job(&child).unwrap();
        fs::write(&gate, b"go").unwrap();
        assert!(child.wait().unwrap().success());
        terminate_and_close_job(job);
        thread::sleep(Duration::from_millis(1200));
        assert!(!survivor.exists(), "job descendant survived parent exit");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn requires_absolute_cwd_before_spawn() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let error = OmpAcpClient::spawn(OmpAcpOptions {
            binary: Path::new("/definitely/not/spawned").to_path_buf(),
            project_root: PathBuf::from("relative"),
            session: OmpAcpSessionOpen::New,
            model: None,
            mcp_servers: vec![],
            sink: Arc::new(move |event| events.lock().unwrap().push(event)),
        });
        assert!(matches!(error, Err(OmpAcpError::Protocol(_))));
    }
}
