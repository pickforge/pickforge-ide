use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::{json, Map, Number, Value};

use super::event::{
    AgentEvent, ApprovalKind, CommandStatus, FileChangeEntry, FileChangeKind, PlanItem,
    ToolCallStatus, TurnStatus,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const CHILD_REAP_TIMEOUT: Duration = Duration::from_secs(2);
const OUTPUT_TAIL_CHARS: usize = 2000;

#[derive(Debug, Clone)]
pub struct CodexAppOptions {
    pub cwd: PathBuf,
    pub binary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadInfo {
    pub thread_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum RequestIdRepr {
    Number(i64),
    String(String),
}

impl RequestIdRepr {
    pub fn from_serialized(value: &str) -> Self {
        serde_json::from_str(value).unwrap_or_else(|_| Self::String(value.to_string()))
    }

    fn from_value(value: &Value) -> Option<Self> {
        value
            .as_i64()
            .map(Self::Number)
            .or_else(|| value.as_str().map(|text| Self::String(text.to_string())))
    }

    fn to_value(&self) -> Value {
        match self {
            Self::Number(value) => Value::Number(Number::from(*value)),
            Self::String(value) => Value::String(value.clone()),
        }
    }

    fn approval_id(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| match self {
            Self::Number(value) => value.to_string(),
            Self::String(value) => value.clone(),
        })
    }
}

impl From<i64> for RequestIdRepr {
    fn from(value: i64) -> Self {
        Self::Number(value)
    }
}

impl From<String> for RequestIdRepr {
    fn from(value: String) -> Self {
        Self::String(value)
    }
}

impl From<&str> for RequestIdRepr {
    fn from(value: &str) -> Self {
        Self::String(value.to_string())
    }
}

pub struct CodexAppClient {
    state: Arc<ClientState>,
    writer_thread: Mutex<Option<JoinHandle<()>>>,
    reader_thread: Mutex<Option<JoinHandle<()>>>,
    stderr_thread: Mutex<Option<JoinHandle<()>>>,
}

#[derive(Debug, thiserror::Error)]
pub enum CodexAppError {
    #[error("failed to spawn {binary}: {source}")]
    Spawn {
        binary: String,
        #[source]
        source: std::io::Error,
    },
    #[error("codex app-server did not expose {0}")]
    MissingPipe(&'static str),
    #[error("failed to start codex app-server thread: {0}")]
    Thread(#[source] std::io::Error),
    #[error("codex app-server writer is closed")]
    WriterClosed,
    #[error("codex app-server request {id} timed out")]
    RequestTimeout { id: i64 },
    #[error("codex app-server response error: {0}")]
    Response(String),
    #[error("codex app-server malformed response: {0}")]
    BadResponse(String),
    #[error("codex app-server lock poisoned: {0}")]
    LockPoisoned(&'static str),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub fn spawn(opts: CodexAppOptions) -> Result<CodexAppClient, CodexAppError> {
    CodexAppClient::spawn(opts)
}

impl CodexAppClient {
    pub fn spawn(opts: CodexAppOptions) -> Result<Self, CodexAppError> {
        let CodexAppOptions { cwd, binary } = opts;
        let binary = binary
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "codex".to_string());

        let mut command = Command::new(&binary);
        command
            .arg("app-server")
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_clear();
        for (key, value) in crate::process::user_shell_environment().clone() {
            command.env(key, value);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }

        let mut child = command.spawn().map_err(|source| CodexAppError::Spawn {
            binary: binary.clone(),
            source,
        })?;
        let Some(stdin) = child.stdin.take() else {
            kill_and_wait_child(child);
            return Err(CodexAppError::MissingPipe("stdin"));
        };
        let Some(stdout) = child.stdout.take() else {
            kill_and_wait_child(child);
            return Err(CodexAppError::MissingPipe("stdout"));
        };
        let Some(stderr) = child.stderr.take() else {
            kill_and_wait_child(child);
            return Err(CodexAppError::MissingPipe("stderr"));
        };

        let (writer_tx, writer_rx) = mpsc::channel();
        let state = Arc::new(ClientState {
            child: Mutex::new(Some(child)),
            pending: Mutex::new(HashMap::new()),
            subscriptions: Mutex::new(HashMap::new()),
            closed: AtomicBool::new(false),
            next_id: AtomicI64::new(1),
            pending_permissions: Mutex::new(HashMap::new()),
            writer_tx: Mutex::new(Some(writer_tx.clone())),
            cancel_pending_turns: Mutex::new(HashSet::new()),
            starting_turns: Mutex::new(HashSet::new()),
            expected_turns: Mutex::new(HashMap::new()),
            deferred_turns: Mutex::new(HashMap::new()),
        });

        let writer_thread = match std::thread::Builder::new()
            .name("codex-app-writer".to_string())
            .spawn({
                let writer_state = Arc::clone(&state);
                move || write_loop(stdin, writer_rx, writer_state)
            }) {
            Ok(thread) => thread,
            Err(error) => {
                kill_state_child(&state);
                return Err(CodexAppError::Thread(error));
            }
        };

        let reader_state = Arc::clone(&state);
        let reader_thread = match std::thread::Builder::new()
            .name("codex-app-reader".to_string())
            .spawn(move || read_loop(stdout, reader_state))
        {
            Ok(thread) => thread,
            Err(error) => {
                kill_state_child(&state);
                let _ = writer_tx.send(WriterMessage::Shutdown);
                let _ = writer_thread.join();
                return Err(CodexAppError::Thread(error));
            }
        };

        let stderr_thread = match std::thread::Builder::new()
            .name("codex-app-stderr".to_string())
            .spawn(move || drain(stderr))
        {
            Ok(thread) => thread,
            Err(error) => {
                kill_state_child(&state);
                let _ = writer_tx.send(WriterMessage::Shutdown);
                let _ = writer_thread.join();
                let _ = reader_thread.join();
                return Err(CodexAppError::Thread(error));
            }
        };

        let client = Self {
            state,
            writer_thread: Mutex::new(Some(writer_thread)),
            reader_thread: Mutex::new(Some(reader_thread)),
            stderr_thread: Mutex::new(Some(stderr_thread)),
        };

        client.initialize()?;
        Ok(client)
    }

    pub fn thread_start(
        &self,
        cwd: PathBuf,
        model: Option<String>,
        sandbox: &str,
        approval_policy: &str,
    ) -> Result<ThreadInfo, CodexAppError> {
        let mut params = Map::new();
        params.insert("cwd".to_string(), Value::String(path_string(cwd)));
        if let Some(model) = model.filter(|value| !value.trim().is_empty()) {
            params.insert("model".to_string(), Value::String(model));
        }
        params.insert("sandbox".to_string(), Value::String(sandbox.to_string()));
        params.insert(
            "approvalPolicy".to_string(),
            Value::String(approval_policy.to_string()),
        );
        params.insert(
            "approvalsReviewer".to_string(),
            Value::String("user".to_string()),
        );

        let result = self.request("thread/start", Value::Object(params), REQUEST_TIMEOUT)?;
        thread_info_from_result(&result)
    }

    pub fn thread_resume(
        &self,
        thread_id: &str,
        cwd: PathBuf,
    ) -> Result<ThreadInfo, CodexAppError> {
        let result = self.request(
            "thread/resume",
            json!({
                "threadId": thread_id,
                "cwd": path_string(cwd),
            }),
            REQUEST_TIMEOUT,
        )?;
        thread_info_from_result(&result)
    }

    pub fn turn_start(
        &self,
        thread_id: &str,
        text: &str,
        model: Option<String>,
        effort: Option<String>,
        images: &[String],
    ) -> Result<String, CodexAppError> {
        let mut params = Map::new();
        params.insert("threadId".to_string(), Value::String(thread_id.to_string()));
        let mut input = images
            .iter()
            .filter(|path| !path.trim().is_empty())
            .map(|path| json!({ "type": "localImage", "path": path }))
            .collect::<Vec<_>>();
        input.push(json!({ "type": "text", "text": text }));
        params.insert("input".to_string(), Value::Array(input));
        if let Some(model) = model.filter(|value| !value.trim().is_empty()) {
            params.insert("model".to_string(), Value::String(model));
        }
        if let Some(effort) = effort.filter(|value| !value.trim().is_empty()) {
            params.insert("effort".to_string(), Value::String(effort));
        }

        let result = self.request("turn/start", Value::Object(params), REQUEST_TIMEOUT)?;
        string_field(
            result
                .get("turn")
                .ok_or_else(|| CodexAppError::BadResponse("missing turn".to_string()))?,
            &["id"],
        )
        .ok_or_else(|| CodexAppError::BadResponse("missing turn id".to_string()))
    }

    /// Mark a `turn/start` as in flight. Armed BEFORE the request so a
    /// `turn/started` that arrives during the (possibly long) wait is captured
    /// rather than missed, and deferred (not interrupted) until the start
    /// resolves and we know whether that turn is the legit one.
    pub fn begin_turn_start(&self, thread_id: &str) {
        if let Ok(mut set) = self.state.cancel_pending_turns.lock() {
            set.insert(thread_id.to_string());
        }
        if let Ok(mut set) = self.state.starting_turns.lock() {
            set.insert(thread_id.to_string());
        }
    }

    /// The start succeeded: `turn_id` is the legit turn. Reconcile deferred
    /// `turn/started`s — drop the legit one, interrupt the rest as orphans —
    /// and disarm (turns serialize per thread, so a prior orphan has ended).
    pub fn finish_turn_start_ok(&self, thread_id: &str, turn_id: &str) {
        if let Ok(mut map) = self.state.expected_turns.lock() {
            map.insert(thread_id.to_string(), turn_id.to_string());
        }
        self.clear_starting(thread_id);
        let orphans = self.take_deferred(thread_id, Some(turn_id));
        self.disarm(thread_id);
        self.interrupt_all(thread_id, orphans);
    }

    /// The start timed out — the app-server may have accepted it, so any turn
    /// seen while it was in flight is an orphan. Stay armed so a `turn/started`
    /// arriving later (no start in flight) is interrupted on sight.
    pub fn finish_turn_start_timeout(&self, thread_id: &str) {
        self.clear_starting(thread_id);
        let orphans = self.take_deferred(thread_id, None);
        self.interrupt_all(thread_id, orphans);
    }

    /// The start failed for a non-timeout reason (no turn was created for it).
    /// Interrupt anything deferred during it, but don't newly arm.
    pub fn finish_turn_start_err(&self, thread_id: &str) {
        self.clear_starting(thread_id);
        let orphans = self.take_deferred(thread_id, None);
        self.interrupt_all(thread_id, orphans);
    }

    fn clear_starting(&self, thread_id: &str) {
        if let Ok(mut set) = self.state.starting_turns.lock() {
            set.remove(thread_id);
        }
    }

    fn disarm(&self, thread_id: &str) {
        if let Ok(mut set) = self.state.cancel_pending_turns.lock() {
            set.remove(thread_id);
        }
    }

    /// Drain a thread's deferred turn ids, excluding `keep` (the legit id).
    fn take_deferred(&self, thread_id: &str, keep: Option<&str>) -> Vec<String> {
        let Ok(mut map) = self.state.deferred_turns.lock() else {
            return Vec::new();
        };
        let Some(mut set) = map.remove(thread_id) else {
            return Vec::new();
        };
        if let Some(keep) = keep {
            set.remove(keep);
        }
        set.into_iter().collect()
    }

    fn interrupt_all(&self, thread_id: &str, turn_ids: Vec<String>) {
        // Fire-and-forget: don't block the send thread on each orphan's
        // interrupt response.
        for turn_id in turn_ids {
            send_turn_interrupt(&self.state, thread_id, &turn_id);
        }
    }

    pub fn turn_interrupt(&self, thread_id: &str, turn_id: &str) -> Result<(), CodexAppError> {
        self.request(
            "turn/interrupt",
            json!({
                "threadId": thread_id,
                "turnId": turn_id,
            }),
            REQUEST_TIMEOUT,
        )
        .map(|_| ())
    }

    pub fn turn_steer(
        &self,
        thread_id: &str,
        expected_turn_id: &str,
        text: &str,
    ) -> Result<(), CodexAppError> {
        self.request(
            "turn/steer",
            json!({
                "threadId": thread_id,
                "expectedTurnId": expected_turn_id,
                "input": [{ "type": "text", "text": text }],
            }),
            REQUEST_TIMEOUT,
        )
        .map(|_| ())
    }

    /// Whether this approval is a permission-escalation request (answered with
    /// a grant profile, not a `{decision}`). Cancel on these must interrupt the
    /// turn — the response shape has no cancel.
    pub fn is_permission_request(&self, request_id: &RequestIdRepr) -> bool {
        self.state
            .pending_permissions
            .lock()
            .map(|pending| pending.contains_key(&request_id.approval_id()))
            .unwrap_or(false)
    }

    pub fn respond_approval(
        &self,
        request_id: RequestIdRepr,
        decision: &str,
    ) -> Result<(), CodexAppError> {
        let requested = self
            .state
            .pending_permissions
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(&request_id.approval_id()));
        match requested {
            Some(permissions) => {
                self.send_value(permission_response_message(request_id, decision, permissions))
            }
            None => self.send_value(approval_response_message(request_id, decision)),
        }
    }

    pub fn thread_list(&self, cwd: Option<String>) -> Result<Value, CodexAppError> {
        let mut params = Map::new();
        if let Some(cwd) = cwd.filter(|value| !value.trim().is_empty()) {
            params.insert("cwd".to_string(), Value::String(cwd));
        }
        self.request("thread/list", Value::Object(params), REQUEST_TIMEOUT)
    }

    pub fn thread_read(
        &self,
        thread_id: &str,
        include_turns: bool,
    ) -> Result<Value, CodexAppError> {
        self.request(
            "thread/read",
            json!({
                "threadId": thread_id,
                "includeTurns": include_turns,
            }),
            REQUEST_TIMEOUT,
        )
    }

    pub fn rate_limits_read(&self) -> Result<Value, CodexAppError> {
        self.request(
            "account/rateLimits/read",
            Value::Object(Map::new()),
            REQUEST_TIMEOUT,
        )
    }

    pub fn account_read(&self) -> Result<Value, CodexAppError> {
        self.request("account/read", Value::Object(Map::new()), REQUEST_TIMEOUT)
    }

    pub fn login_start_chatgpt(&self) -> Result<Value, CodexAppError> {
        self.request(
            "account/login/start",
            json!({ "type": "chatgpt" }),
            REQUEST_TIMEOUT,
        )
    }

    pub fn subscribe(
        &self,
        thread_id: &str,
        sink: Arc<dyn Fn(AgentEvent) + Send + Sync>,
    ) -> Result<(), CodexAppError> {
        self.state
            .subscriptions
            .lock()
            .map_err(|_| CodexAppError::LockPoisoned("subscriptions"))?
            .insert(thread_id.to_string(), sink);
        Ok(())
    }

    pub fn unsubscribe(&self, thread_id: &str) -> Result<(), CodexAppError> {
        // Drop the local sink FIRST so no more events fan out to a disposed
        // session while the server round-trip is in flight (late events would
        // otherwise recreate rows for a deleted chat).
        self.state
            .subscriptions
            .lock()
            .map_err(|_| CodexAppError::LockPoisoned("subscriptions"))?
            .remove(thread_id);
        // Then tell the app-server to release the thread — dropping only the
        // local sink leaves it loaded/subscribed until process exit, leaking
        // resources across chat deletes and provider switches. Best-effort: a
        // closed client or a server that already dropped it must not fail.
        if !self.is_closed() {
            let mut params = Map::new();
            params.insert("threadId".to_string(), Value::String(thread_id.to_string()));
            let _ = self.request("thread/unsubscribe", Value::Object(params), REQUEST_TIMEOUT);
        }
        Ok(())
    }

    pub fn is_closed(&self) -> bool {
        self.state.closed.load(Ordering::SeqCst)
    }

    pub fn kill(&self) -> Result<(), CodexAppError> {
        kill_state_child(&self.state);
        Ok(())
    }

    pub fn shutdown(&self) -> Result<(), CodexAppError> {
        self.state.closed.store(true, Ordering::SeqCst);
        fail_pending(&self.state, "codex app-server shutdown");
        if let Ok(mut tx) = self.state.writer_tx.lock() {
            if let Some(tx) = tx.take() {
                let _ = tx.send(WriterMessage::Shutdown);
            }
        }
        self.kill()?;
        if let Ok(mut thread) = self.reader_thread.lock() {
            if let Some(thread) = thread.take() {
                let _ = thread.join();
            }
        }
        if let Ok(mut thread) = self.writer_thread.lock() {
            if let Some(thread) = thread.take() {
                let _ = thread.join();
            }
        }
        if let Ok(mut thread) = self.stderr_thread.lock() {
            if let Some(thread) = thread.take() {
                let _ = thread.join();
            }
        }
        if let Ok(mut subscriptions) = self.state.subscriptions.lock() {
            subscriptions.clear();
        }
        Ok(())
    }

    fn initialize(&self) -> Result<(), CodexAppError> {
        self.request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "pickforge",
                    "version": env!("CARGO_PKG_VERSION"),
                    "title": "PickForge",
                },
            }),
            REQUEST_TIMEOUT,
        )?;
        self.notify("initialized")
    }

    fn notify(&self, method: &str) -> Result<(), CodexAppError> {
        self.send_value(json!({ "method": method }))
    }

    fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, CodexAppError> {
        let id = self.state.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.state
            .pending
            .lock()
            .map_err(|_| CodexAppError::LockPoisoned("pending"))?
            .insert(id, tx);

        let send_result = self.send_value(json!({
            "id": id,
            "method": method,
            "params": params,
        }));
        if let Err(error) = send_result {
            remove_pending(&self.state, id);
            return Err(error);
        }

        match rx.recv_timeout(timeout) {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(error)) => Err(CodexAppError::Response(error)),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                remove_pending(&self.state, id);
                Err(CodexAppError::RequestTimeout { id })
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(CodexAppError::WriterClosed),
        }
    }

    fn send_value(&self, value: Value) -> Result<(), CodexAppError> {
        if self.is_closed() {
            return Err(CodexAppError::WriterClosed);
        }
        let line = serde_json::to_string(&value)?;
        let tx = self
            .state
            .writer_tx
            .lock()
            .map_err(|_| CodexAppError::LockPoisoned("writer"))?
            .as_ref()
            .cloned()
            .ok_or(CodexAppError::WriterClosed)?;
        tx.send(WriterMessage::Line(line)).map_err(|_| {
            close_state(&self.state, "codex app-server writer closed");
            CodexAppError::WriterClosed
        })
    }
}

