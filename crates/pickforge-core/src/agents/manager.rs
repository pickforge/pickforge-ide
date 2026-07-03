use std::collections::{HashMap, HashSet};
use std::mem::ManuallyDrop;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::db::{AgentSessionRow, Database, DbError};

use super::claude_bridge::{spawn as spawn_claude_bridge, ClaudeBridgeClient, ClaudeBridgeOptions};
use super::claude_stream::{spawn_claude_turn, ClaudeStreamTurn, ClaudeTurnOptions};
use super::codex_app::{spawn as spawn_codex_app, CodexAppClient, CodexAppOptions, RequestIdRepr};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    V1,
    V2,
}

impl Default for Engine {
    fn default() -> Self {
        Self::V2
    }
}

impl FromStr for Engine {
    type Err = AgentChatError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "v1" => Ok(Self::V1),
            "v2" => Ok(Self::V2),
            _ => Err(AgentChatError::BadEngine),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AgentStartOverrides {
    pub sandbox: Option<String>,
    pub approval_policy: Option<String>,
    pub permission_mode: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    /// Reasoning effort for the session. Claude bridge sessions apply it at
    /// start (the SDK fixes effort per query); Codex applies effort per turn
    /// via `send`, so this is ignored there.
    pub effort: Option<String>,
}

#[derive(Clone)]
pub struct AgentChatManager {
    db: Arc<Database>,
    app_root: PathBuf,
    inner: Arc<Mutex<HashMap<String, SessionState>>>,
    codex_app_clients: Arc<Mutex<HashMap<PathBuf, Arc<CodexAppClient>>>>,
    claude_bridge: Arc<Mutex<Option<Arc<ClaudeBridgeClient>>>>,
    starting_chats: Arc<Mutex<HashSet<String>>>,
    #[cfg(test)]
    test_binaries: TestBinaries,
}

struct SessionState {
    chat_id: String,
    project_root: PathBuf,
    provider: AgentProvider,
    engine: Engine,
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
    CodexApp {
        client: Arc<CodexAppClient>,
        thread_id: String,
        turn_id: Arc<Mutex<Option<String>>>,
        pending_interrupt: Arc<AtomicBool>,
    },
    ClaudeBridge {
        client: Arc<ClaudeBridgeClient>,
        chat_id: String,
    },
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
    #[error("unknown agent engine")]
    BadEngine,
    #[error("unsupported agent chat operation: {0}")]
    Unsupported(String),
}

impl AgentChatManager {
    pub fn new(db: Arc<Database>, app_root: PathBuf) -> Self {
        Self {
            db,
            app_root,
            inner: Arc::new(Mutex::new(HashMap::new())),
            codex_app_clients: Arc::new(Mutex::new(HashMap::new())),
            claude_bridge: Arc::new(Mutex::new(None)),
            starting_chats: Arc::new(Mutex::new(HashSet::new())),
            #[cfg(test)]
            test_binaries: TestBinaries::default(),
        }
    }

    pub fn start(
        &self,
        chat_id: &str,
        project_root: PathBuf,
        provider: AgentProvider,
        engine: Engine,
        model: Option<String>,
        overrides: AgentStartOverrides,
        sink: Arc<dyn Fn(AgentEvent) + Send + Sync>,
    ) -> Result<String, AgentChatError> {
        let _start_guard = self.acquire_start_guard(chat_id)?;
        let latest = self.db.latest_agent_session_for_chat(chat_id)?;
        let (session_id, mut provider_session_id) =
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

        let codex_app_client = if engine == Engine::V2 && provider == AgentProvider::Codex {
            let client = self.codex_app_client(project_root.clone())?;
            let sandbox = overrides
                .sandbox
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("workspace-write");
            let approval_policy = overrides
                .approval_policy
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("on-request");
            let thread = if let Some(thread_id) = non_empty(provider_session_id.clone()) {
                match client.thread_resume(&thread_id, project_root.clone()) {
                    Ok(thread) => thread,
                    Err(_) => client
                        .thread_start(
                            project_root.clone(),
                            model.clone(),
                            sandbox,
                            approval_policy,
                        )
                        .map_err(|err| AgentChatError::Spawn(err.to_string()))?,
                }
            } else {
                client
                    .thread_start(
                        project_root.clone(),
                        model.clone(),
                        sandbox,
                        approval_policy,
                    )
                    .map_err(|err| AgentChatError::Spawn(err.to_string()))?
            };
            self.db
                .agent_session_set_provider_session_id(&session_id, &thread.thread_id)?;
            provider_session_id = Some(thread.thread_id.clone());
            Some((client, thread.thread_id))
        } else {
            None
        };

        {
            let mut inner = self.lock_inner()?;
            upsert_session_state(
                &mut inner,
                session_id.clone(),
                SessionState {
                    chat_id: chat_id.to_string(),
                    project_root: project_root.clone(),
                    provider,
                    engine,
                    model: model.clone(),
                    provider_session_id: provider_session_id.clone(),
                    sink,
                    active_turn: None,
                },
            );
        }

        match (engine, provider) {
            (Engine::V2, AgentProvider::Codex) => {
                if let Some((client, thread_id)) = codex_app_client {
                    client
                        .subscribe(
                            &thread_id,
                            self.wrapping_sink(session_id.clone(), chat_id.to_string()),
                        )
                        .map_err(|err| AgentChatError::Spawn(err.to_string()))?;
                }
            }
            (Engine::V2, AgentProvider::ClaudeCode) => {
                let client = self.claude_bridge_client()?;
                client
                    .chat_start(
                        &session_id,
                        project_root,
                        model,
                        overrides.effort,
                        provider_session_id,
                        Some(
                            overrides
                                .permission_mode
                                .filter(|value| !value.trim().is_empty())
                                .unwrap_or_else(|| "default".to_string()),
                        ),
                        overrides.allowed_tools,
                        self.wrapping_sink(session_id.clone(), chat_id.to_string()),
                    )
                    .map_err(|err| AgentChatError::Spawn(err.to_string()))?;
            }
            (Engine::V1, _) => {}
        }

        self.unsubscribe_replaced_codex_threads(chat_id, &session_id);

        Ok(session_id)
    }

