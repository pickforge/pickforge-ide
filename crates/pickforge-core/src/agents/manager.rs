use std::collections::HashMap;
use std::mem::ManuallyDrop;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::db::{AgentSessionRow, Database, DbError};

use super::claude_stream::{spawn_claude_turn, ClaudeStreamTurn, ClaudeTurnOptions};
use super::codex_exec::{spawn_codex_turn, CodexExecTurn, CodexTurnOptions};
use super::event::AgentEvent;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentProvider {
    ClaudeCode,
    Codex,
}

impl AgentProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claudeCode",
            Self::Codex => "codex",
        }
    }
}

impl FromStr for AgentProvider {
    type Err = AgentChatError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "claudeCode" => Ok(Self::ClaudeCode),
            "codex" => Ok(Self::Codex),
            _ => Err(AgentChatError::BadProvider),
        }
    }
}

#[derive(Clone)]
pub struct AgentChatManager {
    db: Arc<Database>,
    inner: Arc<Mutex<HashMap<String, SessionState>>>,
    #[cfg(test)]
    test_binaries: TestBinaries,
}

struct SessionState {
    chat_id: String,
    project_root: PathBuf,
    provider: AgentProvider,
    model: Option<String>,
    provider_session_id: Option<String>,
    sink: Arc<dyn Fn(AgentEvent) + Send + Sync>,
    active_turn: Option<ActiveTurn>,
}

#[derive(Clone)]
struct ActiveTurn {
    inner: Arc<Mutex<Option<ActiveTurnHandle>>>,
}

enum ActiveTurnHandle {
    Codex(CodexExecTurn),
    Claude(ClaudeStreamTurn),
}