impl Drop for CodexAppClient {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

struct ClientState {
    child: Mutex<Option<Child>>,
    pending: Mutex<HashMap<i64, PendingSender>>,
    subscriptions: Mutex<HashMap<String, Arc<dyn Fn(AgentEvent) + Send + Sync>>>,
    closed: AtomicBool,
    next_id: AtomicI64,
    /// Requested permission profiles by approval id — `item/permissions/
    /// requestApproval` answers with `{permissions, scope}` rather than the
    /// `{decision}` shape command/fileChange approvals use.
    pending_permissions: Mutex<HashMap<String, Value>>,
    // On the writer side so the read loop can interrupt a turn whose start
    // request timed out (see cancel_pending_turns).
    writer_tx: Mutex<Option<mpsc::Sender<WriterMessage>>>,
    // --- headless-turn cancellation (a turn/start that times out after the
    // app-server accepted it leaves a turn running; it must be interrupted
    // without cancelling a legitimate retry on the same thread) ---
    /// Threads that may have an orphaned turn to interrupt.
    cancel_pending_turns: Mutex<HashSet<String>>,
    /// Threads with a `turn/start` request currently in flight. While a start
    /// is in flight, an incoming `turn/started` is ambiguous (it may be this
    /// start's own turn, whose response hasn't arrived yet), so it is deferred
    /// and reconciled when the start resolves rather than interrupted on sight.
    starting_turns: Mutex<HashSet<String>>,
    /// The turn id each thread's most recent successful `turn/start` returned.
    expected_turns: Mutex<HashMap<String, String>>,
    /// `turn/started` ids seen while a start was in flight — reconciled against
    /// the resolved turn id (the legit one is dropped, the rest are orphans).
    deferred_turns: Mutex<HashMap<String, HashSet<String>>>,
}

type PendingSender = mpsc::Sender<Result<Value, String>>;

enum WriterMessage {
    Line(String),
    Shutdown,
}

#[derive(Debug, Clone, PartialEq)]
struct RoutedEvent {
    thread_id: Option<String>,
    event: AgentEvent,
}

#[derive(Debug, Clone, PartialEq)]
enum IncomingLine {
    Response {
        id: i64,
        result: Result<Value, String>,
    },
    Events(Vec<RoutedEvent>),
    /// A permission-escalation request: surfaced like any approval, but the
    /// requested profile must be remembered so the eventual answer can echo
    /// the grant back in the shape this method expects.
    PermissionRequest {
        approval_id: String,
        permissions: Value,
        events: Vec<RoutedEvent>,
    },
    None,
}

fn write_loop(stdin: impl Write, rx: mpsc::Receiver<WriterMessage>, state: Arc<ClientState>) {
    let mut writer = BufWriter::new(stdin);
    for message in rx {
        match message {
            WriterMessage::Line(line) => {
                if writeln!(writer, "{line}").is_err() || writer.flush().is_err() {
                    close_state(&state, "codex app-server stdin closed");
                    break;
                }
            }
            WriterMessage::Shutdown => break,
        }
    }
}

fn read_loop(stdout: impl Read, state: Arc<ClientState>) {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        let Ok(line) = line else {
            break;
        };
        interrupt_cancelled_turn(&state, &line);
        match parse_incoming_line(&line) {
            IncomingLine::Response { id, result } => complete_pending(&state, id, result),
            IncomingLine::Events(events) => dispatch_events(&state, events),
            IncomingLine::PermissionRequest {
                approval_id,
                permissions,
                events,
            } => {
                if let Ok(mut pending) = state.pending_permissions.lock() {
                    pending.insert(approval_id, permissions);
                }
                dispatch_events(&state, events);
            }
            IncomingLine::None => {}
        }
    }
    close_state(&state, "codex app-server stdout closed");
    bounded_reap_state_child(&state, CHILD_REAP_TIMEOUT);
}

