use std::collections::{HashMap, HashSet};
use std::mem::ManuallyDrop;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::db::{AgentSessionRow, Database, DbError};

use super::claude_bridge::{spawn as spawn_claude_bridge, ClaudeBridgeClient, ClaudeBridgeOptions};
use super::claude_stream::{spawn_claude_turn, ClaudeStreamTurn, ClaudeTurnOptions};
use super::codex_app::{
    spawn as spawn_codex_app, CodexAppClient, CodexAppError, CodexAppOptions, RequestIdRepr,
};
use super::codex_exec::{spawn_codex_turn, CodexExecTurn, CodexTurnOptions};
use super::event::AgentEvent;
use super::omp_acp::{
    validate_omp_mcp_servers, OmpAcpClient, OmpAcpError, OmpAcpOptions, OmpAcpSessionOpen,
};
use super::pi_rpc::{spawn as spawn_pi_rpc, PiRpcClient, PiRpcError, PiRpcOptions};
use super::remote_exec::RemoteExec;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AgentProvider {
    ClaudeCode,
    Codex,
    Omp,
    Pi,
}

impl AgentProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claudeCode",
            Self::Codex => "codex",
            Self::Omp => "omp",
            Self::Pi => "pi",
        }
    }
}

impl FromStr for AgentProvider {
    type Err = AgentChatError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "claudeCode" => Ok(Self::ClaudeCode),
            "codex" => Ok(Self::Codex),
            "omp" => Ok(Self::Omp),
            "pi" => Ok(Self::Pi),
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
    pub remote: Option<RemoteExec>,
    pub mcp_servers: Vec<serde_json::Value>,
}

#[derive(Clone)]
pub struct AgentChatManager {
    db: Arc<Database>,
    app_root: PathBuf,
    inner: Arc<Mutex<HashMap<String, SessionState>>>,
    codex_app_clients: Arc<Mutex<HashMap<PathBuf, Arc<CodexAppClient>>>>,
    claude_bridge: Arc<Mutex<Option<Arc<ClaudeBridgeClient>>>>,
    remote_sessions: Arc<Mutex<HashMap<RemoteSessionKey, String>>>,
    starting_chats: Arc<Mutex<HashSet<String>>>,
    #[cfg(test)]
    test_binaries: TestBinaries,
}

struct SessionState {
    chat_id: String,
    project_root: PathBuf,
    remote: Option<RemoteExec>,
    provider: AgentProvider,
    engine: Engine,
    model: Option<String>,
    /// Model the most recent turn was sent with (per-turn override or the
    /// session model at send time). Usage rows persist this so a later model
    /// switch can't re-attribute earlier turns.
    last_turn_model: Option<String>,
    /// Start overrides, kept so a dead bridge chat (claude CLI exit between
    /// turns) can be restarted transparently on the next send.
    sandbox: Option<String>,
    approval_policy: Option<String>,
    effort: Option<String>,
    permission_mode: Option<String>,
    allowed_tools: Option<Vec<String>>,
    provider_session_id: Option<String>,
    sink: Arc<dyn Fn(AgentEvent) + Send + Sync>,
    pi_client: Option<Arc<PiRpcClient>>,
    active_turn: Option<ActiveTurn>,
    /// A V1 terminal event arrived before the turn handle was claimed — the
    /// claim then reports this so it doesn't install a handle for a dead
    /// process (leaving the session wedged as running).
    terminal_pending: bool,
    /// Unanswered approval requests, keyed by approval id. Replayed to the new
    /// sink when a reloaded webview re-attaches mid-turn — without this the
    /// rebuilt UI has no prompt while the agent stays blocked waiting.
    pending_approvals: Vec<(String, AgentEvent)>,
    omp_client: Option<Arc<OmpAcpClient>>,
    omp_identity: Option<OmpClientIdentity>,
}

#[derive(Clone, PartialEq)]
struct OmpClientIdentity {
    canonical_project_root: PathBuf,
    normalized_mcp_grants: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct RemoteSessionKey {
    chat_id: String,
    provider: AgentProvider,
    host: String,
    remote_root: String,
}

const REMOTE_PROVIDER_SESSION_PREFIX: &str = "remote:ssh:";

#[derive(Serialize, Deserialize)]
struct PersistedRemoteSession {
    host: String,
    remote_root: String,
    provider_session_id: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct V1TurnOverrides {
    effort: Option<String>,
    sandbox: Option<String>,
    approval_policy: Option<String>,
    permission_mode: Option<String>,
    allowed_tools: Option<String>,
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
    Omp {
        client: Arc<OmpAcpClient>,
    PiRpc {
        client: Arc<PiRpcClient>,
        prompt_started: Arc<AtomicBool>,
        pending_interrupt: Arc<AtomicBool>,
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
            remote_sessions: Arc::new(Mutex::new(HashMap::new())),
            starting_chats: Arc::new(Mutex::new(HashSet::new())),
            #[cfg(test)]
            test_binaries: TestBinaries::default(),
        }
    }

    /// Trusted internal capability. Product rollout/UI gating belongs to the
    /// typed renderer flag; callers that reach the manager may start OMP.
    pub fn start(
        &self,
        chat_id: &str,
        mut project_root: PathBuf,
        provider: AgentProvider,
        engine: Engine,
        model: Option<String>,
        overrides: AgentStartOverrides,
        sink: Arc<dyn Fn(AgentEvent) + Send + Sync>,
    ) -> Result<String, AgentChatError> {
        let _start_guard = self.acquire_start_guard(chat_id)?;
        let remote = overrides.remote.clone();
        let engine = engine_for_start(engine, remote.as_ref());
        if provider == AgentProvider::Pi && (engine != Engine::V2 || remote.is_some()) {
            return Err(AgentChatError::Unsupported(
                "Pi RPC native chat requires the local v2 agent engine".to_string(),
            ));
        }
        if provider == AgentProvider::Pi && non_empty(overrides.effort.clone()).is_some() {
            return Err(AgentChatError::Unsupported(
                "Pi thinking-level selection is not exposed in this release".to_string(),
            ));
        }
        if engine == Engine::V1 && provider == AgentProvider::ClaudeCode {
            claude_v1_permission_mode(overrides.permission_mode.clone())?;
            claude_v1_allowed_tools(overrides.allowed_tools.clone())?;
        }
        if provider == AgentProvider::Omp && (engine != Engine::V2 || remote.is_some()) {
            return Err(AgentChatError::Unsupported(
                "OMP ACP native chat requires the local v2 engine".to_string(),
            ));
        }
        let omp_identity = if provider == AgentProvider::Omp {
            validate_omp_mcp_servers(&overrides.mcp_servers)
                .map_err(|err| AgentChatError::Unsupported(err.to_string()))?;
            let canonical_project_root = std::fs::canonicalize(&project_root).map_err(|error| {
                AgentChatError::Spawn(format!("failed to canonicalize OMP session cwd: {error}"))
            })?;
            project_root = canonical_project_root.clone();
            Some(OmpClientIdentity {
                canonical_project_root,
                normalized_mcp_grants: normalize_omp_mcp_grants(&overrides.mcp_servers),
            })
        } else {
            None
        };
        let existing_omp = if provider == AgentProvider::Omp {
            self.lock_inner()?
                .values()
                .find(|state| state.chat_id == chat_id && state.provider == AgentProvider::Omp)
                .and_then(|state| {
                    state.omp_client.as_ref().map(|client| {
                        (
                            Arc::clone(client),
                            state.model.clone(),
                            state.omp_identity.clone(),
                        )
                    })
                })
        } else {
            None
        };
        let reusable_omp = existing_omp.as_ref().and_then(
            |(client, current_model, current_identity)| {
                (!client.is_closed() && current_identity.as_ref() == omp_identity.as_ref())
                    .then(|| (Arc::clone(client), current_model.clone()))
            },
        );
        if let Some((client, _, current_identity)) = existing_omp.as_ref() {
            if !client.is_closed() && current_identity.as_ref() != omp_identity.as_ref() {
                client.close();
            }
        }
        if reusable_omp
            .as_ref()
            .is_some_and(|(_, current_model)| current_model.is_some() && model.is_none())
        {
            return Err(AgentChatError::Unsupported(
                "OMP model selection cannot be cleared on a live session".to_string(),
            ));
        }
        let latest = self.db.latest_agent_session_for_chat(chat_id)?;
        let (session_id, persisted_provider_session_id) =
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
        let mut provider_session_id = if let Some(remote) = remote.as_ref() {
            self.remote_session_id(chat_id, provider, &remote.host, &remote.remote_root)
                .or_else(|| {
                    remote_provider_session_id(persisted_provider_session_id.as_deref(), remote)
                })
        } else {
            local_provider_session_id(persisted_provider_session_id)
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
                    remote: remote.clone(),
                    provider,
                    engine,
                    model: model.clone(),
                    last_turn_model: None,
                    sandbox: non_empty(overrides.sandbox.clone()),
                    approval_policy: non_empty(overrides.approval_policy.clone()),
                    effort: overrides.effort.clone(),
                    permission_mode: overrides.permission_mode.clone(),
                    allowed_tools: overrides.allowed_tools.clone(),
                    provider_session_id: provider_session_id.clone(),
                    sink: Arc::clone(&sink),
                    pi_client: None,
                    active_turn: None,
                    terminal_pending: false,
                    pending_approvals: Vec::new(),
                    omp_client: None,
                    omp_identity: omp_identity.clone(),
                },
            );
        }

