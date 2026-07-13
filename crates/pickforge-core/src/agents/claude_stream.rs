use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use serde_json::Value;

use super::event::{
    AgentEvent, CommandStatus, FileChangeEntry, FileChangeKind, PlanItem, ToolCallStatus,
    TurnStatus,
};
use super::remote_exec::{remote_ssh_exit_error, RemoteExec, RemoteExecError};
use crate::remote::RemoteLeaseHandle;

const DEFAULT_ALLOWED_TOOLS: &str = "Bash,Edit,Write,Read,Glob,Grep,WebSearch,WebFetch,TodoWrite";
const DEFAULT_PERMISSION_MODE: &str = "acceptEdits";
const OUTPUT_TAIL_CHARS: usize = 2000;

#[derive(Debug, Default)]
pub struct ClaudeStreamParser {
    session_started: bool,
    turn_started: bool,
    terminal_emitted: bool,
    open_blocks: HashMap<usize, OpenBlock>,
    tools: HashMap<String, RememberedTool>,
    // Live context size: the latest main-thread assistant message's usage
    // (prompt + cache + output) is the conversation's current footprint.
    context_used: Option<u64>,
    assistant_model: Option<String>,
}

impl ClaudeStreamParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push_line(&mut self, line: &str) -> Vec<AgentEvent> {
        let line = line.trim_end_matches(['\r', '\n']);
        if line.trim().is_empty() {
            return Vec::new();
        }