    pub fn send(
        &self,
        session_id: &str,
        text: &str,
        effort: Option<String>,
        model: Option<String>,
        images: Option<Vec<String>>,
    ) -> Result<(), AgentChatError> {
        let effort = non_empty(effort);
        let turn_model = non_empty(model);
        let images = images
            .unwrap_or_default()
            .into_iter()
            .filter(|path| !path.trim().is_empty())
            .collect::<Vec<_>>();
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
        let engine = state.engine;
        let session_model = state.model.clone();
        let codex_model = turn_model.clone().or_else(|| session_model.clone());
        let provider_session_id = state.provider_session_id.clone();
        let session_id_owned = session_id.to_string();

        self.db
            .agent_message_append(session_id, &chat_id, "user", text)?;
        self.db.agent_session_set_status(session_id, "running")?;

        if engine == Engine::V2 && provider == AgentProvider::Codex {
            let Some(thread_id) = non_empty(provider_session_id) else {
                let _ = self.db.agent_session_set_status(session_id, "failed");
                return Err(AgentChatError::Spawn(
                    "codex app-server session has no thread id".to_string(),
                ));
            };
            let client = match self.codex_app_client(project_root) {
                Ok(client) => client,
                Err(err) => {
                    let _ = self.db.agent_session_set_status(session_id, "failed");
                    return Err(err);
                }
            };
            let turn_id = Arc::new(Mutex::new(None));
            let pending_interrupt = Arc::new(AtomicBool::new(false));
            state.active_turn = Some(ActiveTurn::new(ActiveTurnHandle::CodexApp {
                client: Arc::clone(&client),
                thread_id: thread_id.clone(),
                turn_id: Arc::clone(&turn_id),
                pending_interrupt: Arc::clone(&pending_interrupt),
            }));
            drop(inner);

            match client.turn_start(&thread_id, text, codex_model, effort.clone(), &images) {
                Ok(started_turn_id) => {
                    *turn_id.lock().map_err(|_| {
                        AgentChatError::Spawn("agent turn lock poisoned".to_string())
                    })? = Some(started_turn_id);
                    if pending_interrupt.load(Ordering::SeqCst) {
                        let turn_id = turn_id
                            .lock()
                            .map_err(|_| {
                                AgentChatError::Spawn("agent turn lock poisoned".to_string())
                            })?
                            .clone()
                            .ok_or_else(|| {
                                AgentChatError::Spawn(
                                    "codex app-server turn id missing".to_string(),
                                )
                            })?;
                        client
                            .turn_interrupt(&thread_id, &turn_id)
                            .map_err(|err| AgentChatError::Spawn(err.to_string()))?;
                    }
                    return Ok(());
                }
                Err(err) => {
                    let _ = self.db.agent_session_set_status(session_id, "failed");
                    if let Some(turn) = clear_active_turn(&self.inner, session_id) {
                        turn.reap();
                    }
                    return Err(AgentChatError::Spawn(err.to_string()));
                }
            }
        }

        let result = match (engine, provider) {
            (Engine::V1, AgentProvider::Codex) => {
                let wrapped_sink = self.wrapping_sink(session_id_owned.clone(), chat_id.clone());
                spawn_codex_turn(
                    CodexTurnOptions {
                        prompt: text.to_string(),
                        cwd: project_root,
                        model: codex_model,
                        effort,
                        resume_thread_id: provider_session_id,
                        binary: self.codex_binary(),
                    },
                    move |event| wrapped_sink(event),
                )
                .map(ActiveTurnHandle::Codex)
                .map_err(|err| AgentChatError::Spawn(err.to_string()))
            }
            (Engine::V1, AgentProvider::ClaudeCode) => {
                let wrapped_sink = self.wrapping_sink(session_id_owned.clone(), chat_id.clone());
                spawn_claude_turn(
                    ClaudeTurnOptions {
                        prompt: text.to_string(),
                        cwd: project_root,
                        model: session_model,
                        resume_session_id: provider_session_id,
                        permission_mode: None,
                        allowed_tools: None,
                        binary: self.claude_binary(),
                    },
                    move |event| wrapped_sink(event),
                )
                .map(ActiveTurnHandle::Claude)
                .map_err(|err| AgentChatError::Spawn(err.to_string()))
            }
            (Engine::V2, AgentProvider::Codex) => unreachable!("handled before match"),
            (Engine::V2, AgentProvider::ClaudeCode) => {
                let client = self.claude_bridge_client()?;
                let chat_id = session_id_owned.clone();
                state.active_turn = Some(ActiveTurn::new(ActiveTurnHandle::ClaudeBridge {
                    client: Arc::clone(&client),
                    chat_id: chat_id.clone(),
                }));
                match client.chat_send(&chat_id, text, &images) {
                    Ok(()) => return Ok(()),
                    Err(err) => {
                        state.active_turn = None;
                        Err(AgentChatError::Spawn(err.to_string()))
                    }
                }
            }
        };

        match result {
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

    pub fn approve(
        &self,
        session_id: &str,
        approval_id: &str,
        decision: &str,
    ) -> Result<(), AgentChatError> {
        let (engine, provider, project_root) = {
            let inner = self.lock_inner()?;
            let state = inner
                .get(session_id)
                .ok_or_else(|| AgentChatError::UnknownSession(session_id.to_string()))?;
            (state.engine, state.provider, state.project_root.clone())
        };

        match (engine, provider) {
            (Engine::V2, AgentProvider::Codex) => self
                .cached_codex_app_client(&project_root)?
                .respond_approval(RequestIdRepr::from_serialized(approval_id), decision)
                .map_err(|err| AgentChatError::Spawn(err.to_string())),
            (Engine::V2, AgentProvider::ClaudeCode) => self
                .cached_claude_bridge_client()?
                .chat_approve(session_id, approval_id, decision)
                .map_err(|err| AgentChatError::Spawn(err.to_string())),
            (Engine::V1, _) => Err(AgentChatError::Unsupported(
                "approvals require the v2 agent engine".to_string(),
            )),
        }
    }

    pub fn steer(&self, session_id: &str, text: &str) -> Result<(), AgentChatError> {
        let (engine, provider, active_turn) = {
            let inner = self.lock_inner()?;
            let state = inner
                .get(session_id)
                .ok_or_else(|| AgentChatError::UnknownSession(session_id.to_string()))?;
            (state.engine, state.provider, state.active_turn.clone())
        };

        match (engine, provider) {
            (Engine::V2, AgentProvider::Codex) => {
                let Some(active_turn) = active_turn else {
                    return Err(AgentChatError::Unsupported(
                        "codex steering requires an active turn".to_string(),
                    ));
                };
                let Some((client, thread_id, turn_id)) = active_turn.codex_app_turn()? else {
                    return Err(AgentChatError::Unsupported(
                        "codex steering requires an active v2 turn".to_string(),
                    ));
                };
                client
                    .turn_steer(&thread_id, &turn_id, text)
                    .map_err(|err| AgentChatError::Spawn(err.to_string()))
            }
            (Engine::V2, AgentProvider::ClaudeCode) => Err(AgentChatError::Unsupported(
                "claude steering is not supported until SDK steering is available".to_string(),
            )),
            (Engine::V1, _) => Err(AgentChatError::Unsupported(
                "steering requires the v2 agent engine".to_string(),
            )),
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

    fn acquire_start_guard(&self, chat_id: &str) -> Result<StartGuard, AgentChatError> {
        let chat_id = chat_id.to_string();
        loop {
            {
                let mut starting = self.starting_chats.lock().map_err(|_| {
                    AgentChatError::Spawn("agent chat start guard lock poisoned".to_string())
                })?;
                if starting.insert(chat_id.clone()) {
                    return Ok(StartGuard {
                        chat_id,
                        starting: Arc::clone(&self.starting_chats),
                    });
                }
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    fn wrapping_sink(
        &self,
        session_id: String,
        chat_id: String,
    ) -> Arc<dyn Fn(AgentEvent) + Send + Sync> {
        let db = Arc::clone(&self.db);
        let sink_inner = Arc::clone(&self.inner);
        Arc::new(move |event| {
            handle_runner_event(&db, &sink_inner, &session_id, &chat_id, event);
        })
    }

    fn codex_app_client(
        &self,
        project_root: PathBuf,
    ) -> Result<Arc<CodexAppClient>, AgentChatError> {
        let mut clients = self
            .codex_app_clients
            .lock()
            .map_err(|_| AgentChatError::Spawn("codex app client lock poisoned".to_string()))?;
        if let Some(client) = clients.get(&project_root) {
            if !client.is_closed() {
                return Ok(Arc::clone(client));
            }
        }
        let evicted = clients.remove(&project_root);

        let spawned = spawn_codex_app(CodexAppOptions {
            cwd: project_root.clone(),
            binary: self.codex_binary(),
        })
        .map(Arc::new);
        if let Ok(client) = spawned.as_ref() {
            clients.insert(project_root, Arc::clone(client));
        }
        drop(clients);

        if let Some(client) = evicted {
            self.evict_codex_app_client(&client);
        }

        spawned.map_err(|err| AgentChatError::Spawn(err.to_string()))
    }

    fn cached_codex_app_client(
        &self,
        project_root: &PathBuf,
    ) -> Result<Arc<CodexAppClient>, AgentChatError> {
        let evicted = {
            let mut clients = self
                .codex_app_clients
                .lock()
                .map_err(|_| AgentChatError::Spawn("codex app client lock poisoned".to_string()))?;
            let Some(client) = clients.get(project_root) else {
                return Err(AgentChatError::Spawn(
                    "codex app-server client is not running".to_string(),
                ));
            };
            if !client.is_closed() {
                return Ok(Arc::clone(client));
            }
            clients.remove(project_root)
        };
        if let Some(client) = evicted {
            self.evict_codex_app_client(&client);
            return Err(AgentChatError::Spawn(
                "codex app-server client is not running".to_string(),
            ));
        }
        Err(AgentChatError::Spawn(
            "codex app-server client is not running".to_string(),
        ))
    }

    fn claude_bridge_client(&self) -> Result<Arc<ClaudeBridgeClient>, AgentChatError> {
        let mut bridge = self
            .claude_bridge
            .lock()
            .map_err(|_| AgentChatError::Spawn("claude bridge lock poisoned".to_string()))?;
        if let Some(client) = bridge.as_ref() {
            if !client.is_closed() {
                return Ok(Arc::clone(client));
            }
        }
        let evicted = bridge.take();

        let spawned = spawn_claude_bridge(ClaudeBridgeOptions {
            runtime: self.claude_binary(),
            script: None,
            app_root: self.app_root.clone(),
        })
        .map(Arc::new);
        if let Ok(client) = spawned.as_ref() {
            *bridge = Some(Arc::clone(client));
        }
        drop(bridge);

        if let Some(client) = evicted {
            self.evict_claude_bridge_client(&client);
        }

        spawned.map_err(|err| AgentChatError::Spawn(err.to_string()))
    }

    fn cached_claude_bridge_client(&self) -> Result<Arc<ClaudeBridgeClient>, AgentChatError> {
        let evicted = {
            let mut bridge = self
                .claude_bridge
                .lock()
                .map_err(|_| AgentChatError::Spawn("claude bridge lock poisoned".to_string()))?;
            let Some(client) = bridge.as_ref() else {
                return Err(AgentChatError::Spawn(
                    "claude bridge client is not running".to_string(),
                ));
            };
            if !client.is_closed() {
                return Ok(Arc::clone(client));
            }
            bridge.take()
        };
        if let Some(client) = evicted {
            self.evict_claude_bridge_client(&client);
            return Err(AgentChatError::Spawn(
                "claude bridge client is not running".to_string(),
            ));
        }
        Err(AgentChatError::Spawn(
            "claude bridge client is not running".to_string(),
        ))
    }

    fn evict_codex_app_client(&self, client: &Arc<CodexAppClient>) {
        for turn in self.clear_active_turns_for_codex_app_client(client) {
            turn.reap();
        }
        let _ = client.shutdown();
    }

    fn evict_claude_bridge_client(&self, client: &Arc<ClaudeBridgeClient>) {
        for turn in self.clear_active_turns_for_claude_bridge_client(client) {
            turn.reap();
        }
        let _ = client.shutdown();
    }

    fn clear_active_turns_for_codex_app_client(
        &self,
        client: &Arc<CodexAppClient>,
    ) -> Vec<ActiveTurn> {
        let Ok(mut inner) = self.inner.lock() else {
            return Vec::new();
        };
        inner
            .values_mut()
            .filter_map(|state| {
                let should_clear = state
                    .active_turn
                    .as_ref()
                    .map(|turn| turn.references_codex_app_client(client))
                    .unwrap_or(false);
                should_clear.then(|| state.active_turn.take()).flatten()
            })
            .collect()
    }

    fn clear_active_turns_for_claude_bridge_client(
        &self,
        client: &Arc<ClaudeBridgeClient>,
    ) -> Vec<ActiveTurn> {
        let Ok(mut inner) = self.inner.lock() else {
            return Vec::new();
        };
        inner
            .values_mut()
            .filter_map(|state| {
                let should_clear = state
                    .active_turn
                    .as_ref()
                    .map(|turn| turn.references_claude_bridge_client(client))
                    .unwrap_or(false);
                should_clear.then(|| state.active_turn.take()).flatten()
            })
            .collect()
    }

    fn unsubscribe_replaced_codex_threads(&self, chat_id: &str, current_session_id: &str) {
        let threads = self
            .inner
            .lock()
            .ok()
            .map(|inner| {
                inner
                    .iter()
                    .filter_map(|(session_id, state)| {
                        if session_id == current_session_id
                            || state.chat_id != chat_id
                            || state.provider != AgentProvider::Codex
                            || state.engine != Engine::V2
                        {
                            return None;
                        }
                        Some((
                            state.project_root.clone(),
                            state.provider_session_id.clone()?,
                        ))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        for (project_root, thread_id) in threads {
            if let Ok(client) = self.cached_codex_app_client(&project_root) {
                let _ = client.unsubscribe(&thread_id);
            }
        }
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
        app_root: PathBuf,
        codex_binary: Option<String>,
        claude_binary: Option<String>,
    ) -> Self {
        Self {
            db,
            app_root,
            inner: Arc::new(Mutex::new(HashMap::new())),
            codex_app_clients: Arc::new(Mutex::new(HashMap::new())),
            claude_bridge: Arc::new(Mutex::new(None)),
            starting_chats: Arc::new(Mutex::new(HashSet::new())),
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

struct StartGuard {
    chat_id: String,
    starting: Arc<Mutex<HashSet<String>>>,
}

impl Drop for StartGuard {
    fn drop(&mut self) {
        if let Ok(mut starting) = self.starting.lock() {
            starting.remove(&self.chat_id);
        }
    }
}

fn upsert_session_state(
    inner: &mut HashMap<String, SessionState>,
    session_id: String,
    state: SessionState,
) {
    if let Some(existing) = inner.get_mut(&session_id) {
        existing.chat_id = state.chat_id;
        existing.project_root = state.project_root;
        existing.provider = state.provider;
        existing.engine = state.engine;
        existing.model = state.model;
        existing.provider_session_id = state.provider_session_id;
        existing.sink = state.sink;
    } else {
        inner.insert(session_id, state);
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
            Some(ActiveTurnHandle::CodexApp {
                client,
                thread_id,
                turn_id,
                pending_interrupt,
            }) => {
                let turn_id = turn_id
                    .lock()
                    .map_err(|_| AgentChatError::Spawn("agent turn lock poisoned".to_string()))?
                    .clone();
                let Some(turn_id) = turn_id else {
                    pending_interrupt.store(true, Ordering::SeqCst);
                    return Ok(());
                };
                client
                    .turn_interrupt(thread_id, &turn_id)
                    .map_err(|err| AgentChatError::Spawn(err.to_string()))
            }
            Some(ActiveTurnHandle::ClaudeBridge { client, chat_id }) => client
                .chat_interrupt(chat_id)
                .map_err(|err| AgentChatError::Spawn(err.to_string())),
            None => Ok(()),
        }
    }

    fn codex_app_turn(
        &self,
    ) -> Result<Option<(Arc<CodexAppClient>, String, String)>, AgentChatError> {
        let handle = self
            .inner
            .lock()
            .map_err(|_| AgentChatError::Spawn("agent turn lock poisoned".to_string()))?;
        Ok(match handle.as_ref() {
            Some(ActiveTurnHandle::CodexApp {
                client,
                thread_id,
                turn_id,
                ..
            }) => {
                let turn_id = turn_id
                    .lock()
                    .map_err(|_| AgentChatError::Spawn("agent turn lock poisoned".to_string()))?
                    .clone();
                turn_id.map(|turn_id| (Arc::clone(client), thread_id.clone(), turn_id))
            }
            _ => None,
        })
    }

    fn references_codex_app_client(&self, target: &Arc<CodexAppClient>) -> bool {
        self.inner
            .lock()
            .ok()
            .and_then(|handle| match handle.as_ref() {
                Some(ActiveTurnHandle::CodexApp { client, .. }) => {
                    Some(Arc::ptr_eq(client, target))
                }
                _ => None,
            })
            .unwrap_or(false)
    }

    fn references_claude_bridge_client(&self, target: &Arc<ClaudeBridgeClient>) -> bool {
        self.inner
            .lock()
            .ok()
            .and_then(|handle| match handle.as_ref() {
                Some(ActiveTurnHandle::ClaudeBridge { client, .. }) => {
                    Some(Arc::ptr_eq(client, target))
                }
                _ => None,
            })
            .unwrap_or(false)
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
        | AgentEvent::Usage { .. } => {
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
        | AgentEvent::RateLimits { .. }
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

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty())
}

#[cfg(test)]
#[derive(Clone, Default)]
struct TestBinaries {
    codex: Option<String>,
    claude: Option<String>,
}

#[cfg(test)]
mod tests {
    use std::sync::{Barrier, Mutex};
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
            script.dir.clone(),
            Some(script.path.to_string_lossy().to_string()),
            None,
        )
    }

    #[cfg(unix)]
    fn claude_manager(db: Arc<Database>, script: &TestScript) -> AgentChatManager {
        AgentChatManager::with_test_binaries(
            db,
            script.dir.clone(),
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

    #[cfg(unix)]
    fn wait_for_file(path: &PathBuf, predicate: impl Fn(&str) -> bool) -> String {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let value = std::fs::read_to_string(path).unwrap_or_default();
            if predicate(&value) {
                return value;
            }
            if Instant::now() >= deadline {
                panic!("timed out waiting for {}", path.display());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[cfg(unix)]
    fn process_alive(pid: i32) -> bool {
        unsafe { libc::kill(pid, 0) == 0 }
    }

    #[cfg(unix)]
    fn wait_for_process_exit(pid: i32) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while process_alive(pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!process_alive(pid), "process {pid} should be gone");
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
    fn engine_parse_defaults_to_v2_shape() {
        assert_eq!("v1".parse::<Engine>().unwrap(), Engine::V1);
        assert_eq!("v2".parse::<Engine>().unwrap(), Engine::V2);
        assert!("V2".parse::<Engine>().is_err());
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
    fn v2_codex_start_send_approval_and_idle_flow() {
        let script = test_script(
            "codex-app-flow",
            r#"#!/bin/sh
log="$0.stdin"
: > "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{"id":1,"result":{}}'
      ;;
    *'"method":"thread/start"'*)
      printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-v2"}}}'
      ;;
    *'"method":"turn/start"'*)
      printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-v2"}}}'
      printf '%s\n' '{"method":"turn/started","params":{"threadId":"thread-v2","turnId":"turn-v2"}}'
      printf '%s\n' '{"id":42,"method":"item/commandExecution/requestApproval","params":{"threadId":"thread-v2","turnId":"turn-v2","itemId":"cmd-1","command":"cargo check"}}'
      printf '%s\n' '{"method":"item/completed","params":{"threadId":"thread-v2","turnId":"turn-v2","item":{"id":"msg-1","type":"agentMessage","text":"assistant v2"}}}'
      printf '%s\n' '{"method":"thread/tokenUsage/updated","params":{"threadId":"thread-v2","tokenUsage":{"total":{"inputTokens":1,"cachedInputTokens":0,"outputTokens":2,"totalTokens":3},"modelContextWindow":100}}}'
      printf '%s\n' '{"method":"account/rateLimits/updated","params":{"rateLimits":{"primary":{"usedPercent":10}}}}'
      printf '%s\n' '{"method":"turn/completed","params":{"threadId":"thread-v2","turn":{"id":"turn-v2","status":"completed"}}}'
      ;;
  esac
done
"#,
        );
        let log = script.path.with_file_name("fake-agent.stdin");
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = codex_manager(Arc::clone(&db), &script);
        let (events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-v2",
                script.dir.clone(),
                AgentProvider::Codex,
                Engine::V2,
                Some("gpt-5".to_string()),
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();

        let start_log = wait_for_file(&log, |text| text.contains(r#""method":"thread/start""#));
        assert!(start_log.contains(r#""sandbox":"workspace-write""#));
        assert!(start_log.contains(r#""approvalPolicy":"on-request""#));

        manager
            .send(
                &session_id,
                "hello v2",
                Some("high".to_string()),
                None,
                Some(vec!["/tmp/pickforge-shot.png".to_string()]),
            )
            .unwrap();
        let approval_events = wait_for_events(&events, |events| {
            events
                .iter()
                .any(|event| matches!(event, AgentEvent::ApprovalRequest { .. }))
        });
        let approval_id = approval_events
            .iter()
            .find_map(|event| match event {
                AgentEvent::ApprovalRequest {
                    approval_id,
                    kind,
                    detail,
                } => {
                    assert_eq!(*kind, super::super::event::ApprovalKind::Command);
                    assert!(detail.contains("cargo check"));
                    Some(approval_id.clone())
                }
                _ => None,
            })
            .unwrap();
        assert_eq!(approval_id, "42");

        manager
            .approve(&session_id, &approval_id, "approved")
            .unwrap();
        let approval_log = wait_for_file(&log, |text| {
            text.contains(r#""id":42"#) && text.contains(r#""decision":"approved""#)
        });
        assert!(approval_log.contains(r#""method":"turn/start""#));
        assert!(approval_log.contains(r#""effort":"high""#));
        assert!(approval_log.contains(r#""type":"localImage""#));
        assert!(approval_log.contains(r#""path":"/tmp/pickforge-shot.png""#));
        assert!(approval_log.contains(r#""type":"text""#));
        assert!(approval_log.contains(r#""text":"hello v2""#));
        assert!(
            approval_log.find(r#""type":"localImage""#).unwrap()
                < approval_log.find(r#""text":"hello v2""#).unwrap()
        );

        wait_for_events(&events, |events| {
            matches!(
                events.last(),
                Some(AgentEvent::TurnDone {
                    status: TurnStatus::Completed
                })
            )
        });
        let row = wait_for_status(&db, "chat-v2", "idle");
        assert_eq!(row.id, session_id);
        assert_eq!(row.provider_session_id.as_deref(), Some("thread-v2"));

        let timeline = db.agent_timeline_for_chat("chat-v2").unwrap();
        assert!(timeline.iter().any(|entry| {
            matches!(entry, AgentTimelineEntry::Message { role, content, .. }
                if role == "user" && content == "hello v2")
        }));
        assert!(timeline.iter().any(|entry| {
            matches!(entry, AgentTimelineEntry::Message { role, content, .. }
                if role == "assistant" && content == "assistant v2")
        }));
        assert!(timeline.iter().any(|entry| {
            matches!(entry, AgentTimelineEntry::Item { kind, .. } if kind == "usage")
        }));
        assert!(!timeline.iter().any(|entry| {
            matches!(entry, AgentTimelineEntry::Item { kind, .. }
                if kind == "approvalRequest" || kind == "rateLimits")
        }));
    }

    #[cfg(unix)]
    #[test]
    fn v2_codex_send_forwards_per_turn_model() {
        let script = test_script(
            "codex-app-turn-model",
            r#"#!/bin/sh
log="$0.stdin"
: > "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{"id":1,"result":{}}'
      ;;
    *'"method":"thread/start"'*)
      printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-model"}}}'
      ;;
    *'"method":"turn/start"'*)
      printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-model"}}}'
      printf '%s\n' '{"method":"turn/completed","params":{"threadId":"thread-model","turn":{"id":"turn-model","status":"completed"}}}'
      ;;
  esac
done
"#,
        );
        let log = script.path.with_file_name("fake-agent.stdin");
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = codex_manager(Arc::clone(&db), &script);
        let (_events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-model-v2",
                script.dir.clone(),
                AgentProvider::Codex,
                Engine::V2,
                Some("gpt-session".to_string()),
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();

        manager
            .send(
                &session_id,
                "hello",
                None,
                Some("gpt-turn".to_string()),
                None,
            )
            .unwrap();
        let log = wait_for_file(&log, |text| text.contains(r#""method":"turn/start""#));
        let start_line = log
            .lines()
            .find(|line| line.contains(r#""method":"thread/start""#))
            .unwrap();
        let turn_line = log
            .lines()
            .find(|line| line.contains(r#""method":"turn/start""#))
            .unwrap();
        assert!(start_line.contains(r#""model":"gpt-session""#));
        assert!(turn_line.contains(r#""model":"gpt-turn""#));
        assert!(!turn_line.contains("gpt-session"));
    }

    #[cfg(unix)]
    #[test]
    fn v2_codex_steer_and_interrupt_serialize_ops() {
        let script = test_script(
            "codex-app-control",
            r#"#!/bin/sh
log="$0.stdin"
: > "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{"id":1,"result":{}}'
      ;;
    *'"method":"thread/start"'*)
      printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-live"}}}'
      ;;
    *'"method":"turn/start"'*)
      printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-live"}}}'
      printf '%s\n' '{"method":"turn/started","params":{"threadId":"thread-live","turnId":"turn-live"}}'
      ;;
    *'"method":"turn/steer"'*)
      printf '%s\n' '{"id":4,"result":{}}'
      ;;
    *'"method":"turn/interrupt"'*)
      printf '%s\n' '{"id":5,"result":{}}'
      printf '%s\n' '{"method":"turn/completed","params":{"threadId":"thread-live","turn":{"id":"turn-live","status":"interrupted"}}}'
      ;;
  esac
done
"#,
        );
        let log = script.path.with_file_name("fake-agent.stdin");
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = codex_manager(Arc::clone(&db), &script);
        let (events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-control",
                script.dir.clone(),
                AgentProvider::Codex,
                Engine::V2,
                None,
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();

        manager.send(&session_id, "start", None, None, None).unwrap();
        wait_for_events(&events, |events| {
            events
                .iter()
                .any(|event| matches!(event, AgentEvent::TurnStarted))
        });

        manager.steer(&session_id, "adjust").unwrap();
        manager.interrupt(&session_id).unwrap();

        let log_text = wait_for_file(&log, |text| {
            text.contains(r#""method":"turn/steer""#)
                && text.contains(r#""expectedTurnId":"turn-live""#)
                && text.contains(r#""method":"turn/interrupt""#)
                && text.contains(r#""turnId":"turn-live""#)
        });
        assert!(log_text.contains(r#""text":"adjust""#));
        wait_for_events(&events, |events| {
            matches!(
                events.last(),
                Some(AgentEvent::TurnDone {
                    status: TurnStatus::Interrupted
                })
            )
        });
        wait_for_status(&db, "chat-control", "idle");
    }

    #[cfg(unix)]
    #[test]
    fn v2_codex_resume_failure_starts_fresh_thread() {
        let script = test_script(
            "codex-app-resume-fallback",
            r#"#!/bin/sh
log="$0.stdin"
: > "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{"id":1,"result":{}}'
      ;;
    *'"method":"thread/resume"'*)
      printf '%s\n' '{"id":2,"error":{"message":"missing thread"}}'
      ;;
    *'"method":"thread/start"'*)
      printf '%s\n' '{"id":3,"result":{"thread":{"id":"fresh-thread"}}}'
      ;;
  esac
done
"#,
        );
        let log = script.path.with_file_name("fake-agent.stdin");
        let db = Arc::new(Database::open_in_memory().unwrap());
        db.agent_session_create(&AgentSessionRow {
            id: "existing-session".to_string(),
            chat_id: "chat-resume".to_string(),
            provider: AgentProvider::Codex.as_str().to_string(),
            provider_session_id: Some("stale-thread".to_string()),
            model: None,
            status: "idle".to_string(),
            created_at: 1,
        })
        .unwrap();
        let manager = codex_manager(Arc::clone(&db), &script);
        let (_events, sink) = event_sink();

        let session_id = manager
            .start(
                "chat-resume",
                script.dir.clone(),
                AgentProvider::Codex,
                Engine::V2,
                None,
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();

        assert_eq!(session_id, "existing-session");
        let row = db
            .latest_agent_session_for_chat("chat-resume")
            .unwrap()
            .unwrap();
        assert_eq!(row.provider_session_id.as_deref(), Some("fresh-thread"));
        let log = wait_for_file(&log, |text| {
            text.contains(r#""method":"thread/resume""#)
                && text.contains(r#""method":"thread/start""#)
        });
        assert!(log.contains("stale-thread"));
    }

    #[cfg(unix)]
    #[test]
    fn v2_codex_dead_client_broadcasts_failure_and_next_start_respawns() {
        let script = test_script(
            "codex-app-dead-respawn",
            r#"#!/bin/sh
log="$0.stdin"
count_file="$0.count"
count=0
if [ -f "$count_file" ]; then
  count=$(cat "$count_file")
fi
count=$((count + 1))
printf '%s' "$count" > "$count_file"
pid_file="$0.pid.$count"
printf '%s' "$$" > "$pid_file"
printf 'spawn:%s\n' "$count" >> "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{"id":1,"result":{}}'
      ;;
    *'"method":"thread/start"'*)
      printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-dead"}}}'
      ;;
    *'"method":"thread/resume"'*)
      printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-respawn"}}}'
      ;;
    *'"method":"turn/start"'*)
      if [ "$count" = "1" ]; then
        printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-dead"}}}'
        printf '%s\n' '{"method":"turn/started","params":{"threadId":"thread-dead","turnId":"turn-dead"}}'
        exec 1>&-
        sleep 30
        exit 0
      fi
      printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-ok"}}}'
      printf '%s\n' '{"method":"turn/started","params":{"threadId":"thread-respawn","turnId":"turn-ok"}}'
      printf '%s\n' '{"method":"item/completed","params":{"threadId":"thread-respawn","turnId":"turn-ok","item":{"id":"msg-1","type":"agentMessage","text":"after respawn"}}}'
      printf '%s\n' '{"method":"turn/completed","params":{"threadId":"thread-respawn","turn":{"id":"turn-ok","status":"completed"}}}'
      ;;
  esac
done
"#,
        );
        let count_file = script.path.with_file_name("fake-agent.count");
        let first_pid_file = script.path.with_file_name("fake-agent.pid.1");
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = codex_manager(Arc::clone(&db), &script);
        let (events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-dead",
                script.dir.clone(),
                AgentProvider::Codex,
                Engine::V2,
                None,
                AgentStartOverrides::default(),
                Arc::clone(&sink),
            )
            .unwrap();

        manager.send(&session_id, "first", None, None, None).unwrap();
        wait_for_events(&events, |events| {
            matches!(
                events.last(),
                Some(AgentEvent::TurnFailed { error }) if error == "agent process exited"
            )
        });
        wait_for_status(&db, "chat-dead", "failed");
        let first_pid: i32 = wait_for_file(&first_pid_file, |text| !text.trim().is_empty())
            .trim()
            .parse()
            .unwrap();
        assert!(process_alive(first_pid));

        let restarted_id = manager
            .start(
                "chat-dead",
                script.dir.clone(),
                AgentProvider::Codex,
                Engine::V2,
                None,
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();
        assert_eq!(restarted_id, session_id);
        wait_for_process_exit(first_pid);
        manager
            .send(&restarted_id, "second", None, None, None)
            .unwrap();
        wait_for_events(&events, |events| {
            matches!(
                events.last(),
                Some(AgentEvent::TurnDone {
                    status: TurnStatus::Completed
                })
            )
        });
        let row = wait_for_status(&db, "chat-dead", "idle");
        assert_eq!(row.provider_session_id.as_deref(), Some("thread-respawn"));
        assert_eq!(std::fs::read_to_string(count_file).unwrap(), "2");
    }

    #[cfg(unix)]
    #[test]
    fn v2_claude_dead_bridge_next_start_respawns_and_kills_evicted_child() {
        let script = test_script(
            "claude-bridge-dead-respawn",
            r#"#!/bin/sh
log="$0.stdin"
count_file="$0.count"
count=0
if [ -f "$count_file" ]; then
  count=$(cat "$count_file")
fi
count=$((count + 1))
printf '%s' "$count" > "$count_file"
pid_file="$0.pid.$count"
printf '%s' "$$" > "$pid_file"
printf 'spawn:%s\n' "$count" >> "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  chat_id=$(printf '%s\n' "$line" | sed 's/.*"chatId":"\([^"]*\)".*/\1/')
  case "$line" in
    *'"op":"start"'*)
      printf '{"ev":"started","chatId":"%s"}\n' "$chat_id"
      ;;
    *'"op":"send"'*)
      if [ "$count" = "1" ]; then
        printf '{"ev":"raw","chatId":"%s","message":{"type":"stream_event","event":{"type":"message_start"}}}\n' "$chat_id"
        exec 1>&-
        sleep 30
        exit 0
      fi
      printf '{"ev":"raw","chatId":"%s","message":{"type":"system","subtype":"init","session_id":"claude-respawn"}}\n' "$chat_id"
      printf '{"ev":"raw","chatId":"%s","message":{"type":"stream_event","event":{"type":"message_start"}}}\n' "$chat_id"
      printf '{"ev":"raw","chatId":"%s","message":{"type":"assistant","message":{"content":[{"type":"text","text":"after respawn"}]}}}\n' "$chat_id"
      printf '{"ev":"raw","chatId":"%s","message":{"type":"result","subtype":"success","usage":{"input_tokens":1,"cache_read_input_tokens":0,"output_tokens":1},"total_cost_usd":0.01}}\n' "$chat_id"
      ;;
    *'"op":"shutdown"'*)
      exit 0
      ;;
  esac
done
"#,
        );
        let count_file = script.path.with_file_name("fake-agent.count");
        let first_pid_file = script.path.with_file_name("fake-agent.pid.1");
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = claude_manager(Arc::clone(&db), &script);
        let (events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-claude-dead",
                script.dir.clone(),
                AgentProvider::ClaudeCode,
                Engine::V2,
                None,
                AgentStartOverrides::default(),
                Arc::clone(&sink),
            )
            .unwrap();

        manager.send(&session_id, "first", None, None, None).unwrap();
        wait_for_events(&events, |events| {
            matches!(
                events.last(),
                Some(AgentEvent::TurnFailed { error }) if error == "agent process exited"
            )
        });
        wait_for_status(&db, "chat-claude-dead", "failed");
        let first_pid: i32 = wait_for_file(&first_pid_file, |text| !text.trim().is_empty())
            .trim()
            .parse()
            .unwrap();
        assert!(process_alive(first_pid));

        let restarted_id = manager
            .start(
                "chat-claude-dead",
                script.dir.clone(),
                AgentProvider::ClaudeCode,
                Engine::V2,
                None,
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();
        assert_eq!(restarted_id, session_id);
        wait_for_process_exit(first_pid);
        manager
            .send(&restarted_id, "second", None, None, None)
            .unwrap();
        wait_for_events(&events, |events| {
            matches!(
                events.last(),
                Some(AgentEvent::TurnDone {
                    status: TurnStatus::Completed
                })
            )
        });
        let row = wait_for_status(&db, "chat-claude-dead", "idle");
        assert_eq!(row.provider_session_id.as_deref(), Some("claude-respawn"));
        assert_eq!(std::fs::read_to_string(count_file).unwrap(), "2");
    }

    #[cfg(unix)]
    #[test]
    fn concurrent_start_for_same_chat_reuses_one_session() {
        let script = test_script(
            "codex-app-concurrent-start",
            r#"#!/bin/sh
log="$0.stdin"
: > "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{"id":1,"result":{}}'
      ;;
    *'"method":"thread/start"'*)
      sleep 0.1
      printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-concurrent"}}}'
      ;;
    *'"method":"thread/resume"'*)
      printf '%s\n' '{"id":3,"result":{"thread":{"id":"thread-concurrent"}}}'
      ;;
  esac
done
"#,
        );
        let log = script.path.with_file_name("fake-agent.stdin");
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = Arc::new(codex_manager(Arc::clone(&db), &script));
        let barrier = Arc::new(Barrier::new(2));
        let handles = (0..2)
            .map(|_| {
                let manager = Arc::clone(&manager);
                let barrier = Arc::clone(&barrier);
                let project_root = script.dir.clone();
                std::thread::spawn(move || {
                    let (_events, sink) = event_sink();
                    barrier.wait();
                    manager
                        .start(
                            "chat-concurrent",
                            project_root,
                            AgentProvider::Codex,
                            Engine::V2,
                            None,
                            AgentStartOverrides::default(),
                            sink,
                        )
                        .unwrap()
                })
            })
            .collect::<Vec<_>>();
        let ids = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(ids[0], ids[1]);
        let row = db
            .latest_agent_session_for_chat("chat-concurrent")
            .unwrap()
            .unwrap();
        assert_eq!(row.id, ids[0]);
        let log = wait_for_file(&log, |text| text.contains(r#""method":"thread/resume""#));
        assert_eq!(log.matches(r#""method":"thread/start""#).count(), 1);
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
                Engine::V1,
                Some("gpt-5".to_string()),
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();

        manager.send(&session_id, "hello", None, None, None).unwrap();
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
    fn v1_codex_send_forwards_per_turn_model() {
        let script = test_script(
            "codex-v1-turn-model",
            r#"#!/bin/sh
log="$0.args"
: > "$log"
for arg in "$@"; do
  printf '%s\n' "$arg" >> "$log"
done
printf '%s\n' \
'{"type":"thread.started","thread_id":"thread-v1-model"}' \
'{"type":"turn.started"}' \
'{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'
"#,
        );
        let log = script.path.with_file_name("fake-agent.args");
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = codex_manager(Arc::clone(&db), &script);
        let (events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-model-v1",
                script.dir.clone(),
                AgentProvider::Codex,
                Engine::V1,
                Some("gpt-session".to_string()),
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();

        manager
            .send(
                &session_id,
                "hello",
                None,
                Some("gpt-turn".to_string()),
                None,
            )
            .unwrap();
        wait_for_events(&events, |events| {
            matches!(events.last(), Some(AgentEvent::TurnDone { .. }))
        });
        let args = wait_for_file(&log, |text| text.contains("gpt-turn"));
        assert!(args.lines().any(|line| line == "gpt-turn"));
        assert!(!args.lines().any(|line| line == "gpt-session"));
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
                Engine::V1,
                Some("sonnet".to_string()),
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();

        manager.send(&session_id, "hello", None, None, None).unwrap();
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
                Engine::V1,
                None,
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();

        manager.send(&session_id, "first", None, None, None).unwrap();
        wait_for_events(&events, |events| {
            events
                .iter()
                .any(|event| matches!(event, AgentEvent::TurnStarted))
        });

        assert!(matches!(
            manager.send(&session_id, "second", None, None, None),
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
                Engine::V1,
                None,
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();

        manager.send(&session_id, "stop", None, None, None).unwrap();
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
                Engine::V1,
                Some("gpt-5".to_string()),
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();
        manager.send(&session_id, "first", None, None, None).unwrap();
        wait_for_events(&events, |events| {
            matches!(
                events.last(),
                Some(AgentEvent::TurnDone {
                    status: TurnStatus::Completed
                })
            )
        });
        wait_for_status(&db, "chat-restart", "idle");

        let restarted = AgentChatManager::new(Arc::clone(&db), script.dir.clone());
        let (_events2, sink2) = event_sink();
        let reused_id = restarted
            .start(
                "chat-restart",
                script.dir.clone(),
                AgentProvider::Codex,
                Engine::V1,
                Some("gpt-5.1".to_string()),
                AgentStartOverrides::default(),
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
                Engine::V1,
                None,
                AgentStartOverrides::default(),
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
