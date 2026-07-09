use std::collections::HashMap;
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use serde_json::{json, Map, Value};

use super::claude_stream::ClaudeStreamParser;
use super::event::{AgentEvent, ApprovalKind};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_GRACE: Duration = Duration::from_millis(150);
const CHILD_EXIT_TIMEOUT: Duration = Duration::from_secs(2);
const CHILD_EXIT_POLL: Duration = Duration::from_millis(10);

#[derive(Debug, Clone)]
pub struct ClaudeBridgeOptions {
    pub runtime: Option<String>,
    pub script: Option<PathBuf>,
    /// A self-contained bridge executable (the `pickforge-claude-bridge`
    /// sidecar in packaged builds). When set it runs directly — no Bun, no
    /// script argument.
    pub standalone: Option<PathBuf>,
    pub app_root: PathBuf,
}

pub struct ClaudeBridgeClient {
    state: Arc<ClientState>,
    writer_tx: Mutex<Option<mpsc::Sender<WriterMessage>>>,
    writer_thread: Mutex<Option<JoinHandle<()>>>,
    reader_thread: Mutex<Option<JoinHandle<()>>>,
    stderr_thread: Mutex<Option<JoinHandle<()>>>,
}

#[derive(Debug, thiserror::Error)]
pub enum ClaudeBridgeError {
    #[error("failed to spawn {runtime}: {source}")]
    Spawn {
        runtime: String,
        #[source]
        source: std::io::Error,
    },
    #[error("claude bridge did not expose {0}")]
    MissingPipe(&'static str),
    #[error("failed to start claude bridge thread: {0}")]
    Thread(#[source] std::io::Error),
    #[error("claude bridge writer is closed")]
    WriterClosed,
    #[error("claude bridge chat {chat_id} did not start before timeout")]
    StartTimeout { chat_id: String },
    #[error("claude bridge request {id} timed out")]
    RequestTimeout { id: String },
    #[error("claude bridge response error: {0}")]
    Response(String),
    #[error("claude bridge malformed response: {0}")]
    BadResponse(String),
    #[error("unknown claude bridge chat {chat_id}")]
    UnknownChat { chat_id: String },
    #[error("claude bridge chat {chat_id} already has an active turn")]
    TurnActive { chat_id: String },
    #[error("claude bridge lock poisoned: {0}")]
    LockPoisoned(&'static str),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub fn spawn(opts: ClaudeBridgeOptions) -> Result<ClaudeBridgeClient, ClaudeBridgeError> {
    ClaudeBridgeClient::spawn(opts)
}

impl ClaudeBridgeClient {
    pub fn spawn(opts: ClaudeBridgeOptions) -> Result<Self, ClaudeBridgeError> {
        let ClaudeBridgeOptions {
            runtime,
            script,
            standalone,
            app_root,
        } = opts;
        let (runtime, script) = match standalone {
            Some(binary) => (binary.to_string_lossy().into_owned(), None),
            None => (
                runtime
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "bun".to_string()),
                Some(
                    script.unwrap_or_else(|| app_root.join("scripts").join("claude-bridge.ts")),
                ),
            ),
        };

        let mut command = Command::new(&runtime);
        if let Some(script) = script {
            command.arg(script);
        }
        command
            .current_dir(app_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // A packaged GUI app doesn't inherit the login-shell PATH, so the
        // sidecar can't find the user's `claude` (or `bun`) install. Spawn with
        // the enriched shell environment like the other runners do.
        command.env_clear();
        for (key, value) in crate::process::user_shell_environment().clone() {
            command.env(key, value);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }

        let mut child = command.spawn().map_err(|source| ClaudeBridgeError::Spawn {
            runtime: runtime.clone(),
            source,
        })?;
        let Some(stdin) = child.stdin.take() else {
            kill_and_wait_child(child);
            return Err(ClaudeBridgeError::MissingPipe("stdin"));
        };
        let Some(stdout) = child.stdout.take() else {
            kill_and_wait_child(child);
            return Err(ClaudeBridgeError::MissingPipe("stdout"));
        };
        let Some(stderr) = child.stderr.take() else {
            kill_and_wait_child(child);
            return Err(ClaudeBridgeError::MissingPipe("stderr"));
        };

        let state = Arc::new(ClientState {
            child: Mutex::new(Some(child)),
            pending: Mutex::new(HashMap::new()),
            starts: Mutex::new(HashMap::new()),
            chats: Mutex::new(HashMap::new()),
            closed: AtomicBool::new(false),
            next_id: AtomicI64::new(1),
        });
        let (writer_tx, writer_rx) = mpsc::channel();

        let writer_thread = match std::thread::Builder::new()
            .name("claude-bridge-writer".to_string())
            .spawn({
                let writer_state = Arc::clone(&state);
                move || write_loop(stdin, writer_rx, writer_state)
            }) {
            Ok(thread) => thread,
            Err(error) => {
                kill_state_child(&state);
                return Err(ClaudeBridgeError::Thread(error));
            }
        };

        let reader_state = Arc::clone(&state);
        let reader_thread = match std::thread::Builder::new()
            .name("claude-bridge-reader".to_string())
            .spawn(move || read_loop(stdout, reader_state))
        {
            Ok(thread) => thread,
            Err(error) => {
                kill_state_child(&state);
                let _ = writer_tx.send(WriterMessage::Shutdown);
                let _ = writer_thread.join();
                return Err(ClaudeBridgeError::Thread(error));
            }
        };

        let stderr_thread = match std::thread::Builder::new()
            .name("claude-bridge-stderr".to_string())
            .spawn(move || drain(stderr))
        {
            Ok(thread) => thread,
            Err(error) => {
                kill_state_child(&state);
                let _ = writer_tx.send(WriterMessage::Shutdown);
                let _ = writer_thread.join();
                let _ = reader_thread.join();
                return Err(ClaudeBridgeError::Thread(error));
            }
        };

        Ok(Self {
            state,
            writer_tx: Mutex::new(Some(writer_tx)),
            writer_thread: Mutex::new(Some(writer_thread)),
            reader_thread: Mutex::new(Some(reader_thread)),
            stderr_thread: Mutex::new(Some(stderr_thread)),
        })
    }

    pub fn chat_start(
        &self,
        chat_id: &str,
        cwd: PathBuf,
        model: Option<String>,
        effort: Option<String>,
        resume_session_id: Option<String>,
        permission_mode: Option<String>,
        allowed_tools: Option<Vec<String>>,
        sink: Arc<dyn Fn(AgentEvent) + Send + Sync>,
    ) -> Result<(), ClaudeBridgeError> {
        let chat_id = chat_id.to_string();
        self.register_chat(chat_id.clone(), sink)?;

        let (tx, rx) = mpsc::channel();
        self.state
            .starts
            .lock()
            .map_err(|_| ClaudeBridgeError::LockPoisoned("starts"))?
            .insert(chat_id.clone(), tx);

        let mut op = Map::new();
        op.insert("op".to_string(), Value::String("start".to_string()));
        op.insert("chatId".to_string(), Value::String(chat_id.clone()));
        op.insert("cwd".to_string(), Value::String(path_string(cwd)));
        if let Some(model) = non_empty(model) {
            op.insert("model".to_string(), Value::String(model));
        }
        if let Some(effort) = non_empty(effort) {
            op.insert("effort".to_string(), Value::String(effort));
        }
        if let Some(session_id) = non_empty(resume_session_id) {
            op.insert("resumeSessionId".to_string(), Value::String(session_id));
        }
        if let Some(permission_mode) = non_empty(permission_mode) {
            op.insert("permissionMode".to_string(), Value::String(permission_mode));
        }
        if let Some(allowed_tools) = allowed_tools {
            op.insert(
                "allowedTools".to_string(),
                Value::Array(allowed_tools.into_iter().map(Value::String).collect()),
            );
        }

        if let Err(error) = self.send_value(Value::Object(op)) {
            remove_start_waiter(&self.state, &chat_id);
            remove_chat(&self.state, &chat_id);
            return Err(error);
        }

        match rx.recv_timeout(REQUEST_TIMEOUT) {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => {
                remove_chat(&self.state, &chat_id);
                Err(ClaudeBridgeError::Response(error))
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                remove_start_waiter(&self.state, &chat_id);
                remove_chat(&self.state, &chat_id);
                Err(ClaudeBridgeError::StartTimeout { chat_id })
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(ClaudeBridgeError::WriterClosed),
        }
    }

    pub fn chat_send(
        &self,
        chat_id: &str,
        text: &str,
        images: &[String],
    ) -> Result<(), ClaudeBridgeError> {
        let chat = self.chat(chat_id)?;
        begin_chat_turn(&chat, chat_id)?;
        let mut op = Map::new();
        op.insert("op".to_string(), Value::String("send".to_string()));
        op.insert("chatId".to_string(), Value::String(chat_id.to_string()));
        op.insert("text".to_string(), Value::String(text.to_string()));
        if !images.is_empty() {
            op.insert(
                "images".to_string(),
                Value::Array(images.iter().cloned().map(Value::String).collect()),
            );
        }
        let result = self.send_value(Value::Object(op));
        if result.is_err() {
            chat.turn_active.store(false, Ordering::SeqCst);
        }
        result
    }

    pub fn chat_approve(
        &self,
        chat_id: &str,
        request_id: &str,
        decision: &str,
    ) -> Result<(), ClaudeBridgeError> {
        self.send_value(json!({
            "op": "approve",
            "chatId": chat_id,
            "requestId": request_id,
            "decision": decision,
        }))
    }

    pub fn chat_interrupt(&self, chat_id: &str) -> Result<(), ClaudeBridgeError> {
        self.send_value(json!({
            "op": "interrupt",
            "chatId": chat_id,
        }))
    }

    /// Whether the bridge still holds a live query for this chat.
    pub fn chat_started(&self, chat_id: &str) -> bool {
        self.state
            .chats
            .lock()
            .map(|chats| chats.contains_key(chat_id))
            .unwrap_or(false)
    }

    /// Close the chat's query, releasing its resident claude CLI process.
    pub fn chat_close(&self, chat_id: &str) -> Result<(), ClaudeBridgeError> {
        remove_chat(&self.state, chat_id);
        self.send_value(json!({
            "op": "close",
            "chatId": chat_id,
        }))
    }

    /// Switch the live query's model mid-session (the SDK's `setModel`).
    pub fn chat_set_model(
        &self,
        chat_id: &str,
        model: Option<&str>,
    ) -> Result<(), ClaudeBridgeError> {
        self.send_value(json!({
            "op": "setModel",
            "chatId": chat_id,
            "model": model,
        }))
    }

    pub fn chat_set_permission_mode(
        &self,
        chat_id: &str,
        mode: &str,
    ) -> Result<(), ClaudeBridgeError> {
        self.send_value(json!({
            "op": "setPermissionMode",
            "chatId": chat_id,
            "mode": mode,
        }))
    }

    pub fn list_sessions(&self, cwd: PathBuf) -> Result<Value, ClaudeBridgeError> {
        self.request(
            |req_id| {
                json!({
                    "op": "listSessions",
                    "reqId": req_id,
                    "cwd": path_string(cwd),
                })
            },
            REQUEST_TIMEOUT,
        )
    }

    pub fn session_messages(
        &self,
        session_id: &str,
        cwd: PathBuf,
    ) -> Result<Value, ClaudeBridgeError> {
        self.request(
            |req_id| {
                json!({
                    "op": "sessionMessages",
                    "reqId": req_id,
                    "sessionId": session_id,
                    "cwd": path_string(cwd),
                })
            },
            REQUEST_TIMEOUT,
        )
    }

    pub fn kill(&self) -> Result<(), ClaudeBridgeError> {
        kill_state_child(&self.state);
        Ok(())
    }

    pub fn shutdown(&self) -> Result<(), ClaudeBridgeError> {
        self.state.closed.store(true, Ordering::SeqCst);
        fail_pending(&self.state, "claude bridge shutdown");
        fail_start_waiters(&self.state, "claude bridge shutdown");
        if let Ok(mut tx) = self.writer_tx.lock() {
            if let Some(tx) = tx.take() {
                let _ = tx.send(WriterMessage::Line(json!({ "op": "shutdown" }).to_string()));
                let _ = tx.send(WriterMessage::Shutdown);
            }
        }

        if !reap_state_child_if_exited(&self.state) {
            std::thread::sleep(SHUTDOWN_GRACE);
            self.kill()?;
        }

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
        if let Ok(mut chats) = self.state.chats.lock() {
            chats.clear();
        }
        Ok(())
    }

    pub fn is_closed(&self) -> bool {
        self.state.closed.load(Ordering::SeqCst)
    }

    fn register_chat(
        &self,
        chat_id: String,
        sink: Arc<dyn Fn(AgentEvent) + Send + Sync>,
    ) -> Result<(), ClaudeBridgeError> {
        let mut chats = self
            .state
            .chats
            .lock()
            .map_err(|_| ClaudeBridgeError::LockPoisoned("chats"))?;
        // A reattach (webview reload while the bridge kept the chat alive) must
        // only redirect events to the new sink — replacing the runtime would
        // drop a live turn's parser state and reset turn_active, so a query
        // that ends without a parsed terminal would never emit its synthetic
        // failure and the manager's turn would hang forever.
        if let Some(existing) = chats.get(&chat_id) {
            if let Ok(mut slot) = existing.sink.lock() {
                *slot = sink;
            }
            return Ok(());
        }
        chats.insert(
            chat_id,
            Arc::new(ChatRuntime {
                sink: Mutex::new(sink),
                parser: Mutex::new(ClaudeStreamParser::new()),
                turn_active: AtomicBool::new(false),
                terminal_emitted: AtomicBool::new(false),
            }),
        );
        Ok(())
    }

    fn chat(&self, chat_id: &str) -> Result<Arc<ChatRuntime>, ClaudeBridgeError> {
        self.state
            .chats
            .lock()
            .map_err(|_| ClaudeBridgeError::LockPoisoned("chats"))?
            .get(chat_id)
            .cloned()
            .ok_or_else(|| ClaudeBridgeError::UnknownChat {
                chat_id: chat_id.to_string(),
            })
    }

    fn request<F>(&self, op: F, timeout: Duration) -> Result<Value, ClaudeBridgeError>
    where
        F: FnOnce(Value) -> Value,
    {
        let id = self.state.next_id.fetch_add(1, Ordering::SeqCst);
        let id_key = id.to_string();
        let (tx, rx) = mpsc::channel();
        self.state
            .pending
            .lock()
            .map_err(|_| ClaudeBridgeError::LockPoisoned("pending"))?
            .insert(id_key.clone(), tx);

        let send_result = self.send_value(op(Value::Number(id.into())));
        if let Err(error) = send_result {
            remove_pending(&self.state, &id_key);
            return Err(error);
        }

        match rx.recv_timeout(timeout) {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(error)) => Err(ClaudeBridgeError::Response(error)),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                remove_pending(&self.state, &id_key);
                Err(ClaudeBridgeError::RequestTimeout { id: id_key })
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(ClaudeBridgeError::WriterClosed),
        }
    }

    fn send_value(&self, value: Value) -> Result<(), ClaudeBridgeError> {
        if self.is_closed() {
            return Err(ClaudeBridgeError::WriterClosed);
        }
        let line = serde_json::to_string(&value)?;
        let tx = self
            .writer_tx
            .lock()
            .map_err(|_| ClaudeBridgeError::LockPoisoned("writer"))?
            .as_ref()
            .cloned()
            .ok_or(ClaudeBridgeError::WriterClosed)?;
        tx.send(WriterMessage::Line(line)).map_err(|_| {
            close_state(&self.state, "claude bridge writer closed");
            ClaudeBridgeError::WriterClosed
        })
    }
}

impl Drop for ClaudeBridgeClient {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

struct ClientState {
    child: Mutex<Option<Child>>,
    pending: Mutex<HashMap<String, PendingSender>>,
    starts: Mutex<HashMap<String, StartSender>>,
    chats: Mutex<HashMap<String, Arc<ChatRuntime>>>,
    closed: AtomicBool,
    next_id: AtomicI64,
}

struct ChatRuntime {
    // Swappable so a webview reattach can redirect events to the new client
    // sink without discarding the live parser / turn state below.
    sink: Mutex<Arc<dyn Fn(AgentEvent) + Send + Sync>>,
    parser: Mutex<ClaudeStreamParser>,
    turn_active: AtomicBool,
    terminal_emitted: AtomicBool,
}

impl ChatRuntime {
    fn sink(&self) -> Option<Arc<dyn Fn(AgentEvent) + Send + Sync>> {
        self.sink.lock().ok().map(|sink| Arc::clone(&sink))
    }
}

type PendingSender = mpsc::Sender<Result<Value, String>>;
type StartSender = mpsc::Sender<Result<(), String>>;

enum WriterMessage {
    Line(String),
    Shutdown,
}

fn write_loop(stdin: impl Write, rx: mpsc::Receiver<WriterMessage>, state: Arc<ClientState>) {
    let mut writer = BufWriter::new(stdin);
    for message in rx {
        match message {
            WriterMessage::Line(line) => {
                if writeln!(writer, "{line}").is_err() || writer.flush().is_err() {
                    close_state(&state, "claude bridge stdin closed");
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
        handle_incoming_line(&state, &line);
    }

    close_state(&state, "claude bridge stdout closed");
    let _ = poll_state_child_exit(&state, CHILD_EXIT_TIMEOUT);
}

fn handle_incoming_line(state: &Arc<ClientState>, line: &str) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }

    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return;
    };

    match value.get("ev").and_then(Value::as_str) {
        Some("started") => {
            if let Some(chat_id) = string_field(&value, &["chatId"]) {
                complete_started(state, &chat_id, Ok(()));
            }
        }
        Some("raw") => handle_raw_event(state, &value),
        Some("approvalRequest") => handle_approval_request(state, &value),
        Some("turnClosed") => {}
        Some("chatClosed") => {
            // The bridge dropped this chat (query ended or errored). Remove the
            // runtime so chat_send fails fast and the manager can restart the
            // chat instead of streaming prompts into a void. If a send raced
            // ahead and installed a turn, emit a terminal failure first — the
            // bridge's own `fatal` for that send would arrive after the chat is
            // gone and get dropped, leaving the manager stuck as running.
            if let Some(chat_id) = string_field(&value, &["chatId"]) {
                if let Some(chat) = chat_runtime(state, &chat_id) {
                    if chat.turn_active.load(Ordering::SeqCst) {
                        dispatch_chat_event(
                            &chat,
                            AgentEvent::TurnFailed {
                                error: "claude chat ended before the turn completed".to_string(),
                            },
                        );
                    }
                }
                remove_chat(state, &chat_id);
            }
        }
        Some("fatal") => {
            let error = value
                .get("error")
                .map(error_message)
                .unwrap_or_else(|| "claude bridge fatal error".to_string());
            let chat_id = string_field(&value, &["chatId"]);
            if let Some(chat_id) = chat_id.as_deref() {
                complete_started(state, chat_id, Err(error.clone()));
            }
            dispatch_fatal(state, chat_id.as_deref(), error);
        }
        Some("response") => handle_response(state, &value),
        _ => {}
    }
}

fn handle_raw_event(state: &Arc<ClientState>, value: &Value) {
    let Some(chat_id) = string_field(value, &["chatId"]) else {
        return;
    };
    let Some(message) = value.get("message") else {
        return;
    };
    let Some(chat) = chat_runtime(state, &chat_id) else {
        return;
    };
    let Ok(line) = serde_json::to_string(message) else {
        return;
    };
    let events = {
        let Ok(mut parser) = chat.parser.lock() else {
            return;
        };
        parser.push_line(&line)
    };

    for event in events {
        dispatch_chat_event(&chat, event);
    }
}

fn handle_approval_request(state: &Arc<ClientState>, value: &Value) {
    let Some(chat_id) = string_field(value, &["chatId"]) else {
        return;
    };
    let Some(request_id) = string_field(value, &["requestId"]) else {
        return;
    };
    let Some(tool_name) = string_field(value, &["toolName"]) else {
        return;
    };
    let Some(chat) = chat_runtime(state, &chat_id) else {
        return;
    };
    let input = value.get("input").cloned().unwrap_or(Value::Null);
    dispatch_chat_event(
        &chat,
        AgentEvent::ApprovalRequest {
            approval_id: request_id,
            kind: approval_kind(&tool_name),
            detail: json!({
                "toolName": tool_name,
                "input": input,
            })
            .to_string(),
        },
    );
}

fn handle_response(state: &Arc<ClientState>, value: &Value) {
    let Some(req_id) = value.get("reqId").and_then(scalar_string) else {
        return;
    };
    let result = if let Some(error) = value.get("error") {
        Err(error_message(error))
    } else {
        Ok(value.get("data").cloned().unwrap_or(Value::Null))
    };
    complete_pending(state, &req_id, result);
}

fn dispatch_chat_event(chat: &Arc<ChatRuntime>, event: AgentEvent) {
    if is_terminal_event(&event) {
        if chat.terminal_emitted.swap(true, Ordering::SeqCst) {
            return;
        }
        chat.turn_active.store(false, Ordering::SeqCst);
    }
    let Some(sink) = chat.sink() else {
        return;
    };
    let _ = std::panic::catch_unwind(AssertUnwindSafe(|| sink(event)));
}

fn dispatch_fatal(state: &Arc<ClientState>, chat_id: Option<&str>, error: String) {
    for chat in event_chats(state, chat_id) {
        dispatch_chat_event(
            &chat,
            AgentEvent::TurnFailed {
                error: error.clone(),
            },
        );
    }
}

fn event_chats(state: &Arc<ClientState>, chat_id: Option<&str>) -> Vec<Arc<ChatRuntime>> {
    let Ok(chats) = state.chats.lock() else {
        return Vec::new();
    };
    match chat_id {
        Some(chat_id) => chats.get(chat_id).cloned().into_iter().collect(),
        None => chats.values().cloned().collect(),
    }
}

fn chat_runtime(state: &Arc<ClientState>, chat_id: &str) -> Option<Arc<ChatRuntime>> {
    state.chats.lock().ok()?.get(chat_id).cloned()
}

fn begin_chat_turn(chat: &Arc<ChatRuntime>, chat_id: &str) -> Result<(), ClaudeBridgeError> {
    if chat.turn_active.swap(true, Ordering::SeqCst) {
        return Err(ClaudeBridgeError::TurnActive {
            chat_id: chat_id.to_string(),
        });
    }
    let mut parser = match chat.parser.lock() {
        Ok(parser) => parser,
        Err(_) => {
            chat.turn_active.store(false, Ordering::SeqCst);
            return Err(ClaudeBridgeError::LockPoisoned("parser"));
        }
    };
    *parser = ClaudeStreamParser::new();
    chat.terminal_emitted.store(false, Ordering::SeqCst);
    Ok(())
}

fn complete_started(state: &Arc<ClientState>, chat_id: &str, result: Result<(), String>) {
    let pending = state
        .starts
        .lock()
        .ok()
        .and_then(|mut starts| starts.remove(chat_id));
    if let Some(pending) = pending {
        let _ = pending.send(result);
    }
}

fn complete_pending(state: &Arc<ClientState>, id: &str, result: Result<Value, String>) {
    let pending = state
        .pending
        .lock()
        .ok()
        .and_then(|mut pending| pending.remove(id));
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

fn fail_start_waiters(state: &Arc<ClientState>, message: &str) {
    if let Ok(mut starts) = state.starts.lock() {
        for (_, tx) in starts.drain() {
            let _ = tx.send(Err(message.to_string()));
        }
    }
}

fn close_state(state: &Arc<ClientState>, pending_message: &str) {
    if state.closed.swap(true, Ordering::SeqCst) {
        return;
    }
    fail_pending(state, pending_message);
    fail_start_waiters(state, pending_message);
    dispatch_fatal(state, None, "agent process exited".to_string());
}

fn remove_pending(state: &Arc<ClientState>, id: &str) {
    if let Ok(mut pending) = state.pending.lock() {
        pending.remove(id);
    }
}

fn remove_start_waiter(state: &Arc<ClientState>, chat_id: &str) {
    if let Ok(mut starts) = state.starts.lock() {
        starts.remove(chat_id);
    }
}

fn remove_chat(state: &Arc<ClientState>, chat_id: &str) {
    if let Ok(mut chats) = state.chats.lock() {
        chats.remove(chat_id);
    }
}

fn approval_kind(tool_name: &str) -> ApprovalKind {
    match tool_name {
        "Bash" => ApprovalKind::Command,
        "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => ApprovalKind::FileChange,
        _ => ApprovalKind::ToolUse,
    }
}

fn is_terminal_event(event: &AgentEvent) -> bool {
    matches!(
        event,
        AgentEvent::TurnDone { .. } | AgentEvent::TurnFailed { .. }
    )
}

fn path_string(path: PathBuf) -> String {
    path.to_string_lossy().to_string()
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty())
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

fn error_message(value: &Value) -> String {
    string_field(value, &["message", "detail", "reason"])
        .or_else(|| value_text(value))
        .unwrap_or_else(|| value.to_string())
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

fn drain(mut stderr: impl Read) {
    let _ = std::io::copy(&mut stderr, &mut std::io::sink());
}

fn poll_state_child_exit(
    state: &Arc<ClientState>,
    timeout: Duration,
) -> Option<std::process::ExitStatus> {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if let Some(status) = reap_state_child_if_exited_with_status(state) {
            return Some(status);
        }
        if state.child.lock().ok()?.is_none() || std::time::Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(CHILD_EXIT_POLL);
    }
}

fn kill_state_child(state: &Arc<ClientState>) {
    if reap_state_child_if_exited(state) {
        return;
    }
    if let Ok(mut child) = state.child.lock() {
        if let Some(child) = child.take() {
            kill_and_wait_child(child);
        }
    }
}

fn reap_state_child_if_exited(state: &Arc<ClientState>) -> bool {
    if state
        .child
        .lock()
        .ok()
        .and_then(|child| child.as_ref().map(|_| ()))
        .is_none()
    {
        return true;
    }
    reap_state_child_if_exited_with_status(state).is_some()
}

fn reap_state_child_if_exited_with_status(
    state: &Arc<ClientState>,
) -> Option<std::process::ExitStatus> {
    let mut child = state.child.lock().ok()?;
    let running = child.as_mut()?;
    let status = match running.try_wait() {
        Ok(Some(status)) => status,
        Ok(None) | Err(_) => return None,
    };
    let Some(mut exited) = child.take() else {
        return Some(status);
    };
    let _ = exited.wait();
    Some(status)
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    #[cfg(unix)]
    use std::path::PathBuf;
    use std::sync::Mutex;
    #[cfg(unix)]
    use std::time::{Instant, SystemTime, UNIX_EPOCH};
    #[cfg(unix)]
    use std::{os::unix::fs::PermissionsExt, thread};

    use super::super::event::{AgentEvent, TurnStatus};
    use super::*;

    #[cfg(unix)]
    struct TestScript {
        dir: PathBuf,
        runtime: PathBuf,
        stdin_log: PathBuf,
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
            "pickforge-claude-bridge-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let runtime = dir.join("fake-bridge");
        let stdin_log = dir.join("stdin.jsonl");
        let body = format!(
            r#"#!/bin/sh
log='{}'
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    *'"op":"start"'*)
      printf '%s\n' '{{"ev":"started","chatId":"chat-1"}}'
      ;;
    *'"op":"send"'*)
      printf '%s\n' '{{"ev":"raw","chatId":"chat-1","message":{{"type":"system","subtype":"init","session_id":"session-1"}}}}'
      printf '%s\n' '{{"ev":"raw","chatId":"chat-1","message":{{"type":"stream_event","event":{{"type":"message_start"}}}}}}'
      printf '%s\n' '{{"ev":"raw","chatId":"chat-1","message":{{"type":"stream_event","event":{{"type":"content_block_delta","index":0,"delta":{{"type":"text_delta","text":"hi"}}}}}}}}'
      printf '%s\n' '{{"ev":"raw","chatId":"chat-1","message":{{"type":"assistant","message":{{"content":[{{"type":"text","text":"hi"}}]}}}}}}'
      printf '%s\n' '{{"ev":"raw","chatId":"chat-1","message":{{"type":"result","subtype":"success","usage":{{"input_tokens":1,"cache_read_input_tokens":2,"output_tokens":3}},"total_cost_usd":0.01}}}}'
      printf '%s\n' '{{"ev":"approvalRequest","chatId":"chat-1","requestId":"approval-1","toolName":"Bash","input":{{"command":"cargo check"}}}}'
      printf '%s\n' '{{"ev":"turnClosed","chatId":"chat-1"}}'
      ;;
    *'"op":"approve"'*)
      ;;
    *'"op":"listSessions"'*)
      printf '%s\n' '{{"ev":"response","reqId":1,"data":{{"sessions":[{{"id":"session-1"}}]}}}}'
      ;;
    *'"op":"sessionMessages"'*)
      printf '%s\n' '{{"ev":"response","reqId":2,"data":{{"messages":[{{"role":"assistant","text":"hi"}}]}}}}'
      ;;
    *'"op":"shutdown"'*)
      exit 0
      ;;
  esac
done
"#,
            stdin_log.display()
        );
        fs::write(&runtime, body).unwrap();
        let mut permissions = fs::metadata(&runtime).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&runtime, permissions).unwrap();

        TestScript {
            dir,
            runtime,
            stdin_log,
        }
    }

    #[cfg(unix)]
    fn active_turn_script() -> TestScript {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "pickforge-claude-bridge-active-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let runtime = dir.join("fake-bridge");
        let stdin_log = dir.join("stdin.jsonl");
        let body = format!(
            r#"#!/bin/sh
log='{}'
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    *'"op":"start"'*)
      printf '%s\n' '{{"ev":"started","chatId":"chat-1"}}'
      ;;
    *'"op":"send"'*)
      printf '%s\n' '{{"ev":"raw","chatId":"chat-1","message":{{"type":"stream_event","event":{{"type":"message_start"}}}}}}'
      ;;
    *'"op":"shutdown"'*)
      exit 0
      ;;
  esac