fn parse_incoming_line(line: &str) -> IncomingLine {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return IncomingLine::None;
    }

    let value = match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => value,
        Err(_) => {
            return IncomingLine::Events(vec![RoutedEvent {
                thread_id: None,
                event: AgentEvent::Noise {
                    line: line.to_string(),
                },
            }]);
        }
    };

    let method = value.get("method").and_then(Value::as_str);
    if method.is_none() {
        if let Some(id) = value.get("id").and_then(Value::as_i64) {
            let result = if let Some(error) = value.get("error") {
                Err(error_message(error))
            } else {
                Ok(value.get("result").cloned().unwrap_or(Value::Null))
            };
            return IncomingLine::Response { id, result };
        }
        return IncomingLine::None;
    }

    let method = method.unwrap_or_default();
    let params = value.get("params").unwrap_or(&Value::Null);
    if let Some(id) = value.get("id") {
        let events = server_request_events(method, id, params);
        if method == "item/permissions/requestApproval" {
            if let Some(request_id) = RequestIdRepr::from_value(id) {
                return IncomingLine::PermissionRequest {
                    approval_id: request_id.approval_id(),
                    permissions: params
                        .get("permissions")
                        .cloned()
                        .unwrap_or_else(|| Value::Object(Map::new())),
                    events,
                };
            }
        }
        return IncomingLine::Events(events);
    }

    IncomingLine::Events(notification_events(method, params))
}