#[derive(Debug, thiserror::Error)]
pub enum AgentChatError {
    #[error("unknown agent session: {0}")]
    UnknownSession(String),
    #[error("agent turn already active")]
    TurnActive,
    #[error(transparent)]
    Db(#[from] DbError),
    #[error("failed to spawn agent turn: {0}")]
    Spawn(String),
    #[error("unknown agent provider")]
    BadProvider,
}

impl AgentChatManager {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            inner: Arc::new(Mutex::new(HashMap::new())),
            #[cfg(test)]
            test_binaries: TestBinaries::default(),
        }
    }

    pub fn start(
        &self,
        chat_id: &str,
        project_root: PathBuf,
        provider: AgentProvider,
        model: Option<String>,
        sink: Arc<dyn Fn(AgentEvent) + Send + Sync>,
    ) -> Result<String, AgentChatError> {
        let mut inner = self.lock_inner()?;
        let latest = self.db.latest_agent_session_for_chat(chat_id)?;
        let (session_id, provider_session_id) =
            match latest.filter(|row| row.provider == provider.as_str()) {
                Some(row) => {
                    if row.model != model {
                        self.db.agent_session_set_model(&row.id, model.as_deref())?;
                    }
                    (row.id, row.provider_session_id)
                }
                None => {
                    let now = now_millis();
                    let session_id = next_session_id(now);
                    self.db.agent_session_create(&AgentSessionRow {
                        id: session_id.clone(),
                        chat_id: chat_id.to_string(),
                        provider: provider.as_str().to_string(),
                        provider_session_id: None,
                        model: model.clone(),
                        status: "idle".to_string(),
                        created_at: now,
                    })?;
                    (session_id, None)
                }
            };

        if let Some(state) = inner.get_mut(&session_id) {
            state.chat_id = chat_id.to_string();
            state.project_root = project_root;
            state.provider = provider;
            state.model = model;
            state.provider_session_id = provider_session_id;
            state.sink = sink;
        } else {
            inner.insert(
                session_id.clone(),
                SessionState {
                    chat_id: chat_id.to_string(),
                    project_root,
                    provider,
                    model,
                    provider_session_id,
                    sink,
                    active_turn: None,
                },
            );
        }

        Ok(session_id)
    }

    pub fn send(&self, session_id: &str, text: &str) -> Result<(), AgentChatError> {
        let mut inner = self.lock_inner()?;
        let state = inner
            .get_mut(session_id)
            .ok_or_else(|| AgentChatError::UnknownSession(session_id.to_string()))?;
        if state.active_turn.is_some() {
            return Err(AgentChatError::TurnActive);
        }

        let chat_id = state.chat_id.clone();
        let project_root = state.project_root.clone();
        let provider = state.provider;
        let model = state.model.clone();
        let provider_session_id = state.provider_session_id.clone();
        let session_id_owned = session_id.to_string();

        self.db
            .agent_message_append(session_id, &chat_id, "user", text)?;
        self.db.agent_session_set_status(session_id, "running")?;

        let db = Arc::clone(&self.db);
        let sink_inner = Arc::clone(&self.inner);
        let sink_session_id = session_id_owned.clone();
        let sink_chat_id = chat_id.clone();
        let wrapped_sink = move |event| {
            handle_runner_event(&db, &sink_inner, &sink_session_id, &sink_chat_id, event);
        };

        let turn = match provider {
            AgentProvider::Codex => spawn_codex_turn(
                CodexTurnOptions {
                    prompt: text.to_string(),
                    cwd: project_root,
                    model,
                    effort: None,
                    resume_thread_id: provider_session_id,
                    binary: self.codex_binary(),
                },
                wrapped_sink,
            )
            .map(ActiveTurnHandle::Codex)
            .map_err(|err| AgentChatError::Spawn(err.to_string())),
            AgentProvider::ClaudeCode => spawn_claude_turn(
                ClaudeTurnOptions {
                    prompt: text.to_string(),
                    cwd: project_root,
                    model,
                    resume_session_id: provider_session_id,
                    permission_mode: None,
                    allowed_tools: None,
                    binary: self.claude_binary(),
                },
                wrapped_sink,
            )
            .map(ActiveTurnHandle::Claude)
            .map_err(|err| AgentChatError::Spawn(err.to_string())),
        };

        match turn {
            Ok(turn) => {
                state.active_turn = Some(ActiveTurn::new(turn));
                Ok(())
            }
            Err(err) => {
                let _ = self.db.agent_session_set_status(session_id, "failed");
                Err(err)
            }
        }
    }

    pub fn interrupt(&self, session_id: &str) -> Result<(), AgentChatError> {
        let active_turn = {
            let inner = self.lock_inner()?;
            let state = inner
                .get(session_id)
                .ok_or_else(|| AgentChatError::UnknownSession(session_id.to_string()))?;
            state.active_turn.clone()
        };

        if let Some(turn) = active_turn {
            turn.kill()?;
        }
        Ok(())
    }

    fn lock_inner(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, SessionState>>, AgentChatError> {
        self.inner
            .lock()
            .map_err(|_| AgentChatError::Spawn("agent chat manager lock poisoned".to_string()))
    }

    #[cfg(test)]
    fn with_test_binaries(
        db: Arc<Database>,
        codex_binary: Option<String>,
        claude_binary: Option<String>,
    ) -> Self {
        Self {
            db,
            inner: Arc::new(Mutex::new(HashMap::new())),
            test_binaries: TestBinaries {
                codex: codex_binary,
                claude: claude_binary,
            },
        }
    }

    #[cfg(test)]
    fn codex_binary(&self) -> Option<String> {
        self.test_binaries.codex.clone()
    }

    #[cfg(not(test))]
    fn codex_binary(&self) -> Option<String> {
        None
    }

    #[cfg(test)]
    fn claude_binary(&self) -> Option<String> {
        self.test_binaries.claude.clone()
    }

    #[cfg(not(test))]
    fn claude_binary(&self) -> Option<String> {
        None
    }
}