done
"#,
            stdin_log.display()
        );
        fs::write(&runtime, body).unwrap();
        let mut permissions = fs::metadata(&runtime).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&runtime, permissions).unwrap();

        TestScript {
            dir,
            runtime,
            stdin_log,
        }
    }

    #[cfg(unix)]
    fn exit_mid_turn_script() -> TestScript {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "pickforge-claude-bridge-exit-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let runtime = dir.join("fake-bridge");
        let stdin_log = dir.join("stdin.jsonl");
        let body = format!(
            r#"#!/bin/sh
log='{}'
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    *'"op":"start"'*)
      printf '%s\n' '{{"ev":"started","chatId":"chat-1"}}'
      ;;
    *'"op":"send"'*)
      printf '%s\n' '{{"ev":"raw","chatId":"chat-1","message":{{"type":"stream_event","event":{{"type":"message_start"}}}}}}'
      exit 0
      ;;
  esac
done
"#,
            stdin_log.display()
        );
        fs::write(&runtime, body).unwrap();
        let mut permissions = fs::metadata(&runtime).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&runtime, permissions).unwrap();

        TestScript {
            dir,
            runtime,
            stdin_log,
        }
    }

    #[cfg(unix)]
    fn client_opts(script: &TestScript) -> ClaudeBridgeOptions {
        ClaudeBridgeOptions {
            runtime: Some(script.runtime.to_string_lossy().to_string()),
            script: Some(script.dir.join("ignored.ts")),
            standalone: None,
            app_root: script.dir.clone(),
        }
    }

    #[cfg(unix)]
    fn spawn_test_client(script: &TestScript) -> ClaudeBridgeClient {
        for attempt in 0..10 {
            match spawn(client_opts(script)) {
                Ok(client) => return client,
                Err(error) if is_text_file_busy(&error) && attempt < 9 => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("spawn claude bridge: {error:?}"),
            }
        }
        unreachable!("retry loop returns or panics")
    }

    #[cfg(unix)]
    fn is_text_file_busy(error: &ClaudeBridgeError) -> bool {
        matches!(
            error,
            ClaudeBridgeError::Spawn { source, .. }
                if source.raw_os_error() == Some(libc::ETXTBSY)
        )
    }

    fn event_sink() -> (
        Arc<Mutex<Vec<AgentEvent>>>,
        Arc<dyn Fn(AgentEvent) + Send + Sync>,
    ) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink_events = Arc::clone(&events);
        let sink = Arc::new(move |event| sink_events.lock().unwrap().push(event));
        (events, sink)
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
    fn wait_for_file(path: &Path, predicate: impl Fn(&str) -> bool) -> String {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let value = fs::read_to_string(path).unwrap_or_default();
            if predicate(&value) {
                return value;
            }
            if Instant::now() >= deadline {
                panic!("timed out waiting for {}", path.display());
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn terminal_event_count(events: &[AgentEvent]) -> usize {
        events
            .iter()
            .filter(|event| {
                matches!(
                    event,
                    AgentEvent::TurnDone { .. } | AgentEvent::TurnFailed { .. }
                )
            })
            .count()
    }

    fn turn_started_count(events: &[AgentEvent]) -> usize {
        events
            .iter()
            .filter(|event| matches!(event, AgentEvent::TurnStarted))
            .count()
    }

    #[cfg(unix)]
    #[test]
    fn maps_bridge_events_writes_ops_and_pairs_list_sessions() {
        let script = test_script();
        let client = spawn_test_client(&script);
        let (events, sink) = event_sink();

        client
            .chat_start(
                "chat-1",
                script.dir.clone(),
                Some("sonnet".to_string()),
                Some("high".to_string()),
                Some("session-0".to_string()),
                Some("acceptEdits".to_string()),
                Some(vec!["Bash".to_string()]),
                sink,
            )
            .unwrap();
        client
            .chat_send("chat-1", "hello", &["/tmp/pickforge-shot.png".to_string()])
            .unwrap();

        let snapshot = wait_for_events(&events, |events| {
            terminal_event_count(events) == 1
                && events
                    .iter()
                    .any(|event| matches!(event, AgentEvent::ApprovalRequest { .. }))
        });

        assert!(matches!(
            snapshot.first(),
            Some(AgentEvent::SessionStarted {
                provider_session_id
            }) if provider_session_id == "session-1"
        ));
        assert!(snapshot
            .iter()
            .any(|event| *event == AgentEvent::TurnStarted));
        assert!(snapshot
            .iter()
            .any(|event| matches!(event, AgentEvent::TextDelta { text } if text == "hi")));
        assert!(snapshot.iter().any(|event| {
            matches!(
                event,
                AgentEvent::TextFinal { text, .. } if text == "hi"
            )
        }));
        assert!(snapshot.iter().any(|event| {
            matches!(
                event,
                AgentEvent::Usage {
                    input_tokens: 1,
                    cached_input_tokens: 2,
                    output_tokens: 3,
                    cost_usd: Some(0.01),
                    context_used: None,
                    context_window: None
                }
            )
        }));
        assert!(snapshot.iter().any(|event| {
            matches!(
                event,
                AgentEvent::TurnDone {
                    status: TurnStatus::Completed
                }
            )
        }));
        assert!(snapshot.iter().any(|event| {
            matches!(
                event,
                AgentEvent::ApprovalRequest {
                    approval_id,
                    kind: ApprovalKind::Command,
                    detail
                } if approval_id == "approval-1"
                    && detail.contains(r#""toolName":"Bash""#)
                    && detail.contains(r#""command":"cargo check""#)
            )
        }));

        client
            .chat_approve("chat-1", "approval-1", "acceptForSession")
            .unwrap();
        client
            .chat_set_permission_mode("chat-1", "plan")
            .unwrap();
        let sessions = client.list_sessions(script.dir.clone()).unwrap();
        assert_eq!(sessions["sessions"][0]["id"], "session-1");

        let log = wait_for_file(&script.stdin_log, |log| {
            log.contains(r#""op":"start""#)
                && log.contains(r#""op":"send""#)
                && log.contains(r#""op":"approve""#)
                && log.contains(r#""op":"setPermissionMode""#)
                && log.contains(r#""op":"listSessions""#)
        });
        assert!(log.contains(r#""model":"sonnet""#));
        assert!(log.contains(r#""resumeSessionId":"session-0""#));
        assert!(log.contains(r#""permissionMode":"acceptEdits""#));
        assert!(log.contains(r#""mode":"plan""#));
        assert!(log.contains(r#""allowedTools":["Bash"]"#));
        assert!(log.contains(r#""images":["/tmp/pickforge-shot.png"]"#));
        assert!(log.contains(r#""decision":"acceptForSession""#));
    }

    #[cfg(unix)]
    #[test]
    fn resets_parser_between_sends() {
        let script = test_script();
        let client = spawn_test_client(&script);
        let (events, sink) = event_sink();

        client
            .chat_start("chat-1", script.dir.clone(), None, None, None, None, None, sink)
            .unwrap();
        client.chat_send("chat-1", "first", &[]).unwrap();
        wait_for_events(&events, |events| {
            turn_started_count(events) == 1 && terminal_event_count(events) == 1
        });

        client.chat_send("chat-1", "second", &[]).unwrap();
        let snapshot = wait_for_events(&events, |events| {
            turn_started_count(events) == 2 && terminal_event_count(events) == 2
        });

        assert_eq!(turn_started_count(&snapshot), 2);
    }

    #[cfg(unix)]
    #[test]
    fn send_while_turn_active_errors() {
        let script = active_turn_script();
        let client = spawn_test_client(&script);
        let (events, sink) = event_sink();

        client
            .chat_start("chat-1", script.dir.clone(), None, None, None, None, None, sink)
            .unwrap();
        client.chat_send("chat-1", "first", &[]).unwrap();
        let error = client.chat_send("chat-1", "second", &[]).unwrap_err();

        assert!(matches!(
            error,
            ClaudeBridgeError::TurnActive { chat_id } if chat_id == "chat-1"
        ));
        wait_for_events(&events, |events| turn_started_count(events) == 1);
        let log = wait_for_file(&script.stdin_log, |log| log.contains(r#""op":"send""#));
        assert_eq!(log.matches(r#""op":"send""#).count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn exiting_bridge_broadcasts_turn_failed_and_marks_closed() {
        let script = exit_mid_turn_script();
        let client = spawn_test_client(&script);
        let (events, sink) = event_sink();

        client
            .chat_start("chat-1", script.dir.clone(), None, None, None, None, None, sink)
            .unwrap();
        client.chat_send("chat-1", "first", &[]).unwrap();

        wait_for_events(&events, |events| {
            matches!(
                events.last(),
                Some(AgentEvent::TurnFailed { error }) if error == "agent process exited"
            )
        });
        assert!(client.is_closed());
    }
}