fn server_request_events(method: &str, id: &Value, params: &Value) -> Vec<RoutedEvent> {
    let Some(request_id) = RequestIdRepr::from_value(id) else {
        return Vec::new();
    };
    let kind = match method {
        "item/commandExecution/requestApproval" => ApprovalKind::Command,
        "item/fileChange/requestApproval" => ApprovalKind::FileChange,
        "item/permissions/requestApproval" => ApprovalKind::ToolUse,
        _ => return Vec::new(),
    };

    vec![RoutedEvent {
        thread_id: string_field(params, &["threadId"]),
        event: AgentEvent::ApprovalRequest {
            approval_id: request_id.approval_id(),
            kind,
            detail: params.to_string(),
        },
    }]
}

fn notification_events(method: &str, params: &Value) -> Vec<RoutedEvent> {
    match method {
        "turn/started" => routed(params, AgentEvent::TurnStarted),
        "item/agentMessage/delta" => string_field(params, &["delta"])
            .map(|text| routed(params, AgentEvent::TextDelta { text }))
            .unwrap_or_default(),
        "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta" => {
            string_field(params, &["delta"])
                .map(|text| routed(params, AgentEvent::ThinkingDelta { text }))
                .unwrap_or_default()
        }
        "item/commandExecution/outputDelta" => {
            let Some(item_id) = string_field(params, &["itemId"]) else {
                return Vec::new();
            };
            let Some(chunk) = string_field(params, &["delta"]) else {
                return Vec::new();
            };
            routed(params, AgentEvent::CommandOutput { item_id, chunk })
        }
        "item/started" => item_started_events(params),
        "item/completed" => item_completed_events(params),
        "item/fileChange/patchUpdated" => {
            let Some(item_id) = string_field(params, &["itemId"]) else {
                return Vec::new();
            };
            routed(
                params,
                AgentEvent::FileChange {
                    item_id,
                    changes: file_changes(params),
                },
            )
        }
        "turn/plan/updated" => routed(
            params,
            AgentEvent::PlanUpdate {
                items: plan_items(params),
            },
        ),
        "thread/tokenUsage/updated" => usage_event(params)
            .map(|event| routed(params, event))
            .unwrap_or_default(),
        "account/rateLimits/updated" => params
            .get("rateLimits")
            .map(|rate_limits| {
                vec![RoutedEvent {
                    thread_id: None,
                    event: AgentEvent::RateLimits {
                        payload: rate_limits.to_string(),
                    },
                }]
            })
            .unwrap_or_default(),
        "turn/completed" => turn_completed_event(params)
            .map(|event| routed(params, event))
            .unwrap_or_default(),
        "error" => {
            if params
                .get("willRetry")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                Vec::new()
            } else {
                routed(
                    params,
                    AgentEvent::TurnFailed {
                        error: params
                            .get("error")
                            .map(error_message)
                            .unwrap_or_else(|| "codex app-server error".to_string()),
                    },
                )
            }
        }
        "thread/status/changed"
        | "mcpServer/startupStatus/updated"
        | "remoteControl/status/changed" => Vec::new(),
        _ => Vec::new(),
    }
}

fn item_started_events(params: &Value) -> Vec<RoutedEvent> {
    let Some(item) = params.get("item") else {
        return Vec::new();
    };
    let Some(item_type) = string_field(item, &["type"]) else {
        return Vec::new();
    };
    let item_id = string_field(item, &["id"]).unwrap_or_default();

    match item_type.as_str() {
        "commandExecution" | "command_execution" => routed(
            params,
            AgentEvent::CommandStarted {
                item_id,
                command: string_field(item, &["command"]).unwrap_or_default(),
                cwd: string_field(item, &["cwd"]),
            },
        ),
        "mcpToolCall" | "mcp_tool_call" => routed(
            params,
            AgentEvent::McpToolCall {
                item_id,
                server: string_field(item, &["server", "serverName", "mcpServer"])
                    .unwrap_or_default(),
                tool: string_field(item, &["tool", "toolName", "name"]).unwrap_or_default(),
                status: ToolCallStatus::InProgress,
                detail: None,
            },
        ),
        "webSearch" | "web_search" => routed(
            params,
            AgentEvent::WebSearch {
                item_id,
                query: string_field(item, &["query", "searchQuery"]).unwrap_or_default(),
            },
        ),
        _ => Vec::new(),
    }
}