impl ActiveTurn {
    fn new(handle: ActiveTurnHandle) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Some(handle))),
        }
    }

    fn kill(&self) -> Result<(), AgentChatError> {
        let handle = self
            .inner
            .lock()
            .map_err(|_| AgentChatError::Spawn("agent turn lock poisoned".to_string()))?;
        match handle.as_ref() {
            Some(ActiveTurnHandle::Codex(turn)) => turn
                .kill()
                .map_err(|err| AgentChatError::Spawn(err.to_string())),
            Some(ActiveTurnHandle::Claude(turn)) => turn
                .kill()
                .map_err(|err| AgentChatError::Spawn(err.to_string())),
            None => Ok(()),
        }
    }

    fn reap(&self) {
        let handle = self.inner.lock().ok().and_then(|mut handle| handle.take());
        if let Some(handle) = handle {
            let handle = ManuallyDrop::new(handle);
            let _ = std::thread::Builder::new()
                .name("agent-turn-reaper".to_string())
                .spawn(move || drop(ManuallyDrop::into_inner(handle)));
        }
    }
}

fn handle_runner_event(
    db: &Database,
    inner: &Arc<Mutex<HashMap<String, SessionState>>>,
    session_id: &str,
    chat_id: &str,
    event: AgentEvent,
) {
    let mut errors = Vec::new();
    let mut active_turn = None;

    match &event {
        AgentEvent::SessionStarted {
            provider_session_id,
        } => {
            if let Err(err) =
                db.agent_session_set_provider_session_id(session_id, provider_session_id)
            {
                errors.push(err.to_string());
            }
            if let Ok(mut states) = inner.lock() {
                if let Some(state) = states.get_mut(session_id) {
                    state.provider_session_id = Some(provider_session_id.clone());
                }
            }
        }
        AgentEvent::TextFinal { text, .. } => {
            if let Err(err) = db.agent_message_append(session_id, chat_id, "assistant", text) {
                errors.push(err.to_string());
            }
        }
        AgentEvent::ThinkingFinal { .. }
        | AgentEvent::CommandStarted { .. }
        | AgentEvent::CommandDone { .. }
        | AgentEvent::FileChange { .. }
        | AgentEvent::McpToolCall { .. }
        | AgentEvent::ToolUse { .. }
        | AgentEvent::WebSearch { .. }
        | AgentEvent::PlanUpdate { .. }
        | AgentEvent::Usage { .. }
        | AgentEvent::RateLimits { .. } => {
            if let Err(err) = append_item(db, session_id, chat_id, &event) {
                errors.push(err);
            }
        }
        AgentEvent::TurnDone { .. } => {
            if let Err(err) = db.agent_session_set_status(session_id, "idle") {
                errors.push(err.to_string());
            }
            active_turn = clear_active_turn(inner, session_id);
        }
        AgentEvent::TurnFailed { .. } => {
            if let Err(err) = append_item(db, session_id, chat_id, &event) {
                errors.push(err);
            }
            if let Err(err) = db.agent_session_set_status(session_id, "failed") {
                errors.push(err.to_string());
            }
            active_turn = clear_active_turn(inner, session_id);
        }
        AgentEvent::TextDelta { .. }
        | AgentEvent::ThinkingDelta { .. }
        | AgentEvent::CommandOutput { .. }
        | AgentEvent::TurnStarted
        | AgentEvent::Noise { .. }
        | AgentEvent::ApprovalRequest { .. } => {}
    }

    if let Some(turn) = active_turn {
        turn.reap();
    }

    if let Some(sink) = sink_for_session(inner, session_id) {
        for error in errors {
            sink(AgentEvent::Noise { line: error });
        }
        sink(event);
    }
}

fn append_item(
    db: &Database,
    session_id: &str,
    chat_id: &str,
    event: &AgentEvent,
) -> Result<(), String> {
    let value = serde_json::to_value(event).map_err(|err| err.to_string())?;
    let kind = value
        .get("kind")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "agent event serialized without kind".to_string())?;
    let payload = value.to_string();
    db.agent_item_append(session_id, chat_id, kind, &payload)
        .map(|_| ())
        .map_err(|err| err.to_string())
}

fn clear_active_turn(
    inner: &Arc<Mutex<HashMap<String, SessionState>>>,
    session_id: &str,
) -> Option<ActiveTurn> {
    inner.lock().ok().and_then(|mut states| {
        states
            .get_mut(session_id)
            .and_then(|state| state.active_turn.take())
    })
}

