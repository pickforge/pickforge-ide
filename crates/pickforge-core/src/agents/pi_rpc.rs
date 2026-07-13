use std::collections::HashMap;
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::event::{
    AgentEvent, FileChangeEntry, FileChangeKind, ToolCallStatus, TurnStatus,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_JSON_LINE_BYTES: usize = 1024 * 1024;
const MAX_COMMAND_BYTES: usize = 1024 * 1024;
const MAX_VERSION_OUTPUT_BYTES: usize = 16 * 1024;
const STDERR_TAIL_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone)]
pub struct PiRpcOptions {
    pub cwd: PathBuf,
    /// Canonical app-owned root beneath which Pi session directories must live.
    pub session_root: PathBuf,
    pub session_dir: PathBuf,
    pub session_path: PathBuf,
    pub model: Option<String>,
    pub binary: Option<String>,
    /// Test/dogfood only: prevents loading configured extensions and does not
    /// alter Pi's global configuration.
    pub no_extensions: bool,
    /// Startup smoke only. Production sessions leave this false so model turns
    /// can use their configured provider normally.
    pub offline: bool,
    /// Tests can replace HOME/XDG roots without exposing the user's Pi config.
    pub environment_overrides: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PiSessionState {
    pub session_id: String,
    pub session_file: Option<String>,
    pub is_streaming: bool,
    pub thinking_level: String,
    pub model: Option<Value>,
    pub session_name: Option<String>,
}

pub struct PiRpcClient {
    state: Arc<ClientState>,
    writer_thread: Mutex<Option<JoinHandle<()>>>,
    reader_thread: Mutex<Option<JoinHandle<()>>>,
    stderr_thread: Mutex<Option<JoinHandle<()>>>,
}

struct ClientState {
    child: Mutex<Option<ManagedChild>>,
    session_root: PathBuf,
    session_dir: PathBuf,
    session_mutation: Mutex<()>,
    pending: Mutex<HashMap<String, mpsc::Sender<Result<Value, String>>>>,
    writer_tx: Mutex<Option<mpsc::Sender<WriterMessage>>>,
    sink: Arc<dyn Fn(AgentEvent) + Send + Sync>,
    closed: AtomicBool,
    shutting_down: AtomicBool,
    active: AtomicBool,
    pending_failure: Mutex<Option<String>>,
    terminal_sent: AtomicBool,
    turn_sequence: AtomicU64,
    message_sequence: AtomicU64,
    stderr_done: AtomicBool,
    next_id: AtomicU64,
    stderr_tail: Mutex<Vec<u8>>,
    tool_args: Mutex<HashMap<String, (String, Value)>>,
    dialogs: Mutex<HashMap<String, String>>,
}
struct ManagedChild {
    child: Child,
    #[cfg(windows)]
    _job: WindowsJob,
}

#[cfg(windows)]
struct WindowsJob(isize);

#[cfg(windows)]
impl WindowsJob {
    fn assign(child: &Child) -> Result<Self, PiRpcError> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(PiRpcError::ProcessIsolation(
                std::io::Error::last_os_error().to_string(),
            ));
        }
        let job = Self(handle as isize);
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&limits).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(PiRpcError::ProcessIsolation(
                std::io::Error::last_os_error().to_string(),
            ));
        }
        let assigned =
            unsafe { AssignProcessToJobObject(handle, child.as_raw_handle() as *mut _) };
        if assigned == 0 {
            return Err(PiRpcError::ProcessIsolation(
                std::io::Error::last_os_error().to_string(),
            ));
        }
        Ok(job)
    }
}

#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;

        unsafe {
            CloseHandle(self.0 as *mut _);
        }
    }
}