fn item_completed_events(params: &Value) -> Vec<RoutedEvent> {
    let Some(item) = params.get("item") else {
        return Vec::new();
    };
    let Some(item_type) = string_field(item, &["type"]) else {
        return Vec::new();
    };
    let item_id = string_field(item, &["id"]).unwrap_or_default();

    match item_type.as_str() {
        "commandExecution" | "command_execution" => routed(
            params,
            AgentEvent::CommandDone {
                item_id,
                exit_code: i32_field(item, &["exitCode", "exit_code"]),
                status: command_status(string_field(item, &["status"]).as_deref()),
                output_tail: string_field(item, &["aggregatedOutput", "aggregated_output"])
                    .map(|text| tail_chars(&text, OUTPUT_TAIL_CHARS)),
            },
        ),
        "agentMessage" | "agent_message" => routed(
            params,
            AgentEvent::TextFinal {
                item_id: string_field(item, &["id"]),
                text: string_field(item, &["text"]).unwrap_or_default(),
            },
        ),
        "reasoning" => {
            let text = reasoning_text(item);
            if text.trim().is_empty() {
                Vec::new()
            } else {
                routed(
                    params,
                    AgentEvent::ThinkingFinal {
                        item_id: string_field(item, &["id"]),
                        text,
                    },
                )
            }
        }
        "fileChange" | "file_change" => routed(
            params,
            AgentEvent::FileChange {
                item_id,
                changes: file_changes(item),
            },
        ),
        "mcpToolCall" | "mcp_tool_call" => routed(
            params,
            AgentEvent::McpToolCall {
                item_id,
                server: string_field(item, &["server", "serverName", "mcpServer"])
                    .unwrap_or_default(),
                tool: string_field(item, &["tool", "toolName", "name"]).unwrap_or_default(),
                status: tool_status(string_field(item, &["status"]).as_deref()),
                detail: string_field(item, &["error", "result"]),
            },
        ),
        "webSearch" | "web_search" => routed(
            params,
            AgentEvent::WebSearch {
                item_id,
                query: string_field(item, &["query", "searchQuery"]).unwrap_or_default(),
            },
        ),
        _ => Vec::new(),
    }
}

fn usage_event(params: &Value) -> Option<AgentEvent> {
    let token_usage = params.get("tokenUsage")?;
    let total = token_usage.get("total")?;
    Some(AgentEvent::Usage {
        input_tokens: u64_field(total, &["inputTokens"]).unwrap_or_default(),
        cached_input_tokens: u64_field(total, &["cachedInputTokens"]).unwrap_or_default(),
        output_tokens: u64_field(total, &["outputTokens"]).unwrap_or_default(),
        cost_usd: None,
        context_used: u64_field(total, &["totalTokens"]),
        context_window: u64_field(token_usage, &["modelContextWindow"]),
    })
}

fn turn_completed_event(params: &Value) -> Option<AgentEvent> {
    let turn = params.get("turn")?;
    match string_field(turn, &["status"]).as_deref() {
        Some("completed") => Some(AgentEvent::TurnDone {
            status: TurnStatus::Completed,
        }),
        Some("interrupted") => Some(AgentEvent::TurnDone {
            status: TurnStatus::Interrupted,
        }),
        Some("failed") => Some(AgentEvent::TurnFailed {
            error: turn
                .get("error")
                .map(error_message)
                .unwrap_or_else(|| "codex turn failed".to_string()),
        }),
        Some(status) => Some(AgentEvent::TurnFailed {
            error: turn
                .get("error")
                .map(error_message)
                .unwrap_or_else(|| status.to_string()),
        }),
        None => None,
    }
}

fn routed(params: &Value, event: AgentEvent) -> Vec<RoutedEvent> {
    vec![RoutedEvent {
        thread_id: string_field(params, &["threadId"]),
        event,
    }]
}

/// React to a `turn/started` on a thread that has an outstanding
/// cancel-on-timeout: an orphaned turn (from a timed-out start the app-server
/// accepted) must be interrupted, but a legitimate turn must not be. A turn
/// seen WHILE a start is in flight is ambiguous — it may be that start's own
/// turn whose response hasn't arrived — so it is deferred and reconciled when
/// the start resolves (finish_turn_start_*). Only when armed with NO start in
/// flight is the turn unambiguously an orphan; interrupt it on sight (fire and
/// forget — the read loop must not block on the interrupt's own response).
fn interrupt_cancelled_turn(state: &Arc<ClientState>, line: &str) {
    if state
        .cancel_pending_turns
        .lock()
        .map(|set| set.is_empty())
        .unwrap_or(true)
    {
        return;
    }
    let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
        return;
    };
    if value.get("method").and_then(Value::as_str).is_none() {
        return;
    }
    let params = value.get("params").unwrap_or(&Value::Null);
    let Some(thread_id) = string_field(params, &["threadId"]) else {
        return;
    };
    let flagged = state
        .cancel_pending_turns
        .lock()
        .map(|set| set.contains(&thread_id))
        .unwrap_or(false);
    if !flagged {
        return;
    }
    // turn/started carries `turn.id`; item notifications carry `turnId`.
    let turn_id = params
        .get("turn")
        .and_then(|turn| string_field(turn, &["id"]))
        .or_else(|| string_field(params, &["turnId"]));
    let Some(turn_id) = turn_id else {
        return;
    };
    // A turn already confirmed legit is never an orphan.
    let is_expected = state
        .expected_turns
        .lock()
        .map(|map| map.get(&thread_id).is_some_and(|expected| expected == &turn_id))
        .unwrap_or(false);
    if is_expected {
        return;
    }
    // Ambiguous while a start is in flight — defer for reconciliation.
    let starting = state
        .starting_turns
        .lock()
        .map(|set| set.contains(&thread_id))
        .unwrap_or(false);
    if starting {
        if let Ok(mut map) = state.deferred_turns.lock() {
            map.entry(thread_id).or_default().insert(turn_id);
        }
        return;
    }
    // Armed, no start in flight: an unambiguous orphan — interrupt and disarm.
    if let Ok(mut set) = state.cancel_pending_turns.lock() {
        set.remove(&thread_id);
    }
    send_turn_interrupt(state, &thread_id, &turn_id);
}

/// Send a `turn/interrupt` without waiting for its response (the read loop must
/// not block on its own reply; the send thread need not either).
fn send_turn_interrupt(state: &Arc<ClientState>, thread_id: &str, turn_id: &str) {
    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let Ok(line) = serde_json::to_string(&json!({
        "id": id,
        "method": "turn/interrupt",
        "params": { "threadId": thread_id, "turnId": turn_id },
    })) else {
        return;
    };
    if let Ok(tx) = state.writer_tx.lock() {
        if let Some(tx) = tx.as_ref() {
            let _ = tx.send(WriterMessage::Line(line));
        }
    }
}

fn dispatch_events(state: &Arc<ClientState>, events: Vec<RoutedEvent>) {
    for event in events {
        if event.thread_id.is_none() && matches!(event.event, AgentEvent::Noise { .. }) {
            if let AgentEvent::Noise { line } = event.event {
                eprintln!("codex app-server noise: {line}");
            }
            continue;
        }

        let sinks = event_sinks(state, event.thread_id.as_deref());
        for sink in sinks {
            let event = event.event.clone();
            let _ = std::panic::catch_unwind(AssertUnwindSafe(|| sink(event)));
        }
    }
}

fn event_sinks(
    state: &Arc<ClientState>,
    thread_id: Option<&str>,
) -> Vec<Arc<dyn Fn(AgentEvent) + Send + Sync>> {
    let Ok(subscriptions) = state.subscriptions.lock() else {
        return Vec::new();
    };
    match thread_id {
        Some(thread_id) => subscriptions
            .get(thread_id)
            .map(|sink| vec![Arc::clone(sink)])
            .unwrap_or_default(),
        None => subscriptions.values().cloned().collect(),
    }
}

fn complete_pending(state: &Arc<ClientState>, id: i64, result: Result<Value, String>) {
    let pending = state
        .pending
        .lock()
        .ok()
        .and_then(|mut map| map.remove(&id));
    if let Some(pending) = pending {
        let _ = pending.send(result);
    }
}