        // A webview reload re-attaches to a session the manager kept alive; the
        // rebuilt store starts from persisted history, which excludes transient
        // turn state. Replay it so a running turn and its unanswered approvals
        // survive the reload.
        let replay = {
            let inner = self.lock_inner()?;
            inner
                .get(&session_id)
                .map(|state| {
                    let mut events = Vec::new();
                    if state.active_turn.is_some() {
                        events.push(AgentEvent::TurnStarted);
                    }
                    events.extend(state.pending_approvals.iter().map(|(_, event)| event.clone()));
                    events
                })
                .unwrap_or_default()
        };
        for event in replay {
            sink(event);
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
            (Engine::V2, AgentProvider::Omp) => {
                if let Some((client, current_model)) = reusable_omp {
                    client
                        .set_sink(self.wrapping_sink(session_id.clone(), chat_id.to_string()))
                        .map_err(|err| AgentChatError::Spawn(err.to_string()))?;
                    if current_model != model {
                        if let Some(model) = model.as_deref() {
                            client
                                .set_model(model)
                                .map_err(|err| AgentChatError::Spawn(err.to_string()))?;
                        }
                    }
                    if let Some(state) = self.lock_inner()?.get_mut(&session_id) {
                        state.omp_client = Some(client);
                    }
                } else {
                    let mut options = OmpAcpOptions {
                        binary: self
                            .omp_binary()
                            .map(PathBuf::from)
                            .unwrap_or_else(|| PathBuf::from("omp")),
                        project_root,
                        session: provider_session_id
                            .map(OmpAcpSessionOpen::Resume)
                            .unwrap_or(OmpAcpSessionOpen::New),
                        model,
                        mcp_servers: overrides.mcp_servers,
                        sink: self.wrapping_sink(session_id.clone(), chat_id.to_string()),
                    };
                    let resume_requested = matches!(options.session, OmpAcpSessionOpen::Resume(_));
                    let client = match OmpAcpClient::spawn(options.clone()) {
                        Ok(client) => Ok(client),
                        // Provider session ids are opaque and may expire outside
                        // PickForge. Only a typed failure from the resume/open
                        // exchange gets one isolated fresh-session attempt.
                        // Model/config application happens after that exchange
                        // and must never abandon a successfully resumed session.
                        Err(OmpAcpError::SessionOpen(_)) if resume_requested => {
                            options.session = OmpAcpSessionOpen::New;
                            OmpAcpClient::spawn(options)
                        }
                        Err(error) => Err(error),
                    }
                    .map(Arc::new)
                    .map_err(|err| {
                        if let Ok(mut inner) = self.inner.lock() {
                            inner.remove(&session_id);
                        }
                        let _ = self.db.agent_session_set_status(&session_id, "failed");
                        AgentChatError::Spawn(err.to_string())
                    })?;
                    let provider_session_id = client
                        .provider_session_id()
                        .map_err(|err| AgentChatError::Spawn(err.to_string()))?;
                    self.db
                        .agent_session_set_provider_session_id(&session_id, &provider_session_id)?;
                    if let Some(state) = self.lock_inner()?.get_mut(&session_id) {
                        state.provider_session_id = Some(provider_session_id);
                        state.omp_client = Some(client);
                    }
                }
            }
            (Engine::V2, AgentProvider::Pi) => {
                let existing_client = self
                    .lock_inner()?
                    .get(&session_id)
                    .and_then(|state| state.pi_client.clone())
                    .filter(|client| !client.is_closed());
                if existing_client.is_none() {
                    let session_root = self.app_root.clone();
                    let session_dir = session_root.join("agent-sessions").join("pi");
                    let persisted_path = provider_session_id
                        .as_deref()
                        .map(PathBuf::from)
                        .filter(|path| path.is_absolute() && path.starts_with(&session_dir));
                    let session_path = persisted_path
                        .unwrap_or_else(|| session_dir.join(format!("{session_id}.jsonl")));
                    let client = spawn_pi_rpc(
                        PiRpcOptions {
                            cwd: project_root.clone(),
                            session_root,
                            session_dir,
                            session_path,
                            model: model.clone(),
                            binary: self.pi_binary(),
                            no_extensions: true,
                            offline: false,
                            environment_overrides: HashMap::new(),
                        },
                        self.wrapping_sink(session_id.clone(), chat_id.to_string()),
                    )
                    .map(Arc::new)
                    .map_err(|error| {
                        if let Ok(mut inner) = self.inner.lock() {
                            inner.remove(&session_id);
                        }
                        let _ = self.db.agent_session_set_status(&session_id, "failed");
                        AgentChatError::Spawn(error.to_string())
                    })?;
                    let mut inner = self.lock_inner()?;
                    let state = inner
                        .get_mut(&session_id)
                        .ok_or_else(|| AgentChatError::UnknownSession(session_id.clone()))?;
                    state.pi_client = Some(client);
                }
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
        // Snapshot under a short lock: acquiring a provider client can evict a
        // dead one, and eviction relocks `inner` — holding it across that call
        // would self-deadlock the manager. The turn is claimed atomically via
        // claim_turn once a handle exists.
        let (
            chat_id,
            project_root,
            remote,
            provider,
            engine,
            session_model,
            provider_session_id,
            sandbox,
            approval_policy,
            session_effort,
            permission_mode,
            allowed_tools,
            omp_client,
            pi_client,
        ) = {
            let mut inner = self.lock_inner()?;
            let state = inner
                .get_mut(session_id)
                .ok_or_else(|| AgentChatError::UnknownSession(session_id.to_string()))?;
            if state.active_turn.is_some() {
                return Err(AgentChatError::TurnActive);
            }
            if state.provider == AgentProvider::Pi && !images.is_empty() {
                return Err(AgentChatError::Unsupported(
                    "Pi RPC image-path input is not supported by PickForge".to_string(),
                ));
            }
            if state.engine == Engine::V1 && !images.is_empty() {
                return Err(AgentChatError::Unsupported(
                    "v1 agent engine cannot accept image input".to_string(),
                ));
            }
            state.last_turn_model = match state.provider {
                AgentProvider::Codex => turn_model.clone().or_else(|| state.model.clone()),
                AgentProvider::ClaudeCode | AgentProvider::Omp => state.model.clone(),
                AgentProvider::ClaudeCode | AgentProvider::Pi => state.model.clone(),
            };
            (
                state.chat_id.clone(),
                state.project_root.clone(),
                state.remote.clone(),
                state.provider,
                state.engine,
                state.model.clone(),
                state.provider_session_id.clone(),
                state.sandbox.clone(),
                state.approval_policy.clone(),
                state.effort.clone(),
                state.permission_mode.clone(),
                state.allowed_tools.clone(),
                state.omp_client.clone(),
                state.pi_client.clone(),
            )
        };
        let codex_model = turn_model.or_else(|| session_model.clone());
        let session_id_owned = session_id.to_string();
        let remote_v1 = remote.is_some();
        let v1_overrides = if engine == Engine::V1 {
            v1_turn_overrides(
                provider,
                remote_v1,
                effort.clone(),
                session_effort.clone(),
                sandbox.clone(),
                approval_policy.clone(),
                permission_mode.clone(),
                allowed_tools.clone(),
            )?
        } else {
            V1TurnOverrides::default()
        };

        // Persist the prompt BEFORE the provider dispatch so it always wins the
        // sequence race against assistant/usage events the reader thread may
        // append the instant the turn starts — otherwise reloaded history can
        // show the reply before the prompt. A dispatch that fails, or a session
        // disposed mid-flight, rolls these rows back so no phantom prompt (or
        // orphan of a deleted chat) survives.
        let persist_prompt = |db: &Database| -> Result<Vec<i64>, AgentChatError> {
            let mut seqs = vec![db.agent_message_append(&session_id_owned, &chat_id, "user", text)?];
            if !images.is_empty() {
                let payload =
                    serde_json::json!({ "kind": "attachments", "paths": images }).to_string();
                match db.agent_item_append(&session_id_owned, &chat_id, "attachments", &payload) {
                    Ok(seq) => seqs.push(seq),
                    // The message committed but its attachments didn't — roll the
                    // message back too so a half-persisted prompt never survives.
                    Err(err) => {
                        let _ = db.agent_prompt_rollback(&chat_id, &seqs);
                        return Err(err.into());
                    }
                }
            }
            Ok(seqs)
        };
        let rollback_prompt = |seqs: &[i64]| {
            let _ = self.db.agent_prompt_rollback(&chat_id, seqs);
        };

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
            if !self.claim_turn(
                session_id,
                ActiveTurn::new(ActiveTurnHandle::CodexApp {
                    client: Arc::clone(&client),
                    thread_id: thread_id.clone(),
                    turn_id: Arc::clone(&turn_id),
                    pending_interrupt: Arc::clone(&pending_interrupt),
                }),
            )? {
                return Ok(());
            }
            let prompt_seqs =
                persist_prompt(&self.db).map_err(|err| self.abort_send(session_id, err))?;

            // Arm cancellation BEFORE the request so a turn/started arriving
            // during the wait is captured, then reconcile on the outcome so
            // only an orphaned (timed-out) turn is interrupted, never a legit
            // one on the same thread.
            client.begin_turn_start(&thread_id);
            match client.turn_start(
                &thread_id,
                text,
                codex_model,
                effort.clone(),
                &images,
                sandbox,
                approval_policy,
            ) {
                Ok(started_turn_id) => {
                    client.finish_turn_start_ok(&thread_id, &started_turn_id);
                    // Disposed while turn/start was in flight: the session (and
                    // its just-installed turn) is gone — drop the orphan prompt.
                    // dispose() could only arm pending_interrupt (the turn id
                    // wasn't known yet), so stop the now-started server turn
                    // here or it keeps running headless.
                    if !self.session_present(session_id) {
                        if pending_interrupt.swap(false, Ordering::SeqCst) {
                            let _ = client.turn_interrupt(&thread_id, &started_turn_id);
                        }
                        rollback_prompt(&prompt_seqs);
                        return Ok(());
                    }
                    *turn_id.lock().map_err(|_| {
                        AgentChatError::Spawn("agent turn lock poisoned".to_string())
                    })? = Some(started_turn_id);
                    // swap: exactly one of send()/kill() fires the interrupt.
                    if pending_interrupt.swap(false, Ordering::SeqCst) {
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
                    // A local timeout doesn't mean the app-server rejected the
                    // turn — it may have accepted and started running it, so
                    // stay armed and interrupt that orphan once its turn/started
                    // is seen. Any other error means no turn was created.
                    if matches!(err, CodexAppError::RequestTimeout { .. }) {
                        client.finish_turn_start_timeout(&thread_id);
                    } else {
                        client.finish_turn_start_err(&thread_id);
                    }
                    rollback_prompt(&prompt_seqs);
                    let _ = self.db.agent_session_set_status(session_id, "failed");
                    if let Some(turn) = clear_active_turn(&self.inner, session_id) {
                        turn.reap();
                    }
                    return Err(AgentChatError::Spawn(err.to_string()));
                }
            }
        }

        if engine == Engine::V2 && provider == AgentProvider::Pi {
            let client = pi_client.ok_or_else(|| {
                AgentChatError::Spawn("Pi RPC client is not running".to_string())
            })?;
            if client.is_closed() {
                let _ = self.db.agent_session_set_status(session_id, "failed");
                return Err(AgentChatError::Spawn("Pi RPC client is closed".to_string()));
            }
            let prompt_started = Arc::new(AtomicBool::new(false));
            let pending_interrupt = Arc::new(AtomicBool::new(false));
            if !self.claim_turn(
                session_id,
                ActiveTurn::new(ActiveTurnHandle::PiRpc {
                    client: Arc::clone(&client),
                    prompt_started: Arc::clone(&prompt_started),
                    pending_interrupt: Arc::clone(&pending_interrupt),
                }),
            )? {
                return Ok(());
            }
            let prompt_seqs =
                persist_prompt(&self.db).map_err(|err| self.abort_send(session_id, err))?;
            return match start_pi_prompt(
                &client,
                &prompt_started,
                &pending_interrupt,
                text,
            ) {
                Ok(()) => {
                    if !self.session_present(session_id) {
                        rollback_prompt(&prompt_seqs);
                    }
                    Ok(())
                }
                Err(error) => {
                    rollback_prompt(&prompt_seqs);
                    let _ = self.db.agent_session_set_status(session_id, "failed");
                    if let Some(turn) = clear_active_turn(&self.inner, session_id) {
                        turn.reap();
                    }
                    Err(AgentChatError::Spawn(error.to_string()))
                }
            };
        }

        if engine == Engine::V2 && provider == AgentProvider::ClaudeCode {
            let client = self.claude_bridge_client()?;
            // The bridge chat dies with its claude CLI process (crash, auth
            // expiry, idle exit) while the session stays resumable — restart it
            // transparently instead of sending into a void.
            if !client.chat_started(&session_id_owned) {
                if let Err(err) = client.chat_start(
                    &session_id_owned,
                    project_root.clone(),
                    session_model.clone(),
                    session_effort,
                    provider_session_id.clone(),
                    Some(
                        permission_mode
                            .filter(|value| !value.trim().is_empty())
                            .unwrap_or_else(|| "default".to_string()),
                    ),
                    allowed_tools,
                    self.wrapping_sink(session_id_owned.clone(), chat_id.clone()),
                ) {
                    let _ = self.db.agent_session_set_status(session_id, "failed");
                    return Err(AgentChatError::Spawn(err.to_string()));
                }
            }
            if !self.claim_turn(
                session_id,
                ActiveTurn::new(ActiveTurnHandle::ClaudeBridge {
                    client: Arc::clone(&client),
                    chat_id: session_id_owned.clone(),
                }),
            )? {
                return Ok(());
            }
            let prompt_seqs =
                persist_prompt(&self.db).map_err(|err| self.abort_send(session_id, err))?;
            return match client.chat_send(&session_id_owned, text, &images) {
                Ok(()) => {
                    if !self.session_present(session_id) {
                        rollback_prompt(&prompt_seqs);
                    }
                    Ok(())
                }
                Err(err) => {
                    rollback_prompt(&prompt_seqs);
                    if let Some(turn) = clear_active_turn(&self.inner, session_id) {
                        turn.reap();
                    }
                    Err(AgentChatError::Spawn(err.to_string()))
                }
            };
        }

        if engine == Engine::V2 && provider == AgentProvider::Omp {
            let client = omp_client.ok_or_else(|| {
                AgentChatError::Spawn("OMP ACP client is not running".to_string())
            })?;
            if !self.claim_turn(
                session_id,
                ActiveTurn::new(ActiveTurnHandle::Omp {
                    client: Arc::clone(&client),
                }),
            )? {
                return Ok(());
            }
            let prompt_seqs =
                persist_prompt(&self.db).map_err(|err| self.abort_send(session_id, err))?;
            return match client.prompt(text, &images) {
                Ok(()) => Ok(()),
                Err(err) => {
                    rollback_prompt(&prompt_seqs);
                    if let Some(turn) = clear_active_turn(&self.inner, session_id) {
                        turn.reap();
                    }
                    let _ = self.db.agent_session_set_status(session_id, "idle");
                    Err(AgentChatError::Spawn(err.to_string()))
                }
            };
        }
        // V1 one-shot engine: the handle only exists after spawn, so a fast
        // process failure can emit its terminal event before the turn is
        // claimed. persist_prompt runs before spawn (seq order), and claim_turn
        // reports whether a terminal already landed so a stale handle isn't
        // installed on a dead process.
        let prompt_seqs =
            persist_prompt(&self.db).map_err(|err| self.abort_send(session_id, err))?;
        let spawned = match (engine, provider) {
            (Engine::V1, AgentProvider::Codex) => {
                let wrapped_sink = self.wrapping_sink(session_id_owned.clone(), chat_id.clone());
                spawn_codex_turn(
                    CodexTurnOptions {
                        prompt: text.to_string(),
                        cwd: project_root,
                        model: codex_model,
                        effort: v1_overrides.effort,
                        sandbox: v1_overrides.sandbox,
                        approval_policy: v1_overrides.approval_policy,
                        resume_thread_id: provider_session_id,
                        binary: self.codex_binary(),
                        remote,
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
                        effort: v1_overrides.effort,
                        resume_session_id: provider_session_id,
                        permission_mode: v1_overrides.permission_mode,
                        allowed_tools: v1_overrides.allowed_tools,
                        binary: self.claude_binary(),
                        remote,
                    },
                    move |event| wrapped_sink(event),
                )
                .map(ActiveTurnHandle::Claude)
                .map_err(|err| AgentChatError::Spawn(err.to_string()))
            }
            (Engine::V1, AgentProvider::Omp) => Err(AgentChatError::Unsupported(
                "OMP ACP requires the v2 agent engine".to_string(),
            (Engine::V1, AgentProvider::Pi) => Err(AgentChatError::Unsupported(
                "Pi RPC requires the v2 agent engine".to_string(),
            )),
            (Engine::V2, _) => unreachable!("handled before match"),
        };

        match spawned {
            Ok(turn) => {
                let turn = ActiveTurn::new(turn);
                match self.claim_turn(session_id, turn.clone()) {
                    // A terminal event already surfaced for this send (or it was
                    // disposed): don't install a handle for an ended process.
                    Ok(false) | Err(AgentChatError::UnknownSession(_)) => {
                        let _ = turn.kill();
                        turn.reap();
                        if !self.session_present(session_id) {
                            rollback_prompt(&prompt_seqs);
                        }
                        Ok(())
                    }
                    Ok(true) => Ok(()),
                    Err(err) => {
                        let _ = turn.kill();
                        turn.reap();
                        rollback_prompt(&prompt_seqs);
                        Err(err)
                    }
                }
            }
            Err(err) => {
                rollback_prompt(&prompt_seqs);
                let _ = self.db.agent_session_set_status(session_id, "failed");
                Err(err)
            }
        }
    }

    /// Atomically install a turn handle. Returns `Ok(true)` when installed,
    /// `Ok(false)` when a terminal event already fired for this pending send
    /// (V1 race) so the caller must not treat the turn as active. Errors with
    /// TurnActive if another send won the race, UnknownSession if disposed.
    fn claim_turn(&self, session_id: &str, turn: ActiveTurn) -> Result<bool, AgentChatError> {
        let mut inner = self.lock_inner()?;
        let state = inner
            .get_mut(session_id)
            .ok_or_else(|| AgentChatError::UnknownSession(session_id.to_string()))?;
        if state.terminal_pending {
            state.terminal_pending = false;
            return Ok(false);
        }
        if state.active_turn.is_some() {
            return Err(AgentChatError::TurnActive);
        }
        state.active_turn = Some(turn);
        Ok(true)
    }

    fn session_present(&self, session_id: &str) -> bool {
        self.inner
            .lock()
            .map(|inner| inner.contains_key(session_id))
            .unwrap_or(false)
    }

    /// Unwind a send that failed after the turn was claimed / status set to
    /// running (e.g. prompt persistence errored before dispatch) so the session
    /// isn't left wedged as active. Returns the error for `?` threading.
    fn abort_send<E>(&self, session_id: &str, err: E) -> E {
        let _ = self.db.agent_session_set_status(session_id, "failed");
        if let Some(turn) = clear_active_turn(&self.inner, session_id) {
            turn.reap();
        }
        err
    }

    pub fn approve(
        &self,
        session_id: &str,
        approval_id: &str,
        decision: &str,
    ) -> Result<(), AgentChatError> {
        let (engine, provider, project_root, omp_client) = {
            let inner = self.lock_inner()?;
            let state = inner
                .get(session_id)
                .ok_or_else(|| AgentChatError::UnknownSession(session_id.to_string()))?;
            (
                state.engine,
                state.provider,
                state.project_root.clone(),
                state.omp_client.clone(),
            )
        };

        let result = match (engine, provider) {
            (Engine::V2, AgentProvider::Codex) => {
                let client = self.cached_codex_app_client(&project_root)?;
                let request_id = RequestIdRepr::from_serialized(approval_id);
                // A permission-escalation grant has no cancel in its response
                // shape, so cancel must interrupt the turn. Do it before the
                // (deny) response so the app-server sees the intent.
                if decision == "cancel" && client.is_permission_request(&request_id) {
                    let active_turn = self
                        .lock_inner()?
                        .get(session_id)
                        .and_then(|state| state.active_turn.clone());
                    if let Some(turn) = active_turn {
                        let _ = turn.kill();
                    }
                }
                client
                    .respond_approval(request_id, decision)
                    .map_err(|err| AgentChatError::Spawn(err.to_string()))
            }
            (Engine::V2, AgentProvider::ClaudeCode) => self
                .cached_claude_bridge_client()?
                .chat_approve(session_id, approval_id, decision)
                .map_err(|err| AgentChatError::Spawn(err.to_string())),
            (Engine::V2, AgentProvider::Omp) => omp_client
                .ok_or_else(|| AgentChatError::Spawn("OMP ACP client is not running".to_string()))?
                .approve(approval_id, decision)
                .map_err(|err| AgentChatError::Spawn(err.to_string())),
            (Engine::V2, AgentProvider::Pi) => Err(AgentChatError::Unsupported(
                "Pi RPC has no native approval protocol".to_string(),
            )),
            (Engine::V1, _) => Err(AgentChatError::Unsupported(
                "approvals require the v2 agent engine".to_string(),
            )),
        };
        if result.is_ok() {
            if let Ok(mut states) = self.inner.lock() {
                if let Some(state) = states.get_mut(session_id) {
                    state.pending_approvals.retain(|(id, _)| id != approval_id);
                }
            }
        }
        result
    }

    pub fn steer(&self, session_id: &str, text: &str) -> Result<(), AgentChatError> {
        let (engine, provider, chat_id, active_turn) = {
            let inner = self.lock_inner()?;
            let state = inner
                .get(session_id)
                .ok_or_else(|| AgentChatError::UnknownSession(session_id.to_string()))?;
            (
                state.engine,
                state.provider,
                state.chat_id.clone(),
                state.active_turn.clone(),
            )
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
                    .map_err(|err| AgentChatError::Spawn(err.to_string()))?;
                // Record the steer as a user message so reloaded history keeps
                // the instruction that shaped the running turn.
                let _ = self.db.agent_message_append(session_id, &chat_id, "user", text);
                Ok(())
            }
            (Engine::V2, AgentProvider::ClaudeCode) => Err(AgentChatError::Unsupported(
                "claude steering is not supported until SDK steering is available".to_string(),
            )),
            (Engine::V2, AgentProvider::Omp) => Err(AgentChatError::Unsupported(
                "OMP ACP does not advertise turn steering".to_string(),
            )),
            (Engine::V2, AgentProvider::Pi) => {
                let Some(active_turn) = active_turn else {
                    return Err(AgentChatError::Unsupported(
                        "Pi steering requires an active turn".to_string(),
                    ));
                };
                let Some(client) = active_turn.pi_rpc_client()? else {
                    return Err(AgentChatError::Unsupported(
                        "Pi steering requires an active Pi RPC turn".to_string(),
                    ));
                };
                client
                    .steer(text)
                    .map_err(|error| AgentChatError::Spawn(error.to_string()))?;
                let _ = self.db.agent_message_append(session_id, &chat_id, "user", text);
                Ok(())
            }
            (Engine::V1, _) => Err(AgentChatError::Unsupported(
                "steering requires the v2 agent engine".to_string(),
            )),
        }
    }

    pub fn follow_up(&self, session_id: &str, text: &str) -> Result<(), AgentChatError> {
        let (chat_id, client) = {
            let inner = self.lock_inner()?;
            let state = inner
                .get(session_id)
                .ok_or_else(|| AgentChatError::UnknownSession(session_id.to_string()))?;
            if state.provider != AgentProvider::Pi || state.engine != Engine::V2 {
                return Err(AgentChatError::Unsupported(
                    "follow-up queueing is only supported by Pi RPC".to_string(),
                ));
            }
            if state.active_turn.is_none() {
                return Err(AgentChatError::Unsupported(
                    "Pi follow-up queueing requires an active turn".to_string(),
                ));
            }
            let client = state.pi_client.clone().ok_or_else(|| {
                AgentChatError::Spawn("Pi RPC client is not running".to_string())
            })?;
            (state.chat_id.clone(), client)
        };
        client
            .follow_up(text)
            .map_err(|error| AgentChatError::Spawn(error.to_string()))?;
        let _ = self.db.agent_message_append(session_id, &chat_id, "user", text);
        Ok(())
    }

    /// Apply a model change to a live session.
    pub fn set_model(
        &self,
        session_id: &str,
        model: Option<String>,
    ) -> Result<(), AgentChatError> {
        let model = non_empty(model);
        let (provider, engine, omp_client, pi_client) = {
            let inner = self.lock_inner()?;
            let state = inner
                .get(session_id)
                .ok_or_else(|| AgentChatError::UnknownSession(session_id.to_string()))?;
            (
                state.provider,
                state.engine,
                state.omp_client.clone(),
                state.pi_client.clone(),
            )
        };
        if engine == Engine::V2 && provider == AgentProvider::Omp {
            let model_id = model.as_deref().ok_or_else(|| {
                AgentChatError::Unsupported("OMP model selection cannot be cleared".to_string())
            })?;
            omp_client
                .ok_or_else(|| AgentChatError::Spawn("OMP ACP client is not running".to_string()))?
                .set_model(model_id)
                .map_err(|err| AgentChatError::Spawn(err.to_string()))?;
        }
        if engine == Engine::V2 && provider == AgentProvider::Pi {
            let model_name = model.as_deref().ok_or_else(|| {
                AgentChatError::Unsupported("Pi RPC requires an explicit provider/model".to_string())
            })?;
            pi_client
                .ok_or_else(|| AgentChatError::Spawn("Pi RPC client is not running".to_string()))?
                .set_model(model_name)
                .map_err(|error| AgentChatError::Spawn(error.to_string()))?;
        }
        if engine == Engine::V2 && provider == AgentProvider::ClaudeCode {
            let client = self.claude_bridge_client()?;
            client
                .chat_set_model(session_id, model.as_deref())
                .map_err(|err| AgentChatError::Spawn(err.to_string()))?;
        }
        {
            let mut inner = self.lock_inner()?;
            let state = inner
                .get_mut(session_id)
                .ok_or_else(|| AgentChatError::UnknownSession(session_id.to_string()))?;
            state.model = model.clone();
        }
        self.db.agent_session_set_model(session_id, model.as_deref())?;
        Ok(())
    }

    pub fn set_mode(
        &self,
        session_id: &str,
        sandbox: Option<String>,
        approval_policy: Option<String>,
        permission_mode: Option<String>,
    ) -> Result<(), AgentChatError> {
        let sandbox = sandbox.map(|value| non_empty(Some(value)));
        let approval_policy = approval_policy.map(|value| non_empty(Some(value)));
        let permission_mode = permission_mode.map(|value| non_empty(Some(value)));
        if let Some(mode) = permission_mode.as_ref().and_then(|mode| mode.as_deref()) {
            let omp_client = {
                let inner = self.lock_inner()?;
                let state = inner
                    .get(session_id)
                    .ok_or_else(|| AgentChatError::UnknownSession(session_id.to_string()))?;
                (state.provider == AgentProvider::Omp).then(|| state.omp_client.clone())
            }
            .flatten();
            if let Some(client) = omp_client {
                client
                    .set_mode(mode)
                    .map_err(|err| AgentChatError::Spawn(err.to_string()))?;
            }
        }
        let push_permission_mode = {
            let mut inner = self.lock_inner()?;
            let state = inner
                .get_mut(session_id)
                .ok_or_else(|| AgentChatError::UnknownSession(session_id.to_string()))?;
            if state.provider == AgentProvider::Pi {
                return Err(AgentChatError::Unsupported(
                    "Pi RPC exposes no native approval or sandbox mode control".to_string(),
                ));
            }
            if let Some(sandbox) = sandbox {
                state.sandbox = sandbox;
            }
            if let Some(approval_policy) = approval_policy {
                state.approval_policy = approval_policy;
            }
            if let Some(permission_mode) = permission_mode {
                state.permission_mode = permission_mode.clone();
                if let Some(permission_mode) = permission_mode {
                    if state.engine == Engine::V2 && state.provider == AgentProvider::ClaudeCode {
                        Some(permission_mode)
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(permission_mode) = push_permission_mode {
            let client = match self.cached_claude_bridge_client() {
                Ok(client) => Some(client),
                Err(AgentChatError::Spawn(message))
                    if message == "claude bridge client is not running" => None,
                Err(err) => return Err(err),
            };
            if let Some(client) = client {
                if client.chat_started(session_id) {
                    client
                        .chat_set_permission_mode(session_id, &permission_mode)
                        .map_err(|err| AgentChatError::Spawn(err.to_string()))?;
                }
            }
        }
        Ok(())
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
        let remote_sessions = Arc::clone(&self.remote_sessions);
        Arc::new(move |event| {
            handle_runner_event(
                &db,
                &sink_inner,
                &remote_sessions,
                &session_id,
                &chat_id,
                event,
            );
        })
    }

    fn remote_session_id(
        &self,
        chat_id: &str,
        provider: AgentProvider,
        host: &str,
        remote_root: &str,
    ) -> Option<String> {
        self.remote_sessions
            .lock()
            .ok()
            .and_then(|sessions| {
                sessions
                    .get(&RemoteSessionKey {
                        chat_id: chat_id.to_string(),
                        provider,
                        host: host.to_string(),
                        remote_root: remote_root.to_string(),
                    })
                    .cloned()
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
            standalone: bridge_sidecar_path(),
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

    /// Release a session's provider resources: the claude bridge keeps a
    /// resident `claude` CLI process per chat and codex keeps a thread
    /// subscription — without this, deleting a chat (or switching provider)
    /// leaks them until app exit.
    pub fn dispose(&self, session_id: &str) {
        let removed = self
            .lock_inner()
            .ok()
            .and_then(|mut inner| inner.remove(session_id));
        let Some(state) = removed else {
            return;
        };
        if let Some(turn) = state.active_turn {
            let _ = turn.kill();
            turn.reap();
        }
        if let Some(remote) = state.remote.as_ref() {
            if let Ok(mut sessions) = self.remote_sessions.lock() {
                sessions.remove(&RemoteSessionKey {
                    chat_id: state.chat_id.clone(),
                    provider: state.provider,
                    host: remote.host.clone(),
                    remote_root: remote.remote_root.clone(),
                });
            }
        }
        match (state.engine, state.provider) {
            (Engine::V2, AgentProvider::ClaudeCode) => {
                if let Ok(client) = self.cached_claude_bridge_client() {
                    let _ = client.chat_close(session_id);
                }
            }
            (Engine::V2, AgentProvider::Codex) => {
                if let Some(thread_id) = state.provider_session_id {
                    if let Ok(client) = self.cached_codex_app_client(&state.project_root) {
                        let _ = client.unsubscribe(&thread_id);
                    }
                }
            }
            (Engine::V2, AgentProvider::Omp) => {
                if let Some(client) = state.omp_client {
                    client.close();
            (Engine::V2, AgentProvider::Pi) => {
                if let Some(client) = state.pi_client {
                    let _ = client.shutdown();
                }
            }
            (Engine::V1, _) => {}
        }
        let _ = self.db.agent_session_set_status(session_id, "idle");
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
        omp_binary: Option<String>,
    ) -> Self {
        Self {
            db,
            app_root,
            inner: Arc::new(Mutex::new(HashMap::new())),
            codex_app_clients: Arc::new(Mutex::new(HashMap::new())),
            claude_bridge: Arc::new(Mutex::new(None)),
            remote_sessions: Arc::new(Mutex::new(HashMap::new())),
            starting_chats: Arc::new(Mutex::new(HashSet::new())),
            test_binaries: TestBinaries {
                codex: codex_binary,
                claude: claude_binary,
                omp: omp_binary,
                pi: None,
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
    #[cfg(test)]
    fn omp_binary(&self) -> Option<String> {
        self.test_binaries.omp.clone()
    }

    #[cfg(not(test))]
    fn omp_binary(&self) -> Option<String> {
        None
    }


    #[cfg(test)]
    fn pi_binary(&self) -> Option<String> {
        self.test_binaries.pi.clone()
    }

    #[cfg(not(test))]
    fn pi_binary(&self) -> Option<String> {
        None
    }
}

/// Packaged builds ship the bridge as the self-contained
/// `pickforge-claude-bridge` sidecar next to the app binary (Tauri
/// externalBin); dev builds have no such file and fall back to
/// `bun scripts/claude-bridge.ts`.
fn bridge_sidecar_path() -> Option<PathBuf> {
    // Dev builds iterate on the live script — `tauri dev` stages externalBin
    // next to the debug exe, and a stale compiled bridge must not shadow it.
    if cfg!(debug_assertions) {
        return None;
    }
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let name = if cfg!(windows) {
        "pickforge-claude-bridge.exe"
    } else {
        "pickforge-claude-bridge"
    };
    let candidate = exe_dir.join(name);
    candidate.is_file().then_some(candidate)
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
        existing.remote = state.remote;
        existing.provider = state.provider;
        existing.engine = state.engine;
        existing.model = state.model;
        existing.sandbox = state.sandbox;
        existing.approval_policy = state.approval_policy;
        existing.effort = state.effort;
        existing.permission_mode = state.permission_mode;
        existing.allowed_tools = state.allowed_tools;
        existing.provider_session_id = state.provider_session_id;
        existing.omp_identity = state.omp_identity;
        if existing.pi_client.as_ref().is_none_or(|client| client.is_closed()) {
            existing.pi_client = state.pi_client;
        }
        existing.sink = state.sink;
    } else {
        inner.insert(session_id, state);
    }
}

fn start_pi_prompt(
    client: &Arc<PiRpcClient>,
    prompt_started: &Arc<AtomicBool>,
    pending_interrupt: &Arc<AtomicBool>,
    text: &str,
) -> Result<(), PiRpcError> {
    client.prompt(text)?;
    prompt_started.store(true, Ordering::SeqCst);
    if pending_interrupt.swap(false, Ordering::SeqCst) {
        client.abort()?;
    }
    Ok(())
}

impl ActiveTurn {
    fn new(handle: ActiveTurnHandle) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Some(handle))),
        }
    }

    fn kill(&self) -> Result<(), AgentChatError> {
        // Provider interrupt calls block on responses delivered by reader
        // threads whose terminal path reaps this handle, so decide the action
        // under the mutex and execute it only after releasing the mutex.
        let (codex_interrupt, pi_interrupt) = {
            let handle = self
                .inner
                .lock()
                .map_err(|_| AgentChatError::Spawn("agent turn lock poisoned".to_string()))?;
            match handle.as_ref() {
                Some(ActiveTurnHandle::Codex(turn)) => {
                    return turn
                        .kill()
                        .map_err(|err| AgentChatError::Spawn(err.to_string()));
                }
                Some(ActiveTurnHandle::Claude(turn)) => {
                    return turn
                        .kill()
                        .map_err(|err| AgentChatError::Spawn(err.to_string()));
                }
                Some(ActiveTurnHandle::ClaudeBridge { client, chat_id }) => {
                    return client
                        .chat_interrupt(chat_id)
                        .map_err(|err| AgentChatError::Spawn(err.to_string()));
                }
                Some(ActiveTurnHandle::Omp { client }) => {
                    return client
                        .cancel()
                        .map_err(|err| AgentChatError::Spawn(err.to_string()));
                Some(ActiveTurnHandle::PiRpc {
                    client,
                    prompt_started,
                    pending_interrupt,
                }) => {
                    // Arm before checking prompt_started. Whichever side wins
                    // the race swaps the flag and sends exactly one abort, but
                    // never before Pi has acknowledged the prompt command.
                    pending_interrupt.store(true, Ordering::SeqCst);
                    let client = if prompt_started.load(Ordering::SeqCst)
                        && pending_interrupt.swap(false, Ordering::SeqCst)
                    {
                        Some(Arc::clone(client))
                    } else {
                        None
                    };
                    (None, client)
                }
                Some(ActiveTurnHandle::CodexApp {
                    client,
                    thread_id,
                    turn_id,
                    pending_interrupt,
                }) => {
                    // Arm the flag BEFORE reading the turn id: a send() racing
                    // to publish the id is then guaranteed to observe it. The
                    // swap makes send()/kill() fire the interrupt exactly once.
                    pending_interrupt.store(true, Ordering::SeqCst);
                    let turn_id = turn_id
                        .lock()
                        .map_err(|_| {
                            AgentChatError::Spawn("agent turn lock poisoned".to_string())
                        })?
                        .clone();
                    let interrupt = match turn_id {
                        Some(turn_id) if pending_interrupt.swap(false, Ordering::SeqCst) => {
                            Some((Arc::clone(client), thread_id.clone(), turn_id))
                        }
                        _ => None,
                    };
                    (interrupt, None)
                }
                None => (None, None),
            }
        };

        if let Some(client) = pi_interrupt {
            return client
                .abort()
                .map_err(|error| AgentChatError::Spawn(error.to_string()));
        }
        match codex_interrupt {
            Some((client, thread_id, turn_id)) => client
                .turn_interrupt(&thread_id, &turn_id)
                .map_err(|err| AgentChatError::Spawn(err.to_string())),
            None => Ok(()),
        }
    }

    fn pi_rpc_client(&self) -> Result<Option<Arc<PiRpcClient>>, AgentChatError> {
        let handle = self
            .inner
            .lock()
            .map_err(|_| AgentChatError::Spawn("agent turn lock poisoned".to_string()))?;
        Ok(match handle.as_ref() {
            Some(ActiveTurnHandle::PiRpc { client, .. }) => Some(Arc::clone(client)),
            _ => None,
        })
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
    remote_sessions: &Arc<Mutex<HashMap<RemoteSessionKey, String>>>,
    session_id: &str,
    chat_id: &str,
    event: AgentEvent,
) {
    let mut errors = Vec::new();
    let mut active_turn = None;

    // Turn-scoped events for a session that no longer owns a turn are stale and
    // must be dropped entirely (not persisted, not forwarded):
    //  - a disposed session (chat deleted / provider switched) may still get
    //    queued events before its subscription tears down — persisting them
    //    would recreate rows for a gone chat (tables have no chat FK);
    //  - a V2 turn whose start errored (e.g. timed out after the app-server
    //    accepted it) has its handle cleared, but the server can still emit a
    //    late turn/started + items whose terminal would then be skipped,
    //    wedging the UI as running.
    // SessionStarted/RateLimits/Noise are not turn-scoped and always pass.
    let (session_present, has_turn, is_v2) = inner
        .lock()
        .map(|states| {
            states.get(session_id).map_or((false, false, false), |state| {
                (true, state.active_turn.is_some(), state.engine == Engine::V2)
            })
        })
        .unwrap_or((false, false, false));
    let turn_scoped = !matches!(
        &event,
        AgentEvent::SessionStarted { .. }
            | AgentEvent::SessionTitle { .. }
            | AgentEvent::ProviderPayload { .. }
            | AgentEvent::SessionUpdated { .. }
            | AgentEvent::ProviderEvent { .. }
            | AgentEvent::RateLimits { .. }
            | AgentEvent::Noise { .. }
    );
    if !session_present
        && matches!(
            &event,
            AgentEvent::SessionTitle { .. } | AgentEvent::ProviderPayload { .. }
        )
    {
        return;
    }
    if turn_scoped && (!session_present || (is_v2 && !has_turn)) {
        return;
    }

    match &event {
        AgentEvent::SessionStarted {
            provider_session_id,
        } => {
            let persisted_session_id = inner
                .lock()
                .ok()
                .and_then(|states| {
                    states.get(session_id).and_then(|state| {
                        state.remote.as_ref().map(|remote| {
                            persisted_remote_provider_session_id(remote, provider_session_id)
                        })
                    })
                })
                .unwrap_or_else(|| provider_session_id.clone());
            if let Err(err) =
                db.agent_session_set_provider_session_id(session_id, &persisted_session_id)
            {
                errors.push(err.to_string());
            }
            if let Ok(mut states) = inner.lock() {
                if let Some(state) = states.get_mut(session_id) {
                    state.provider_session_id = Some(provider_session_id.clone());
                    if let Some(remote) = state.remote.as_ref() {
                        if let Ok(mut sessions) = remote_sessions.lock() {
                            sessions.insert(
                                RemoteSessionKey {
                                    chat_id: state.chat_id.clone(),
                                    provider: state.provider,
                                    host: remote.host.clone(),
                                    remote_root: remote.remote_root.clone(),
                                },
                                provider_session_id.clone(),
                            );
                        }
                    }
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
        | AgentEvent::PlanUpdate { .. } => {
            if let Err(err) = append_item(db, session_id, chat_id, &event) {
                errors.push(err);
            }
        }
        // Raw provider frames are live diagnostic events. They may contain
        // high-volume chunks and provider-specific data, so never turn them
        // into durable timeline rows.
        AgentEvent::ProviderPayload { .. } => {}
        AgentEvent::SessionTitle { .. } => {
            if let Err(err) = append_item(db, session_id, chat_id, &event) {
                errors.push(err);
            }
        }
        AgentEvent::Usage { .. } => {
            let model = inner.lock().ok().and_then(|states| {
                states.get(session_id).and_then(|state| {
                    state.last_turn_model.clone().or_else(|| state.model.clone())
                })
            });
            if let Err(err) = append_usage_item(db, session_id, chat_id, &event, model) {
                errors.push(err);
            }
        }
        AgentEvent::TurnDone { .. } => {
            if terminal_should_skip(inner, session_id) {
                return;
            }
            if let Err(err) = db.agent_session_set_status(session_id, "idle") {
                errors.push(err.to_string());
            }
            active_turn = clear_active_turn(inner, session_id);
            clear_pending_approvals(inner, session_id);
        }
        AgentEvent::TurnFailed { .. } => {
            if terminal_should_skip(inner, session_id) {
                return;
            }
            if let Err(err) = append_item(db, session_id, chat_id, &event) {
                errors.push(err);
            }
            let status = inner
                .lock()
                .ok()
                .and_then(|states| states.get(session_id).map(|state| state.provider))
                .map_or("failed", |provider| {
                    if provider == AgentProvider::Omp {
                        "idle"
                    } else {
                        "failed"
                    }
                });
            if let Err(err) = db.agent_session_set_status(session_id, status) {
                errors.push(err.to_string());
            }
            active_turn = clear_active_turn(inner, session_id);
            clear_pending_approvals(inner, session_id);
        }
        AgentEvent::ApprovalRequest { approval_id, .. } => {
            if let Ok(mut states) = inner.lock() {
                if let Some(state) = states.get_mut(session_id) {
                    state
                        .pending_approvals
                        .push((approval_id.clone(), event.clone()));
                }
            }
        }
        AgentEvent::TurnStarted => {}
        AgentEvent::TextDelta { .. }
        | AgentEvent::ThinkingDelta { .. }
        | AgentEvent::CommandOutput { .. }
        | AgentEvent::ProviderEvent { .. }
        | AgentEvent::SessionUpdated { .. }
        | AgentEvent::Noise { .. }
        | AgentEvent::RateLimits { .. } => {}
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
    append_item_value(db, session_id, chat_id, value)
}

/// Usage rows carry the model that served the turn — sessions can switch
/// models, so attribution must be captured when the event lands, not joined
/// from the mutable session row later.
fn append_usage_item(
    db: &Database,
    session_id: &str,
    chat_id: &str,
    event: &AgentEvent,
    model: Option<String>,
) -> Result<(), String> {
    let mut value = serde_json::to_value(event).map_err(|err| err.to_string())?;
    if let (Some(object), Some(model)) = (value.as_object_mut(), model) {
        object.insert("model".to_string(), serde_json::Value::String(model));
    }
    append_item_value(db, session_id, chat_id, value)
}

fn append_item_value(
    db: &Database,
    session_id: &str,
    chat_id: &str,
    value: serde_json::Value,
) -> Result<(), String> {
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
    inner
        .lock()
        .ok()
        .and_then(|mut states| states.get_mut(session_id)?.active_turn.take())
}

/// Whether a terminal event should be ignored. A session that already owns an
/// active turn keeps it (not skipped). Otherwise: a V2 session with no turn is
/// a broadcast to an idle codex-app subscriber (its shared client crashed) —
/// skip so idle chats don't get phantom failures. A V1 session with no turn hit
/// the spawn-vs-terminal race: mark `terminal_pending` so the imminent claim
/// aborts, and process the terminal so the session isn't wedged as running.
fn terminal_should_skip(
    inner: &Arc<Mutex<HashMap<String, SessionState>>>,
    session_id: &str,
) -> bool {
    let Ok(mut states) = inner.lock() else {
        return true;
    };
    let Some(state) = states.get_mut(session_id) else {
        return true;
    };
    if state.active_turn.is_some() {
        return false;
    }
    if state.engine == Engine::V2 {
        return true;
    }
    state.terminal_pending = true;
    false
}

fn clear_pending_approvals(
    inner: &Arc<Mutex<HashMap<String, SessionState>>>,
    session_id: &str,
) {
    if let Ok(mut states) = inner.lock() {
        if let Some(state) = states.get_mut(session_id) {
            state.pending_approvals.clear();
        }
    }
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

fn normalize_omp_mcp_grants(servers: &[serde_json::Value]) -> Vec<serde_json::Value> {
    fn normalize(value: &serde_json::Value) -> serde_json::Value {
        match value {
            serde_json::Value::Array(values) => {
                serde_json::Value::Array(values.iter().map(normalize).collect())
            }
            serde_json::Value::Object(object) => {
                let mut entries = object.iter().collect::<Vec<_>>();
                entries.sort_unstable_by(|(left, _), (right, _)| left.cmp(right));
                let mut normalized = serde_json::Map::new();
                for (key, value) in entries {
                    normalized.insert(key.clone(), normalize(value));
                }
                serde_json::Value::Object(normalized)
            }
            value => value.clone(),
        }
    }

    let mut normalized = servers
        .iter()
        .map(normalize)
        .map(|value| {
            (
                serde_json::to_string(&value).expect("JSON values are serializable"),
                value,
            )
        })
        .collect::<Vec<_>>();
    normalized.sort_unstable_by(|(left, _), (right, _)| left.cmp(right));
    normalized.into_iter().map(|(_, value)| value).collect()
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty())
}

fn engine_for_start(engine: Engine, remote: Option<&RemoteExec>) -> Engine {
    if remote.is_some() {
        Engine::V1
    } else {
        engine
    }
}

fn v1_turn_overrides(
    provider: AgentProvider,
    remote: bool,
    turn_effort: Option<String>,
    session_effort: Option<String>,
    sandbox: Option<String>,
    approval_policy: Option<String>,
    permission_mode: Option<String>,
    allowed_tools: Option<Vec<String>>,
) -> Result<V1TurnOverrides, AgentChatError> {
    match provider {
        AgentProvider::Codex => Ok(V1TurnOverrides {
            effort: turn_effort.or(session_effort),
            sandbox: sandbox.or_else(|| remote.then(|| "workspace-write".to_string())),
            approval_policy: approval_policy.or_else(|| remote.then(|| "on-request".to_string())),
            ..V1TurnOverrides::default()
        }),
        AgentProvider::ClaudeCode => Ok(V1TurnOverrides {
            effort: turn_effort.or(session_effort),
            permission_mode: claude_v1_permission_mode(permission_mode)?,
            allowed_tools: claude_v1_allowed_tools(allowed_tools)?,
            ..V1TurnOverrides::default()
        }),
        AgentProvider::Omp => Err(AgentChatError::Unsupported(
            "OMP ACP requires the v2 agent engine".to_string(),
        AgentProvider::Pi => Err(AgentChatError::Unsupported(
            "Pi RPC requires the v2 agent engine".to_string(),
        )),
    }
}

fn claude_v1_permission_mode(mode: Option<String>) -> Result<Option<String>, AgentChatError> {
    let Some(mode) = non_empty(mode) else {
        return Ok(None);
    };
    let mode = match mode.as_str() {
        "default" => "acceptEdits",
        "acceptEdits" | "auto" | "bypassPermissions" | "manual" | "dontAsk" | "plan" => {
            mode.as_str()
        }
        _ => {
            return Err(AgentChatError::Unsupported(format!(
                "v1 claude cannot represent permission mode {mode}"
            )));
        }
    };
    Ok(Some(mode.to_string()))
}

fn claude_v1_allowed_tools(
    allowed_tools: Option<Vec<String>>,
) -> Result<Option<String>, AgentChatError> {
    let Some(allowed_tools) = allowed_tools else {
        return Ok(None);
    };
    if allowed_tools.iter().any(|tool| {
        tool.is_empty() || tool.trim() != tool || tool.contains(',') || tool.contains('\0')
    }) {
        return Err(AgentChatError::Unsupported(
            "v1 claude cannot represent the configured allowed tools".to_string(),
        ));
    }
    Ok(Some(allowed_tools.join(",")))
}

fn persisted_remote_provider_session_id(remote: &RemoteExec, provider_session_id: &str) -> String {
    let value = PersistedRemoteSession {
        host: remote.host.clone(),
        remote_root: remote.remote_root.clone(),
        provider_session_id: provider_session_id.to_string(),
    };
    format!(
        "{REMOTE_PROVIDER_SESSION_PREFIX}{}",
        serde_json::to_string(&value).expect("remote session id serializes")
    )
}

fn remote_provider_session_id(
    provider_session_id: Option<&str>,
    remote: &RemoteExec,
) -> Option<String> {
    let provider_session_id = provider_session_id?;
    let value = provider_session_id.strip_prefix(REMOTE_PROVIDER_SESSION_PREFIX)?;
    let persisted = serde_json::from_str::<PersistedRemoteSession>(value).ok()?;
    (persisted.host == remote.host && persisted.remote_root == remote.remote_root)
        .then_some(persisted.provider_session_id)
}

fn local_provider_session_id(provider_session_id: Option<String>) -> Option<String> {
    provider_session_id.filter(|id| !id.starts_with(REMOTE_PROVIDER_SESSION_PREFIX))
}

#[cfg(test)]
#[derive(Clone, Default)]
struct TestBinaries {
    codex: Option<String>,
    claude: Option<String>,
    omp: Option<String>,
    pi: Option<String>,
}

#[cfg(test)]
mod tests {
    use std::sync::{Barrier, Mutex};
    use std::time::{Duration, Instant};

    use crate::agents::event::{ApprovalKind, TurnStatus};
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
            None,
        )
    }

    #[cfg(unix)]
    fn omp_manager(db: Arc<Database>, script: &TestScript) -> AgentChatManager {
        AgentChatManager::with_test_binaries(
            db,
            script.dir.clone(),
            None,
            None,
            Some(script.path.to_string_lossy().to_string()),
        )
    }

    #[cfg(unix)]
    fn pi_manager(db: Arc<Database>, script: &TestScript) -> AgentChatManager {
        let mut manager = AgentChatManager::new(db, script.dir.clone());
        manager.test_binaries.pi = Some(script.path.to_string_lossy().to_string());
        manager
    }

    #[cfg(unix)]
    fn pi_rpc_test_script(name: &str) -> TestScript {
        test_script(
            name,
            r#"#!/usr/bin/env python3
import json, sys

if "--version" in sys.argv:
    print("pi 0.79.10")
    raise SystemExit(0)

log_path = sys.argv[0] + ".stdin"
session_path = sys.argv[sys.argv.index("--session") + 1]
prompt_count = 0

def emit(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)

for raw in sys.stdin:
    command = json.loads(raw)
    with open(log_path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(command, separators=(",", ":")) + "\n")
    response = {
        "type": "response",
        "id": command["id"],
        "command": command["type"],
        "success": True,
    }
    if command["type"] == "get_state":
        response["data"] = {
            "sessionId": "pi-manager-fixture",
            "sessionFile": session_path,
            "isStreaming": False,
            "thinkingLevel": "medium",
            "model": {"provider": "test", "id": "model"},
        }
    emit(response)
    if command["type"] == "prompt":
        prompt_count += 1
        emit({"type": "agent_start"})
        if "follow-up-lifecycle" in sys.argv[0]:
            text = "initial answer" if prompt_count == 1 else "next answer"
            message = {
                "role": "assistant",
                "content": [{"type": "text", "text": text}],
                "usage": {},
                "stopReason": "stop",
            }
            emit({"type": "message_start", "message": {"role": "assistant", "content": []}})
            emit({"type": "message_end", "message": message})
            if prompt_count > 1:
                emit({"type": "agent_end", "messages": [message], "willRetry": False})
    elif command["type"] == "follow_up" and "follow-up-lifecycle" in sys.argv[0]:
        message = {
            "role": "assistant",
            "content": [{"type": "text", "text": "queued answer"}],
            "usage": {},
            "stopReason": "stop",
        }
        emit({"type": "message_start", "message": {"role": "assistant", "content": []}})
        emit({"type": "message_end", "message": message})
        emit({"type": "agent_end", "messages": [message], "willRetry": False})
    elif command["type"] == "abort":
        message = {"role": "assistant", "content": [], "usage": {}, "stopReason": "aborted"}
        emit({"type": "message_end", "message": message})
        emit({"type": "agent_end", "messages": [message], "willRetry": False})
"#,
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

    #[cfg(unix)]
    #[test]
    fn omp_manager_lifecycle_reuses_live_client_and_resumes_after_dispose() {
        let log = std::env::temp_dir().join(format!(
            "pickforge-omp-manager-{}-{}.log",
            std::process::id(),
            now_millis()
        ));
        let body = r#"#!/bin/sh
log='__LOG__'
printf 'launch\n' >> "$log"
prompt_count=0
prompt_id=
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"oh-my-pi","version":"16.4.8"},"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{},"close":{}}}}}'
      ;;
    *'"method":"session/new"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"sessionId":"omp-manager-session","modes":{"availableModes":[{"id":"default"},{"id":"plan"}]},"configOptions":[{"id":"model","options":[{"value":"openai/gpt-test"}]}]}}'
      ;;
    *'"method":"session/resume"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"modes":{"availableModes":[{"id":"default"},{"id":"plan"}]},"configOptions":[{"id":"model","options":[{"value":"openai/gpt-test"}]}]}}'
      ;;
    *'"method":"session/prompt"'*)
      request_id=${line#*\"id\":}
      request_id=${request_id%%,*}
      prompt_id=$request_id
      prompt_count=$((prompt_count + 1))
      if [ "$prompt_count" -eq 1 ]; then
        printf '%s\n' '{"jsonrpc":"2.0","id":"permission-1","method":"session/request_permission","params":{"sessionId":"omp-manager-session","toolCall":{"toolCallId":"tool-1","title":"Run checks","kind":"execute"},"options":[{"optionId":"once","kind":"allow_once"},{"optionId":"reject","kind":"reject_once"}]}}'
      else
        printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"omp-manager-session","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"done"}}}}'
        printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"omp-manager-session","update":{"sessionUpdate":"usage_update","size":100,"used":10}}}'
        printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"omp-manager-session","update":{"sessionUpdate":"session_info_update","title":"OMP managed title"}}}'
        printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":$request_id,\"result\":{\"stopReason\":\"end_turn\",\"usage\":{\"inputTokens\":2,\"outputTokens\":3,\"totalTokens\":5}}}"
      fi
      ;;
    *'"method":"session/set_mode"'*)
      request_id=${line#*\"id\":}
      request_id=${request_id%%,*}
      printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":$request_id,\"result\":{}}"
      ;;
    *'"method":"session/cancel"'*)
      printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":$prompt_id,\"result\":{\"stopReason\":\"cancelled\"}}"
      ;;
    *'"method":"session/close"'*)
      exit 0
      ;;
  esac
done
"#
        .replace("__LOG__", &log.to_string_lossy());
        let script = test_script("omp-lifecycle", &body);
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = omp_manager(Arc::clone(&db), &script);
        let (events1, sink1) = event_sink();
        let session_id = manager
            .start(
                "omp-chat",
                script.dir.clone(),
                AgentProvider::Omp,
                Engine::V2,
                None,
                AgentStartOverrides::default(),
                sink1,
            )
            .unwrap();
        manager
            .send(&session_id, "first", None, None, None)
            .unwrap();
        let approval_id = wait_for_events(&events1, |events| {
            events.iter().any(|event| matches!(event, AgentEvent::ApprovalRequest { .. }))
        })
        .into_iter()
        .find_map(|event| match event {
            AgentEvent::ApprovalRequest { approval_id, .. } => Some(approval_id),
            _ => None,
        })
        .unwrap();

        let (events2, sink2) = event_sink();
        assert_eq!(
            manager
                .start(
                    "omp-chat",
                    script.dir.clone(),
                    AgentProvider::Omp,
                    Engine::V2,
                    None,
                    AgentStartOverrides::default(),
                    sink2,
                )
                .unwrap(),
            session_id
        );
        wait_for_events(&events2, |events| {
            events.iter().any(|event| matches!(event, AgentEvent::TurnStarted))
                && events.iter().any(|event| matches!(event, AgentEvent::ApprovalRequest { .. }))
        });
        assert_eq!(
            wait_for_file(&log, |value| value.matches("launch\n").count() == 1)
                .matches("launch\n")
                .count(),
            1
        );

        manager.approve(&session_id, &approval_id, "accept").unwrap();
        manager
            .set_mode(&session_id, None, None, Some("default".to_string()))
            .unwrap();
        assert!(matches!(
            manager.set_mode(&session_id, None, None, Some("plan".to_string())),
            Err(AgentChatError::Spawn(message)) if message.contains("did not advertise mode plan")
        ));
        manager.interrupt(&session_id).unwrap();
        wait_for_events(&events2, |events| {
            events.iter().any(|event| matches!(
                event,
                AgentEvent::TurnDone {
                    status: TurnStatus::Interrupted
                }
            ))
        });
        manager
            .send(&session_id, "second", None, None, None)
            .unwrap();
        let completed = wait_for_events(&events2, |events| {
            events.iter().any(|event| matches!(
                event,
                AgentEvent::TurnDone {
                    status: TurnStatus::Completed
                }
            ))
        });
        assert!(completed
            .iter()
            .any(|event| matches!(event, AgentEvent::SessionTitle { title } if title == "OMP managed title")));
        assert!(completed.iter().any(|event| matches!(
            event,
            AgentEvent::Usage {
                context_used: Some(10),
                context_window: Some(100),
                ..
            }
        )));
        wait_for_status(&db, "omp-chat", "idle");
        let persisted_provider_payloads = db
            .agent_timeline_for_chat("omp-chat")
            .unwrap()
            .iter()
            .filter(|entry| {
                matches!(
                    entry,
                    AgentTimelineEntry::Item { kind, .. } if kind == "providerPayload"
                )
            })
            .count();
        assert_eq!(persisted_provider_payloads, 0);
        manager.dispose(&session_id);

        let (_, sink3) = event_sink();
        let resumed = manager
            .start(
                "omp-chat",
                script.dir.clone(),
                AgentProvider::Omp,
                Engine::V2,
                None,
                AgentStartOverrides::default(),
                sink3,
            )
            .unwrap();
        assert_eq!(resumed, session_id);
        let log_contents = wait_for_file(&log, |value| {
            value.matches("launch\n").count() == 2 && value.contains("\"method\":\"session/resume\"")
        });
        assert!(log_contents.contains("\"optionId\":\"once\""));
        assert!(log_contents.contains("\"method\":\"session/set_mode\""));
        assert!(log_contents.contains("\"mcpServers\":[]"));
        manager.dispose(&resumed);
        let _ = std::fs::remove_file(log);
    }

    #[cfg(unix)]
    #[test]
    fn omp_live_reuse_requires_exact_canonical_cwd_and_normalized_mcp_grants() {
        use std::os::unix::fs::symlink;

        let log = std::env::temp_dir().join(format!(
            "pickforge-omp-identity-{}-{}.log",
            std::process::id(),
            now_millis()
        ));
        let body = r#"#!/bin/sh
log='__LOG__'
printf 'launch\n' >> "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"oh-my-pi","version":"16.4.8"},"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{},"close":{}}}}}'
      ;;
    *'"method":"session/new"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"sessionId":"omp-identity-session"}}'
      ;;
    *'"method":"session/resume"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{}}'
      ;;
    *'"method":"session/close"'*)
      exit 0
      ;;
  esac
done"#
        .replace("__LOG__", &log.to_string_lossy());
        let script = test_script("omp-identity", &body);
        let real_root = script.dir.join("real-root");
        let other_root = script.dir.join("other-root");
        let alias_root = script.dir.join("alias-root");
        std::fs::create_dir_all(&real_root).unwrap();
        std::fs::create_dir_all(&other_root).unwrap();
        symlink(&real_root, &alias_root).unwrap();
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = omp_manager(Arc::clone(&db), &script);
        let grants = vec![
            serde_json::json!({
                "name": "stdio",
                "command": "pickforge-mcp",
                "args": ["--scope", "project"],
                "env": [{"name": "PICKFORGE_TEST_TOKEN", "value": "first"}]
            }),
            serde_json::json!({
                "name": "remote",
                "type": "http",
                "url": "https://mcp.invalid",
                "headers": [{"name": "Authorization", "value": "Bearer test"}]
            }),
        ];
        let overrides = |mcp_servers| AgentStartOverrides {
            mcp_servers,
            ..AgentStartOverrides::default()
        };
        let (_, first_sink) = event_sink();
        let session_id = manager
            .start(
                "omp-identity-chat",
                real_root.clone(),
                AgentProvider::Omp,
                Engine::V2,
                None,
                overrides(grants.clone()),
                first_sink,
            )
            .unwrap();

        let (_, alias_sink) = event_sink();
        manager
            .start(
                "omp-identity-chat",
                alias_root,
                AgentProvider::Omp,
                Engine::V2,
                None,
                overrides(grants.iter().cloned().rev().collect()),
                alias_sink,
            )
            .unwrap();
        assert_eq!(
            wait_for_file(&log, |value| value.matches("launch\n").count() == 1)
                .matches("launch\n")
                .count(),
            1
        );

        let mut changed_grants = grants.clone();
        changed_grants[0]["env"][0]["value"] = serde_json::Value::String("second".to_string());
        let (_, changed_sink) = event_sink();
        manager
            .start(
                "omp-identity-chat",
                real_root.clone(),
                AgentProvider::Omp,
                Engine::V2,
                None,
                overrides(changed_grants.clone()),
                changed_sink,
            )
            .unwrap();
        let (_, cwd_sink) = event_sink();
        manager
            .start(
                "omp-identity-chat",
                other_root.clone(),
                AgentProvider::Omp,
                Engine::V2,
                None,
                overrides(changed_grants),
                cwd_sink,
            )
            .unwrap();

        let contents = wait_for_file(&log, |value| value.matches("launch\n").count() == 3);
        let opened = contents
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .filter(|value| {
                matches!(
                    value.get("method").and_then(serde_json::Value::as_str),
                    Some("session/new" | "session/resume")
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(opened.len(), 3);
        assert_eq!(
            opened[0]["params"]["cwd"],
            real_root.canonicalize().unwrap().to_string_lossy().as_ref()
        );
        assert_eq!(
            opened[1]["params"]["mcpServers"][0]["env"][0]["value"],
            "second"
        );
        assert_eq!(
            opened[2]["params"]["cwd"],
            other_root.canonicalize().unwrap().to_string_lossy().as_ref()
        );
        assert_eq!(
            opened
                .iter()
                .filter(|value| value["method"] == "session/resume")
                .count(),
            2
        );
        manager.dispose(&session_id);
        let _ = std::fs::remove_file(log);
    }

    #[cfg(unix)]
    #[test]
    fn omp_dead_transport_fails_boundedly_idles_and_resumes_on_restart() {
        let log = std::env::temp_dir().join(format!(
            "pickforge-omp-dead-{}-{}.log",
            std::process::id(),
            now_millis()
        ));
        let body = r#"#!/bin/sh
log='__LOG__'
marker="$log.recover"
if [ -f "$marker" ]; then
  recovered=1
else
  recovered=0
  : > "$marker"
fi
printf 'launch\n' >> "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"oh-my-pi","version":"16.4.8"},"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{},"close":{}}}}}'
      ;;
    *'"method":"session/new"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"sessionId":"omp-dead-session"}}'
      ;;
    *'"method":"session/resume"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{}}'
      ;;
    *'"method":"session/prompt"'*)
      if [ "$recovered" -eq 0 ]; then
        exit 9
      fi
      request_id=${line#*\"id\":}
      request_id=${request_id%%,*}
      printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":$request_id,\"result\":{\"stopReason\":\"end_turn\"}}"
      ;;
    *'"method":"session/close"'*)
      exit 0
      ;;
  esac
done"#
        .replace("__LOG__", &log.to_string_lossy());
        let script = test_script("omp-dead", &body);
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = omp_manager(Arc::clone(&db), &script);
        let (events, sink) = event_sink();
        let session_id = manager
            .start(
                "omp-dead-chat",
                script.dir.clone(),
                AgentProvider::Omp,
                Engine::V2,
                None,
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();
        manager
            .send(&session_id, "crash transport", None, None, None)
            .unwrap();
        wait_for_events(&events, |events| {
            events
                .iter()
                .any(|event| matches!(event, AgentEvent::TurnFailed { .. }))
        });
        wait_for_status(&db, "omp-dead-chat", "idle");

        let started = Instant::now();
        assert!(matches!(
            manager.send(&session_id, "reject while closed", None, None, None),
            Err(AgentChatError::Spawn(message)) if message.contains("closed")
        ));
        assert!(
            started.elapsed() < Duration::from_millis(500),
            "closed transport rejection was not synchronous"
        );
        wait_for_status(&db, "omp-dead-chat", "idle");
        assert!(
            manager
                .lock_inner()
                .unwrap()
                .get(&session_id)
                .is_some_and(|state| state.active_turn.is_none()),
            "closed transport left a retained manager turn active"
        );

        let (recovered_events, recovered_sink) = event_sink();
        assert_eq!(
            manager
                .start(
                    "omp-dead-chat",
                    script.dir.clone(),
                    AgentProvider::Omp,
                    Engine::V2,
                    None,
                    AgentStartOverrides::default(),
                    recovered_sink,
                )
                .unwrap(),
            session_id
        );
        manager
            .send(&session_id, "after restart", None, None, None)
            .unwrap();
        wait_for_events(&recovered_events, |events| {
            events.iter().any(|event| {
                matches!(
                    event,
                    AgentEvent::TurnDone {
                        status: TurnStatus::Completed
                    }
                )
            })
        });
        let contents = wait_for_file(&log, |value| value.matches("launch\n").count() == 2);
        assert!(contents.contains("\"method\":\"session/resume\""));
        wait_for_status(&db, "omp-dead-chat", "idle");
        manager.dispose(&session_id);
        let _ = std::fs::remove_file(format!("{}.recover", log.display()));
        let _ = std::fs::remove_file(log);
    }

    #[cfg(unix)]
    #[test]
    fn omp_stale_resume_falls_back_once_and_replaces_persisted_provider_id() {
        let log = std::env::temp_dir().join(format!(
            "pickforge-omp-stale-resume-{}-{}.log",
            std::process::id(),
            now_millis()
        ));
        let body = r#"#!/bin/sh
log='__LOG__'
marker="$log.fresh"
if [ -f "$marker" ]; then fresh=1; else fresh=0; : > "$marker"; fi
printf 'launch\n' >> "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"oh-my-pi","version":"16.4.8"},"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{},"close":{}}}}}'
      ;;
    *'"method":"session/resume"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":2,"error":{"code":-32001,"message":"session expired"}}'
      ;;
    *'"method":"session/new"'*)
      [ "$fresh" -eq 1 ] || exit 12
      printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"sessionId":"fresh-provider-session"}}'
      ;;
  esac
