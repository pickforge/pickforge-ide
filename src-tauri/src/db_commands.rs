//! Tauri command layer over `pickforge_core::Database`. Sync commands — SQLite
//! reads/writes are local and sub-millisecond.

use pickforge_core::{
    AgentRunLog, Chat, Database, PickHistory, Project, ProjectSettings, RunSessionLog,
};
use tauri::State;

use crate::fs_commands::{register_project_root, ApprovedRoots};

#[tauri::command]
pub fn projects_list(
    db: State<'_, Database>,
    roots: State<'_, ApprovedRoots>,
    include_archived: bool,
) -> Result<Vec<Project>, String> {
    let projects = db.list_projects(include_archived).map_err(|e| e.to_string())?;
    // Keep the filesystem allowlist in sync with the live project set (another
    // instance may have added a project since startup).
    for p in &projects {
        register_project_root(&roots, &p.project_root);
    }
    Ok(projects)
}

#[tauri::command]
pub fn project_upsert(
    db: State<'_, Database>,
    roots: State<'_, ApprovedRoots>,
    project: Project,
) -> Result<(), String> {
    db.upsert_project(&project).map_err(|e| e.to_string())?;
    register_project_root(&roots, &project.project_root);
    Ok(())
}

#[tauri::command]
pub fn project_set_archived(
    db: State<'_, Database>,
    root: String,
    archived_at: Option<i64>,
) -> Result<(), String> {
    db.set_project_archived(&root, archived_at)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn project_touch(db: State<'_, Database>, root: String, ts: i64) -> Result<(), String> {
    db.touch_project(&root, ts).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn project_delete(db: State<'_, Database>, root: String) -> Result<(), String> {
    db.delete_project(&root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chats_list(db: State<'_, Database>, project_root: String) -> Result<Vec<Chat>, String> {
    db.list_chats(&project_root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_upsert(db: State<'_, Database>, chat: Chat) -> Result<(), String> {
    db.upsert_chat(&chat).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_delete(db: State<'_, Database>, chat_id: String) -> Result<(), String> {
    db.delete_chat(&chat_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_get(
    db: State<'_, Database>,
    root: String,
) -> Result<Option<ProjectSettings>, String> {
    db.get_settings(&root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_upsert(db: State<'_, Database>, settings: ProjectSettings) -> Result<(), String> {
    db.upsert_settings(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn picks_list(
    db: State<'_, Database>,
    project_root: String,
    limit: i64,
) -> Result<Vec<PickHistory>, String> {
    db.list_picks(&project_root, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pick_insert(db: State<'_, Database>, pick: PickHistory) -> Result<i64, String> {
    db.insert_pick(&pick).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn runs_list(
    db: State<'_, Database>,
    project_root: String,
    limit: i64,
) -> Result<Vec<RunSessionLog>, String> {
    db.list_runs(&project_root, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn run_insert(db: State<'_, Database>, run: RunSessionLog) -> Result<(), String> {
    db.insert_run(&run).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn run_finish(
    db: State<'_, Database>,
    session_id: String,
    ended_at: i64,
    exit_reason: Option<String>,
    exit_code: Option<i64>,
) -> Result<(), String> {
    db.finish_run(&session_id, ended_at, exit_reason.as_deref(), exit_code)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_run_insert(db: State<'_, Database>, run: AgentRunLog) -> Result<i64, String> {
    db.insert_agent_run(&run).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_run_finish(
    db: State<'_, Database>,
    id: i64,
    finished_at: i64,
    exit_code: Option<i64>,
    hot_reload_count: i64,
) -> Result<(), String> {
    db.finish_agent_run(id, finished_at, exit_code, hot_reload_count)
        .map_err(|e| e.to_string())
}