fn fail_pending(state: &Arc<ClientState>, message: &str) {
    if let Ok(mut pending) = state.pending.lock() {
        for (_, tx) in pending.drain() {
            let _ = tx.send(Err(message.to_string()));
        }
    }
}

fn close_state(state: &Arc<ClientState>, pending_message: &str) {
    if state.closed.swap(true, Ordering::SeqCst) {
        return;
    }
    fail_pending(state, pending_message);
    dispatch_events(
        state,
        vec![RoutedEvent {
            thread_id: None,
            event: AgentEvent::TurnFailed {
                error: "agent process exited".to_string(),
            },
        }],
    );
}

fn remove_pending(state: &Arc<ClientState>, id: i64) {
    if let Ok(mut pending) = state.pending.lock() {
        pending.remove(&id);
    }
}

fn approval_response_message(request_id: RequestIdRepr, decision: &str) -> Value {
    let mut message = Map::new();
    message.insert("id".to_string(), request_id.to_value());
    message.insert(
        "result".to_string(),
        json!({
            "decision": decision,
        }),
    );
    Value::Object(message)
}

/// Answer for `item/permissions/requestApproval`: an accepted grant echoes the
/// requested profile (scoped to the turn, or the session for "accept for
/// session"); a plain decline grants an empty profile so the turn proceeds
/// without the escalation. `cancel` is distinct — the caller interrupts the
/// turn instead of sending this, so it is treated like decline here as a
/// fallback only.
fn permission_response_message(
    request_id: RequestIdRepr,
    decision: &str,
    requested: Value,
) -> Value {
    let granted = matches!(decision, "accept" | "acceptForSession");
    let mut result = Map::new();
    result.insert(
        "permissions".to_string(),
        if granted {
            requested
        } else {
            Value::Object(Map::new())
        },
    );
    if granted {
        let scope = if decision == "acceptForSession" {
            "session"
        } else {
            "turn"
        };
        result.insert("scope".to_string(), Value::String(scope.to_string()));
    }
    let mut message = Map::new();
    message.insert("id".to_string(), request_id.to_value());
    message.insert("result".to_string(), Value::Object(result));
    Value::Object(message)
}

fn thread_info_from_result(result: &Value) -> Result<ThreadInfo, CodexAppError> {
    let thread = result
        .get("thread")
        .ok_or_else(|| CodexAppError::BadResponse("missing thread".to_string()))?;
    let thread_id = string_field(thread, &["id"])
        .ok_or_else(|| CodexAppError::BadResponse("missing thread id".to_string()))?;
    Ok(ThreadInfo { thread_id })
}

fn path_string(path: PathBuf) -> String {
    path.to_string_lossy().to_string()
}

fn drain(mut stderr: impl Read) {
    let _ = std::io::copy(&mut stderr, &mut std::io::sink());
}

fn bounded_reap_state_child(state: &Arc<ClientState>, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    loop {
        let mut child = match state.child.lock() {
            Ok(child) => child,
            Err(_) => return,
        };
        let Some(child_ref) = child.as_mut() else {
            return;
        };

        match child_ref.try_wait() {
            Ok(Some(_)) | Err(_) => {
                let _ = child.take();
                return;
            }
            Ok(None) => {}
        }
        drop(child);

        if Instant::now() >= deadline {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn kill_state_child(state: &Arc<ClientState>) {
    if let Ok(mut child) = state.child.lock() {
        if let Some(child) = child.take() {
            kill_and_wait_child(child);
        }
    }
}

fn kill_and_wait_child(mut child: Child) {
    signal_child(&mut child);
    let _ = child.wait();
}

fn signal_child(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        libc::killpg(child.id() as libc::pid_t, libc::SIGKILL);
    }
    let _ = child.kill();
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(scalar_string))
}

fn scalar_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn u64_field(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        value.get(*key).and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        })
    })
}

fn i32_field(value: &Value, keys: &[&str]) -> Option<i32> {
    keys.iter().find_map(|key| {
        value.get(*key).and_then(|value| {
            value
                .as_i64()
                .and_then(|number| i32::try_from(number).ok())
                .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        })
    })
}

fn command_status(status: Option<&str>) -> CommandStatus {
    match status {
        Some("completed") => CommandStatus::Completed,
        Some("interrupted") => CommandStatus::Interrupted,
        _ => CommandStatus::Failed,
    }
}

fn tool_status(status: Option<&str>) -> ToolCallStatus {
    match status {
        Some("failed") | Some("errored") | Some("error") => ToolCallStatus::Failed,
        Some("inProgress") | Some("in_progress") => ToolCallStatus::InProgress,
        _ => ToolCallStatus::Completed,
    }
}

fn file_changes(value: &Value) -> Vec<FileChangeEntry> {
    value
        .get("changes")
        .and_then(Value::as_array)
        .map(|changes| changes.iter().filter_map(file_change_entry).collect())
        .unwrap_or_default()
}

fn file_change_entry(value: &Value) -> Option<FileChangeEntry> {
    Some(FileChangeEntry {
        path: string_field(value, &["path", "file", "filePath", "newPath", "oldPath"])?,
        kind: file_change_kind(value.get("kind")),
        diff: string_field(value, &["diff"]),
    })
}

fn file_change_kind(kind: Option<&Value>) -> FileChangeKind {
    let kind = kind.and_then(|kind| match kind {
        Value::Object(_) => string_field(kind, &["type"]),
        _ => scalar_string(kind),
    });
    match kind.as_deref() {
        Some("add") | Some("added") => FileChangeKind::Add,
        Some("delete") | Some("deleted") | Some("remove") | Some("removed") => {
            FileChangeKind::Delete
        }
        Some("rename") | Some("renamed") => FileChangeKind::Rename,
        _ => FileChangeKind::Modify,
    }
}