fn sink_for_session(
    inner: &Arc<Mutex<HashMap<String, SessionState>>>,
    session_id: &str,
) -> Option<Arc<dyn Fn(AgentEvent) + Send + Sync>> {
    inner
        .lock()
        .ok()
        .and_then(|states| states.get(session_id).map(|state| Arc::clone(&state.sink)))
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn next_session_id(now: i64) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let suffix = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("asess-{now}-{suffix}")
}

#[cfg(test)]
#[derive(Clone, Default)]
struct TestBinaries {
    codex: Option<String>,
    claude: Option<String>,
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use crate::agents::event::TurnStatus;
    use crate::db::AgentTimelineEntry;

    use super::*;

    #[cfg(unix)]
    struct TestScript {
        dir: PathBuf,
        path: PathBuf,
    }

    #[cfg(unix)]
    impl Drop for TestScript {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[cfg(unix)]
    fn test_script(name: &str, body: &str) -> TestScript {
        use std::os::unix::fs::PermissionsExt;

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "pickforge-agent-manager-{name}-{}-{stamp}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fake-agent");
        std::fs::write(&path, body).unwrap();
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&path, permissions).unwrap();
        TestScript { dir, path }
    }

    #[cfg(unix)]
    fn codex_manager(db: Arc<Database>, script: &TestScript) -> AgentChatManager {
        AgentChatManager::with_test_binaries(
            db,
            Some(script.path.to_string_lossy().to_string()),
            None,
        )
    }

    #[cfg(unix)]
    fn claude_manager(db: Arc<Database>, script: &TestScript) -> AgentChatManager {
        AgentChatManager::with_test_binaries(
            db,
            None,
            Some(script.path.to_string_lossy().to_string()),
        )
    }

    #[cfg(unix)]
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
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[cfg(unix)]
    fn wait_for_status(db: &Database, chat_id: &str, status: &str) -> AgentSessionRow {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let row = db
                .latest_agent_session_for_chat(chat_id)
                .unwrap()
                .expect("agent session");
            if row.status == status {
                return row;
            }
            if Instant::now() >= deadline {
                panic!("timed out waiting for status {status}: {row:?}");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn provider_parse_is_exact() {
        assert_eq!(
            "claudeCode".parse::<AgentProvider>().unwrap(),
            AgentProvider::ClaudeCode
        );
        assert_eq!(
            "codex".parse::<AgentProvider>().unwrap(),
            AgentProvider::Codex
        );
        assert!("claude".parse::<AgentProvider>().is_err());
        assert!("Codex".parse::<AgentProvider>().is_err());
    }

    #[test]
    fn session_ids_include_a_counter_suffix() {
        let first = next_session_id(42);
        let second = next_session_id(42);
        assert_ne!(first, second);
        assert!(first.starts_with("asess-42-"));
        assert!(second.starts_with("asess-42-"));
    }

    #[cfg(unix)]
    #[test]
    fn codex_turn_persists_session_messages_items_and_idle_status() {
        let script = test_script(
            "codex-clean",
            r#"#!/bin/sh
printf '%s\n' \
'{"type":"thread.started","thread_id":"thread-1"}' \
'{"type":"turn.started"}' \
'{"type":"item.completed","item":{"id":"think-1","type":"reasoning","text":"thought"}}' \
'{"type":"item.started","item":{"id":"cmd-1","type":"command_execution","command":"echo hi"}}' \
'{"type":"item.completed","item":{"id":"cmd-1","type":"command_execution","command":"echo hi","exit_code":0,"status":"completed","aggregated_output":"ok"}}' \
'{"type":"item.completed","item":{"id":"msg-1","type":"agent_message","text":"assistant hi"}}' \
'{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":2}}'
"#,
        );
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = codex_manager(Arc::clone(&db), &script);
        let (events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-1",
                script.dir.clone(),
                AgentProvider::Codex,
                Some("gpt-5".to_string()),
                sink,
            )
            .unwrap();

        manager.send(&session_id, "hello").unwrap();
        wait_for_events(&events, |events| {
            matches!(events.last(), Some(AgentEvent::TurnDone { .. }))
        });
        let row = wait_for_status(&db, "chat-1", "idle");

        assert_eq!(row.id, session_id);
        assert_eq!(row.provider_session_id.as_deref(), Some("thread-1"));

        let timeline = db.agent_timeline_for_chat("chat-1").unwrap();
        assert!(matches!(
            &timeline[0],
            AgentTimelineEntry::Message { role, content, .. }
                if role == "user" && content == "hello"
        ));
        assert!(timeline.iter().any(|entry| {
            matches!(entry, AgentTimelineEntry::Message { role, content, .. }
                if role == "assistant" && content == "assistant hi")
        }));
        assert!(timeline.iter().any(|entry| {
            matches!(entry, AgentTimelineEntry::Item { kind, payload, .. }
                if kind == "thinkingFinal" && payload.contains("thought"))
        }));
        assert!(timeline.iter().any(|entry| {
            matches!(entry, AgentTimelineEntry::Item { kind, payload, .. }
                if kind == "commandStarted" && payload.contains("echo hi"))
        }));
        assert!(timeline.iter().any(|entry| {
            matches!(entry, AgentTimelineEntry::Item { kind, .. } if kind == "commandDone")
        }));
        assert!(timeline.iter().any(|entry| {
            matches!(entry, AgentTimelineEntry::Item { kind, .. } if kind == "usage")
        }));
    }

    #[cfg(unix)]
    #[test]
    fn claude_turn_persists_session_and_assistant_message() {
        let script = test_script(
            "claude-clean",
            r#"#!/bin/sh
printf '%s\n' '{"type":"system","subtype":"init","session_id":"claude-session-1"}'
printf '%s\n' '{"type":"stream_event","event":{"type":"message_start"}}'
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"hello from claude"}]}}'
printf '%s\n' '{"type":"result","subtype":"success","usage":{"input_tokens":1,"cache_read_input_tokens":0,"output_tokens":2},"total_cost_usd":0.01}'
"#,
        );
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = claude_manager(Arc::clone(&db), &script);
        let (events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-claude",
                script.dir.clone(),
                AgentProvider::ClaudeCode,
                Some("sonnet".to_string()),
                sink,
            )
            .unwrap();

        manager.send(&session_id, "hello").unwrap();
        wait_for_events(&events, |events| {
            matches!(events.last(), Some(AgentEvent::TurnDone { .. }))
        });
        let row = wait_for_status(&db, "chat-claude", "idle");
        assert_eq!(row.provider_session_id.as_deref(), Some("claude-session-1"));

        let timeline = db.agent_timeline_for_chat("chat-claude").unwrap();
        assert!(timeline.iter().any(|entry| {
            matches!(entry, AgentTimelineEntry::Message { role, content, .. }
                if role == "assistant" && content == "hello from claude")
        }));
    }

    #[cfg(unix)]
    #[test]
    fn send_while_turn_is_active_returns_turn_active() {
        let script = test_script(
            "codex-active",
            r#"#!/bin/sh
printf '%s\n' '{"type":"thread.started","thread_id":"thread-active"}'
printf '%s\n' '{"type":"turn.started"}'
sleep 5
"#,
        );
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = codex_manager(Arc::clone(&db), &script);
        let (events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-active",
                script.dir.clone(),
                AgentProvider::Codex,
                None,
                sink,
            )
            .unwrap();

        manager.send(&session_id, "first").unwrap();
        wait_for_events(&events, |events| {
            events
                .iter()
                .any(|event| matches!(event, AgentEvent::TurnStarted))
        });

        assert!(matches!(
            manager.send(&session_id, "second"),
            Err(AgentChatError::TurnActive)
        ));
        manager.interrupt(&session_id).unwrap();
        wait_for_events(&events, |events| {
            matches!(events.last(), Some(AgentEvent::TurnFailed { .. }))
        });
    }

    #[cfg(unix)]
    #[test]
    fn interrupt_kills_active_turn_and_marks_failed() {
        let script = test_script(
            "codex-interrupt",
            r#"#!/bin/sh
printf '%s\n' '{"type":"thread.started","thread_id":"thread-interrupt"}'
printf '%s\n' '{"type":"turn.started"}'
exec sleep 5
"#,
        );
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = codex_manager(Arc::clone(&db), &script);
        let (events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-kill",
                script.dir.clone(),
                AgentProvider::Codex,
                None,
                sink,
            )
            .unwrap();

        manager.send(&session_id, "stop").unwrap();
        wait_for_events(&events, |events| {
            events
                .iter()
                .any(|event| matches!(event, AgentEvent::TurnStarted))
        });

        manager.interrupt(&session_id).unwrap();
        wait_for_events(
            &events,
            |events| matches!(events.last(), Some(AgentEvent::TurnFailed { error }) if error == "interrupted"),
        );
        let row = wait_for_status(&db, "chat-kill", "failed");
        assert_eq!(row.status, "failed");

        let timeline = db.agent_timeline_for_chat("chat-kill").unwrap();
        assert!(timeline.iter().any(|entry| {
            matches!(entry, AgentTimelineEntry::Item { kind, payload, .. }
                if kind == "turnFailed" && payload.contains("interrupted"))
        }));
    }

    #[cfg(unix)]
    #[test]
    fn restart_reuses_session_id_provider_session_id_and_updates_model() {
        let script = test_script(
            "codex-restart",
            r#"#!/bin/sh
printf '%s\n' \
'{"type":"thread.started","thread_id":"thread-reuse"}' \
'{"type":"turn.started"}' \
'{"type":"item.completed","item":{"id":"msg-1","type":"agent_message","text":"done"}}' \
'{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'
"#,
        );
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = codex_manager(Arc::clone(&db), &script);
        let (events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-restart",
                script.dir.clone(),
                AgentProvider::Codex,
                Some("gpt-5".to_string()),
                sink,
            )
            .unwrap();
        manager.send(&session_id, "first").unwrap();
        wait_for_events(&events, |events| {
            matches!(
                events.last(),
                Some(AgentEvent::TurnDone {
                    status: TurnStatus::Completed
                })
            )
        });
        wait_for_status(&db, "chat-restart", "idle");

        let restarted = AgentChatManager::new(Arc::clone(&db));
        let (_events2, sink2) = event_sink();
        let reused_id = restarted
            .start(
                "chat-restart",
                script.dir.clone(),
                AgentProvider::Codex,
                Some("gpt-5.1".to_string()),
                sink2,
            )
            .unwrap();

        assert_eq!(reused_id, session_id);
        let row = db
            .latest_agent_session_for_chat("chat-restart")
            .unwrap()
            .unwrap();
        assert_eq!(row.provider_session_id.as_deref(), Some("thread-reuse"));
        assert_eq!(row.model.as_deref(), Some("gpt-5.1"));
        {
            let state = restarted.inner.lock().unwrap();
            assert_eq!(
                state
                    .get(&reused_id)
                    .and_then(|state| state.provider_session_id.as_deref()),
                Some("thread-reuse"),
            );
        }

        let (_events3, sink3) = event_sink();
        let switched_id = restarted
            .start(
                "chat-restart",
                script.dir.clone(),
                AgentProvider::ClaudeCode,
                None,
                sink3,
            )
            .unwrap();

        assert_ne!(switched_id, session_id);
        let switched = db
            .latest_agent_session_for_chat("chat-restart")
            .unwrap()
            .unwrap();
        assert_eq!(switched.id, switched_id);
        assert_eq!(switched.provider, "claudeCode");
        assert_eq!(switched.provider_session_id, None);
        let state = restarted.inner.lock().unwrap();
        assert_eq!(
            state
                .get(&switched_id)
                .and_then(|state| state.provider_session_id.as_deref()),
            None,
        );
    }
}
