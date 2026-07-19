use std::io::{BufRead, BufReader, Read};
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Stdio};
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

#[derive(Debug, Clone)]
pub struct CodexTurnOptions {
    pub prompt: String,
    pub cwd: PathBuf,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub sandbox: Option<String>,
    pub approval_policy: Option<String>,
    pub resume_thread_id: Option<String>,
    pub binary: Option<String>,
    pub remote: Option<RemoteExec>,
}

pub struct CodexExecTurn {
    state: Arc<CodexTurnState>,
    reader_thread: Mutex<Option<JoinHandle<()>>>,
    stderr_thread: Mutex<Option<JoinHandle<()>>>,
}

#[derive(Debug, thiserror::Error)]
pub enum AgentSpawnError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("codex exec did not expose {0}")]
    MissingPipe(&'static str),
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

fn turn_command(opts: &CodexTurnOptions) -> Result<TurnCommand, AgentSpawnError> {
    let binary = opts
        .binary
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "codex".to_string());
    let mut args = vec![
        binary.clone(),
        "exec".to_string(),
        "--json".to_string(),
        "--skip-git-repo-check".to_string(),
        "-c".to_string(),
        config_override(
            "sandbox_mode",
            opts.sandbox
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("workspace-write"),
        ),
        "-c".to_string(),
        config_override(
            "approval_policy",
            opts.approval_policy
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("never"),
        ),
    ];
    if let Some(effort) = opts.effort.as_deref().filter(|value| !value.trim().is_empty()) {
        args.push("-c".to_string());
        args.push(config_override("model_reasoning_effort", effort));
    }
    if let Some(model) = opts.model.as_deref().filter(|value| !value.trim().is_empty()) {
        args.push("-m".to_string());
        args.push(model.to_string());
    }
    if let Some(thread_id) = opts
        .resume_thread_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        args.push("resume".to_string());
        args.push(thread_id.to_string());
    }
    args.push(opts.prompt.clone());
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

fn config_override(key: &str, value: &str) -> String {
    format!(
        "{key}={}",
        serde_json::to_string(value).expect("config override serializes")
    )
}

pub fn parse_codex_exec_line(line: &str) -> Option<AgentEvent> {
    parse_codex_exec_line_parts(line).event
}