fn plan_items(params: &Value) -> Vec<PlanItem> {
    params
        .get("plan")
        .and_then(Value::as_array)
        .map(|plan| {
            plan.iter()
                .filter_map(|item| {
                    let text = string_field(item, &["step", "text"])?;
                    let completed = string_field(item, &["status"])
                        .map(|status| status == "completed")
                        .unwrap_or(false);
                    Some(PlanItem { text, completed })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn reasoning_text(item: &Value) -> String {
    string_field(item, &["text", "summaryText"])
        .or_else(|| item.get("summary").and_then(value_text))
        .or_else(|| item.get("content").and_then(value_text))
        .unwrap_or_default()
}

fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Array(values) => {
            let parts = values.iter().filter_map(value_text).collect::<Vec<_>>();
            (!parts.is_empty()).then(|| parts.join("\n"))
        }
        Value::Object(_) => string_field(value, &["text", "content", "message", "summary"]),
        _ => scalar_string(value),
    }
}

fn error_message(value: &Value) -> String {
    string_field(value, &["message", "detail", "reason"])
        .or_else(|| value_text(value))
        .unwrap_or_else(|| value.to_string())
}

fn tail_chars(text: &str, max_chars: usize) -> String {
    let len = text.chars().count();
    if len <= max_chars {
        text.to_string()
    } else {
        text.chars().skip(len - max_chars).collect()
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    #[cfg(unix)]
    use std::path::PathBuf;
    use std::sync::Mutex;
    #[cfg(unix)]
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    #[cfg(unix)]
    use std::{os::unix::fs::PermissionsExt, thread};

    use super::*;

    fn fixture_events(name: &str) -> Vec<AgentEvent> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures")
            .join("agents")
            .join("codex-app-server")
            .join(name);
        fs::read_to_string(path)
            .unwrap()
            .lines()
            .filter_map(|line| line.strip_prefix("S: "))
            .flat_map(|line| match parse_incoming_line(line) {
                IncomingLine::Events(events) => {
                    events.into_iter().map(|event| event.event).collect()
                }
                _ => Vec::new(),
            })
            .collect()
    }

    #[test]
    fn interrupts_a_timed_out_turn_once_its_id_arrives() {
        let (tx, rx) = std::sync::mpsc::channel();
        let state = Arc::new(ClientState {
            child: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            subscriptions: Mutex::new(HashMap::new()),
            closed: AtomicBool::new(false),
            next_id: AtomicI64::new(1),
            pending_permissions: Mutex::new(HashMap::new()),
            writer_tx: Mutex::new(Some(tx)),
            cancel_pending_turns: Mutex::new(HashSet::new()),
            starting_turns: Mutex::new(HashSet::new()),
            expected_turns: Mutex::new(HashMap::new()),
            deferred_turns: Mutex::new(HashMap::new()),
        });
        let orphan = r#"{"method":"turn/started","params":{"threadId":"t1","turn":{"id":"turn-orphan"}}}"#;

        // Not armed: the late turn/started is left alone.
        interrupt_cancelled_turn(&state, orphan);
        assert!(rx.try_recv().is_err());

        // Armed AND a start in flight: an incoming turn/started is ambiguous, so
        // it is deferred (not interrupted), even the orphan's.
        state.cancel_pending_turns.lock().unwrap().insert("t1".into());
        state.starting_turns.lock().unwrap().insert("t1".into());
        interrupt_cancelled_turn(&state, orphan);
        let retry = r#"{"method":"turn/started","params":{"threadId":"t1","turn":{"id":"turn-legit"}}}"#;
        interrupt_cancelled_turn(&state, retry);
        assert!(rx.try_recv().is_err());
        assert_eq!(state.deferred_turns.lock().unwrap()["t1"].len(), 2);

        // Armed, no start in flight: an unambiguous orphan is interrupted on
        // sight and the thread disarms.
        state.starting_turns.lock().unwrap().remove("t1");
        let late = r#"{"method":"turn/started","params":{"threadId":"t1","turn":{"id":"turn-late"}}}"#;
        interrupt_cancelled_turn(&state, late);
        let WriterMessage::Line(line) = rx.try_recv().unwrap() else {
            panic!("expected an interrupt line");
        };
        assert!(line.contains("turn/interrupt"));
        assert!(line.contains("turn-late"));
        assert!(state.cancel_pending_turns.lock().unwrap().is_empty());
    }

    #[test]
    fn handshake_fixture_skips_remote_control_status() {
        assert!(fixture_events("appserver-handshake.jsonl").is_empty());
    }

    #[test]
    fn permission_request_is_surfaced_and_answered_in_grant_shape() {
        let line = r#"{"id":7,"method":"item/permissions/requestApproval","params":{"threadId":"t1","itemId":"i1","turnId":"u1","cwd":"/p","startedAtMs":1,"permissions":{"network":{"allowAll":true}}}}"#;
        let IncomingLine::PermissionRequest {
            approval_id,
            permissions,
            events,
        } = parse_incoming_line(line)
        else {
            panic!("expected a permission request");
        };

        assert_eq!(permissions, json!({"network": {"allowAll": true}}));
        assert!(matches!(
            events.as_slice(),
            [RoutedEvent {
                thread_id: Some(thread_id),
                event: AgentEvent::ApprovalRequest {
                    kind: ApprovalKind::ToolUse,
                    ..
                },
            }] if thread_id == "t1"
        ));

        let granted = permission_response_message(
            RequestIdRepr::from_serialized(&approval_id),
            "acceptForSession",
            permissions.clone(),
        );
        assert_eq!(granted["id"], json!(7));
        assert_eq!(granted["result"]["scope"], "session");
        assert_eq!(granted["result"]["permissions"], permissions);

        let declined = permission_response_message(
            RequestIdRepr::from_serialized(&approval_id),
            "decline",
            permissions,
        );
        assert_eq!(declined["result"]["permissions"], json!({}));
        assert!(declined["result"].get("scope").is_none());
    }

    #[test]
    fn session_fixture_maps_command_usage_and_rate_limits() {
        let events = fixture_events("appserver-session.jsonl");

        assert!(events
            .iter()
            .any(|event| matches!(event, AgentEvent::TurnStarted)));
        assert!(events.iter().any(|event| {
            matches!(
                event,
                AgentEvent::CommandStarted { command, cwd: Some(cwd), .. }
                    if command.contains("appserver-fixture-ok") && cwd.contains("fixture-rec2")
            )
        }));
        assert!(events.iter().any(|event| {
            matches!(
                event,
                AgentEvent::CommandDone {
                    exit_code: Some(0),
                    status: CommandStatus::Completed,
                    output_tail: Some(output_tail),
                    ..
                } if output_tail.contains("appserver-fixture-ok")
            )
        }));
        assert!(events.iter().any(|event| {
            matches!(
                event,
                AgentEvent::Usage {
                    input_tokens: 28363,
                    cached_input_tokens: 18048,
                    output_tokens: 1698,
                    context_used: Some(30061),
                    context_window: Some(121600),
                    ..
                }
            )
        }));
        assert!(events.iter().any(|event| {
            matches!(
                event,
                AgentEvent::RateLimits { payload } if payload.contains(r#""planType":"pro""#)
            )
        }));
        assert!(matches!(
            events.last(),
            Some(AgentEvent::TurnDone {
                status: TurnStatus::Completed
            })
        ));
    }

    #[test]
    fn approval_fixture_maps_request_and_completion() {
        let events = fixture_events("appserver-approval.jsonl");
        let approval = events
            .iter()
            .find_map(|event| match event {
                AgentEvent::ApprovalRequest {
                    approval_id,
                    kind,
                    detail,
                } => Some((approval_id, kind, detail)),
                _ => None,
            })
            .expect("approval request");

        assert_eq!(approval.0, "0");
        assert_eq!(*approval.1, ApprovalKind::Command);
        assert!(approval.2.contains("approved.txt"));
        assert_eq!(
            RequestIdRepr::from_serialized(approval.0),
            RequestIdRepr::Number(0)
        );
        assert!(matches!(
            events.last(),
            Some(AgentEvent::TurnDone {
                status: TurnStatus::Completed
            })
        ));
    }

    #[test]
    fn untrusted_fixture_still_maps_final_completed_turn() {
        let events = fixture_events("appserver-untrusted-rejected.jsonl");

        assert!(!events
            .iter()
            .any(|event| matches!(event, AgentEvent::ApprovalRequest { .. })));
        assert!(events.iter().any(|event| {
            matches!(
                event,
                AgentEvent::CommandDone {
                    exit_code: Some(0),
                    status: CommandStatus::Completed,
                    output_tail: Some(output_tail),
                    ..
                } if output_tail.contains("appserver-approval-ok")
            )
        }));
        assert!(matches!(
            events.last(),
            Some(AgentEvent::TurnDone {
                status: TurnStatus::Completed
            })
        ));
    }

    #[test]
    fn non_json_line_maps_to_noise() {
        assert_eq!(
            parse_incoming_line("not json"),
            IncomingLine::Events(vec![RoutedEvent {
                thread_id: None,
                event: AgentEvent::Noise {
                    line: "not json".to_string(),
                },
            }])
        );
    }

    #[test]
    fn skips_empty_reasoning_final() {
        assert_eq!(
            parse_incoming_line(
                r#"{"method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"reasoning","id":"think-1","text":"   "}}}"#
            ),
            IncomingLine::Events(Vec::new())
        );
    }

    #[test]
    fn maps_patch_plan_tool_search_and_error_notifications() {
        let lines = [
            r#"{"method":"item/fileChange/patchUpdated","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"file-1","changes":[{"path":"src/lib.rs","kind":{"type":"update"},"diff":"@@ diff"}]}}"#,
            r#"{"method":"turn/plan/updated","params":{"threadId":"thread-1","turnId":"turn-1","plan":[{"step":"ship it","status":"completed"},{"step":"verify","status":"pending"}]}}"#,
            r#"{"method":"item/started","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"mcpToolCall","id":"mcp-1","server":"context7","tool":"query"}}}"#,
            r#"{"method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"mcpToolCall","id":"mcp-1","server":"context7","tool":"query","status":"failed","error":"boom"}}}"#,
            r#"{"method":"item/started","params":{"threadId":"thread-1","turnId":"turn-1","item":{"type":"webSearch","id":"web-1","query":"pickforge"}}}"#,
            r#"{"method":"error","params":{"threadId":"thread-1","turnId":"turn-1","willRetry":false,"error":{"message":"boom"}}}"#,
        ];
        let events = lines
            .into_iter()
            .flat_map(|line| match parse_incoming_line(line) {
                IncomingLine::Events(events) => {
                    events.into_iter().map(|event| event.event).collect()
                }
                _ => Vec::new(),
            })
            .collect::<Vec<_>>();

        assert!(events.iter().any(|event| {
            matches!(
                event,
                AgentEvent::FileChange { item_id, changes }
                    if item_id == "file-1"
                        && matches!(
                            changes.as_slice(),
                            [FileChangeEntry {
                                path,
                                kind: FileChangeKind::Modify,
                                diff: Some(diff),
                            }] if path == "src/lib.rs" && diff == "@@ diff"
                        )
            )
        }));
        assert!(events.iter().any(|event| {
            matches!(
                event,
                AgentEvent::PlanUpdate { items }
                    if matches!(
                        items.as_slice(),
                        [
                            PlanItem { text: first, completed: true },
                            PlanItem { text: second, completed: false },
                        ] if first == "ship it" && second == "verify"
                    )
            )
        }));
        assert!(events.iter().any(|event| {
            matches!(
                event,
                AgentEvent::McpToolCall {
                    item_id,
                    server,
                    tool,
                    status: ToolCallStatus::InProgress,
                    ..
                } if item_id == "mcp-1" && server == "context7" && tool == "query"
            )
        }));
        assert!(events.iter().any(|event| {
            matches!(
                event,
                AgentEvent::McpToolCall {
                    item_id,
                    status: ToolCallStatus::Failed,
                    detail: Some(detail),
                    ..
                } if item_id == "mcp-1" && detail == "boom"
            )
        }));
        assert!(events.iter().any(|event| {
            matches!(
                event,
                AgentEvent::WebSearch { item_id, query }
                    if item_id == "web-1" && query == "pickforge"
            )
        }));
        assert!(events
            .iter()
            .any(|event| { matches!(event, AgentEvent::TurnFailed { error } if error == "boom") }));
    }

    #[test]
    fn approval_response_serializes_int_and_string_ids() {
        assert_eq!(
            serde_json::to_string(&approval_response_message(
                RequestIdRepr::Number(0),
                "accept"
            ))
            .unwrap(),
            r#"{"id":0,"result":{"decision":"accept"}}"#
        );
        assert_eq!(
            serde_json::to_string(&approval_response_message(
                RequestIdRepr::String("req-1".to_string()),
                "accept",
            ))
            .unwrap(),
            r#"{"id":"req-1","result":{"decision":"accept"}}"#
        );
    }

    #[cfg(unix)]
    struct TestScript {
        dir: PathBuf,
        path: PathBuf,
        pid_file: PathBuf,
        log_file: PathBuf,
    }

    #[cfg(unix)]
    impl Drop for TestScript {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    #[cfg(unix)]
    fn test_script() -> TestScript {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "pickforge-codex-app-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fake-codex-app");
        let pid_file = dir.join("pid");
        let log_file = dir.join("requests.log");
        let body = format!(
            r#"#!/bin/sh
printf '%s' "$$" > '{}'
while IFS= read -r line; do
  printf '%s\n' "$line" >> '{}'
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{{"id":1,"result":{{"userAgent":"fake"}}}}'
      ;;
    *'"method":"thread/start"'*)
      printf '%s\n' '{{"id":2,"result":{{"thread":{{"id":"thread-1"}}}}}}'
      printf '%s\n' '{{"method":"turn/started","params":{{"threadId":"thread-1","turn":{{"id":"turn-1","status":"inProgress"}}}}}}'
      ;;
  esac
done
"#,
            pid_file.display(),
            log_file.display()
        );
        fs::write(&path, body).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();

        TestScript {
            dir,
            path,
            pid_file,
            log_file,
        }
    }

    #[cfg(unix)]
    fn wait_for_events(
        events: &Arc<Mutex<Vec<AgentEvent>>>,
        predicate: impl Fn(&[AgentEvent]) -> bool,
    ) -> Vec<AgentEvent> {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let snapshot = events.lock().unwrap().clone();
            if predicate(&snapshot) {
                return snapshot;
            }
            if Instant::now() >= deadline {
                panic!("timed out waiting for events: {snapshot:?}");
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[cfg(unix)]
    fn wait_for_file(path: &Path) -> String {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if let Ok(value) = fs::read_to_string(path) {
                if !value.is_empty() {
                    return value;
                }
            }
            if Instant::now() >= deadline {
                panic!("timed out waiting for {}", path.display());
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[cfg(unix)]
    fn process_alive(pid: i32) -> bool {
        unsafe { libc::kill(pid, 0) == 0 }
    }

    #[cfg(unix)]
    #[test]
    fn client_handshakes_pairs_request_response_and_drops_child() {
        let script = test_script();
        let client = spawn(CodexAppOptions {
            cwd: script.dir.clone(),
            binary: Some(script.path.to_string_lossy().to_string()),
        })
        .unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink_events = Arc::clone(&events);
        client
            .subscribe(
                "thread-1",
                Arc::new(move |event| sink_events.lock().unwrap().push(event)),
            )
            .unwrap();

        let info = client
            .thread_start(script.dir.clone(), None, "workspace-write", "on-request")
            .unwrap();
        assert_eq!(info.thread_id, "thread-1");
        wait_for_events(&events, |events| {
            events
                .iter()
                .any(|event| matches!(event, AgentEvent::TurnStarted))
        });

        let pid: i32 = wait_for_file(&script.pid_file).parse().unwrap();
        let log = fs::read_to_string(&script.log_file).unwrap();
        assert!(log.contains(r#""method":"initialize""#));
        assert!(log.contains(r#""method":"initialized""#));
        assert!(log.contains(r#""method":"thread/start""#));

        drop(client);
        let deadline = Instant::now() + Duration::from_secs(3);
        while process_alive(pid) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(!process_alive(pid));
    }
}