done"#
            .replace("__LOG__", &log.to_string_lossy());
        let script = test_script("omp-stale-resume", &body);
        let db = Arc::new(Database::open_in_memory().unwrap());
        db.agent_session_create(&AgentSessionRow {
            id: "persisted-omp-session".to_string(),
            chat_id: "omp-stale-chat".to_string(),
            provider: "omp".to_string(),
            provider_session_id: Some("expired-provider-session".to_string()),
            model: None,
            status: "idle".to_string(),
            created_at: 1,
        })
        .unwrap();
        let manager = omp_manager(Arc::clone(&db), &script);
        let (_, sink) = event_sink();
        assert_eq!(
            manager
                .start(
                    "omp-stale-chat",
                    script.dir.clone(),
                    AgentProvider::Omp,
                    Engine::V2,
                    None,
                    AgentStartOverrides::default(),
                    sink,
                )
                .unwrap(),
            "persisted-omp-session"
        );
        let row = db.latest_agent_session_for_chat("omp-stale-chat").unwrap().unwrap();
        assert_eq!(row.provider_session_id.as_deref(), Some("fresh-provider-session"));
        let contents = wait_for_file(&log, |value| value.matches("launch\n").count() == 2);
        assert_eq!(contents.matches("\"method\":\"session/resume\"").count(), 1);
        assert_eq!(contents.matches("\"method\":\"session/new\"").count(), 1);
        manager.dispose("persisted-omp-session");
        let _ = std::fs::remove_file(format!("{}.fresh", log.display()));
        let _ = std::fs::remove_file(log);
    }

    #[cfg(unix)]
    #[test]
    fn omp_successful_resume_is_not_abandoned_when_initial_model_is_rejected() {
        let log = std::env::temp_dir().join(format!(
            "pickforge-omp-resume-model-{}-{}.log",
            std::process::id(),
            now_millis()
        ));
        let body = r#"#!/bin/sh
log='__LOG__'
printf 'launch\n' >> "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"oh-my-pi","version":"16.4.8"},"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{},"close":{}}}}}'
      ;;
    *'"method":"session/resume"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"configOptions":[{"id":"model","options":[{"value":"openai/available"}]}]}}'
      ;;
    *'"method":"session/new"'*)
      printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"sessionId":"must-not-replace-resume"}}'
      ;;
  esac