pub fn spawn_codex_turn<F>(
    opts: CodexTurnOptions,
    sink: F,
) -> Result<CodexExecTurn, AgentSpawnError>
where
    F: Fn(AgentEvent) + Send + Sync + 'static,
{
    let mut turn_command = turn_command(&opts)?;
    let mut cmd = Command::new(&turn_command.program);
    cmd.args(&turn_command.args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear();
    if let Some(cwd) = turn_command.cwd.as_ref() {
        cmd.current_dir(cwd);
    }
    for (key, value) in crate::process::user_shell_environment().clone() {
        cmd.env(key, value);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    if let Some(lease) = turn_command.lease.as_ref() {
        lease.prepare()?;
    }

    let mut child = cmd.spawn()?;
    // Crash containment: no-op unless the guardian/job is active.
    crate::process::contain_owned_root(child.id());
    if let Some(lease) = turn_command.lease.as_ref() {
        if let Err(error) = lease.start_heartbeat() {
            kill_and_wait_child(child);
            return Err(AgentSpawnError::Io(error));
        }
    }
    let Some(stdout) = child.stdout.take() else {
        if let Some(lease) = turn_command.lease.take() {
            lease.stop();
        }
        kill_and_wait_child(child);
        return Err(AgentSpawnError::MissingPipe("stdout"));
    };
    let Some(stderr) = child.stderr.take() else {
        if let Some(lease) = turn_command.lease.take() {
            lease.stop();
        }
        kill_and_wait_child(child);
        return Err(AgentSpawnError::MissingPipe("stderr"));
    };

    let state = Arc::new(CodexTurnState {
        child: Mutex::new(Some(child)),
        killed: AtomicBool::new(false),
        terminal_sent: AtomicBool::new(false),
        lease: Mutex::new(turn_command.lease),
    });
    let sink = Arc::new(sink);

    let stderr_state = Arc::clone(&state);
    let stderr_thread = std::thread::Builder::new()
        .name("codex-exec-stderr".to_string())
        .spawn(move || drain(stderr, stderr_state));
    let stderr_thread = match stderr_thread {
        Ok(handle) => handle,
        Err(err) => {
            kill_state_child(&state);
            return Err(AgentSpawnError::Io(err));
        }
    };

    let reader_state = Arc::clone(&state);
    let reader_sink = Arc::clone(&sink);
    let reader_thread = match std::thread::Builder::new()
        .name("codex-exec-stdout".to_string())
        .spawn(move || {
            read_loop(stdout, reader_state, reader_sink, turn_command.remote_host);
        }) {
        Ok(handle) => handle,
        Err(err) => {
            kill_state_child(&state);
            let _ = stderr_thread.join();
            return Err(AgentSpawnError::Io(err));
        }
    };

    Ok(CodexExecTurn {
        state,
        reader_thread: Mutex::new(Some(reader_thread)),
        stderr_thread: Mutex::new(Some(stderr_thread)),
    })
}

impl CodexExecTurn {
    pub fn kill(&self) -> Result<(), AgentSpawnError> {
        stop_state_lease(&self.state);
        if self.state.terminal_sent.load(Ordering::SeqCst) {
            signal_state_child(&self.state);
            return Ok(());
        }
        self.state.killed.store(true, Ordering::SeqCst);
        signal_state_child(&self.state);
        Ok(())
    }

    pub(crate) fn shutdown_bounded(&self) {
        let terminal = self.state.terminal_sent.load(Ordering::SeqCst);
        if !terminal {
            self.state.killed.store(true, Ordering::SeqCst);
        }
        signal_state_child(&self.state);
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

impl Drop for CodexExecTurn {
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

struct CodexTurnState {
    child: Mutex<Option<Child>>,
    killed: AtomicBool,
    terminal_sent: AtomicBool,
    lease: Mutex<Option<RemoteLeaseHandle>>,
}

struct ParsedCodexLine {
    event: Option<AgentEvent>,
    turn_completed: bool,
}

fn parse_codex_exec_line_parts(line: &str) -> ParsedCodexLine {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return ParsedCodexLine {
            event: None,
            turn_completed: false,
        };
    }

    let value = match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => value,
        Err(_) => {
            return ParsedCodexLine {
                event: Some(AgentEvent::Noise {
                    line: line.to_string(),
                }),
                turn_completed: false,
            };
        }
    };

    let Some(event_type) = value.get("type").and_then(Value::as_str) else {
        return ParsedCodexLine {
            event: None,
            turn_completed: false,
        };
    };

    let event = match event_type {
        "thread.started" => string_field(&value, &["thread_id"]).map(|provider_session_id| {
            AgentEvent::SessionStarted {
                provider_session_id,
            }
        }),
        "turn.started" => Some(AgentEvent::TurnStarted),
        "item.started" | "item.updated" | "item.completed" => parse_item_event(event_type, &value),
        "turn.completed" => Some(parse_usage(&value)),
        "turn.failed" | "error" => Some(AgentEvent::TurnFailed {
            error: best_error_message(&value),
        }),
        _ => None,
    };

    ParsedCodexLine {
        event,
        turn_completed: event_type == "turn.completed",
    }
}

fn parse_item_event(event_type: &str, value: &Value) -> Option<AgentEvent> {
    let item = value.get("item")?;
    let item_type = item.get("type").and_then(Value::as_str)?;
    let completed = event_type == "item.completed";
    let item_id_value = item_id(item).unwrap_or_default();

    match item_type {
        "agent_message" => completed.then(|| AgentEvent::TextFinal {
            item_id: item_id(item),
            text: string_field(item, &["text"]).unwrap_or_default(),
        }),
        "reasoning" if completed => {
            let text = reasoning_text(item);
            (!text.trim().is_empty()).then(|| AgentEvent::ThinkingFinal {
                item_id: item_id(item),
                text,
            })
        }
        "reasoning" => None,
        "command_execution" => match event_type {
            "item.started" => Some(AgentEvent::CommandStarted {
                item_id: item_id_value,
                command: string_field(item, &["command"]).unwrap_or_default(),
                cwd: None,
            }),
            "item.completed" => Some(AgentEvent::CommandDone {
                item_id: item_id_value,
                exit_code: i32_field(item, &["exit_code"]),
                status: command_status(string_field(item, &["status"]).as_deref()),
                output_tail: string_field(item, &["aggregated_output"])
                    .map(|text| last_chars(&text, 2000)),
            }),
            _ => None,
        },
        "file_change" => completed.then(|| AgentEvent::FileChange {
            item_id: item_id_value,
            changes: file_changes(item),
        }),
        "mcp_tool_call" => completed.then(|| AgentEvent::McpToolCall {
            item_id: item_id_value,
            server: string_field(item, &["server", "server_name", "mcp_server"])
                .unwrap_or_default(),
            tool: string_field(item, &["tool", "tool_name", "name"]).unwrap_or_default(),
            status: tool_status(string_field(item, &["status"]).as_deref()),
            detail: None,
        }),
        "web_search" => completed.then(|| AgentEvent::WebSearch {
            item_id: item_id_value,
            query: string_field(item, &["query", "search_query"]).unwrap_or_default(),
        }),
        "todo_list" => Some(AgentEvent::PlanUpdate {
            items: plan_items(item),
        }),
        _ => completed.then(|| AgentEvent::ToolUse {
            item_id: item_id_value,
            name: item_type.to_string(),
            status: ToolCallStatus::Completed,
            detail: None,
        }),
    }
}

fn parse_usage(value: &Value) -> AgentEvent {
    let usage = value.get("usage").unwrap_or(&Value::Null);
    AgentEvent::Usage {
        input_tokens: u64_field(usage, &["input_tokens"]).unwrap_or(0),
        cached_input_tokens: u64_field(usage, &["cached_input_tokens"])
            .or_else(|| {
                usage
                    .get("input_token_details")
                    .and_then(|details| u64_field(details, &["cached_tokens"]))
            })
            .unwrap_or(0),
        output_tokens: u64_field(usage, &["output_tokens"]).unwrap_or(0),
        cost_usd: None,
        context_used: None,
        context_window: None,
    }
}

fn read_loop<F>(
    stdout: impl Read,
    state: Arc<CodexTurnState>,
    sink: Arc<F>,
    remote_host: Option<String>,
)
where
    F: Fn(AgentEvent) + Send + Sync + 'static,
{
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut reader_failed = false;
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => {
                reader_failed = true;
                break;
            }
        }
        let parsed = parse_codex_exec_line_parts(&line);
        if let Some(event) = parsed.event {
            if !dispatch_event(&sink, &state.terminal_sent, event) {
                reader_failed = true;
                break;
            }
        }
        if parsed.turn_completed
            && !dispatch_terminal(
                &sink,
                &state.terminal_sent,
                AgentEvent::TurnDone {
                    status: TurnStatus::Completed,
                },
            )
        {
            reader_failed = true;
            break;
        }
    }

    if reader_failed {
        stop_state_lease(&state);
        signal_state_child(&state);
    }

    let status = wait_state_child(&state);
    finish_state_lease(&state);
    if state.terminal_sent.load(Ordering::SeqCst) {
        return;
    }

    if state.killed.load(Ordering::SeqCst) {
        let _ = dispatch_terminal(
            &sink,
            &state.terminal_sent,
            AgentEvent::TurnFailed {
                error: "interrupted".to_string(),
            },
        );
    } else if status.as_ref().is_some_and(|status| !status.success()) {
        let code = status
            .and_then(|status| status.code())
            .map(|code| code.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let _ = dispatch_terminal(
            &sink,
            &state.terminal_sent,
            AgentEvent::TurnFailed {
                error: if code == "255" {
                    remote_host
                        .as_deref()
                        .map(remote_ssh_exit_error)
                        .unwrap_or_else(|| format!("codex exec exited with status {code}"))
                } else {
                    format!("codex exec exited with status {code}")
                },
            },
        );
    }
}

fn dispatch_event<F>(sink: &Arc<F>, terminal_sent: &AtomicBool, event: AgentEvent) -> bool
where
    F: Fn(AgentEvent) + Send + Sync + 'static,
{
    match event {
        AgentEvent::Noise { .. } => emit_event(sink, event),
        AgentEvent::TurnFailed { .. } => dispatch_terminal(sink, terminal_sent, event),
        _ if terminal_sent.load(Ordering::SeqCst) => true,
        _ => emit_event(sink, event),
    }
}

fn dispatch_terminal<F>(sink: &Arc<F>, terminal_sent: &AtomicBool, event: AgentEvent) -> bool
where
    F: Fn(AgentEvent) + Send + Sync + 'static,
{
    if terminal_sent.swap(true, Ordering::SeqCst) {
        return true;
    }
    emit_event(sink, event)
}

fn emit_event<F>(sink: &Arc<F>, event: AgentEvent) -> bool
where
    F: Fn(AgentEvent) + Send + Sync + 'static,
{
    std::panic::catch_unwind(AssertUnwindSafe(|| (sink.as_ref())(event))).is_ok()
}

fn drain(mut stderr: impl Read, state: Arc<CodexTurnState>) {
    let mut buffer = [0u8; 8192];
    loop {
        match stderr.read(&mut buffer) {
            Ok(0) => break,
            Ok(_) => {}
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => {
                state.killed.store(true, Ordering::SeqCst);
                stop_state_lease(&state);
                signal_state_child(&state);
                break;
            }
        }
    }
}

fn wait_state_child(state: &Arc<CodexTurnState>) -> Option<ExitStatus> {
    let mut child = state.child.lock().ok()?.take()?;
    child.wait().ok()
}

fn signal_state_child(state: &Arc<CodexTurnState>) {
    if let Ok(mut child) = state.child.lock() {
        if let Some(child) = child.as_mut() {
            signal_child(child);
        }
    }
}

fn stop_state_lease(state: &Arc<CodexTurnState>) {
    if let Ok(mut lease) = state.lease.lock() {
        if let Some(lease) = lease.take() {
            lease.stop();
        }
    }
}

fn stop_state_lease_bounded(state: &Arc<CodexTurnState>) {
    if let Ok(mut lease) = state.lease.lock() {
        if let Some(lease) = lease.take() {
            lease.stop_bounded();
        }
    }
}

fn finish_state_lease(state: &Arc<CodexTurnState>) {
    if let Ok(mut lease) = state.lease.lock() {
        if let Some(lease) = lease.take() {
            lease.finish_natural();
        }
    }
}

fn kill_state_child(state: &Arc<CodexTurnState>) {
    stop_state_lease(state);
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

fn item_id(item: &Value) -> Option<String> {
    string_field(item, &["id"])
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

fn reasoning_text(item: &Value) -> String {
    string_field(item, &["text"])
        .or_else(|| item.get("summary").and_then(value_text))
        .unwrap_or_default()
}

fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Array(values) => {
            let parts = values.iter().filter_map(value_text).collect::<Vec<_>>();
            (!parts.is_empty()).then(|| parts.join("\n"))
        }
        Value::Object(_) => string_field(value, &["text", "content", "message"]),
        _ => scalar_string(value),
    }
}

fn command_status(status: Option<&str>) -> CommandStatus {
    match status {
        Some(status) if status.eq_ignore_ascii_case("completed") => CommandStatus::Completed,
        _ => CommandStatus::Failed,
    }
}

fn tool_status(status: Option<&str>) -> ToolCallStatus {
    match status {
        Some(status)
            if status.eq_ignore_ascii_case("failed") || status.eq_ignore_ascii_case("error") =>
        {
            ToolCallStatus::Failed
        }
        _ => ToolCallStatus::Completed,
    }
}

fn file_changes(item: &Value) -> Vec<FileChangeEntry> {
    let mut changes = Vec::new();
    for key in ["changes", "files"] {
        if let Some(value) = item.get(key) {
            collect_file_changes(value, &mut changes);
        }
    }
    if changes.is_empty() {
        if let Some(path) = string_field(item, &["path", "file", "file_path", "new_path"]) {
            changes.push(FileChangeEntry {
                path,
                kind: file_change_kind(
                    string_field(item, &["kind", "change_type", "status"]).as_deref(),
                ),
                diff: None,
            });
        }
    }
    if changes.is_empty() {
        if let Some(paths) = item.get("paths").and_then(Value::as_array) {
            for path in paths.iter().filter_map(scalar_string) {
                changes.push(FileChangeEntry {
                    path,
                    kind: FileChangeKind::Modify,
                    diff: None,
                });
            }
        }
    }
    changes
}

fn collect_file_changes(value: &Value, changes: &mut Vec<FileChangeEntry>) {
    match value {
        Value::Array(values) => {
            for value in values {
                collect_file_changes(value, changes);
            }
        }
        Value::Object(map) => {
            if let Some(path) = string_field(
                value,
                &["path", "file", "file_path", "new_path", "old_path"],
            ) {
                changes.push(FileChangeEntry {
                    path,
                    kind: file_change_kind(
                        string_field(value, &["kind", "change", "change_type", "type", "status"])
                            .as_deref(),
                    ),
                    diff: None,
                });
            } else {
                let mut entries = Vec::new();
                for (path, kind) in map {
                    let Some(kind) = kind.as_str().and_then(|kind| parse_file_change_kind(kind))
                    else {
                        return;
                    };
                    entries.push(FileChangeEntry {
                        path: path.clone(),
                        kind,
                        diff: None,
                    });
                }
                changes.extend(entries);
            }
        }
        Value::String(path) => changes.push(FileChangeEntry {
            path: path.clone(),
            kind: FileChangeKind::Modify,
            diff: None,
        }),
        _ => {}
    }
}

fn file_change_kind(kind: Option<&str>) -> FileChangeKind {
    kind.and_then(parse_file_change_kind)
        .unwrap_or(FileChangeKind::Modify)
}

fn parse_file_change_kind(kind: &str) -> Option<FileChangeKind> {
    if kind.eq_ignore_ascii_case("add") || kind.eq_ignore_ascii_case("added") {
        Some(FileChangeKind::Add)
    } else if kind.eq_ignore_ascii_case("delete")
        || kind.eq_ignore_ascii_case("deleted")
        || kind.eq_ignore_ascii_case("remove")
        || kind.eq_ignore_ascii_case("removed")
    {
        Some(FileChangeKind::Delete)
    } else if kind.eq_ignore_ascii_case("rename") || kind.eq_ignore_ascii_case("renamed") {
        Some(FileChangeKind::Rename)
    } else if kind.eq_ignore_ascii_case("update")
        || kind.eq_ignore_ascii_case("updated")
        || kind.eq_ignore_ascii_case("modify")
        || kind.eq_ignore_ascii_case("modified")
    {
        Some(FileChangeKind::Modify)
    } else {
        None
    }
}

fn plan_items(item: &Value) -> Vec<PlanItem> {
    let list = item
        .get("items")
        .or_else(|| item.get("todos"))
        .and_then(Value::as_array);
    let Some(list) = list else {
        return string_field(item, &["text"])
            .map(|text| {
                vec![PlanItem {
                    text,
                    completed: false,
                }]
            })
            .unwrap_or_default();
    };
    list.iter().filter_map(plan_item).collect()
}

fn plan_item(value: &Value) -> Option<PlanItem> {
    match value {
        Value::String(text) => Some(PlanItem {
            text: text.clone(),
            completed: false,
        }),
        Value::Object(_) => {
            let text = string_field(value, &["text", "content", "title", "description"])?;
            let completed = value
                .get("completed")
                .and_then(Value::as_bool)
                .unwrap_or_else(|| {
                    string_field(value, &["status"])
                        .map(|status| {
                            status.eq_ignore_ascii_case("completed")
                                || status.eq_ignore_ascii_case("done")
                        })
                        .unwrap_or(false)
                });
            Some(PlanItem { text, completed })
        }
        _ => None,
    }
}

fn best_error_message(value: &Value) -> String {
    string_field(value, &["message", "reason", "detail"])
        .or_else(|| {
            value.get("error").and_then(|error| {
                string_field(error, &["message", "reason", "detail"]).or_else(|| value_text(error))
            })
        })
        .unwrap_or_else(|| "codex exec failed".to_string())
}

fn last_chars(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars().rev().take(max_chars).collect::<Vec<_>>();
    chars.reverse();
    chars.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    #[cfg(unix)]
    struct TempScript {
        dir: PathBuf,
        path: PathBuf,
    }

    #[cfg(unix)]
    impl Drop for TempScript {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[cfg(unix)]
    fn write_script(name: &str, body: &str) -> TempScript {
        use std::os::unix::fs::PermissionsExt;

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "pickforge-codex-exec-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("create temp script dir");
        let path = dir.join("fake-codex");
        std::fs::write(&path, body).expect("write temp script");
        let mut permissions = std::fs::metadata(&path)
            .expect("read temp script metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&path, permissions).expect("chmod temp script");
        TempScript { dir, path }
    }

    #[cfg(unix)]
    fn spawn_script_turn(
        script: &TempScript,
        events: Arc<Mutex<Vec<AgentEvent>>>,
    ) -> CodexExecTurn {
        for attempt in 0..10 {
            let sink_events = Arc::clone(&events);
            match spawn_codex_turn(
                CodexTurnOptions {
                    prompt: "prompt".to_string(),
                    cwd: script.dir.clone(),
                    model: None,
                    effort: None,
                    sandbox: None,
                    approval_policy: None,
                    resume_thread_id: None,
                    binary: Some(script.path.to_string_lossy().to_string()),
                    remote: None,
                },
                move |event| sink_events.lock().expect("events lock").push(event),
            ) {
                Ok(turn) => return turn,
                Err(error) if is_text_file_busy(&error) && attempt < 9 => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("spawn codex turn: {error:?}"),
            }
        }
        unreachable!("retry loop returns or panics")
    }

    #[cfg(unix)]
    fn is_text_file_busy(error: &AgentSpawnError) -> bool {
        matches!(
            error,
            AgentSpawnError::Io(source) if source.raw_os_error() == Some(libc::ETXTBSY)
        )
    }

    #[cfg(unix)]
    fn wait_for_events(
        events: &Arc<Mutex<Vec<AgentEvent>>>,
        predicate: impl Fn(&[AgentEvent]) -> bool,
    ) -> Vec<AgentEvent> {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let snapshot = events.lock().expect("events lock").clone();
            if predicate(&snapshot) {
                return snapshot;
            }
            if Instant::now() >= deadline {
                panic!("timed out waiting for events: {snapshot:?}");
            }
            std::thread::sleep(Duration::from_millis(10));
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

    fn fixture_events(name: &str) -> Vec<AgentEvent> {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures/agents/codex-exec")
            .join(name);
        std::fs::read_to_string(path)
            .expect("read fixture")
            .lines()
            .filter_map(parse_codex_exec_line)
            .collect()
    }

    #[test]
    fn remote_turn_uses_one_quoted_ssh_command() {
        let options = CodexTurnOptions {
            prompt: "say it's $HOME".to_string(),
            cwd: PathBuf::from("/local/project"),
            model: Some("gpt remote".to_string()),
            effort: Some("high".to_string()),
            sandbox: Some("read-only".to_string()),
            approval_policy: Some("on-request".to_string()),
            resume_thread_id: Some("thread'one".to_string()),
            binary: Some("codex".to_string()),
            remote: Some(RemoteExec::new("mac-mini", "/srv/it's $app").unwrap()),
        };

        let command = turn_command(&options).unwrap();

        assert_eq!(command.program, "ssh");
        assert_eq!(command.cwd, None);
        assert_eq!(command.remote_host.as_deref(), Some("mac-mini"));
        assert_eq!(
            command.args.last().unwrap(),
            "cd '/srv/it'\\''s $app' && exec \"$SHELL\" -lc ''\\''codex'\\'' '\\''exec'\\'' '\\''--json'\\'' '\\''--skip-git-repo-check'\\'' '\\''-c'\\'' '\\''sandbox_mode=\"read-only\"'\\'' '\\''-c'\\'' '\\''approval_policy=\"on-request\"'\\'' '\\''-c'\\'' '\\''model_reasoning_effort=\"high\"'\\'' '\\''-m'\\'' '\\''gpt remote'\\'' '\\''resume'\\'' '\\''thread'\\''\\'\\'''\\''one'\\'' '\\''say it'\\''\\'\\'''\\''s $HOME'\\'''"
        );
    }

    #[test]
    fn parses_hi_fixture() {
        let events = fixture_events("codex-exec-hi.jsonl");
        assert_eq!(
            events,
            vec![
                AgentEvent::SessionStarted {
                    provider_session_id: "019f2237-c21f-7482-a517-7acbf5e2d6cf".to_string(),
                },
                AgentEvent::TurnStarted,
                AgentEvent::TextFinal {
                    item_id: Some("item_0".to_string()),
                    text: "hello from codex".to_string(),
                },
                AgentEvent::Usage {
                    input_tokens: 12049,
                    cached_input_tokens: 4736,
                    output_tokens: 32,
                    cost_usd: None,
                    context_used: None,
                    context_window: None,
                },
            ]
        );
    }

    #[test]
    fn parses_command_fixture() {
        let events = fixture_events("codex-exec-command.jsonl");
        assert_eq!(events.len(), 7);
        assert!(matches!(events[0], AgentEvent::SessionStarted { .. }));
        assert_eq!(events[1], AgentEvent::TurnStarted);
        assert!(matches!(events[2], AgentEvent::TextFinal { .. }));
        match &events[3] {
            AgentEvent::CommandStarted { command, .. } => {
                assert!(command.contains("pickforge-fixture"));
            }
            event => panic!("expected CommandStarted, got {event:?}"),
        }
        match &events[4] {
            AgentEvent::CommandDone {
                exit_code, status, ..
            } => {
                assert_eq!(*exit_code, Some(0));
                assert_eq!(*status, CommandStatus::Completed);
            }
            event => panic!("expected CommandDone, got {event:?}"),
        }
        assert!(matches!(events[5], AgentEvent::TextFinal { .. }));
        assert!(matches!(events[6], AgentEvent::Usage { .. }));
    }

    #[test]
    fn parses_resume_fixture_text() {
        let events = fixture_events("codex-exec-resume.jsonl");
        assert!(events.iter().any(|event| {
            matches!(
                event,
                AgentEvent::TextFinal { text, .. } if text == "hello from codex"
            )
        }));
    }

    #[test]
    fn ignores_unknown_top_level_json() {
        assert_eq!(parse_codex_exec_line(r#"{"type":"something.new"}"#), None);
    }

    #[test]
    fn parses_garbage_as_noise() {
        assert_eq!(
            parse_codex_exec_line("not json"),
            Some(AgentEvent::Noise {
                line: "not json".to_string(),
            })
        );
    }

    #[test]
    fn ignores_empty_lines() {
        assert_eq!(parse_codex_exec_line(" \t "), None);
    }

    #[test]
    fn parses_turn_failed() {
        assert_eq!(
            parse_codex_exec_line(r#"{"type":"turn.failed","message":"boom"}"#),
            Some(AgentEvent::TurnFailed {
                error: "boom".to_string(),
            })
        );
    }

    #[test]
    fn skips_empty_reasoning_final() {
        assert_eq!(
            parse_codex_exec_line(
                r#"{"type":"item.completed","item":{"id":"think-1","type":"reasoning","text":"   "}}"#
            ),
            None
        );
    }

    #[test]
    fn file_change_map_ignores_non_change_kind_values() {
        assert_eq!(
            parse_codex_exec_line(
                r#"{"type":"item.completed","item":{"id":"files","type":"file_change","changes":{"status":"completed"}}}"#
            ),
            Some(AgentEvent::FileChange {
                item_id: "files".to_string(),
                changes: Vec::new(),
            })
        );
    }

    #[cfg(unix)]
    #[test]
    fn kill_after_terminal_stops_remaining_lease_once() {
        let script = write_script(
            "clean",
            r#"#!/bin/sh
printf '%s\n' \
'{"type":"thread.started","thread_id":"thread-1"}' \
'{"type":"turn.started"}' \
'{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"hello"}}' \
'{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":2}}'
sleep 5
"#,
        );
        let events = Arc::new(Mutex::new(Vec::new()));
        let turn = spawn_script_turn(&script, Arc::clone(&events));
        let snapshot = wait_for_events(&events, |events| terminal_event_count(events) == 1);
        assert!(turn.state.terminal_sent.load(Ordering::SeqCst));
        let Ok(mut lease) = turn.state.lease.lock() else {
            panic!("turn lease lock poisoned");
        };
        *lease = Some(crate::remote::RemoteLeaseHandle::new(
            crate::remote::SshTarget::new("127.0.0.1").unwrap(),
            Vec::new(),
        ));
        drop(lease);

        assert_eq!(
            snapshot,
            vec![
                AgentEvent::SessionStarted {
                    provider_session_id: "thread-1".to_string(),
                },
                AgentEvent::TurnStarted,
                AgentEvent::TextFinal {
                    item_id: Some("item_1".to_string()),
                    text: "hello".to_string(),
                },
                AgentEvent::Usage {
                    input_tokens: 1,
                    cached_input_tokens: 0,
                    output_tokens: 2,
                    cost_usd: None,
                    context_used: None,
                    context_window: None,
                },
                AgentEvent::TurnDone {
                    status: TurnStatus::Completed,
                },
            ]
        );
        assert_eq!(terminal_event_count(&snapshot), 1);
        let started = std::time::Instant::now();
        turn.kill().unwrap();
        assert!(turn.state.lease.lock().is_ok_and(|lease| lease.is_none()));
        drop(turn);
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
    }

    #[cfg(unix)]
    #[test]
    fn runner_emits_one_failure_for_nonzero_exit_without_turn_completion() {
        let script = write_script(
            "exit3",
            r#"#!/bin/sh
printf '%s\n' '{"type":"turn.started"}'
exit 3
"#,
        );
        let events = Arc::new(Mutex::new(Vec::new()));
        let _turn = spawn_script_turn(&script, Arc::clone(&events));
        let snapshot = wait_for_events(&events, |events| terminal_event_count(events) == 1);

        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot[0], AgentEvent::TurnStarted);
        match &snapshot[1] {
            AgentEvent::TurnFailed { error } => assert!(error.contains('3')),
            event => panic!("expected TurnFailed, got {event:?}"),
        }
        assert_eq!(terminal_event_count(&snapshot), 1);
    }

    #[cfg(unix)]
    #[test]
    fn runner_kill_emits_one_interrupted_failure() {
        let script = write_script(
            "kill",
            r#"#!/bin/sh
printf '%s\n' '{"type":"turn.started"}'
sleep 5
"#,
        );
        let events = Arc::new(Mutex::new(Vec::new()));
        let turn = spawn_script_turn(&script, Arc::clone(&events));
        let snapshot = wait_for_events(&events, |events| {
            events.iter().any(|event| *event == AgentEvent::TurnStarted)
        });
        assert_eq!(snapshot, vec![AgentEvent::TurnStarted]);

        turn.kill().expect("kill codex turn");
        let snapshot = wait_for_events(&events, |events| terminal_event_count(events) == 1);

        assert_eq!(terminal_event_count(&snapshot), 1);
        assert!(matches!(
            snapshot.last(),
            Some(AgentEvent::TurnFailed { error }) if error == "interrupted"
        ));
    }
}