        let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
            return vec![AgentEvent::Noise {
                line: line.to_string(),
            }];
        };

        match string_at(&value, "type") {
            Some("system") => self.handle_system(&value),
            Some("stream_event") => self.handle_stream_event(&value),
            Some("assistant") => self.handle_assistant(&value),
            Some("user") => self.handle_user(&value),
            Some("result") => self.handle_result(&value),
            Some("rate_limit_event") => Vec::new(),
            _ => Vec::new(),
        }
    }

    fn handle_system(&mut self, value: &Value) -> Vec<AgentEvent> {
        if self.session_started || string_at(value, "subtype") != Some("init") {
            return Vec::new();
        }

        let Some(session_id) = string_at(value, "session_id") else {
            return Vec::new();
        };

        self.session_started = true;
        vec![AgentEvent::SessionStarted {
            provider_session_id: session_id.to_string(),
        }]
    }

    fn handle_stream_event(&mut self, value: &Value) -> Vec<AgentEvent> {
        let Some(event) = value.get("event") else {
            return Vec::new();
        };

        match string_at(event, "type") {
            Some("message_start") => {
                if self.turn_started {
                    Vec::new()
                } else {
                    self.turn_started = true;
                    vec![AgentEvent::TurnStarted]
                }
            }
            Some("content_block_start") => {
                self.record_open_block(event);
                Vec::new()
            }
            Some("content_block_delta") => self.handle_content_block_delta(event),
            Some("content_block_stop") => {
                if let Some(index) = usize_at(event, "index") {
                    self.open_blocks.remove(&index);
                }
                Vec::new()
            }
            Some("message_delta") | Some("message_stop") => Vec::new(),
            _ => Vec::new(),
        }
    }

    fn record_open_block(&mut self, event: &Value) {
        let Some(index) = usize_at(event, "index") else {
            return;
        };
        let Some(block) = event.get("content_block") else {
            return;
        };

        self.open_blocks.insert(
            index,
            OpenBlock {
                block_type: string_at(block, "type").unwrap_or_default().to_string(),
                tool_id: string_at(block, "id").map(ToString::to_string),
                tool_name: string_at(block, "name").map(ToString::to_string),
                partial_json: String::new(),
            },
        );
    }

    fn handle_content_block_delta(&mut self, event: &Value) -> Vec<AgentEvent> {
        let Some(delta) = event.get("delta") else {
            return Vec::new();
        };

        match string_at(delta, "type") {
            Some("thinking_delta") => string_at(delta, "thinking")
                .map(|text| {
                    vec![AgentEvent::ThinkingDelta {
                        item_id: None,
                        text: text.to_string(),
                    }]
                })
                .unwrap_or_default(),
            Some("text_delta") => string_at(delta, "text")
                .map(|text| {
                    vec![AgentEvent::TextDelta {
                        item_id: None,
                        text: text.to_string(),
                    }]
                })
                .unwrap_or_default(),
            Some("input_json_delta") => {
                if let (Some(index), Some(partial)) =
                    (usize_at(event, "index"), string_at(delta, "partial_json"))
                {
                    if let Some(block) = self.open_blocks.get_mut(&index) {
                        if block.block_type == "tool_use" {
                            block.partial_json.push_str(partial);
                        }
                    }
                }
                Vec::new()
            }
            Some("signature_delta") => Vec::new(),
            _ => Vec::new(),
        }
    }

    fn handle_assistant(&mut self, value: &Value) -> Vec<AgentEvent> {
        self.record_context(value);
        value
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_array)
            .map(|blocks| {
                blocks
                    .iter()
                    .flat_map(|block| self.map_assistant_block(block))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn record_context(&mut self, value: &Value) {
        // Subagent (Task) messages carry parent_tool_use_id and describe a
        // different context, not this conversation's.
        if value
            .get("parent_tool_use_id")
            .is_some_and(|parent| !parent.is_null())
        {
            return;
        }
        let Some(message) = value.get("message") else {
            return;
        };
        if let Some(usage) = message.get("usage") {
            let used = context_size(usage);
            if used > 0 {
                self.context_used = Some(used);
            }
        }
        if let Some(model) = string_at(message, "model") {
            self.assistant_model = Some(model.to_string());
        }
    }

    fn map_assistant_block(&mut self, block: &Value) -> Vec<AgentEvent> {
        match string_at(block, "type") {
            Some("thinking") => string_at(block, "thinking")
                .filter(|text| !text.trim().is_empty())
                .map(|text| {
                    vec![AgentEvent::ThinkingFinal {
                        item_id: None,
                        text: text.to_string(),
                    }]
                })
                .unwrap_or_default(),
            Some("text") => string_at(block, "text")
                .map(|text| {
                    vec![AgentEvent::TextFinal {
                        item_id: None,
                        text: text.to_string(),
                    }]
                })
                .unwrap_or_default(),
            Some("tool_use") => self.map_tool_use(block),
            _ => Vec::new(),
        }
    }

    fn map_tool_use(&mut self, block: &Value) -> Vec<AgentEvent> {
        let Some(item_id) = string_at(block, "id") else {
            return Vec::new();
        };
        let Some(name) = string_at(block, "name") else {
            return Vec::new();
        };

        let input = self.tool_input(block);
        let remembered = if name == "Bash" {
            RememberedTool::Bash
        } else {
            RememberedTool::Other
        };
        self.tools.insert(item_id.to_string(), remembered);

        match name {
            "Bash" => vec![AgentEvent::CommandStarted {
                item_id: item_id.to_string(),
                command: input_string(&input, &["command"]).unwrap_or_default(),
                cwd: None,
            }],
            "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => {
                vec![AgentEvent::FileChange {
                    item_id: item_id.to_string(),
                    changes: vec![FileChangeEntry {
                        path: input_string(&input, &["file_path", "notebook_path"])
                            .unwrap_or_default(),
                        kind: if name == "Write" {
                            FileChangeKind::Add
                        } else {
                            FileChangeKind::Modify
                        },
                        diff: None,
                    }],
                }]
            }
            "WebSearch" | "WebFetch" => vec![AgentEvent::WebSearch {
                item_id: item_id.to_string(),
                query: input_string(&input, &["query", "url"]).unwrap_or_default(),
            }],
            "TodoWrite" => vec![AgentEvent::PlanUpdate {
                items: todo_items(&input),
            }],
            _ => {
                if let Some((server, tool)) = mcp_parts(name) {
                    vec![AgentEvent::McpToolCall {
                        item_id: item_id.to_string(),
                        server: server.to_string(),
                        tool: tool.to_string(),
                        status: ToolCallStatus::InProgress,
                        detail: None,
                    }]
                } else {
                    vec![AgentEvent::ToolUse {
                        item_id: item_id.to_string(),
                        name: name.to_string(),
                        status: ToolCallStatus::InProgress,
                        detail: compact_input_summary(&input),
                    }]
                }
            }
        }
    }

    fn tool_input(&self, block: &Value) -> Value {
        let input = block.get("input").cloned().unwrap_or(Value::Null);
        if !is_empty_object(&input) {
            return input;
        }

        let Some(item_id) = string_at(block, "id") else {
            return input;
        };

        self.open_blocks
            .values()
            .find(|open| {
                open.tool_id.as_deref() == Some(item_id)
                    || open.tool_name.as_deref() == string_at(block, "name")
            })
            .and_then(|open| serde_json::from_str::<Value>(&open.partial_json).ok())
            .unwrap_or(input)
    }

    fn handle_user(&mut self, value: &Value) -> Vec<AgentEvent> {
        value
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_array)
            .map(|blocks| {
                blocks
                    .iter()
                    .filter_map(|block| self.map_tool_result(block))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn map_tool_result(&self, block: &Value) -> Option<AgentEvent> {
        if string_at(block, "type") != Some("tool_result") {
            return None;
        }

        let item_id = string_at(block, "tool_use_id")?;
        if self.tools.get(item_id) != Some(&RememberedTool::Bash) {
            return None;
        }

        Some(AgentEvent::CommandDone {
            item_id: item_id.to_string(),
            exit_code: None,
            status: if bool_at(block, "is_error") {
                CommandStatus::Failed
            } else {
                CommandStatus::Completed
            },
            output_tail: tool_result_text(block).map(|text| tail_chars(&text, OUTPUT_TAIL_CHARS)),
        })
    }

    fn handle_result(&mut self, value: &Value) -> Vec<AgentEvent> {
        if self.terminal_emitted {
            return Vec::new();
        }
        self.terminal_emitted = true;

        let usage = value.get("usage").unwrap_or(&Value::Null);
        // `modelUsage` and `total_cost_usd` are session-cumulative running
        // counters (the plain `usage` object is per-turn). Prefer them so the
        // event is a consistent cumulative snapshot the store can diff, and so
        // the context meter rides along. Without `modelUsage`, fall back to
        // the per-turn shape with no context data.
        let model_usage = value.get("modelUsage").and_then(Value::as_object);
        let mut events = vec![match model_usage.filter(|models| !models.is_empty()) {
            Some(models) => AgentEvent::Usage {
                // Cache writes are prompt tokens too — folding them into input
                // keeps usage rows reconciled with the context meter.
                input_tokens: models
                    .values()
                    .map(|entry| {
                        u64_at(entry, "inputTokens").unwrap_or_default()
                            + u64_at(entry, "cacheCreationInputTokens").unwrap_or_default()
                    })
                    .sum(),
                cached_input_tokens: models
                    .values()
                    .filter_map(|entry| u64_at(entry, "cacheReadInputTokens"))
                    .sum(),
                output_tokens: models
                    .values()
                    .filter_map(|entry| u64_at(entry, "outputTokens"))
                    .sum(),
                cost_usd: f64_at(value, "total_cost_usd"),
                context_used: Some(self.context_used.unwrap_or_else(|| context_size(usage))),
                context_window: context_window_for(models, self.assistant_model.as_deref()),
            },
            None => AgentEvent::Usage {
                input_tokens: u64_at(usage, "input_tokens").unwrap_or_default(),
                cached_input_tokens: u64_at(usage, "cache_read_input_tokens").unwrap_or_default(),
                output_tokens: u64_at(usage, "output_tokens").unwrap_or_default(),
                // total_cost_usd is a session-cumulative counter, but this
                // additive row (contextUsed absent) would be summed per turn.
                // A present-but-empty modelUsage means a multi-turn v2 session
                // (only an error result with no API call gets here) — drop the
                // cost rather than re-count the whole session. A missing key
                // is the single-turn v1 CLI, where cumulative == per-turn.
                cost_usd: if value.get("modelUsage").is_some() {
                    None
                } else {
                    f64_at(value, "total_cost_usd")
                },
                context_used: None,
                context_window: None,
            },
        }];

        if string_at(value, "subtype") == Some("success") {
            events.push(AgentEvent::TurnDone {
                status: TurnStatus::Completed,
            });
        } else {
            events.push(AgentEvent::TurnFailed {
                error: string_at(value, "subtype")
                    .or_else(|| string_at(value, "result"))
                    .unwrap_or("failed")
                    .to_string(),
            });
        }

        events
    }
}

#[derive(Debug, Clone)]
struct OpenBlock {
    block_type: String,
    tool_id: Option<String>,
    tool_name: Option<String>,
    partial_json: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RememberedTool {
    Bash,
    Other,
}

#[derive(Debug, Clone)]
pub struct ClaudeTurnOptions {
    pub prompt: String,
    pub cwd: PathBuf,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub resume_session_id: Option<String>,
    pub permission_mode: Option<String>,
    pub allowed_tools: Option<String>,
    pub binary: Option<String>,
    pub remote: Option<RemoteExec>,
}

pub struct ClaudeStreamTurn {
    state: Arc<TurnState>,
    reader_thread: Mutex<Option<JoinHandle<()>>>,
    stderr_thread: Mutex<Option<JoinHandle<()>>>,
}

impl ClaudeStreamTurn {
    pub fn kill(&self) -> Result<(), AgentSpawnError> {
        stop_state_lease(&self.state);
        if self.state.terminal_emitted.load(Ordering::SeqCst) {
            let mut child = self
                .state
                .child
                .lock()
                .map_err(|_| AgentSpawnError::ProcessLockPoisoned)?;
            if let Some(child) = child.as_mut() {
                signal_child(child);
            }
            return Ok(());
        }
        self.state.interrupted.store(true, Ordering::SeqCst);
        let mut child = self
            .state
            .child
            .lock()
            .map_err(|_| AgentSpawnError::ProcessLockPoisoned)?;
        if let Some(child) = child.as_mut() {
            signal_child(child);
        }
        Ok(())
    }

    pub(crate) fn shutdown_bounded(&self) {
        let terminal = self.state.terminal_emitted.load(Ordering::SeqCst);
        if !terminal {
            self.state.interrupted.store(true, Ordering::SeqCst);
        }
        if let Ok(mut child) = self.state.child.lock() {
            if let Some(child) = child.as_mut() {
                signal_child(child);
            }
        }
        stop_state_lease_bounded(&self.state);
        if let Ok(mut reader) = self.reader_thread.lock() {
            if let Some(thread) = reader.take() {
                let _ = thread.join();
            }
        }
        if let Ok(mut stderr) = self.stderr_thread.lock() {
            if let Some(thread) = stderr.take() {
                let _ = thread.join();
            }
        }
    }
}

impl Drop for ClaudeStreamTurn {
    fn drop(&mut self) {
        let _ = self.kill();
        if let Ok(mut reader_thread) = self.reader_thread.lock() {
            if let Some(thread) = reader_thread.take() {
                let _ = thread.join();
            }
        }
        if let Ok(mut stderr_thread) = self.stderr_thread.lock() {
            if let Some(thread) = stderr_thread.take() {
                let _ = thread.join();
            }
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AgentSpawnError {
    #[error("failed to spawn {binary}: {source}")]
    Spawn {
        binary: String,
        #[source]
        source: std::io::Error,
    },
    #[error("claude stdout was not piped")]
    MissingStdout,
    #[error("claude stderr was not piped")]
    MissingStderr,
    #[error("failed to start claude stream thread: {0}")]
    Thread(#[source] std::io::Error),
    #[error("claude process lock poisoned")]
    ProcessLockPoisoned,
    #[error(transparent)]
    Io(std::io::Error),
    #[error(transparent)]
    Remote(#[from] RemoteExecError),
}

struct TurnCommand {
    program: String,
    args: Vec<String>,
    cwd: Option<PathBuf>,
    remote_host: Option<String>,
    lease: Option<RemoteLeaseHandle>,
}

fn turn_command(opts: &ClaudeTurnOptions) -> Result<TurnCommand, AgentSpawnError> {
    let binary = opts.binary.clone().unwrap_or_else(|| "claude".to_string());
    let mut args = vec![
        binary.clone(),
        "-p".to_string(),
        opts.prompt.clone(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--include-partial-messages".to_string(),
        "--verbose".to_string(),
        "--permission-mode".to_string(),
        opts.permission_mode
            .clone()
            .unwrap_or_else(|| DEFAULT_PERMISSION_MODE.to_string()),
        "--allowedTools".to_string(),
        opts.allowed_tools
            .clone()
            .unwrap_or_else(|| DEFAULT_ALLOWED_TOOLS.to_string()),
    ];
    if let Some(model) = opts.model.as_deref().filter(|value| !value.trim().is_empty()) {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    if let Some(effort) = opts.effort.as_deref().filter(|value| !value.trim().is_empty()) {
        args.push("--effort".to_string());
        args.push(effort.to_string());
    }
    if let Some(session_id) = opts
        .resume_session_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        args.push("--resume".to_string());
        args.push(session_id.to_string());
    }
    if let Some(remote) = opts.remote.as_ref() {
        let (args, lease) = remote.ssh_launch(&args)?;
        return Ok(TurnCommand {
            program: "ssh".to_string(),
            args,
            cwd: None,
            remote_host: Some(remote.host.clone()),
            lease,
        });
    }
    args.remove(0);
    Ok(TurnCommand {
        program: binary,
        args,
        cwd: Some(opts.cwd.clone()),
        remote_host: None,
        lease: None,
    })
}

pub fn spawn_claude_turn<F>(
    opts: ClaudeTurnOptions,
    sink: F,
) -> Result<ClaudeStreamTurn, AgentSpawnError>
where
    F: Fn(AgentEvent) + Send + Sync + 'static,
{
    let mut turn_command = turn_command(&opts)?;
    let mut command = Command::new(&turn_command.program);
    command
        .args(&turn_command.args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = turn_command.cwd.as_ref() {
        command.current_dir(cwd);
    }
    // Own process group so kill() can take down the whole tree — a claude turn
    // spawns descendants (MCP servers, Bash tool children) that would otherwise
    // outlive it. Mirrors codex_exec.rs.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    if let Some(lease) = turn_command.lease.as_ref() {
        lease.prepare().map_err(AgentSpawnError::Thread)?;
    }

    let mut child = command.spawn().map_err(|source| AgentSpawnError::Spawn {
        binary: turn_command.program.clone(),
        source,
    })?;
    if let Some(lease) = turn_command.lease.as_ref() {
        if let Err(error) = lease.start_heartbeat() {
            kill_and_wait_child(child);
            return Err(AgentSpawnError::Thread(error));
        }
    }

    let Some(stdout) = child.stdout.take() else {
        if let Some(lease) = turn_command.lease.take() {
            lease.stop();
        }
        kill_and_wait_child(child);
        return Err(AgentSpawnError::MissingStdout);
    };
    let Some(stderr) = child.stderr.take() else {
        if let Some(lease) = turn_command.lease.take() {
            lease.stop();
        }
        kill_and_wait_child(child);
        return Err(AgentSpawnError::MissingStderr);
    };
    let state = Arc::new(TurnState {
        child: Mutex::new(Some(child)),
        terminal_emitted: AtomicBool::new(false),
        interrupted: AtomicBool::new(false),
        lease: Mutex::new(turn_command.lease),
    });

    let stderr_state = Arc::clone(&state);
    let stderr_thread = match std::thread::Builder::new()
        .name("claude-stderr-drain".to_string())
        .spawn(move || drain_stderr(stderr, stderr_state))
    {
        Ok(thread) => thread,
        Err(error) => {
            kill_state_child(&state);
            return Err(AgentSpawnError::Thread(error));
        }
    };

    let sink = Arc::new(sink);
    let reader_state = Arc::clone(&state);
    let reader_thread = match std::thread::Builder::new()
        .name("claude-stream-reader".to_string())
        .spawn(move || read_stdout(stdout, reader_state, sink, turn_command.remote_host))
    {
        Ok(thread) => thread,
        Err(error) => {
            kill_state_child(&state);
            let _ = stderr_thread.join();
            return Err(AgentSpawnError::Thread(error));
        }
    };

    Ok(ClaudeStreamTurn {
        state,
        reader_thread: Mutex::new(Some(reader_thread)),
        stderr_thread: Mutex::new(Some(stderr_thread)),
    })
}

struct TurnState {
    child: Mutex<Option<Child>>,
    terminal_emitted: AtomicBool,
    interrupted: AtomicBool,
    lease: Mutex<Option<RemoteLeaseHandle>>,
}

fn read_stdout<F>(
    stdout: impl Read,
    state: Arc<TurnState>,
    sink: Arc<F>,
    remote_host: Option<String>,
)
where
    F: Fn(AgentEvent) + Send + Sync + 'static,
{
    let mut parser = ClaudeStreamParser::new();
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();

    let mut reader_failed = false;

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let mut delivered = true;
                for event in parser.push_line(&line) {
                    delivered = emit_event(&sink, &state.terminal_emitted, event);
                    if !delivered {
                        break;
                    }
                }
                if !delivered {
                    reader_failed = true;
                    break;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => {
                reader_failed = true;
                break;
            }
        }
    }

    if reader_failed {
        stop_state_lease(&state);
        if let Ok(mut child) = state.child.lock() {
            if let Some(child) = child.as_mut() {
                signal_child(child);
            }
        }
    }

    let status = state
        .child
        .lock()
        .ok()
        .and_then(|mut child| child.take())
        .and_then(|mut child| child.wait().ok());
    finish_state_lease(&state);

    if state.interrupted.load(Ordering::SeqCst) {
        let _ = emit_event(
            &sink,
            &state.terminal_emitted,
            AgentEvent::TurnFailed {
                error: "interrupted".to_string(),
            },
        );
        return;
    }

    if let Some(status) = status {
        if !status.success() && !state.terminal_emitted.load(Ordering::SeqCst) {
            let status_text = status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| status.to_string());
            let _ = emit_event(
                &sink,
                &state.terminal_emitted,
                AgentEvent::TurnFailed {
                    error: if status.code() == Some(255) {
                        remote_host
                            .as_deref()
                            .map(remote_ssh_exit_error)
                            .unwrap_or_else(|| format!("claude exited with status {status_text}"))
                    } else {
                        format!("claude exited with status {status_text}")
                    },
                },
            );
        }
    }
}

fn emit_event<F>(sink: &Arc<F>, terminal_emitted: &AtomicBool, event: AgentEvent) -> bool
where
    F: Fn(AgentEvent) + Send + Sync + 'static,
{
    if is_terminal_event(&event) && terminal_emitted.swap(true, Ordering::SeqCst) {
        return true;
    }
    std::panic::catch_unwind(AssertUnwindSafe(|| sink(event))).is_ok()
}

fn is_terminal_event(event: &AgentEvent) -> bool {
    matches!(
        event,
        AgentEvent::TurnDone { .. } | AgentEvent::TurnFailed { .. }
    )
}

fn drain_stderr(mut stderr: impl Read, state: Arc<TurnState>) {
    if std::io::copy(&mut stderr, &mut std::io::sink()).is_err() {
        state.interrupted.store(true, Ordering::SeqCst);
        stop_state_lease(&state);
        if let Ok(mut child) = state.child.lock() {
            if let Some(child) = child.as_mut() {
                signal_child(child);
            }
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


fn stop_state_lease(state: &Arc<TurnState>) {
    if let Ok(mut lease) = state.lease.lock() {
        if let Some(lease) = lease.take() {
            lease.stop();
        }
    }
}

fn stop_state_lease_bounded(state: &Arc<TurnState>) {
    if let Ok(mut lease) = state.lease.lock() {
        if let Some(lease) = lease.take() {
            lease.stop_bounded();
        }
    }
}

fn finish_state_lease(state: &Arc<TurnState>) {
    if let Ok(mut lease) = state.lease.lock() {
        if let Some(lease) = lease.take() {
            lease.finish_natural();
        }
    }
}

fn kill_state_child(state: &Arc<TurnState>) {
    stop_state_lease(state);
    if let Ok(mut child) = state.child.lock() {
        if let Some(child) = child.take() {
            kill_and_wait_child(child);
        }
    }
}

fn string_at<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn bool_at(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn u64_at(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

fn f64_at(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn usize_at(value: &Value, key: &str) -> Option<usize> {
    u64_at(value, key).and_then(|index| usize::try_from(index).ok())
}

/// Total tokens an API `usage` object occupies in the context window.
fn context_size(usage: &Value) -> u64 {
    u64_at(usage, "input_tokens").unwrap_or_default()
        + u64_at(usage, "cache_creation_input_tokens").unwrap_or_default()
        + u64_at(usage, "cache_read_input_tokens").unwrap_or_default()
        + u64_at(usage, "output_tokens").unwrap_or_default()
}

/// Context window of the conversation's main model. `modelUsage` keys are the
/// requested model ids (e.g. `claude-haiku-4-5`) while assistant messages
/// report resolved ids (e.g. `claude-haiku-4-5-20251001`), so match by prefix.
/// Subagents may add entries for other models; with no match and more than one
/// entry the window is unknowable, so report nothing.
fn context_window_for(
    models: &serde_json::Map<String, Value>,
    assistant_model: Option<&str>,
) -> Option<u64> {
    let matched = assistant_model.and_then(|model| {
        models
            .iter()
            .find(|(key, _)| model.starts_with(key.as_str()) || key.starts_with(model))
            .map(|(_, entry)| entry)
    });
    matched
        .or_else(|| (models.len() == 1).then(|| models.values().next()).flatten())
        .and_then(|entry| u64_at(entry, "contextWindow"))
}

fn input_string(input: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| string_at(input, key).map(ToString::to_string))
}

fn is_empty_object(value: &Value) -> bool {
    value.as_object().map(|object| object.is_empty()).unwrap_or(false)
}

fn todo_items(input: &Value) -> Vec<PlanItem> {
    input
        .get("todos")
        .and_then(Value::as_array)
        .map(|todos| {
            todos
                .iter()
                .map(|todo| PlanItem {
                    text: input_string(todo, &["content", "activeForm"]).unwrap_or_default(),
                    completed: string_at(todo, "status") == Some("completed"),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn mcp_parts(name: &str) -> Option<(&str, &str)> {
    name.strip_prefix("mcp__")?.split_once("__")
}

fn compact_input_summary(input: &Value) -> Option<String> {
    input_string(input, &["file_path", "notebook_path", "pattern", "description"])
        .filter(|summary| !summary.is_empty())
}

fn tool_result_text(block: &Value) -> Option<String> {
    match block.get("content")? {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let text = items
                .iter()
                .filter_map(|item| {
                    item.as_str()
                        .or_else(|| string_at(item, "text"))
                        .map(ToString::to_string)
                })
                .collect::<Vec<_>>()
                .join("");
            Some(text)
        }
        _ => None,
    }
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
    #[cfg(unix)]
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    #[cfg(unix)]
    use std::{os::unix::fs::PermissionsExt, thread};

    use super::*;

    fn fixture_events(name: &str) -> Vec<AgentEvent> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures")
            .join("agents")
            .join("claude-stream")
            .join(name);
        let input = fs::read_to_string(path).unwrap();
        let mut parser = ClaudeStreamParser::new();
        input
            .lines()
            .flat_map(|line| parser.push_line(line))
            .collect()
    }

    fn turn_started_count(events: &[AgentEvent]) -> usize {
        events
            .iter()
            .filter(|event| matches!(event, AgentEvent::TurnStarted))
            .count()
    }

    fn has_noise(events: &[AgentEvent]) -> bool {
        events
            .iter()
            .any(|event| matches!(event, AgentEvent::Noise { .. }))
    }

    fn usage_count(events: &[AgentEvent]) -> usize {
        events
            .iter()
            .filter(|event| matches!(event, AgentEvent::Usage { .. }))
            .count()
    }

    fn terminal_event_count(events: &[AgentEvent]) -> usize {
        events
            .iter()
            .filter(|event| is_terminal_event(event))
            .count()
    }

    #[cfg(unix)]
    struct TestScript {
        dir: PathBuf,
        path: PathBuf,
    }

    #[cfg(unix)]
    impl Drop for TestScript {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    #[cfg(unix)]
    fn test_script(body: &str) -> TestScript {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "pickforge-claude-stream-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("claude-fixture");
        fs::write(&path, body).unwrap();

        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();

        TestScript { dir, path }
    }

    #[cfg(unix)]
    fn runner_opts(binary: PathBuf) -> ClaudeTurnOptions {
        ClaudeTurnOptions {
            prompt: "ignored".to_string(),
            cwd: std::env::temp_dir(),
            model: None,
            effort: None,
            resume_session_id: None,
            permission_mode: None,
            allowed_tools: None,
            binary: Some(binary.to_string_lossy().to_string()),
            remote: None,
        }
    }

    #[test]
    fn remote_turn_uses_one_quoted_ssh_command() {
        let options = ClaudeTurnOptions {
            prompt: "say it's $HOME".to_string(),
            cwd: PathBuf::from("/local/project"),
            model: Some("model with spaces".to_string()),
            effort: Some("high".to_string()),
            resume_session_id: Some("session'one".to_string()),
            permission_mode: Some("plan".to_string()),
            allowed_tools: Some("Read,Bash(git status)".to_string()),
            binary: Some("claude".to_string()),
            remote: Some(RemoteExec::new("mac-mini", "/Users/dev/it's $root").unwrap()),
        };

        let command = turn_command(&options).unwrap();

        assert_eq!(command.program, "ssh");
        assert_eq!(command.cwd, None);
        assert_eq!(command.remote_host.as_deref(), Some("mac-mini"));
        assert_eq!(
            command.args.last().unwrap(),
            "cd '/Users/dev/it'\\''s $root' && exec \"$SHELL\" -lc ''\\''claude'\\'' '\\''-p'\\'' '\\''say it'\\''\\'\\'''\\''s $HOME'\\'' '\\''--output-format'\\'' '\\''stream-json'\\'' '\\''--include-partial-messages'\\'' '\\''--verbose'\\'' '\\''--permission-mode'\\'' '\\''plan'\\'' '\\''--allowedTools'\\'' '\\''Read,Bash(git status)'\\'' '\\''--model'\\'' '\\''model with spaces'\\'' '\\''--effort'\\'' '\\''high'\\'' '\\''--resume'\\'' '\\''session'\\''\\'\\'''\\''one'\\'''"
        );
    }

    #[cfg(unix)]
    fn wait_for_events<F>(events: &Arc<Mutex<Vec<AgentEvent>>>, predicate: F) -> Vec<AgentEvent>
    where
        F: Fn(&[AgentEvent]) -> bool,
    {
        let deadline = Instant::now() + Duration::from_secs(2);
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
    fn collected_runner_events(
        script: &TestScript,
    ) -> (ClaudeStreamTurn, Arc<Mutex<Vec<AgentEvent>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let turn = spawn_test_turn(script, &events);

        (turn, events)
    }

    #[cfg(unix)]
    fn spawn_test_turn(
        script: &TestScript,
        events: &Arc<Mutex<Vec<AgentEvent>>>,
    ) -> ClaudeStreamTurn {
        for attempt in 0..10 {
            let sink_events = Arc::clone(events);
            match spawn_claude_turn(runner_opts(script.path.clone()), move |event| {
                sink_events.lock().unwrap().push(event);
            }) {
                Ok(turn) => return turn,
                Err(error) if is_text_file_busy(&error) && attempt < 9 => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("spawn claude turn: {error:?}"),
            }
        }
        unreachable!("retry loop returns or panics")
    }

    #[cfg(unix)]
    fn is_text_file_busy(error: &AgentSpawnError) -> bool {
        matches!(
            error,
            AgentSpawnError::Spawn { source, .. }
                if source.raw_os_error() == Some(libc::ETXTBSY)
        )
    }

    #[test]
    fn parses_hi_fixture() {
        let events = fixture_events("claude-stream-hi.jsonl");

        assert!(matches!(
            events.first(),
            Some(AgentEvent::SessionStarted {
                provider_session_id
            }) if provider_session_id.starts_with("f4ea5772")
        ));
        assert_eq!(turn_started_count(&events), 1);
        assert!(events
            .iter()
            .any(|event| matches!(event, AgentEvent::ThinkingDelta { .. })));
        assert!(events
            .iter()
            .any(|event| matches!(event, AgentEvent::ThinkingFinal { .. })));
        assert!(events
            .iter()
            .any(|event| matches!(event, AgentEvent::TextDelta { .. })));
        assert!(events.iter().any(|event| {
            matches!(
                event,
                AgentEvent::TextFinal { text, .. } if text == "hello from claude"
            )
        }));
        assert!(events.iter().any(|event| {
            matches!(
                event,
                AgentEvent::Usage {
                    cost_usd: Some(cost),
                    ..
                } if *cost > 0.0
            )
        }));
        assert!(matches!(
            events.last(),
            Some(AgentEvent::TurnDone {
                status: TurnStatus::Completed
            })
        ));
        assert!(!has_noise(&events));
    }

    #[test]
    fn skips_empty_assistant_thinking_block() {
        let mut parser = ClaudeStreamParser::new();
        let events = parser.push_line(
            r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"   "}]}}"#,
        );

        assert!(events.is_empty());
    }

    #[test]
    fn parses_bash_fixture() {
        let events = fixture_events("claude-stream-bash.jsonl");

        let started = events.iter().position(|event| {
            matches!(
                event,
                AgentEvent::CommandStarted {
                    command,
                    ..
                } if command.contains("pickforge-fixture")
            )
        });
        let done = events.iter().position(|event| {
            matches!(
                event,
                AgentEvent::CommandDone {
                    status: CommandStatus::Completed,
                    output_tail: Some(output_tail),
                    ..
                } if output_tail.contains("pickforge-fixture")
            )
        });

        assert!(started.is_some());
        assert!(done.is_some());
        assert!(started < done);
        assert_eq!(turn_started_count(&events), 1);
        assert!(!has_noise(&events));
    }

    #[test]
    fn parses_resume_fixture() {
        let events = fixture_events("claude-stream-resume.jsonl");

        assert!(events.iter().any(|event| {
            matches!(
                event,
                AgentEvent::TextFinal { text, .. } if text == "hello from claude"
            )
        }));
        assert!(events.iter().any(|event| {
            matches!(
                event,
                AgentEvent::TurnDone {
                    status: TurnStatus::Completed
                }
            )
        }));
        assert!(!has_noise(&events));
    }

    #[test]
    fn maps_noise_and_skipped_system_events() {
        let mut parser = ClaudeStreamParser::new();

        assert_eq!(
            parser.push_line("garbage"),
            vec![AgentEvent::Noise {
                line: "garbage".to_string()
            }]
        );
        assert!(parser
            .push_line(r#"{"type":"system","subtype":"hook_started"}"#)
            .is_empty());
    }

    #[test]
    fn maps_error_result_to_failed_turn() {
        let mut parser = ClaudeStreamParser::new();
        let events = parser.push_line(
            r#"{"type":"result","subtype":"error_during_execution","usage":{"input_tokens":1,"cache_read_input_tokens":2,"output_tokens":3},"total_cost_usd":0.5}"#,
        );

        assert!(matches!(
            events.as_slice(),
            [
                AgentEvent::Usage {
                    input_tokens: 1,
                    cached_input_tokens: 2,
                    output_tokens: 3,
                    cost_usd: Some(0.5),
                    context_used: None,
                    context_window: None
                },
                AgentEvent::TurnFailed { error }
            ] if error == "error_during_execution"
        ));
    }

    #[test]
    fn result_with_model_usage_emits_cumulative_snapshot_and_context() {
        let mut parser = ClaudeStreamParser::new();
        parser.push_line(
            r#"{"type":"assistant","parent_tool_use_id":"task-1","message":{"model":"claude-sonnet-5","usage":{"input_tokens":9,"cache_creation_input_tokens":0,"cache_read_input_tokens":500000,"output_tokens":9},"content":[]}}"#,
        );
        parser.push_line(
            r#"{"type":"assistant","message":{"model":"claude-haiku-4-5-20251001","usage":{"input_tokens":10,"cache_creation_input_tokens":1373,"cache_read_input_tokens":22513,"output_tokens":4},"content":[]}}"#,
        );
        let events = parser.push_line(
            r#"{"type":"result","subtype":"success","usage":{"input_tokens":10,"cache_read_input_tokens":22513,"output_tokens":33},"total_cost_usd":0.05,"modelUsage":{"claude-haiku-4-5":{"inputTokens":20,"outputTokens":76,"cacheReadInputTokens":22513,"cacheCreationInputTokens":23886,"costUSD":0.05,"contextWindow":200000},"claude-sonnet-5":{"inputTokens":9,"outputTokens":9,"cacheReadInputTokens":500000,"cacheCreationInputTokens":0,"costUSD":0.01,"contextWindow":1000000}}}"#,
        );

        assert!(matches!(
            events.as_slice(),
            [
                AgentEvent::Usage {
                    input_tokens: 23915,
                    cached_input_tokens: 522513,
                    output_tokens: 85,
                    cost_usd: Some(0.05),
                    context_used: Some(23900),
                    context_window: Some(200000),
                },
                AgentEvent::TurnDone {
                    status: TurnStatus::Completed
                }
            ]
        ));
    }

    #[test]
    fn result_with_model_usage_falls_back_to_turn_usage_for_context() {
        let mut parser = ClaudeStreamParser::new();
        let events = parser.push_line(
            r#"{"type":"result","subtype":"success","usage":{"input_tokens":10,"cache_creation_input_tokens":1000,"cache_read_input_tokens":22513,"output_tokens":33},"total_cost_usd":0.05,"modelUsage":{"claude-haiku-4-5":{"inputTokens":10,"outputTokens":33,"cacheReadInputTokens":22513,"cacheCreationInputTokens":1000,"costUSD":0.05,"contextWindow":200000}}}"#,
        );

        assert!(matches!(
            events.first(),
            Some(AgentEvent::Usage {
                context_used: Some(23556),
                context_window: Some(200000),
                ..
            })
        ));
    }

    #[test]
    fn duplicate_result_lines_emit_one_terminal_result() {
        let mut parser = ClaudeStreamParser::new();
        let result = r#"{"type":"result","subtype":"success","usage":{"input_tokens":1,"cache_read_input_tokens":2,"output_tokens":3},"total_cost_usd":0.5}"#;
        let events = parser
            .push_line(result)
            .into_iter()
            .chain(parser.push_line(result))
            .collect::<Vec<_>>();

        assert_eq!(usage_count(&events), 1);
        assert_eq!(terminal_event_count(&events), 1);
        assert!(matches!(
            events.last(),
            Some(AgentEvent::TurnDone {
                status: TurnStatus::Completed
            })
        ));
    }

    #[cfg(unix)]
    #[test]
    fn kill_after_terminal_stops_remaining_lease_once() {
        let script = test_script(
            r#"#!/bin/sh
printf '%s\n' '{"type":"system","subtype":"init","session_id":"runner-clean"}'
printf '%s\n' '{"type":"stream_event","event":{"type":"message_start"}}'
printf '%s\n' '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"runner hi"}}}'
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"runner hi"}]}}'
printf '%s\n' '{"type":"result","subtype":"success","usage":{"input_tokens":1,"cache_read_input_tokens":2,"output_tokens":3},"total_cost_usd":0.25}'
sleep 5
"#,
        );
        let (turn, events) = collected_runner_events(&script);
        wait_for_events(&events, |events| terminal_event_count(events) == 1);
        assert!(turn.state.terminal_emitted.load(Ordering::SeqCst));
        let Ok(mut lease) = turn.state.lease.lock() else {
            panic!("turn lease lock poisoned");
        };
        *lease = Some(crate::remote::RemoteLeaseHandle::new(
            crate::remote::SshTarget::new("127.0.0.1").unwrap(),
            Vec::new(),
        ));
        drop(lease);
        let started = std::time::Instant::now();
        turn.kill().unwrap();
        assert!(turn.state.lease.lock().is_ok_and(|lease| lease.is_none()));
        drop(turn);
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
        let snapshot = events.lock().unwrap().clone();

        assert_eq!(terminal_event_count(&snapshot), 1);
        assert!(matches!(
            snapshot.as_slice(),
            [
                ..,
                AgentEvent::Usage {
                    input_tokens: 1,
                    cached_input_tokens: 2,
                    output_tokens: 3,
                    cost_usd: Some(0.25),
                    context_used: None,
                    context_window: None
                },
                AgentEvent::TurnDone {
                    status: TurnStatus::Completed
                }
            ]
        ));
    }

    #[cfg(unix)]
    #[test]
    fn runner_nonzero_without_result_emits_failed_turn_once() {
        let script = test_script(
            r#"#!/bin/sh
exit 3
"#,
        );
        let (turn, events) = collected_runner_events(&script);
        wait_for_events(&events, |events| terminal_event_count(events) == 1);
        drop(turn);
        let snapshot = events.lock().unwrap().clone();

        assert_eq!(terminal_event_count(&snapshot), 1);
        assert!(snapshot.iter().any(|event| {
            matches!(
                event,
                AgentEvent::TurnFailed { error } if error.contains("claude exited with status 3")
            )
        }));
    }

    #[cfg(unix)]
    #[test]
    fn runner_kill_terminates_descendants_too() {
        let marker = std::env::temp_dir().join(format!(
            "pickforge-claude-killtree-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_file(&marker);
        let script = test_script(&format!(
            r#"#!/bin/sh
printf '%s\n' '{{"type":"system","subtype":"init","session_id":"runner-tree"}}'
sh -c 'sleep 3; : > {}' &
exec sleep 5
"#,
            marker.display()
        ));
        let (turn, events) = collected_runner_events(&script);
        wait_for_events(&events, |events| {
            events
                .iter()
                .any(|event| matches!(event, AgentEvent::SessionStarted { .. }))
        });
        thread::sleep(Duration::from_millis(200)); // let the grandchild fork

        turn.kill().unwrap();
        drop(turn); // joins the readers; the child is reaped

        thread::sleep(Duration::from_secs(4));
        assert!(
            !marker.exists(),
            "descendant survived the turn kill (marker was written)"
        );
        let _ = fs::remove_file(&marker);
    }

    #[cfg(unix)]
    #[test]
    fn runner_kill_emits_interrupted_once() {
        let script = test_script(
            r#"#!/bin/sh
printf '%s\n' '{"type":"system","subtype":"init","session_id":"runner-kill"}'
exec sleep 5
"#,
        );
        let (turn, events) = collected_runner_events(&script);
        wait_for_events(&events, |events| {
            events
                .iter()
                .any(|event| matches!(event, AgentEvent::SessionStarted { .. }))
        });

        turn.kill().unwrap();
        wait_for_events(&events, |events| terminal_event_count(events) == 1);
        drop(turn);
        let snapshot = events.lock().unwrap().clone();

        assert_eq!(terminal_event_count(&snapshot), 1);
        assert!(matches!(
            snapshot.last(),
            Some(AgentEvent::TurnFailed { error }) if error == "interrupted"
        ));
    }
}