done"#
            .replace("__LOG__", &log.to_string_lossy());
        let script = test_script("omp-resume-model-rejected", &body);
        let db = Arc::new(Database::open_in_memory().unwrap());
        db.agent_session_create(&AgentSessionRow {
            id: "persisted-model-session".to_string(),
            chat_id: "omp-resume-model-chat".to_string(),
            provider: "omp".to_string(),
            provider_session_id: Some("exact-provider-session".to_string()),
            model: None,
            status: "idle".to_string(),
            created_at: 1,
        })
        .unwrap();
        let manager = omp_manager(Arc::clone(&db), &script);
        let (_, sink) = event_sink();

        assert!(matches!(
            manager.start(
                "omp-resume-model-chat",
                script.dir.clone(),
                AgentProvider::Omp,
                Engine::V2,
                Some("openai/unavailable".to_string()),
                AgentStartOverrides::default(),
                sink,
            ),
            Err(AgentChatError::Spawn(message)) if message.contains("did not advertise model")
        ));
        let contents = wait_for_file(&log, |value| {
            value.contains("\"method\":\"session/resume\"")
        });
        assert_eq!(contents.matches("launch\n").count(), 1);
        assert_eq!(contents.matches("\"method\":\"session/resume\"").count(), 1);
        assert_eq!(contents.matches("\"method\":\"session/new\"").count(), 0);
        let row = db
            .latest_agent_session_for_chat("omp-resume-model-chat")
            .unwrap()
            .unwrap();
        assert_eq!(
            row.provider_session_id.as_deref(),
            Some("exact-provider-session")
        );
        let _ = std::fs::remove_file(log);
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
    fn pi_rejects_unexposed_thinking_effort_instead_of_ignoring_it() {
        let manager = AgentChatManager::new(
            Arc::new(Database::open_in_memory().unwrap()),
            PathBuf::new(),
        );
        let (_events, sink) = event_sink();

        let error = manager
            .start(
                "chat-pi-effort",
                PathBuf::from("/project"),
                AgentProvider::Pi,
                Engine::V2,
                None,
                AgentStartOverrides {
                    effort: Some("high".to_string()),
                    ..AgentStartOverrides::default()
                },
                sink,
            )
            .unwrap_err();

        assert!(matches!(
            error,
            AgentChatError::Unsupported(message)
                if message.contains("thinking-level selection")
        ));
    }

    #[test]
    fn remote_sessions_force_v1_before_v2_dispatch() {
        let remote = RemoteExec::new("mac-mini", "/srv/app").unwrap();

        assert_eq!(engine_for_start(Engine::V2, Some(&remote)), Engine::V1);
        assert_eq!(engine_for_start(Engine::V1, Some(&remote)), Engine::V1);
        assert_eq!(engine_for_start(Engine::V2, None), Engine::V2);
    }

    #[test]
    fn remote_start_never_initializes_a_v2_client() {
        let manager = AgentChatManager::new(
            Arc::new(Database::open_in_memory().unwrap()),
            PathBuf::new(),
        );
        let (_events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-remote-v1",
                PathBuf::from("/srv/app"),
                AgentProvider::Codex,
                Engine::V2,
                None,
                AgentStartOverrides {
                    remote: Some(RemoteExec::new("mac-mini", "/srv/app").unwrap()),
                    ..AgentStartOverrides::default()
                },
                sink,
            )
            .unwrap();

        let states = manager.inner.lock().unwrap();
        assert_eq!(states[&session_id].engine, Engine::V1);
        assert!(manager.codex_app_clients.lock().unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn v1_send_rejects_images_before_persistence_or_process_dispatch() {
        let script = test_script(
            "v1-image-rejection",
            r#"#!/bin/sh
printf invoked > "$0.invoked"
"#,
        );
        let marker = script.path.with_file_name("fake-agent.invoked");
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = codex_manager(Arc::clone(&db), &script);
        let (_events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-v1-images",
                script.dir.clone(),
                AgentProvider::Codex,
                Engine::V1,
                None,
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();

        let error = manager
            .send(
                &session_id,
                "inspect this",
                None,
                None,
                Some(vec!["/tmp/pickforge-shot.png".to_string()]),
            )
            .unwrap_err();

        assert!(matches!(
            error,
            AgentChatError::Unsupported(message)
                if message == "v1 agent engine cannot accept image input"
        ));
        assert!(!marker.exists(), "v1 process must not be dispatched");
        assert!(db
            .agent_timeline_for_chat("chat-v1-images")
            .unwrap()
            .is_empty());
        assert_eq!(
            db.latest_agent_session_for_chat("chat-v1-images")
                .unwrap()
                .unwrap()
                .status,
            "idle"
        );
    }

    #[test]
    fn reattaching_replays_unanswered_approvals_to_the_new_sink() {
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = AgentChatManager::new(db, PathBuf::new());
        let (_initial_events, initial_sink) = event_sink();
        let session_id = manager
            .start(
                "chat-approval-replay",
                PathBuf::from("/project"),
                AgentProvider::Codex,
                Engine::V1,
                None,
                AgentStartOverrides::default(),
                initial_sink,
            )
            .unwrap();
        let approval = AgentEvent::ApprovalRequest {
            approval_id: "approval-1".to_string(),
            kind: ApprovalKind::Command,
            detail: "cargo check".to_string(),
        };
        (manager.wrapping_sink(
            session_id.clone(),
            "chat-approval-replay".to_string(),
        ))(approval.clone());

        let (reattached_events, reattached_sink) = event_sink();
        let reattached_id = manager
            .start(
                "chat-approval-replay",
                PathBuf::from("/project"),
                AgentProvider::Codex,
                Engine::V1,
                None,
                AgentStartOverrides::default(),
                reattached_sink,
            )
            .unwrap();

        assert_eq!(reattached_id, session_id);
        assert_eq!(*reattached_events.lock().unwrap(), vec![approval]);
    }

    #[test]
    fn remote_start_rejects_unrepresentable_claude_restrictions() {
        let manager = AgentChatManager::new(
            Arc::new(Database::open_in_memory().unwrap()),
            PathBuf::new(),
        );
        let (_events, sink) = event_sink();

        let error = manager
            .start(
                "chat-remote-v1",
                PathBuf::from("/srv/app"),
                AgentProvider::ClaudeCode,
                Engine::V2,
                None,
                AgentStartOverrides {
                    allowed_tools: Some(vec!["Read,Edit".to_string()]),
                    remote: Some(RemoteExec::new("mac-mini", "/srv/app").unwrap()),
                    ..AgentStartOverrides::default()
                },
                sink,
            )
            .unwrap_err();

        assert!(matches!(&error, AgentChatError::Unsupported(_)));
        assert!(error
            .to_string()
            .contains("cannot represent the configured allowed tools"));
    }

    #[test]
    fn remote_session_cache_is_scoped_to_the_host_and_root() {
        let manager = AgentChatManager::new(
            Arc::new(Database::open_in_memory().unwrap()),
            PathBuf::new(),
        );
        manager.remote_sessions.lock().unwrap().insert(
            RemoteSessionKey {
                chat_id: "chat-1".to_string(),
                provider: AgentProvider::Codex,
                host: "mac-mini".to_string(),
                remote_root: "/srv/app-a".to_string(),
            },
            "thread-mac".to_string(),
        );

        assert_eq!(
            manager.remote_session_id("chat-1", AgentProvider::Codex, "mac-mini", "/srv/app-a"),
            Some("thread-mac".to_string())
        );
        assert_eq!(
            manager.remote_session_id("chat-1", AgentProvider::Codex, "mac-mini", "/srv/app-b"),
            None
        );
        assert_eq!(
            manager.remote_session_id("chat-1", AgentProvider::Codex, "linux-box", "/srv/app-a"),
            None
        );
    }

    #[test]
    fn v1_turn_override_mapping_preserves_configured_modes() {
        for (sandbox, approval_policy, effort) in [
            ("read-only", "on-request", "low"),
            ("workspace-write", "on-request", "medium"),
            ("danger-full-access", "never", "high"),
        ] {
            assert_eq!(
                v1_turn_overrides(
                    AgentProvider::Codex,
                    true,
                    None,
                    Some(effort.to_string()),
                    Some(sandbox.to_string()),
                    Some(approval_policy.to_string()),
                    None,
                    None,
                )
                .unwrap(),
                V1TurnOverrides {
                    effort: Some(effort.to_string()),
                    sandbox: Some(sandbox.to_string()),
                    approval_policy: Some(approval_policy.to_string()),
                    ..V1TurnOverrides::default()
                }
            );
        }

        assert_eq!(
            v1_turn_overrides(
                AgentProvider::Codex,
                true,
                None,
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap(),
            V1TurnOverrides {
                sandbox: Some("workspace-write".to_string()),
                approval_policy: Some("on-request".to_string()),
                ..V1TurnOverrides::default()
            }
        );

        for (permission_mode, expected) in [
            ("default", "acceptEdits"),
            ("plan", "plan"),
            ("bypassPermissions", "bypassPermissions"),
        ] {
            assert_eq!(
                v1_turn_overrides(
                    AgentProvider::ClaudeCode,
                    true,
                    None,
                    Some("xhigh".to_string()),
                    None,
                    None,
                    Some(permission_mode.to_string()),
                    Some(vec!["Read".to_string(), "Bash(git status)".to_string()]),
                )
                .unwrap(),
                V1TurnOverrides {
                    effort: Some("xhigh".to_string()),
                    permission_mode: Some(expected.to_string()),
                    allowed_tools: Some("Read,Bash(git status)".to_string()),
                    ..V1TurnOverrides::default()
                }
            );
        }

        assert!(v1_turn_overrides(
            AgentProvider::ClaudeCode,
            true,
            None,
            None,
            None,
            None,
            Some("restricted".to_string()),
            None,
        )
        .is_err());
        assert!(v1_turn_overrides(
            AgentProvider::ClaudeCode,
            true,
            None,
            None,
            None,
            None,
            None,
            Some(vec!["Read,Edit".to_string()]),
        )
        .is_err());
    }

    #[test]
    fn remote_session_ids_only_resume_for_the_same_binding() {
        let db = Arc::new(Database::open_in_memory().unwrap());
        let remote = RemoteExec::new("mac-mini", "/srv/app-a").unwrap();
        db.agent_session_create(&AgentSessionRow {
            id: "session-1".to_string(),
            chat_id: "chat-1".to_string(),
            provider: AgentProvider::Codex.as_str().to_string(),
            provider_session_id: Some(persisted_remote_provider_session_id(&remote, "thread-a")),
            model: None,
            status: "idle".to_string(),
            created_at: 1,
        })
        .unwrap();

        let local_manager = AgentChatManager::new(Arc::clone(&db), PathBuf::new());
        let (_events, sink) = event_sink();
        let local_session = local_manager
            .start(
                "chat-1",
                PathBuf::from("/local/app"),
                AgentProvider::Codex,
                Engine::V1,
                None,
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();
        assert_eq!(
            local_manager.inner.lock().unwrap()[&local_session].provider_session_id,
            None
        );

        let same_binding_manager = AgentChatManager::new(Arc::clone(&db), PathBuf::new());
        let (_events, sink) = event_sink();
        let same_binding_session = same_binding_manager
            .start(
                "chat-1",
                PathBuf::from("/srv/app-a"),
                AgentProvider::Codex,
                Engine::V2,
                None,
                AgentStartOverrides {
                    remote: Some(remote.clone()),
                    ..AgentStartOverrides::default()
                },
                sink,
            )
            .unwrap();
        assert_eq!(
            same_binding_manager.inner.lock().unwrap()[&same_binding_session].provider_session_id,
            Some("thread-a".to_string())
        );

        let other_binding_manager = AgentChatManager::new(db, PathBuf::new());
        let (_events, sink) = event_sink();
        let other_binding_session = other_binding_manager
            .start(
                "chat-1",
                PathBuf::from("/srv/app-b"),
                AgentProvider::Codex,
                Engine::V2,
                None,
                AgentStartOverrides {
                    remote: Some(RemoteExec::new("mac-mini", "/srv/app-b").unwrap()),
                    ..AgentStartOverrides::default()
                },
                sink,
            )
            .unwrap();
        assert_eq!(
            other_binding_manager.inner.lock().unwrap()[&other_binding_session].provider_session_id,
            None
        );
    }

    #[test]
    fn remote_session_started_persists_a_scoped_provider_id() {
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = AgentChatManager::new(Arc::clone(&db), PathBuf::new());
        let remote = RemoteExec::new("mac-mini", "/srv/app").unwrap();
        let (_events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-1",
                PathBuf::from("/srv/app"),
                AgentProvider::Codex,
                Engine::V2,
                None,
                AgentStartOverrides {
                    remote: Some(remote.clone()),
                    ..AgentStartOverrides::default()
                },
                sink,
            )
            .unwrap();

        (manager.wrapping_sink(session_id.clone(), "chat-1".to_string()))(
            AgentEvent::SessionStarted {
                provider_session_id: "thread-a".to_string(),
            },
        );

        let row = db.latest_agent_session_for_chat("chat-1").unwrap().unwrap();
        assert_eq!(
            row.provider_session_id,
            Some(persisted_remote_provider_session_id(&remote, "thread-a"))
        );
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
    fn v2_codex_set_mode_applies_to_next_turn() {
        let script = test_script(
            "codex-app-turn-mode",
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
      printf '%s\n' '{"id":2,"result":{"thread":{"id":"thread-mode"}}}'
      ;;
    *'"method":"turn/start"'*)
      printf '%s\n' '{"id":3,"result":{"turn":{"id":"turn-mode"}}}'
      printf '%s\n' '{"method":"turn/completed","params":{"threadId":"thread-mode","turn":{"id":"turn-mode","status":"completed"}}}'
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
                "chat-mode-v2",
                script.dir.clone(),
                AgentProvider::Codex,
                Engine::V2,
                Some("gpt-5".to_string()),
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();

        manager
            .set_mode(
                &session_id,
                Some("read-only".to_string()),
                Some("never".to_string()),
                None,
            )
            .unwrap();
        manager
            .send(&session_id, "hello", None, None, None)
            .unwrap();

        let log = wait_for_file(&log, |text| text.contains(r#""method":"turn/start""#));
        let turn_line = log
            .lines()
            .find(|line| line.contains(r#""method":"turn/start""#))
            .unwrap();
        assert!(turn_line.contains(r#""approvalPolicy":"never""#));
        assert!(turn_line.contains(r#""sandboxPolicy":{"type":"readOnly"}"#));
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

        manager
            .send(&session_id, "start", None, None, None)
            .unwrap();
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

        manager
            .send(&session_id, "first", None, None, None)
            .unwrap();
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

        manager
            .send(&session_id, "first", None, None, None)
            .unwrap();
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
    fn v2_claude_set_mode_writes_permission_mode_to_bridge() {
        let script = test_script(
            "claude-bridge-set-mode",
            r#"#!/bin/sh
log="$0.stdin"
: > "$log"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  chat_id=$(printf '%s\n' "$line" | sed 's/.*"chatId":"\([^"]*\)".*/\1/')
  case "$line" in
    *'"op":"start"'*)
      printf '{"ev":"started","chatId":"%s"}\n' "$chat_id"
      ;;
    *'"op":"shutdown"'*)
      exit 0
      ;;
  esac
done
"#,
        );
        let log = script.path.with_file_name("fake-agent.stdin");
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = claude_manager(Arc::clone(&db), &script);
        let (_events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-claude-mode",
                script.dir.clone(),
                AgentProvider::ClaudeCode,
                Engine::V2,
                None,
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();

        manager
            .set_mode(&session_id, None, None, Some("plan".to_string()))
            .unwrap();

        let log = wait_for_file(&log, |text| text.contains(r#""op":"setPermissionMode""#));
        assert!(log.contains(r#""chatId":"#));
        assert!(log.contains(r#""mode":"plan""#));
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

        manager
            .send(&session_id, "hello", None, None, None)
            .unwrap();
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

        manager
            .send(&session_id, "hello", None, None, None)
            .unwrap();
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

        manager
            .send(&session_id, "first", None, None, None)
            .unwrap();
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
        manager
            .send(&session_id, "first", None, None, None)
            .unwrap();
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

    #[cfg(unix)]
    #[test]
    fn pi_interrupt_armed_before_prompt_start_is_sent_after_prompt_ack() {
        let script = pi_rpc_test_script("pi-prompt-interrupt-race");
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = pi_manager(Arc::clone(&db), &script);
        let (_events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-pi-prompt-race",
                script.dir.clone(),
                AgentProvider::Pi,
                Engine::V2,
                Some("test/model".to_string()),
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();
        let client = {
            let Ok(states) = manager.inner.lock() else {
                panic!("manager state lock");
            };
            states[&session_id].pi_client.clone().expect("Pi client")
        };
        let prompt_started = Arc::new(AtomicBool::new(false));
        let pending_interrupt = Arc::new(AtomicBool::new(false));
        let turn = ActiveTurn::new(ActiveTurnHandle::PiRpc {
            client: Arc::clone(&client),
            prompt_started: Arc::clone(&prompt_started),
            pending_interrupt: Arc::clone(&pending_interrupt),
        });

        turn.kill().expect("arm interrupt before prompt");
        assert!(!prompt_started.load(Ordering::SeqCst));
        start_pi_prompt(&client, &prompt_started, &pending_interrupt, "race")
            .expect("prompt then pending interrupt");

        let log = script.path.with_extension("stdin");
        let commands = wait_for_file(&log, |text| text.contains(r#""type":"abort""#));
        let kinds = commands
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .filter_map(|command| command["type"].as_str().map(str::to_string))
            .collect::<Vec<_>>();
        let prompt = kinds.iter().position(|kind| kind == "prompt").unwrap();
        let abort = kinds.iter().position(|kind| kind == "abort").unwrap();
        assert!(prompt < abort, "abort must not overtake prompt: {kinds:?}");
        assert!(!pending_interrupt.load(Ordering::SeqCst));
        manager.dispose(&session_id);
    }

    #[cfg(unix)]
    #[test]
    fn pi_follow_up_drains_inside_one_agent_lifecycle_and_allows_the_next_prompt() {
        let script = pi_rpc_test_script("pi-follow-up-lifecycle");
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = pi_manager(Arc::clone(&db), &script);
        let (events, sink) = event_sink();
        let session_id = manager
            .start(
                "chat-pi-follow-up",
                script.dir.clone(),
                AgentProvider::Pi,
                Engine::V2,
                Some("test/model".to_string()),
                AgentStartOverrides::default(),
                sink,
            )
            .unwrap();
        if let Ok(mut captured) = events.lock() {
            captured.clear();
        }
        manager
            .set_model(&session_id, Some("openai-codex/gpt-5.5".to_string()))
            .expect("switch Pi model");
        let command_log = script.path.with_extension("stdin");
        let commands = wait_for_file(&command_log, |text| text.contains(r#""type":"set_model""#));
        let set_model = commands
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .find(|command| command["type"] == "set_model")
            .expect("set_model command");
        assert_eq!(set_model["provider"], "openai-codex");
        assert_eq!(set_model["modelId"], "gpt-5.5");

        manager
            .send(&session_id, "initial", None, None, None)
            .expect("initial prompt");
        wait_for_events(&events, |events| {
            events.iter().any(
                |event| matches!(event, AgentEvent::TextFinal { text, .. } if text == "initial answer"),
            )
        });
        manager
            .follow_up(&session_id, "queued")
            .expect("follow-up accepted during active lifecycle");
        wait_for_events(&events, |events| {
            events
                .iter()
                .any(|event| matches!(event, AgentEvent::TurnDone { .. }))
        });

        let row = wait_for_status(&db, "chat-pi-follow-up", "idle");
        assert_eq!(row.status, "idle");
        assert_eq!(row.model.as_deref(), Some("openai-codex/gpt-5.5"));
        {
            let Ok(states) = manager.inner.lock() else {
                panic!("manager state lock");
            };
            assert!(states[&session_id].active_turn.is_none());
        }
        let snapshot = events.lock().map(|events| events.clone()).unwrap_or_default();
        assert_eq!(
            snapshot
                .iter()
                .filter(|event| matches!(event, AgentEvent::TurnStarted))
                .count(),
            1,
        );
        assert_eq!(
            snapshot
                .iter()
                .filter(|event| matches!(event, AgentEvent::TurnDone { .. }))
                .count(),
            1,
        );
        for expected in ["initial answer", "queued answer"] {
            assert!(snapshot.iter().any(
                |event| matches!(event, AgentEvent::TextFinal { text, .. } if text == expected)
            ));
        }
        let message_ids = snapshot
            .iter()
            .filter_map(|event| match event {
                AgentEvent::TextFinal {
                    item_id: Some(item_id),
                    text,
                } if text == "initial answer" || text == "queued answer" => Some(item_id.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            message_ids,
            ["pi-message-1-1-0", "pi-message-1-2-0"],
            "follow-up assistant messages in one agent lifecycle need distinct item ids",
        );

        manager
            .send(&session_id, "next", None, None, None)
            .expect("next prompt after final agent_end");
        wait_for_events(&events, |events| {
            events
                .iter()
                .filter(|event| matches!(event, AgentEvent::TurnDone { .. }))
                .count()
                == 2
        });
        assert_eq!(
            wait_for_status(&db, "chat-pi-follow-up", "idle").status,
            "idle"
        );
        let timeline = db.agent_timeline_for_chat("chat-pi-follow-up").unwrap();
        for expected in ["initial answer", "queued answer", "next answer"] {
            assert!(timeline.iter().any(|entry| {
                matches!(
                    entry,
                    AgentTimelineEntry::Message { role, content, .. }
                        if role == "assistant" && content == expected
                )
            }));
        }
        manager.dispose(&session_id);
    }

    #[cfg(unix)]
    #[test]
    fn pi_start_rejects_a_symlinked_session_ancestor_beneath_the_app_root() {
        use std::os::unix::fs::symlink;

        let script = pi_rpc_test_script("pi-symlinked-session-ancestor");
        let outside = script.dir.with_extension("outside");
        std::fs::create_dir_all(&outside).expect("create outside directory");
        symlink(&outside, script.dir.join("agent-sessions")).expect("symlink session ancestor");
        let db = Arc::new(Database::open_in_memory().unwrap());
        let manager = pi_manager(db, &script);
        let error = manager
            .start(
                "chat-pi-symlink",
                script.dir.clone(),
                AgentProvider::Pi,
                Engine::V2,
                Some("test/model".to_string()),
                AgentStartOverrides::default(),
                Arc::new(|_| {}),
            )
            .expect_err("symlinked session ancestor must be rejected");
        assert!(
            matches!(error, AgentChatError::Spawn(message) if message.contains("unsafe Pi session path"))
        );
        std::fs::remove_dir_all(&outside).expect("remove outside directory");
    }
}