impl ManagedChild {
    fn new(child: Child) -> Result<Self, PiRpcError> {
        #[cfg(windows)]
        let mut child = child;
        #[cfg(windows)]
        let job = match WindowsJob::assign(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        Ok(Self {
            child,
            #[cfg(windows)]
            _job: job,
        })
    }
}

enum WriterMessage {
    Line(Vec<u8>),
    Shutdown,
}

#[derive(Debug, thiserror::Error)]
pub enum PiRpcError {
    #[error("failed to resolve Pi executable: {0}")]
    Binary(String),
    #[error("unsupported Pi RPC version {0}; PickForge requires >=0.79.10 and <0.80.0")]
    UnsupportedVersion(String),
    #[error("failed to probe Pi version: {0}")]
    VersionProbe(String),
    #[error("unsafe Pi session path: {0}")]
    UnsafeSessionPath(String),
    #[error("failed to prepare Pi session directory: {0}")]
    SessionDirectory(String),
    #[error("failed to spawn {binary}: {source}")]
    Spawn {
        binary: String,
        #[source]
        source: std::io::Error,
    },
    #[error("Pi RPC did not expose {0}")]
    MissingPipe(&'static str),
    #[error("failed to isolate Pi RPC process tree: {0}")]
    ProcessIsolation(String),
    #[error("failed to start Pi RPC thread: {0}")]
    Thread(#[source] std::io::Error),
    #[error("Pi RPC writer is closed")]
    WriterClosed,
    #[error("Pi RPC request {0} timed out")]
    RequestTimeout(String),
    #[error("Pi RPC response error: {0}")]
    Response(String),
    #[error("Pi RPC malformed response: {0}")]
    BadResponse(String),
    #[error("Pi RPC lock poisoned: {0}")]
    LockPoisoned(&'static str),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub fn spawn(
    opts: PiRpcOptions,
    sink: Arc<dyn Fn(AgentEvent) + Send + Sync>,
) -> Result<PiRpcClient, PiRpcError> {
    PiRpcClient::spawn(opts, sink)
}

pub fn compatible_version_output(raw: &str) -> Result<String, PiRpcError> {
    let Some(version) = raw
        .split(|character: char| !(character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '+')))
        .find_map(|token| {
            let token = token.strip_prefix('v').unwrap_or(token);
            let core = token.split(['-', '+']).next()?;
            let mut parts = core.split('.');
            let major = parts.next()?.parse::<u64>().ok()?;
            let minor = parts.next()?.parse::<u64>().ok()?;
            let patch = parts.next()?.parse::<u64>().ok()?;
            parts.next().is_none().then(|| (token.to_string(), major, minor, patch))
        })
    else {
        return Err(PiRpcError::VersionProbe(
            "version output did not contain semver".to_string(),
        ));
    };
    if version.1 == 0 && version.2 == 79 && version.3 >= 10 {
        Ok(version.0)
    } else {
        Err(PiRpcError::UnsupportedVersion(version.0))
    }
}

impl PiRpcClient {
    pub fn spawn(
        opts: PiRpcOptions,
        sink: Arc<dyn Fn(AgentEvent) + Send + Sync>,
    ) -> Result<Self, PiRpcError> {
        prepare_session_paths(&opts.session_root, &opts.session_dir, &opts.session_path)?;
        let environment = controlled_environment(&opts.environment_overrides);
        let binary = resolve_binary(opts.binary.as_deref(), &environment)?;
        probe_version(&binary, &opts.cwd, &environment)?;
        // The version probe is an external process and gives another process a
        // chance to replace a checked path. Revalidate immediately before spawn;
        // descriptor-relative creation/opening is not available through Pi's
        // path-only CLI contract.
        prepare_session_paths(&opts.session_root, &opts.session_dir, &opts.session_path)?;

        let mut command = Command::new(&binary);
        command
            .arg("--mode")
            .arg("rpc")
            .arg("--session")
            .arg(&opts.session_path)
            .arg("--session-dir")
            .arg(&opts.session_dir)
            .current_dir(&opts.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_clear();
        if opts.no_extensions {
            command.arg("--no-extensions");
        }
        if opts.offline {
            command.arg("--offline");
        }
        if let Some(model) = opts.model.as_deref().filter(|value| !value.trim().is_empty()) {
            if let Some((provider, _)) = model.split_once('/') {
                command.arg("--provider").arg(provider);
            }
            command.arg("--model").arg(model);
        }
        for (key, value) in environment {
            command.env(key, value);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }

        let child = command.spawn().map_err(|source| PiRpcError::Spawn {
            binary: binary.to_string_lossy().into_owned(),
            source,
        })?;
        let mut child = ManagedChild::new(child)?;
        let Some(stdin) = child.child.stdin.take() else {
            kill_and_wait_child(child);
            return Err(PiRpcError::MissingPipe("stdin"));
        };
        let Some(stdout) = child.child.stdout.take() else {
            kill_and_wait_child(child);
            return Err(PiRpcError::MissingPipe("stdout"));
        };
        let Some(stderr) = child.child.stderr.take() else {
            kill_and_wait_child(child);
            return Err(PiRpcError::MissingPipe("stderr"));
        };

        let (writer_tx, writer_rx) = mpsc::channel();
        let state = Arc::new(ClientState {
            child: Mutex::new(Some(child)),
            session_root: opts.session_root.clone(),
            session_dir: opts.session_dir.clone(),
            session_mutation: Mutex::new(()),
            pending: Mutex::new(HashMap::new()),
            writer_tx: Mutex::new(Some(writer_tx.clone())),
            sink,
            closed: AtomicBool::new(false),
            shutting_down: AtomicBool::new(false),
            active: AtomicBool::new(false),
            stderr_done: AtomicBool::new(false),
            terminal_sent: AtomicBool::new(false),
            pending_failure: Mutex::new(None),
            turn_sequence: AtomicU64::new(0),
            message_sequence: AtomicU64::new(0),
            next_id: AtomicU64::new(1),
            stderr_tail: Mutex::new(Vec::new()),
            tool_args: Mutex::new(HashMap::new()),
            dialogs: Mutex::new(HashMap::new()),
        });

        let writer_thread = std::thread::Builder::new()
            .name("pi-rpc-writer".to_string())
            .spawn({
                let state = Arc::clone(&state);
                move || write_loop(stdin, writer_rx, state)
            })
            .map_err(|error| {
                kill_state_child(&state);
                PiRpcError::Thread(error)
            })?;
        let reader_thread = match std::thread::Builder::new()
            .name("pi-rpc-reader".to_string())
            .spawn({
                let state = Arc::clone(&state);
                move || read_loop(stdout, state)
            }) {
            Ok(thread) => thread,
            Err(error) => {
                kill_state_child(&state);
                let _ = writer_tx.send(WriterMessage::Shutdown);
                let _ = writer_thread.join();
                return Err(PiRpcError::Thread(error));
            }
        };
        let stderr_thread = match std::thread::Builder::new()
            .name("pi-rpc-stderr".to_string())
            .spawn({
                let state = Arc::clone(&state);
                move || stderr_loop(stderr, state)
            }) {
            Ok(thread) => thread,
            Err(error) => {
                kill_state_child(&state);
                let _ = writer_tx.send(WriterMessage::Shutdown);
                let _ = writer_thread.join();
                let _ = reader_thread.join();
                return Err(PiRpcError::Thread(error));
            }
        };

        let client = Self {
            state,
            writer_thread: Mutex::new(Some(writer_thread)),
            reader_thread: Mutex::new(Some(reader_thread)),
            stderr_thread: Mutex::new(Some(stderr_thread)),
        };
        match client.get_state() {
            Ok(session_state) => {
                client.emit_session_state(&session_state);
                Ok(client)
            }
            Err(error) => {
                let _ = client.shutdown();
                Err(error)
            }
        }
    }

    pub fn is_closed(&self) -> bool {
        self.state.closed.load(Ordering::SeqCst)
    }

    pub fn prompt(&self, message: &str) -> Result<(), PiRpcError> {
        self.state.active.store(true, Ordering::SeqCst);
        self.state.terminal_sent.store(false, Ordering::SeqCst);
        if let Ok(mut pending_failure) = self.state.pending_failure.lock() {
            *pending_failure = None;
        }
        match self.request(json!({"type": "prompt", "message": message}), REQUEST_TIMEOUT) {
            Ok(_) => Ok(()),
            Err(error) => {
                if !matches!(&error, PiRpcError::Response(_)) && !self.is_closed() {
                    let _ = self.abort();
                }
                self.state.active.store(false, Ordering::SeqCst);
                Err(error)
            }
        }
    }

    pub fn steer(&self, message: &str) -> Result<(), PiRpcError> {
        self.request(json!({"type": "steer", "message": message}), REQUEST_TIMEOUT)?;
        Ok(())
    }

    pub fn follow_up(&self, message: &str) -> Result<(), PiRpcError> {
        self.request(json!({"type": "follow_up", "message": message}), REQUEST_TIMEOUT)?;
        Ok(())
    }

    pub fn abort(&self) -> Result<(), PiRpcError> {
        self.request(json!({"type": "abort"}), REQUEST_TIMEOUT)?;
        Ok(())
    }

    pub fn set_model(&self, model: &str) -> Result<Value, PiRpcError> {
        let (provider, model_id) = model.split_once('/').ok_or_else(|| {
            PiRpcError::BadResponse("Pi model must use provider/model syntax".to_string())
        })?;
        let data = self.request(
            json!({"type": "set_model", "provider": provider, "modelId": model_id}),
            REQUEST_TIMEOUT,
        )?;
        (self.state.sink)(AgentEvent::SessionUpdated {
            provider_session_id: None,
            session_file: None,
            title: None,
            model: model_name(&data).or_else(|| Some(model.to_string())),
            thinking_level: None,
        });
        Ok(data)
    }

    pub fn set_thinking_level(&self, level: &str) -> Result<(), PiRpcError> {
        self.request(
            json!({"type": "set_thinking_level", "level": level}),
            REQUEST_TIMEOUT,
        )?;
        Ok(())
    }

    pub fn get_state(&self) -> Result<PiSessionState, PiRpcError> {
        let data = self.request(json!({"type": "get_state"}), REQUEST_TIMEOUT)?;
        let state = parse_session_state(&data)?;
        let session_file = state.session_file.as_deref().ok_or_else(|| {
            PiRpcError::BadResponse("get_state missing sessionFile".to_string())
        })?;
        prepare_session_paths(
            &self.state.session_root,
            &self.state.session_dir,
            Path::new(session_file),
        )?;
        Ok(state)
    }

    pub fn session_stats(&self) -> Result<Value, PiRpcError> {
        self.request(json!({"type": "get_session_stats"}), REQUEST_TIMEOUT)
    }

    pub fn switch_session(&self, path: &Path) -> Result<bool, PiRpcError> {
        prepare_session_paths(&self.state.session_root, &self.state.session_dir, path)?;
        let _session_guard = self
            .state
            .session_mutation
            .lock()
            .map_err(|_| PiRpcError::LockPoisoned("session mutation"))?;
        cancel_all_dialogs(&self.state);
        let data = self.request(
            json!({"type": "switch_session", "sessionPath": path.to_string_lossy()}),
            REQUEST_TIMEOUT,
        )?;
        let cancelled = data
            .get("cancelled")
            .and_then(Value::as_bool)
            .ok_or_else(|| PiRpcError::BadResponse("switch_session missing cancelled".to_string()))?;
        if !cancelled {
            let state = self.get_state()?;
            self.emit_session_state(&state);
        }
        Ok(cancelled)
    }

    pub fn respond_extension_value(&self, id: &str, value: &str) -> Result<(), PiRpcError> {
        self.complete_dialog(id, json!({"type": "extension_ui_response", "id": id, "value": value}))
    }

    pub fn respond_extension_confirm(&self, id: &str, confirmed: bool) -> Result<(), PiRpcError> {
        self.complete_dialog(
            id,
            json!({"type": "extension_ui_response", "id": id, "confirmed": confirmed}),
        )
    }

    pub fn cancel_extension(&self, id: &str) -> Result<(), PiRpcError> {
        self.complete_dialog(id, json!({"type": "extension_ui_response", "id": id, "cancelled": true}))
    }

    pub fn shutdown(&self) -> Result<(), PiRpcError> {
        if self.state.shutting_down.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        if self.state.active.load(Ordering::SeqCst) && !self.is_closed() {
            let _ = self.abort();
        }
        cancel_all_dialogs(&self.state);
        if let Ok(mut writer) = self.state.writer_tx.lock() {
            if let Some(writer) = writer.take() {
                let _ = writer.send(WriterMessage::Shutdown);
            }
        }
        wait_for_child_or_kill(&self.state, SHUTDOWN_TIMEOUT);
        close_state(&self.state, "Pi RPC shutdown");
        join_thread(&self.reader_thread);
        join_thread(&self.writer_thread);
        join_thread(&self.stderr_thread);
        Ok(())
    }

    fn complete_dialog(&self, id: &str, response: Value) -> Result<(), PiRpcError> {
        let removed = self
            .state
            .dialogs
            .lock()
            .map_err(|_| PiRpcError::LockPoisoned("dialogs"))?
            .remove(id);
        if removed.is_none() {
            return Err(PiRpcError::BadResponse(format!(
                "unknown or already completed Pi extension dialog {id}"
            )));
        }
        send_value(&self.state, response)
    }

    fn request(&self, mut command: Value, timeout: Duration) -> Result<Value, PiRpcError> {
        if self.is_closed() {
            return Err(PiRpcError::WriterClosed);
        }
        let id = format!("pf-{}", self.state.next_id.fetch_add(1, Ordering::Relaxed));
        command
            .as_object_mut()
            .ok_or_else(|| PiRpcError::BadResponse("command must be an object".to_string()))?
            .insert("id".to_string(), Value::String(id.clone()));
        let expected_command = command
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let (tx, rx) = mpsc::channel();
        self.state
            .pending
            .lock()
            .map_err(|_| PiRpcError::LockPoisoned("pending"))?
            .insert(id.clone(), tx);
        if let Err(error) = send_value(&self.state, command) {
            if let Ok(mut pending) = self.state.pending.lock() {
                pending.remove(&id);
            }
            return Err(error);
        }
        let response = match rx.recv_timeout(timeout) {
            Ok(response) => response.map_err(PiRpcError::Response)?,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Ok(mut pending) = self.state.pending.lock() {
                    pending.remove(&id);
                }
                return Err(PiRpcError::RequestTimeout(id));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(PiRpcError::Response("Pi RPC response channel closed".to_string()));
            }
        };
        if response.get("command").and_then(Value::as_str) != Some(expected_command.as_str()) {
            return Err(PiRpcError::BadResponse(format!(
                "response command did not match {expected_command}"
            )));
        }
        if response.get("success").and_then(Value::as_bool) != Some(true) {
            return Err(PiRpcError::Response(
                response
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Pi RPC command failed")
                    .to_string(),
            ));
        }
        Ok(response.get("data").cloned().unwrap_or(Value::Null))
    }

    fn emit_session_state(&self, state: &PiSessionState) {
        if let Some(session_file) = state.session_file.as_ref() {
            (self.state.sink)(AgentEvent::SessionStarted {
                provider_session_id: session_file.clone(),
            });
        }
        (self.state.sink)(AgentEvent::SessionUpdated {
            provider_session_id: Some(state.session_id.clone()),
            session_file: state.session_file.clone(),
            title: state.session_name.clone(),
            model: state.model.as_ref().and_then(model_name),
            thinking_level: Some(state.thinking_level.clone()),
        });
    }
}

impl Drop for PiRpcClient {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

fn probe_version(
    binary: &Path,
    cwd: &Path,
    environment: &HashMap<String, String>,
) -> Result<String, PiRpcError> {
    let binary_text = binary.to_string_lossy();
    let cwd_text = cwd.to_string_lossy();
    let (outcome, truncation) = crate::process::run_timeout_capped(
        &binary_text,
        &["--version"],
        Some(&cwd_text),
        Some(environment),
        VERSION_TIMEOUT,
        MAX_VERSION_OUTPUT_BYTES,
    )
    .map_err(|error| PiRpcError::VersionProbe(error.to_string()))?;
    if truncation.stdout || truncation.stderr {
        return Err(PiRpcError::VersionProbe("version output exceeded limit".to_string()));
    }
    if !outcome.success() {
        return Err(PiRpcError::VersionProbe(format!(
            "Pi exited with {:?}",
            outcome.code
        )));
    }
    compatible_version_output(&String::from_utf8_lossy(&outcome.stdout))
}

fn resolve_binary(
    configured: Option<&str>,
    environment: &HashMap<String, String>,
) -> Result<PathBuf, PiRpcError> {
    let binary = configured
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("pi");
    crate::process::which_in(binary, environment)
        .ok_or_else(|| PiRpcError::Binary(binary.to_string()))
}

fn controlled_environment(overrides: &HashMap<String, String>) -> HashMap<String, String> {
    controlled_environment_from(crate::process::user_shell_environment(), overrides)
}

fn controlled_environment_from(
    source: &HashMap<String, String>,
    overrides: &HashMap<String, String>,
) -> HashMap<String, String> {
    const BASE_ENVIRONMENT: &[&str] = &[
        "PATH",
        "Path",
        "PATHEXT",
        "Pathext",
        "HOME",
        "USERPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
        "APPDATA",
        "LOCALAPPDATA",
        "SYSTEMROOT",
        "SystemRoot",
        "COMSPEC",
        "USER",
        "LOGNAME",
        "SHELL",
        "TMPDIR",
        "TEMP",
        "TMP",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_CACHE_HOME",
    ];
    // Pi 0.79.10 docs/providers.md provider credential and connection
    // variables. Values are forwarded unchanged to the controlled child
    // environment; PickForge never interprets or logs them.
    const PI_PROVIDER_ENVIRONMENT: &[&str] = &[
        "ANTHROPIC_API_KEY",
        "ANT_LING_API_KEY",
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_BASE_URL",
        "AZURE_OPENAI_RESOURCE_NAME",
        "AZURE_OPENAI_API_VERSION",
        "AZURE_OPENAI_DEPLOYMENT_NAME_MAP",
        "AWS_PROFILE",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_BEARER_TOKEN_BEDROCK",
        "AWS_REGION",
        "AWS_WEB_IDENTITY_TOKEN_FILE",
        "AWS_BEDROCK_FORCE_CACHE",
        "AWS_ENDPOINT_URL_BEDROCK_RUNTIME",
        "AWS_BEDROCK_SKIP_AUTH",
        "AWS_BEDROCK_FORCE_HTTP1",
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_CLOUD_LOCATION",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "OPENAI_API_KEY",
        "DEEPSEEK_API_KEY",
        "NVIDIA_API_KEY",
        "GEMINI_API_KEY",
        "MISTRAL_API_KEY",
        "GROQ_API_KEY",
        "CEREBRAS_API_KEY",
        "CLOUDFLARE_API_KEY",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_GATEWAY_ID",
        "XAI_API_KEY",
        "OPENROUTER_API_KEY",
        "AI_GATEWAY_API_KEY",
        "ZAI_API_KEY",
        "ZAI_CODING_CN_API_KEY",
        "OPENCODE_API_KEY",
        "HF_TOKEN",
        "FIREWORKS_API_KEY",
        "TOGETHER_API_KEY",
        "KIMI_API_KEY",
        "MINIMAX_API_KEY",
        "MINIMAX_CN_API_KEY",
        "XIAOMI_API_KEY",
        "XIAOMI_TOKEN_PLAN_CN_API_KEY",
        "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
        "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
    ];

    let mut result = HashMap::new();
    for key in BASE_ENVIRONMENT
        .iter()
        .chain(PI_PROVIDER_ENVIRONMENT)
    {
        if let Some(value) = source.get(*key) {
            result.insert((*key).to_string(), value.clone());
        }
    }
    for (key, value) in source {
        if key.starts_with("LC_") || key.starts_with("AWS_CONTAINER_CREDENTIALS_") {
            result.insert(key.clone(), value.clone());
        }
    }
    for (key, value) in overrides {
        result.insert(key.clone(), value.clone());
    }
    result
}

fn validate_owned_session_path(
    session_root: &Path,
    session_dir: &Path,
    session_path: &Path,
) -> Result<(), PiRpcError> {
    if !session_root.is_absolute()
        || !session_dir.is_absolute()
        || !session_path.is_absolute()
        || session_dir == session_root
        || !session_dir.starts_with(session_root)
        || session_path.parent() != Some(session_dir)
        || session_path.extension().and_then(|value| value.to_str()) != Some("jsonl")
    {
        return Err(unsafe_session_path(session_path));
    }
    Ok(())
}
fn unsafe_session_path(path: &Path) -> PiRpcError {
    PiRpcError::UnsafeSessionPath(path.to_string_lossy().into_owned())
}

fn metadata_is_symlink_or_reparse(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

fn reject_symlink_path(path: &Path) -> Result<(), PiRpcError> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata_is_symlink_or_reparse(&metadata) => {
            Err(unsafe_session_path(path))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(PiRpcError::SessionDirectory(error.to_string())),
    }
}

fn reject_symlink_ancestors(root: &Path, target: &Path) -> Result<(), PiRpcError> {
    let relative = target
        .strip_prefix(root)
        .map_err(|_| unsafe_session_path(target))?;
    reject_symlink_path(root)?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        match component {
            std::path::Component::Normal(component) => current.push(component),
            _ => return Err(unsafe_session_path(target)),
        }
        reject_symlink_path(&current)?;
    }
    Ok(())
}


fn prepare_session_paths(
    session_root: &Path,
    session_dir: &Path,
    session_path: &Path,
) -> Result<(), PiRpcError> {
    validate_owned_session_path(session_root, session_dir, session_path)?;
    reject_symlink_ancestors(session_root, session_dir)?;
    let root_metadata = std::fs::symlink_metadata(session_root)
        .map_err(|error| PiRpcError::SessionDirectory(error.to_string()))?;
    if metadata_is_symlink_or_reparse(&root_metadata) || !root_metadata.is_dir() {
        return Err(unsafe_session_path(session_root));
    }
    let canonical_root = std::fs::canonicalize(session_root)
        .map_err(|error| PiRpcError::SessionDirectory(error.to_string()))?;

    match std::fs::symlink_metadata(session_path) {
        Ok(metadata) if metadata_is_symlink_or_reparse(&metadata) || !metadata.is_file() => {
            return Err(unsafe_session_path(session_path));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(PiRpcError::SessionDirectory(error.to_string())),
    }
    std::fs::create_dir_all(session_dir)
        .map_err(|error| PiRpcError::SessionDirectory(error.to_string()))?;

    // Recheck every app-owned path component after recursive creation. This
    // rejects symlink/reparse ancestors as well as the final directory.
    reject_symlink_ancestors(session_root, session_dir)?;
    let metadata = std::fs::symlink_metadata(session_dir)
        .map_err(|error| PiRpcError::SessionDirectory(error.to_string()))?;
    if metadata_is_symlink_or_reparse(&metadata) || !metadata.is_dir() {
        return Err(unsafe_session_path(session_dir));
    }
    let canonical_dir = std::fs::canonicalize(session_dir)
        .map_err(|error| PiRpcError::SessionDirectory(error.to_string()))?;
    if canonical_dir == canonical_root || !canonical_dir.starts_with(&canonical_root) {
        return Err(unsafe_session_path(session_dir));
    }
    let canonical_parent = std::fs::canonicalize(
        session_path
            .parent()
            .ok_or_else(|| unsafe_session_path(session_path))?,
    )
    .map_err(|error| PiRpcError::SessionDirectory(error.to_string()))?;
    if canonical_parent != canonical_dir {
        return Err(unsafe_session_path(session_path));
    }
    match std::fs::symlink_metadata(session_path) {
        Ok(metadata) => {
            if metadata_is_symlink_or_reparse(&metadata) || !metadata.is_file() {
                return Err(unsafe_session_path(session_path));
            }
            let canonical_file = std::fs::canonicalize(session_path)
                .map_err(|error| PiRpcError::SessionDirectory(error.to_string()))?;
            if canonical_file.parent() != Some(canonical_dir.as_path())
                || !canonical_file.starts_with(&canonical_root)
            {
                return Err(unsafe_session_path(session_path));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(PiRpcError::SessionDirectory(error.to_string())),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&canonical_dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| PiRpcError::SessionDirectory(error.to_string()))?;
    }
    Ok(())
}

fn parse_session_state(data: &Value) -> Result<PiSessionState, PiRpcError> {
    let object = data
        .as_object()
        .ok_or_else(|| PiRpcError::BadResponse("get_state data was not an object".to_string()))?;
    let session_id = object
        .get("sessionId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| PiRpcError::BadResponse("get_state missing sessionId".to_string()))?;
    let is_streaming = object
        .get("isStreaming")
        .and_then(Value::as_bool)
        .ok_or_else(|| PiRpcError::BadResponse("get_state missing isStreaming".to_string()))?;
    let thinking_level = object
        .get("thinkingLevel")
        .and_then(Value::as_str)
        .ok_or_else(|| PiRpcError::BadResponse("get_state missing thinkingLevel".to_string()))?;
    if !object.contains_key("model") {
        return Err(PiRpcError::BadResponse("get_state missing model state".to_string()));
    }
    let session_file = object
        .get("sessionFile")
        .and_then(Value::as_str)
        .map(str::to_string);
    if session_file.as_deref().is_none_or(str::is_empty) {
        return Err(PiRpcError::BadResponse("get_state missing sessionFile".to_string()));
    }
    Ok(PiSessionState {
        session_id: session_id.to_string(),
        session_file,
        is_streaming,
        thinking_level: thinking_level.to_string(),
        model: object.get("model").cloned().filter(|value| !value.is_null()),
        session_name: object
            .get("sessionName")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn send_value(state: &Arc<ClientState>, value: Value) -> Result<(), PiRpcError> {
    let mut bytes = serde_json::to_vec(&value)?;
    if bytes.len() > MAX_COMMAND_BYTES {
        return Err(PiRpcError::BadResponse("Pi RPC command exceeded output bound".to_string()));
    }
    bytes.push(b'\n');
    let writer = state
        .writer_tx
        .lock()
        .map_err(|_| PiRpcError::LockPoisoned("writer"))?
        .clone()
        .ok_or(PiRpcError::WriterClosed)?;
    writer.send(WriterMessage::Line(bytes)).map_err(|_| PiRpcError::WriterClosed)
}

fn write_loop(
    stdin: impl Write,
    receiver: mpsc::Receiver<WriterMessage>,
    state: Arc<ClientState>,
) {
    let mut writer = BufWriter::new(stdin);
    for message in receiver {
        match message {
            WriterMessage::Line(bytes) => {
                if writer.write_all(&bytes).is_err() || writer.flush().is_err() {
                    close_state(&state, "Pi RPC stdin closed");
                    wait_for_child_or_kill(&state, SHUTDOWN_TIMEOUT);
                    break;
                }
            }
            WriterMessage::Shutdown => break,
        }
    }
}

fn read_loop(mut stdout: impl Read, state: Arc<ClientState>) {
    let mut pending = Vec::with_capacity(8 * 1024);
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        match stdout.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                pending.extend_from_slice(&chunk[..read]);
                loop {
                    let Some(index) = pending.iter().position(|byte| *byte == b'\n') else {
                        if pending.len() > MAX_JSON_LINE_BYTES {
                            close_state(&state, "Pi RPC JSON line exceeded limit");
                            kill_state_child(&state);
                            return;
                        }
                        break;
                    };
                    if index > MAX_JSON_LINE_BYTES {
                        close_state(&state, "Pi RPC JSON line exceeded limit");
                        kill_state_child(&state);
                        return;
                    }
                    let mut line = pending.drain(..=index).collect::<Vec<_>>();
                    line.pop();
                    if line.last() == Some(&b'\r') {
                        line.pop();
                    }
                    if line.is_empty() {
                        continue;
                    }
                    let Ok(line) = std::str::from_utf8(&line) else {
                        close_state(&state, "Pi RPC emitted invalid UTF-8");
                        kill_state_child(&state);
                        return;
                    };
                    let Ok(value) = serde_json::from_str::<Value>(line) else {
                        close_state(&state, "Pi RPC emitted malformed JSON");
                        kill_state_child(&state);
                        return;
                    };
                    handle_incoming(&state, value);
                }
            }
            Err(error) => {
                close_state(&state, &format!("Pi RPC stdout read failed: {error}"));
                kill_state_child(&state);
                return;
            }
        }
    }
    let stderr_deadline = Instant::now() + Duration::from_millis(100);
    while !state.stderr_done.load(Ordering::SeqCst) && Instant::now() < stderr_deadline {
        std::thread::sleep(Duration::from_millis(2));
    }
    let reason = if state.shutting_down.load(Ordering::SeqCst) {
        "Pi RPC closed"
    } else {
        "Pi RPC stdout closed"
    };
    close_state(&state, reason);
    wait_for_child_or_kill(&state, SHUTDOWN_TIMEOUT);
}

fn stderr_loop(mut stderr: impl Read, state: Arc<ClientState>) {
    let mut chunk = [0_u8; 1024];
    while let Ok(read) = stderr.read(&mut chunk) {
        if read == 0 {
            break;
        }
        if let Ok(mut tail) = state.stderr_tail.lock() {
            tail.extend_from_slice(&chunk[..read]);
            if tail.len() > STDERR_TAIL_BYTES {
                let drop_count = tail.len() - STDERR_TAIL_BYTES;
                tail.drain(..drop_count);
            }
        }
    }
    state.stderr_done.store(true, Ordering::SeqCst);
}

fn handle_incoming(state: &Arc<ClientState>, value: Value) {
    if state.closed.load(Ordering::SeqCst) {
        return;
    }
    let raw = serde_json::to_string(&value).unwrap_or_else(|_| "null".to_string());
    (state.sink)(AgentEvent::ProviderEvent {
        provider: "pi".to_string(),
        payload: raw,
    });

    if value.get("type").and_then(Value::as_str) == Some("response") {
        let Some(id) = value.get("id").and_then(Value::as_str) else {
            return;
        };
        if let Ok(mut pending) = state.pending.lock() {
            if let Some(sender) = pending.remove(id) {
                let result = if value.get("success").and_then(Value::as_bool) == Some(false) {
                    Err(value
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("Pi RPC command failed")
                        .to_string())
                } else {
                    Ok(value)
                };
                let _ = sender.send(result);
            }
        }
        return;
    }

    let event_type = value.get("type").and_then(Value::as_str).unwrap_or_default();
    match event_type {
        "agent_start" => {
            state.active.store(true, Ordering::SeqCst);
            state.terminal_sent.store(false, Ordering::SeqCst);
            if let Ok(mut pending_failure) = state.pending_failure.lock() {
                *pending_failure = None;
            }
            state.turn_sequence.fetch_add(1, Ordering::SeqCst);
            state.message_sequence.store(0, Ordering::SeqCst);
            (state.sink)(AgentEvent::TurnStarted);
        }
        "message_start" => {
            if value
                .get("message")
                .and_then(|message| message.get("role"))
                .and_then(Value::as_str)
                == Some("assistant")
            {
                state.message_sequence.fetch_add(1, Ordering::SeqCst);
            }
        }
        "message_update" => normalize_message_update(state, &value),
        "message_end" => normalize_message_end(state, &value),
        "tool_execution_start" => normalize_tool_start(state, &value),
        "tool_execution_update" => normalize_tool_update(state, &value),
        "tool_execution_end" => normalize_tool_end(state, &value),
        "agent_end" => {
            if value.get("willRetry").and_then(Value::as_bool).unwrap_or(false) {
                if let Ok(mut pending_failure) = state.pending_failure.lock() {
                    *pending_failure = None;
                }
                return;
            }
            state.active.store(false, Ordering::SeqCst);
            if !state.terminal_sent.swap(true, Ordering::SeqCst) {
                let pending_failure = state
                    .pending_failure
                    .lock()
                    .ok()
                    .and_then(|mut pending_failure| pending_failure.take());
                if let Some(error) = pending_failure {
                    (state.sink)(AgentEvent::TurnFailed { error });
                } else {
                    (state.sink)(AgentEvent::TurnDone {
                        status: TurnStatus::Completed,
                    });
                }
            }
        }
        "session_info_changed" => (state.sink)(AgentEvent::SessionUpdated {
            provider_session_id: None,
            session_file: None,
            title: value.get("name").and_then(Value::as_str).map(str::to_string),
            model: None,
            thinking_level: None,
        }),
        "thinking_level_changed" => (state.sink)(AgentEvent::SessionUpdated {
            provider_session_id: None,
            session_file: None,
            title: None,
            model: None,
            thinking_level: value.get("level").and_then(Value::as_str).map(str::to_string),
        }),
        "extension_ui_request" => register_extension_dialog(state, &value),
        _ => {}
    }
}

fn pi_message_item_id(state: &Arc<ClientState>, content_index: u64) -> String {
    format!(
        "pi-message-{}-{}-{content_index}",
        state.turn_sequence.load(Ordering::SeqCst),
        state.message_sequence.load(Ordering::SeqCst),
    )
}

fn normalize_message_update(state: &Arc<ClientState>, value: &Value) {
    let event = value.get("assistantMessageEvent").unwrap_or(&Value::Null);
    let item_id = event
        .get("contentIndex")
        .and_then(Value::as_u64)
        .map(|index| pi_message_item_id(state, index));
    match event.get("type").and_then(Value::as_str) {
        Some("text_delta") => {
            if let Some(text) = event.get("delta").and_then(Value::as_str) {
                (state.sink)(AgentEvent::TextDelta {
                    item_id,
                    text: text.to_string(),
                });
            }
        }
        Some("thinking_delta") => {
            if let Some(text) = event.get("delta").and_then(Value::as_str) {
                (state.sink)(AgentEvent::ThinkingDelta {
                    item_id,
                    text: text.to_string(),
                });
            }
        }
        Some("error") => {
            let message = event
                .get("error")
                .and_then(|error| error.get("errorMessage"))
                .and_then(Value::as_str)
                .unwrap_or("Pi model stream failed");
            emit_failure(state, message.to_string());
        }
        _ => {}
    }
}

fn normalize_message_end(state: &Arc<ClientState>, value: &Value) {
    let message = value.get("message").unwrap_or(&Value::Null);
    if message.get("role").and_then(Value::as_str) != Some("assistant") {
        return;
    }
    if let Some(content) = message.get("content").and_then(Value::as_array) {
        for (index, item) in content.iter().enumerate() {
            let item_id = Some(pi_message_item_id(state, index as u64));
            match item.get("type").and_then(Value::as_str) {
                Some("text") => {
                    let text = item.get("text").and_then(Value::as_str).unwrap_or_default();
                    if !text.is_empty() {
                        (state.sink)(AgentEvent::TextFinal {
                            item_id,
                            text: text.to_string(),
                        });
                    }
                }
                Some("thinking") => {
                    let text = item
                        .get("thinking")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if !text.is_empty() {
                        (state.sink)(AgentEvent::ThinkingFinal {
                            item_id,
                            text: text.to_string(),
                        });
                    }
                }
                _ => {}
            }
        }
    }
    if let Some(usage) = message.get("usage") {
        (state.sink)(AgentEvent::Usage {
            input_tokens: u64_field(usage, "input"),
            cached_input_tokens: u64_field(usage, "cacheRead"),
            output_tokens: u64_field(usage, "output"),
            cost_usd: usage
                .get("cost")
                .and_then(|cost| cost.get("total"))
                .and_then(Value::as_f64),
            context_used: None,
            context_window: None,
        });
    }
    match message.get("stopReason").and_then(Value::as_str) {
        Some("error") => {
            let error = message
                .get("errorMessage")
                .and_then(Value::as_str)
                .unwrap_or("Pi model turn failed")
                .to_string();
            if is_aborted_error(&error) {
                state.active.store(false, Ordering::SeqCst);
                if !state.terminal_sent.swap(true, Ordering::SeqCst) {
                    (state.sink)(AgentEvent::TurnDone {
                        status: TurnStatus::Interrupted,
                    });
                }
            } else if let Ok(mut pending_failure) = state.pending_failure.lock() {
                *pending_failure = Some(error);
            }
        }
        Some("aborted") => {
            state.active.store(false, Ordering::SeqCst);
            if !state.terminal_sent.swap(true, Ordering::SeqCst) {
                (state.sink)(AgentEvent::TurnDone {
                    status: TurnStatus::Interrupted,
                });
            }
        }
        _ => {}
    }
}

fn normalize_tool_start(state: &Arc<ClientState>, value: &Value) {
    let Some(id) = value.get("toolCallId").and_then(Value::as_str) else {
        return;
    };
    let name = value
        .get("toolName")
        .and_then(Value::as_str)
        .unwrap_or("tool")
        .to_string();
    let args = value.get("args").cloned().unwrap_or(Value::Null);
    if let Ok(mut tools) = state.tool_args.lock() {
        tools.insert(id.to_string(), (name.clone(), args.clone()));
    }
    (state.sink)(AgentEvent::ToolUse {
        item_id: id.to_string(),
        name,
        status: ToolCallStatus::InProgress,
        detail: bounded_json(&args),
    });
}

fn normalize_tool_update(state: &Arc<ClientState>, value: &Value) {
    let Some(id) = value.get("toolCallId").and_then(Value::as_str) else {
        return;
    };
    let name = value
        .get("toolName")
        .and_then(Value::as_str)
        .unwrap_or("tool")
        .to_string();
    // Pi's partialResult is accumulated output. Forward the replacement value
    // exactly once; consumers must replace rather than append it.
    (state.sink)(AgentEvent::ToolUse {
        item_id: id.to_string(),
        name,
        status: ToolCallStatus::InProgress,
        detail: value.get("partialResult").and_then(bounded_json),
    });
}

fn normalize_tool_end(state: &Arc<ClientState>, value: &Value) {
    let Some(id) = value.get("toolCallId").and_then(Value::as_str) else {
        return;
    };
    let name = value
        .get("toolName")
        .and_then(Value::as_str)
        .unwrap_or("tool")
        .to_string();
    let is_error = value.get("isError").and_then(Value::as_bool).unwrap_or(false);
    (state.sink)(AgentEvent::ToolUse {
        item_id: id.to_string(),
        name: name.clone(),
        status: if is_error {
            ToolCallStatus::Failed
        } else {
            ToolCallStatus::Completed
        },
        detail: value.get("result").and_then(bounded_json),
    });
    let stored = state
        .tool_args
        .lock()
        .ok()
        .and_then(|mut tools| tools.remove(id));
    if !is_error {
        if let Some((_, args)) = stored {
            if let Some(change) = inferred_file_change(&name, &args) {
                (state.sink)(AgentEvent::FileChange {
                    item_id: id.to_string(),
                    changes: vec![change],
                });
            }
        }
    }
}

fn inferred_file_change(tool_name: &str, args: &Value) -> Option<FileChangeEntry> {
    let lower = tool_name.to_ascii_lowercase();
    if !matches!(lower.as_str(), "write" | "edit" | "patch" | "apply_patch") {
        return None;
    }
    let path = ["path", "filePath", "file_path", "file"]
        .into_iter()
        .find_map(|key| args.get(key).and_then(Value::as_str))?;
    Some(FileChangeEntry {
        path: path.to_string(),
        kind: FileChangeKind::Modify,
        diff: None,
    })
}

fn register_extension_dialog(state: &Arc<ClientState>, value: &Value) {
    let Some(id) = value.get("id").and_then(Value::as_str) else {
        return;
    };
    let Some(method) = value.get("method").and_then(Value::as_str) else {
        return;
    };
    if matches!(method, "select" | "confirm" | "input" | "editor") {
        if let Ok(mut dialogs) = state.dialogs.lock() {
            dialogs.insert(id.to_string(), method.to_string());
        }
    }
}

fn is_aborted_error(error: &str) -> bool {
    let normalized = error.trim().to_ascii_lowercase();
    normalized == "aborted"
        || normalized == "abort"
        || normalized.contains("aborterror")
        || normalized.contains("operation aborted")
}
fn emit_failure(state: &Arc<ClientState>, error: String) {
    state.active.store(false, Ordering::SeqCst);
    if !state.terminal_sent.swap(true, Ordering::SeqCst) {
        (state.sink)(AgentEvent::TurnFailed { error });
    }
}



fn cancel_all_dialogs(state: &Arc<ClientState>) {
    let ids = state
        .dialogs
        .lock()
        .map(|mut dialogs| dialogs.drain().map(|(id, _)| id).collect::<Vec<_>>())
        .unwrap_or_default();
    for id in ids {
        let _ = send_value(
            state,
            json!({"type": "extension_ui_response", "id": id, "cancelled": true}),
        );
    }
}

fn close_state(state: &Arc<ClientState>, reason: &str) {
    if state.closed.swap(true, Ordering::SeqCst) {
        return;
    }
    let stderr = state
        .stderr_tail
        .lock()
        .ok()
        .map(|tail| String::from_utf8_lossy(&tail).trim().to_string())
        .filter(|tail| !tail.is_empty());
    let message = stderr.map_or_else(|| reason.to_string(), |tail| format!("{reason}: {tail}"));
    if let Ok(mut pending) = state.pending.lock() {
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(message.clone()));
        }
    }
    if state.active.swap(false, Ordering::SeqCst)
        && !state.shutting_down.load(Ordering::SeqCst)
        && !state.terminal_sent.swap(true, Ordering::SeqCst)
    {
        (state.sink)(AgentEvent::TurnFailed { error: message });
    }
}

fn wait_for_child_or_kill(state: &Arc<ClientState>, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    loop {
        let done = {
            let mut child = match state.child.lock() {
                Ok(child) => child,
                Err(_) => return,
            };
            match child.as_mut() {
                None => true,
                Some(child_ref) => match child_ref.child.try_wait() {
                    Ok(Some(_)) | Err(_) => {
                        let _ = child.take();
                        true
                    }
                    Ok(None) => false,
                },
            }
        };
        if done {
            return;
        }
        if Instant::now() >= deadline {
            kill_state_child(state);
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

fn kill_and_wait_child(mut child: ManagedChild) {
    #[cfg(unix)]
    unsafe {
        libc::killpg(child.child.id() as libc::pid_t, libc::SIGKILL);
    }
    let _ = child.child.kill();
    let _ = child.child.wait();
}

fn join_thread(thread: &Mutex<Option<JoinHandle<()>>>) {
    if let Ok(mut thread) = thread.lock() {
        if let Some(thread) = thread.take() {
            let _ = thread.join();
        }
    }
}

fn model_name(model: &Value) -> Option<String> {
    let provider = model.get("provider").and_then(Value::as_str);
    let id = model
        .get("id")
        .or_else(|| model.get("modelId"))
        .and_then(Value::as_str);
    match (provider, id) {
        (Some(provider), Some(id)) => Some(format!("{provider}/{id}")),
        (_, Some(id)) => Some(id.to_string()),
        _ => None,
    }
}

fn bounded_json(value: &Value) -> Option<String> {
    let mut text = if let Some(value) = value.as_str() {
        value.to_string()
    } else {
        serde_json::to_string(value).ok()?
    };
    if text.len() > MAX_JSON_LINE_BYTES {
        let mut boundary = MAX_JSON_LINE_BYTES;
        while !text.is_char_boundary(boundary) {
            boundary -= 1;
        }
        text.truncate(boundary);
    }
    Some(text)
}

fn u64_field(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_gate_accepts_only_certified_pi_line() {
        assert_eq!(compatible_version_output("pi 0.79.10\n").unwrap(), "0.79.10");
        assert_eq!(compatible_version_output("v0.79.99").unwrap(), "0.79.99");
        assert!(matches!(
            compatible_version_output("0.79.9"),
            Err(PiRpcError::UnsupportedVersion(_))
        ));
        assert!(matches!(
            compatible_version_output("0.80.0"),
            Err(PiRpcError::UnsupportedVersion(_))
        ));
    }

    #[cfg(windows)]
    #[test]
    fn windows_children_are_assigned_to_a_kill_on_close_job() {
        let child = Command::new("cmd")
            .args(["/C", "ping -n 2 127.0.0.1 >nul"])
            .spawn()
            .expect("spawn Windows fixture");
        let managed = ManagedChild::new(child).expect("assign Windows Job Object");
        assert_ne!(managed._job.0, 0);
        kill_and_wait_child(managed);
    }

    #[test]
    fn get_state_requires_resume_and_protocol_fields() {
        let valid = json!({
            "sessionId": "s1",
            "sessionFile": "/tmp/s1.jsonl",
            "isStreaming": false,
            "thinkingLevel": "medium",
            "model": null
        });
        assert_eq!(parse_session_state(&valid).unwrap().session_id, "s1");
        for key in ["sessionId", "sessionFile", "isStreaming", "thinkingLevel", "model"] {
            let mut malformed = valid.clone();
            malformed.as_object_mut().unwrap().remove(key);
            assert!(parse_session_state(&malformed).is_err(), "missing {key}");
        }
    }

    #[test]
    fn file_changes_are_explicitly_inferred_from_mutating_tools() {
        assert_eq!(
            inferred_file_change("write", &json!({"path": "src/main.rs"})),
            Some(FileChangeEntry {
                path: "src/main.rs".to_string(),
                kind: FileChangeKind::Modify,
                diff: None,
            })
        );
        assert_eq!(inferred_file_change("read", &json!({"path": "src/main.rs"})), None);
    }

    #[test]
    fn controlled_environment_preserves_only_documented_provider_configuration() {
        let documented = [
            "ANTHROPIC_API_KEY",
            "ANT_LING_API_KEY",
            "AZURE_OPENAI_API_KEY",
            "AZURE_OPENAI_BASE_URL",
            "AZURE_OPENAI_RESOURCE_NAME",
            "AZURE_OPENAI_API_VERSION",
            "AZURE_OPENAI_DEPLOYMENT_NAME_MAP",
            "AWS_PROFILE",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_BEARER_TOKEN_BEDROCK",
            "AWS_REGION",
            "AWS_WEB_IDENTITY_TOKEN_FILE",
            "AWS_BEDROCK_FORCE_CACHE",
            "AWS_ENDPOINT_URL_BEDROCK_RUNTIME",
            "AWS_BEDROCK_SKIP_AUTH",
            "AWS_BEDROCK_FORCE_HTTP1",
            "GOOGLE_CLOUD_PROJECT",
            "GOOGLE_CLOUD_LOCATION",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
            "AWS_CONTAINER_CREDENTIALS_FULL_URI",
            "AWS_CONTAINER_CREDENTIALS_AUTHORIZATION_TOKEN",
            "AWS_CONTAINER_CREDENTIALS_AUTHORIZATION_TOKEN_FILE",
            "OPENAI_API_KEY",
            "DEEPSEEK_API_KEY",
            "NVIDIA_API_KEY",
            "GEMINI_API_KEY",
            "MISTRAL_API_KEY",
            "GROQ_API_KEY",
            "CEREBRAS_API_KEY",
            "CLOUDFLARE_API_KEY",
            "CLOUDFLARE_ACCOUNT_ID",
            "CLOUDFLARE_GATEWAY_ID",
            "XAI_API_KEY",
            "OPENROUTER_API_KEY",
            "AI_GATEWAY_API_KEY",
            "ZAI_API_KEY",
            "ZAI_CODING_CN_API_KEY",
            "OPENCODE_API_KEY",
            "HF_TOKEN",
            "FIREWORKS_API_KEY",
            "TOGETHER_API_KEY",
            "KIMI_API_KEY",
            "MINIMAX_API_KEY",
            "MINIMAX_CN_API_KEY",
            "XIAOMI_API_KEY",
            "XIAOMI_TOKEN_PLAN_CN_API_KEY",
            "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
            "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
        ];
        let mut source = documented
            .iter()
            .map(|name| ((*name).to_string(), "configured".to_string()))
            .collect::<HashMap<_, _>>();
        for unrelated in [
            "UNRELATED_SECRET",
            "AWS_SESSION_TOKEN",
            "AWS_DEFAULT_REGION",
            "AWS_CONTAINER_CREDENTIALS",
            "GOOGLE_CLOUD_SECRET",
            "AZURE_OPENAI_UNDOCUMENTED_SECRET",
        ] {
            source.insert(unrelated.to_string(), "must-not-pass".to_string());
        }

        let environment = controlled_environment_from(&source, &HashMap::new());
        let mut actual = environment.keys().map(String::as_str).collect::<Vec<_>>();
        actual.sort_unstable();
        let mut expected = documented.to_vec();
        expected.sort_unstable();
        assert_eq!(actual, expected);
        for unrelated in [
            "UNRELATED_SECRET",
            "AWS_SESSION_TOKEN",
            "AWS_DEFAULT_REGION",
            "AWS_CONTAINER_CREDENTIALS",
            "GOOGLE_CLOUD_SECRET",
            "AZURE_OPENAI_UNDOCUMENTED_SECRET",
        ] {
            assert!(!environment.contains_key(unrelated));
        }
    }

    #[test]
    fn controlled_environment_preserves_windows_runtime_contract_by_name() {
        let expected = [
            "APPDATA",
            "COMSPEC",
            "HOMEDRIVE",
            "HOMEPATH",
            "LOCALAPPDATA",
            "PATHEXT",
            "Pathext",
            "SYSTEMROOT",
            "SystemRoot",
            "USERPROFILE",
        ];
        let source = expected
            .iter()
            .map(|name| ((*name).to_string(), "present".to_string()))
            .collect::<HashMap<_, _>>();

        let environment = controlled_environment_from(&source, &HashMap::new());
        let mut actual = environment.keys().map(String::as_str).collect::<Vec<_>>();
        actual.sort_unstable();
        assert_eq!(actual, expected);
    }

    #[test]
    fn session_paths_cannot_escape_or_nest_below_the_owned_directory() {
        let root = Path::new("/tmp/pickforge-app");
        let dir = root.join("pi-owned");
        assert!(validate_owned_session_path(root, &dir, &dir.join("safe.jsonl")).is_ok());
        assert!(
            validate_owned_session_path(root, &dir, &dir.join("nested/session.jsonl")).is_err()
        );
        assert!(validate_owned_session_path(root, &dir, &dir.join("../escape.jsonl")).is_err());
        assert!(validate_owned_session_path(root, &dir, Path::new("relative.jsonl")).is_err());
        assert!(validate_owned_session_path(root, &dir, &dir.join("wrong.txt")).is_err());
        assert!(
            validate_owned_session_path(
                root,
                Path::new("/tmp/outside"),
                Path::new("/tmp/outside/escape.jsonl"),
            )
            .is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn session_preparation_rejects_symlinked_roots_files_and_canonical_escapes() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let root = std::env::temp_dir().join(format!(
            "pickforge-pi-path-security-{}-{}",
            std::process::id(),
            next_fixture_id()
        ));
        let owned = root.join("owned");
        let outside = root.join("outside");
        std::fs::create_dir_all(&owned).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        let symlinked_root = owned.join("sessions-link");
        symlink(&outside, &symlinked_root).unwrap();
        assert!(matches!(
            prepare_session_paths(&owned, &symlinked_root, &symlinked_root.join("escape.jsonl")),
            Err(PiRpcError::UnsafeSessionPath(_))
        ));

        let sessions = owned.join("sessions");
        std::fs::create_dir_all(&sessions).unwrap();
        let outside_file = outside.join("outside.jsonl");
        std::fs::write(&outside_file, b"outside").unwrap();
        let symlinked_file = sessions.join("resume.jsonl");
        symlink(&outside_file, &symlinked_file).unwrap();
        assert!(matches!(
            prepare_session_paths(&owned, &sessions, &symlinked_file),
            Err(PiRpcError::UnsafeSessionPath(_))
        ));
        assert_eq!(std::fs::read(&outside_file).unwrap(), b"outside");

        let symlinked_ancestor = owned.join("agent-sessions");
        symlink(&outside, &symlinked_ancestor).unwrap();
        let escaped_sessions = symlinked_ancestor.join("pi");
        assert!(matches!(
            prepare_session_paths(
                &owned,
                &escaped_sessions,
                &escaped_sessions.join("ancestor-escape.jsonl"),
            ),
            Err(PiRpcError::UnsafeSessionPath(_))
        ));
        std::fs::remove_file(&symlinked_ancestor).unwrap();

        std::fs::remove_file(&symlinked_file).unwrap();
        let safe_file = sessions.join("safe.jsonl");
        prepare_session_paths(&owned, &sessions, &safe_file).unwrap();
        assert_eq!(
            std::fs::metadata(&sessions).unwrap().permissions().mode() & 0o777,
            0o700
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    struct FakePi {
        root: PathBuf,
        binary: PathBuf,
        log: PathBuf,
        child_pid: PathBuf,
    }

    #[cfg(unix)]
    impl FakePi {
        fn options(&self, mode: &str) -> PiRpcOptions {
            let session_dir = self.root.join("sessions");
            let mut environment_overrides = HashMap::from([
                ("PF_PI_MODE".to_string(), mode.to_string()),
                (
                    "PF_PI_LOG".to_string(),
                    self.log.to_string_lossy().into_owned(),
                ),
                (
                    "PF_PI_CHILD_PID".to_string(),
                    self.child_pid.to_string_lossy().into_owned(),
                ),
            ]);
            if mode == "env_auth" {
                environment_overrides.insert(
                    "OPENAI_API_KEY".to_string(),
                    "configured-for-fixture".to_string(),
                );
            }
            PiRpcOptions {
                session_root: self.root.clone(),
                cwd: self.root.clone(),
                session_path: session_dir.join("resume.jsonl"),
                session_dir,
                model: Some("test/model".to_string()),
                binary: Some(self.binary.to_string_lossy().into_owned()),
                no_extensions: true,
                offline: true,
                environment_overrides,
            }
        }

        fn commands(&self) -> Vec<Value> {
            std::fs::read_to_string(&self.log)
                .unwrap_or_default()
                .lines()
                .filter_map(|line| serde_json::from_str(line).ok())
                .collect()
        }
    }

    #[cfg(unix)]
    impl Drop for FakePi {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[cfg(unix)]
    const FAKE_PI: &str = r#"#!/usr/bin/env python3
import json, os, subprocess, sys, time

if "--version" in sys.argv:
    print("pi 0.79.10")
    raise SystemExit(0)

mode = os.environ.get("PF_PI_MODE", "normal")
log_path = os.environ["PF_PI_LOG"]
session_path = sys.argv[sys.argv.index("--session") + 1]
session_id = "fake-session"
descendant = None
if mode == "env_auth" and "OPENAI_API_KEY" not in os.environ:
    raise SystemExit("documented credential name missing")
if mode == "hang":
    descendant = subprocess.Popen(["sleep", "60"])
    with open(os.environ["PF_PI_CHILD_PID"], "w", encoding="utf-8") as handle:
        handle.write(str(descendant.pid))

def emit(value, fragmented=False, crlf=False):
    ending = b"\r\n" if crlf else b"\n"
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + ending
    if fragmented and len(payload) > 4:
        split = max(1, len(payload) - 3)
        sys.stdout.buffer.write(payload[:split])
        sys.stdout.buffer.flush()
        time.sleep(0.01)
        sys.stdout.buffer.write(payload[split:])
    else:
        sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()

def response(command, data=None, success=True, error=None):
    value = {"type": "response", "id": command.get("id"), "command": command["type"], "success": success}
    if data is not None:
        value["data"] = data
    if error is not None:
        value["error"] = error
    emit(value, crlf=command["type"] == "get_state")

for raw in sys.stdin.buffer:
    command = json.loads(raw)
    with open(log_path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(command, separators=(",", ":")) + "\n")
    kind = command["type"]
    if kind == "get_state":
        response(command, {
            "sessionId": session_id,
            "sessionFile": session_path,
            "isStreaming": False,
            "thinkingLevel": "medium",
            "model": {"provider": "test", "id": "model"},
            "sessionName": "Fixture session",
        })
        if mode == "closed_stdin":
            descendant = subprocess.Popen(["sleep", "60"], stdin=subprocess.DEVNULL)
            with open(os.environ["PF_PI_CHILD_PID"], "w", encoding="utf-8") as handle:
                handle.write(str(descendant.pid))
            os.close(0)
            time.sleep(60)
    elif kind == "prompt":
        if mode == "reject":
            response(command, success=False, error="fixture rejected prompt")
            continue
        response(command)
        emit({"type": "agent_start"})
        if mode == "crash":
            sys.stderr.write("fixture crash detail\n")
            sys.stderr.flush()
            raise SystemExit(7)
        if mode == "interrupt":
            continue
        if mode == "abort_error":
            message = {"role": "assistant", "content": [], "usage": {}, "stopReason": "error",
                       "errorMessage": "AbortError: operation aborted"}
            emit({"type": "message_end", "message": message})
            emit({"type": "agent_end", "messages": [message], "willRetry": False})
            continue
        if mode in ("retry_success", "retry_fail"):
            failed = {"role": "assistant", "content": [], "usage": {}, "stopReason": "error",
                      "errorMessage": "retryable fixture error"}
            emit({"type": "message_end", "message": failed})
            emit({"type": "agent_end", "messages": [failed], "willRetry": True})
            emit({"type": "agent_start"})
            if mode == "retry_fail":
                final = {"role": "assistant", "content": [], "usage": {}, "stopReason": "error",
                         "errorMessage": "final fixture error"}
            else:
                final = {"role": "assistant", "content": [], "usage": {}, "stopReason": "stop"}
            emit({"type": "message_end", "message": final})
            emit({"type": "agent_end", "messages": [final], "willRetry": False})
            continue
        emit({"type": "thinking_level_changed", "level": "high"})
        emit({"type": "session_info_changed", "name": "Renamed fixture"})
        emit({"type": "tool_execution_start", "toolCallId": "tool-1", "toolName": "write",
              "args": {"path": "src/fixture.txt", "content": "ok"}})
        emit({"type": "tool_execution_update", "toolCallId": "tool-1", "toolName": "write",
              "args": {"path": "src/fixture.txt"}, "partialResult": "a"})
        emit({"type": "tool_execution_update", "toolCallId": "tool-1", "toolName": "write",
              "args": {"path": "src/fixture.txt"}, "partialResult": "ab"})
        emit({"type": "tool_execution_end", "toolCallId": "tool-1", "toolName": "write",
              "result": {"content": [{"type": "text", "text": "written"}]}, "isError": False})
        emit({"type": "message_start", "message": {"role": "assistant", "content": []}})
        emit({"type": "message_update", "message": {"role": "assistant"},
              "assistantMessageEvent": {"type": "thinking_delta", "contentIndex": 0,
                                        "delta": "think"}})
        emit({"type": "message_update", "message": {"role": "assistant"},
              "assistantMessageEvent": {"type": "text_delta", "contentIndex": 1,
                                        "delta": "A B C🙂"}},
             fragmented=True)
        message = {
            "role": "assistant",
            "content": [{"type": "thinking", "thinking": "think"},
                        {"type": "text", "text": "A B C🙂"}],
            "usage": {"input": 7, "output": 3, "cacheRead": 2,
                      "cost": {"total": 0.25}},
            "stopReason": "stop",
        }
        emit({"type": "message_end", "message": message})
        emit({"type": "agent_end", "messages": [message], "willRetry": False})
    elif kind in ("steer", "follow_up", "set_thinking_level", "abort"):
        response(command)
        if kind == "abort" and mode == "interrupt":
            message = {"role": "assistant", "content": [], "usage": {}, "stopReason": "aborted"}
            emit({"type": "message_end", "message": message})
            emit({"type": "agent_end", "messages": [message], "willRetry": False})
    elif kind == "set_model":
        if command.get("modelId") == "missing":
            response(command, success=False, error="Model not found: test/missing")
        else:
            response(command, {"provider": command["provider"], "id": command["modelId"]})
    elif kind == "switch_session":
        cancelled = "cancel" in command["sessionPath"]
        if not cancelled:
            session_path = command["sessionPath"]
            session_id = "switched-session"
        response(command, {"cancelled": cancelled})
    elif kind == "get_session_stats":
        if mode == "malformed":
            sys.stdout.buffer.write(b"{malformed\n")
            sys.stdout.buffer.flush()
        elif mode == "oversize":
            sys.stdout.buffer.write(b"x" * (1024 * 1024 + 1))
            sys.stdout.buffer.flush()
        else:
            emit({"type": "extension_ui_request", "id": "dialog-1", "method": "confirm",
                  "title": "Fixture", "message": "Continue?"})
            response(command, {"sessionFile": session_path, "sessionId": session_id,
                               "tokens": {"input": 1, "output": 2, "cacheRead": 0,
                                          "cacheWrite": 0, "total": 3},
                               "cost": 0.0})
    elif kind == "extension_ui_response":
        pass
    else:
        response(command, success=False, error="unsupported fixture command")

if mode == "hang":
    time.sleep(60)
"#;

    #[cfg(unix)]
    fn next_fixture_id() -> u64 {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        NEXT.fetch_add(1, Ordering::Relaxed)
    }

    #[cfg(unix)]
    fn fake_pi() -> FakePi {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "pickforge-pi-rpc-{}-{}",
            std::process::id(),
            next_fixture_id()
        ));
        std::fs::create_dir_all(&root).expect("create fake Pi root");
        let binary = root.join("pi");
        let log = root.join("commands.jsonl");
        let child_pid = root.join("child.pid");
        std::fs::write(&binary, FAKE_PI).expect("write fake Pi");
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700))
            .expect("chmod fake Pi");
        FakePi {
            root,
            binary,
            log,
            child_pid,
        }
    }

    #[cfg(unix)]
    #[test]
    fn documented_provider_credential_name_reaches_the_controlled_child() {
        let fixture = fake_pi();
        let client = spawn(fixture.options("env_auth"), Arc::new(|_| {}))
            .expect("credential-authenticated fixture");
        client.shutdown().expect("shutdown credential fixture");
    }

    #[cfg(unix)]
    fn wait_until(mut predicate: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while !predicate() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(predicate(), "fixture condition timed out");
    }

    #[cfg(unix)]
    fn wait_until_named(name: &str, mut predicate: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while !predicate() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(predicate(), "fixture condition timed out: {name}");
    }

    #[cfg(unix)]
    #[test]
    fn fake_pi_streams_correlated_normalized_and_native_events() {
        let fixture = fake_pi();
        let events = Arc::new(Mutex::new(Vec::<AgentEvent>::new()));
        let sink_events = Arc::clone(&events);
        let sink = Arc::new(move |event| {
            if let Ok(mut events) = sink_events.lock() {
                events.push(event);
            }
        });
        let client = spawn(fixture.options("normal"), sink).expect("spawn fake Pi");
        client.prompt("hello").expect("prompt accepted");
        wait_until(|| {
            events
                .lock()
                .map(|events| events.iter().any(|event| matches!(event, AgentEvent::TurnDone { .. })))
                .unwrap_or(false)
        });
        client.steer("steer").expect("steer response correlated");
        client.follow_up("later").expect("follow-up response correlated");
        client.set_model("test/other").expect("model switched");
        let stats = client.session_stats().expect("stats response correlated");
        assert_eq!(stats["tokens"]["total"], 3);
        wait_until(|| {
            events
                .lock()
                .map(|events| {
                    events.iter().any(|event| {
                        matches!(event, AgentEvent::ProviderEvent { payload, .. } if payload.contains("dialog-1"))
                    })
                })
                .unwrap_or(false)
        });
        client
            .respond_extension_confirm("dialog-1", true)
            .expect("dialog answered once");
        assert!(client.respond_extension_confirm("dialog-1", true).is_err());

        let snapshot = events.lock().map(|events| events.clone()).unwrap_or_default();
        assert!(snapshot.iter().any(
            |event| matches!(
                event,
                AgentEvent::TextFinal {
                    item_id: Some(item_id),
                    text,
                } if item_id == "pi-message-1-1-1" && text == "A\u{2028}B\u{2029}C🙂"
            )
        ));
        assert!(snapshot.iter().any(
            |event| matches!(
                event,
                AgentEvent::ThinkingFinal {
                    item_id: Some(item_id),
                    text,
                } if item_id == "pi-message-1-1-0" && text == "think"
            )
        ));
        assert!(snapshot.iter().any(
            |event| matches!(event, AgentEvent::Usage { input_tokens: 7, cached_input_tokens: 2, output_tokens: 3, .. })
        ));
        assert!(snapshot.iter().any(
            |event| matches!(event, AgentEvent::FileChange { changes, .. } if changes[0].path == "src/fixture.txt")
        ));
        let partials = snapshot
            .iter()
            .filter_map(|event| match event {
                AgentEvent::ToolUse {
                    item_id,
                    status: ToolCallStatus::InProgress,
                    detail,
                    ..
                } if item_id == "tool-1" => detail.clone(),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(partials.ends_with(&["a".to_string(), "ab".to_string()]));
        wait_until(|| {
            fixture.commands().iter().any(|command| {
                command["type"] == "extension_ui_response" && command["id"] == "dialog-1"
            })
        });
        let commands = fixture.commands();
        assert!(commands.iter().any(|command| {
            command["type"] == "extension_ui_response"
                && command["id"] == "dialog-1"
                && command["confirmed"] == true
        }));
        client.session_stats().expect("open second extension dialog");
        client.shutdown().expect("shutdown fake Pi");
        wait_until(|| {
            fixture.commands().iter().any(|command| {
                command["type"] == "extension_ui_response"
                    && command["id"] == "dialog-1"
                    && command["cancelled"] == true
            })
        });
    }

    #[cfg(unix)]
    #[test]
    fn fake_pi_resumes_switches_and_preserves_cancelled_session() {
        let fixture = fake_pi();
        let events = Arc::new(Mutex::new(Vec::<AgentEvent>::new()));
        let sink_events = Arc::clone(&events);
        let client = spawn(
            fixture.options("normal"),
            Arc::new(move |event| {
                if let Ok(mut events) = sink_events.lock() {
                    events.push(event);
                }
            }),
        )
        .expect("spawn fake Pi");
        assert!(client
            .switch_session(&fixture.root.join("sessions").join("cancel.jsonl"))
            .expect("cancelled switch"));
        assert!(!client
            .switch_session(&fixture.root.join("sessions").join("switched.jsonl"))
            .expect("successful switch"));
        let commands = fixture.commands();
        assert_eq!(
            commands.iter().filter(|command| command["type"] == "get_state").count(),
            2,
            "startup and successful switch must refresh state; cancelled switch must not"
        );
        let snapshot = events.lock().map(|events| events.clone()).unwrap_or_default();
        assert!(snapshot.iter().any(
            |event| matches!(event, AgentEvent::SessionStarted { provider_session_id } if provider_session_id.ends_with("switched.jsonl"))
        ));
        client.shutdown().expect("shutdown fake Pi");
    }

    #[cfg(unix)]
    #[test]
    fn fake_pi_interrupts_and_surfaces_rejection_without_synthetic_approval() {
        let fixture = fake_pi();
        let events = Arc::new(Mutex::new(Vec::<AgentEvent>::new()));
        let sink_events = Arc::clone(&events);
        let client = spawn(
            fixture.options("interrupt"),
            Arc::new(move |event| {
                if let Ok(mut events) = sink_events.lock() {
                    events.push(event);
                }
            }),
        )
        .expect("spawn fake Pi");
        client.prompt("wait").expect("prompt accepted");
        client.abort().expect("abort acknowledged");
        wait_until(|| {
            events
                .lock()
                .map(|events| {
                    events.iter().any(|event| {
                        matches!(
                            event,
                            AgentEvent::TurnDone {
                                status: TurnStatus::Interrupted
                            }
                        )
                    })
                })
                .unwrap_or(false)
        });
        assert!(events
            .lock()
            .map(|events| {
                events
                    .iter()
                    .all(|event| !matches!(event, AgentEvent::ApprovalRequest { .. }))
            })
            .unwrap_or(false));
        client.shutdown().expect("shutdown fake Pi");

        let rejected = fake_pi();
        let rejected_client =
            spawn(rejected.options("reject"), Arc::new(|_| {})).expect("spawn rejecting Pi");
        assert!(matches!(
            rejected_client.prompt("no"),
            Err(PiRpcError::Response(message)) if message == "fixture rejected prompt"
        ));
        rejected_client.shutdown().expect("shutdown rejecting Pi");
    }

    #[cfg(unix)]
    #[test]
    fn pi_defers_retryable_errors_and_normalizes_abort_errors() {
        for (mode, expected_failure) in [
            ("abort_error", None),
            ("retry_success", None),
            ("retry_fail", Some("final fixture error")),
        ] {
            let fixture = fake_pi();
            let events = Arc::new(Mutex::new(Vec::<AgentEvent>::new()));
            let sink_events = Arc::clone(&events);
            let client = spawn(
                fixture.options(mode),
                Arc::new(move |event| sink_events.lock().unwrap().push(event)),
            )
            .expect("spawn fake Pi");
            client.prompt("test").expect("prompt accepted");
            wait_until(|| {
                events
                    .lock()
                    .map(|events| {
                        events.iter().any(|event| {
                            matches!(event, AgentEvent::TurnDone { .. } | AgentEvent::TurnFailed { .. })
                        })
                    })
                    .unwrap_or(false)
            });
            let captured = events.lock().unwrap();
            let terminal = captured
                .iter()
                .filter(|event| matches!(event, AgentEvent::TurnDone { .. } | AgentEvent::TurnFailed { .. }))
                .collect::<Vec<_>>();
            assert_eq!(terminal.len(), 1, "{mode} must emit exactly one terminal event");
            match expected_failure {
                Some(error) => assert!(matches!(
                    terminal[0],
                    AgentEvent::TurnFailed { error: actual } if actual == error
                )),
                None if mode == "abort_error" => assert!(matches!(
                    terminal[0],
                    AgentEvent::TurnDone { status: TurnStatus::Interrupted }
                )),
                None => assert!(matches!(
                    terminal[0],
                    AgentEvent::TurnDone { status: TurnStatus::Completed }
                )),
            }
            client.shutdown().expect("shutdown fake Pi");
        }
    }

    #[cfg(unix)]
    #[test]
    fn malformed_oversize_and_crash_close_and_fail_pending_work() {
        for mode in ["malformed", "oversize"] {
            let fixture = fake_pi();
            let client = spawn(fixture.options(mode), Arc::new(|_| {})).expect("spawn fake Pi");
            assert!(client.session_stats().is_err(), "{mode} output must fail request");
            wait_until(|| client.is_closed());
            client.shutdown().expect("shutdown failed fixture");
        }

        let fixture = fake_pi();
        let events = Arc::new(Mutex::new(Vec::<AgentEvent>::new()));
        let sink_events = Arc::clone(&events);
        let client = spawn(
            fixture.options("crash"),
            Arc::new(move |event| {
                if let Ok(mut events) = sink_events.lock() {
                    events.push(event);
                }
            }),
        )
        .expect("spawn crash fixture");
        client.prompt("crash").expect("prompt accepted before crash");
        wait_until(|| client.is_closed());
        assert!(events
            .lock()
            .map(|events| {
                events.iter().any(|event| {
                    matches!(event, AgentEvent::TurnFailed { error } if error.contains("fixture crash detail"))
                })
            })
            .unwrap_or(false));
        client.shutdown().expect("shutdown crashed fixture");
    }

    #[cfg(unix)]
    #[test]
    fn stdin_failure_closes_pending_requests_and_reaps_the_process_group() {
        let fixture = fake_pi();
        let client =
            spawn(fixture.options("closed_stdin"), Arc::new(|_| {})).expect("spawn fake Pi");
        wait_until_named("descendant pid recorded", || fixture.child_pid.is_file());
        let pid = std::fs::read_to_string(&fixture.child_pid)
            .expect("read descendant pid")
            .parse::<libc::pid_t>()
            .expect("parse descendant pid");

        assert!(client.session_stats().is_err());
        wait_until_named("client closed", || client.is_closed());
        wait_until_named("descendant exited", || unsafe { libc::kill(pid, 0) } == -1);
        client.shutdown().expect("shutdown after writer failure");
    }

    #[cfg(unix)]
    #[test]
    fn shutdown_reaps_the_owned_process_group() {
        let fixture = fake_pi();
        let client = spawn(fixture.options("hang"), Arc::new(|_| {})).expect("spawn hanging Pi");
        wait_until(|| fixture.child_pid.is_file());
        let pid = std::fs::read_to_string(&fixture.child_pid)
            .expect("read descendant pid")
            .parse::<libc::pid_t>()
            .expect("parse descendant pid");
        client.shutdown().expect("bounded shutdown");
        wait_until(|| unsafe { libc::kill(pid, 0) } == -1);
    }
}
