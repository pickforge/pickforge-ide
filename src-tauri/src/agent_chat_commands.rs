use std::path::PathBuf;
use std::sync::Arc;

use pickforge_core::agents::{
    AgentChatManager, AgentEvent, AgentProvider, AgentStartOverrides, Engine,
};
use pickforge_core::db::{AgentTimelineEntry, Database};
use tauri::ipc::Channel;
use tauri::State;

use crate::fs_commands::{approved_canonical, ApprovedRoots};

#[tauri::command]
pub fn agent_chat_start(
    mgr: State<'_, AgentChatManager>,
    roots: State<'_, ApprovedRoots>,
    chat_id: String,
    project_root: String,
    provider: String,
    engine: Option<String>,
    model: Option<String>,
    sandbox: Option<String>,
    approval_policy: Option<String>,
    permission_mode: Option<String>,
    allowed_tools: Option<Vec<String>>,
    on_event: Channel<AgentEvent>,
) -> Result<String, String> {
    let provider = provider
        .parse::<AgentProvider>()
        .map_err(|e| e.to_string())?;
    let engine = engine
        .as_deref()
        .unwrap_or("v2")
        .parse::<Engine>()
        .map_err(|e| e.to_string())?;
    let project_root: PathBuf = approved_canonical(&project_root, &roots)?;
    let sink = Arc::new(move |event| {
        let _ = on_event.send(event);
    });
    mgr.start(
        &chat_id,
        project_root,
        provider,
        engine,
        model,
        AgentStartOverrides {
            sandbox,
            approval_policy,
            permission_mode,
            allowed_tools,
        },
        sink,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_chat_send(
    mgr: State<'_, AgentChatManager>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    mgr.send(&session_id, &text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_chat_interrupt(
    mgr: State<'_, AgentChatManager>,
    session_id: String,
) -> Result<(), String> {
    mgr.interrupt(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_chat_approve(
    mgr: State<'_, AgentChatManager>,
    session_id: String,
    approval_id: String,
    decision: String,
) -> Result<(), String> {
    mgr.approve(&session_id, &approval_id, &decision)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_chat_steer(
    mgr: State<'_, AgentChatManager>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    mgr.steer(&session_id, &text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_chat_history(
    db: State<'_, Arc<Database>>,
    chat_id: String,
) -> Result<Vec<AgentTimelineEntry>, String> {
    db.agent_timeline_for_chat(&chat_id)
        .map_err(|e| e.to_string())
}
