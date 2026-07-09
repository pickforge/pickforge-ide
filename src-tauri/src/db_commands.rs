//! Tauri command layer over `pickforge_core::Database`. Sync commands — SQLite
//! reads/writes are local and sub-millisecond.

use pickforge_core::{
    AgentRunLog, AgentSessionRow, AgentUsageSummary, Chat, Database, OperatorAuditRow,
    OrchestraTask, PickHistory, Project, ProjectSettings, RunSessionLog,
};
use std::sync::Arc;
use tauri::State;

use crate::fs_commands::{ensure_root_approved, register_project_root, ApprovedRoots};

#[tauri::command]
pub fn projects_list(
    db: State<'_, Arc<Database>>,
    roots: State<'_, ApprovedRoots>,
    include_archived: bool,
) -> Result<Vec<Project>, String> {
    let projects = db
        .list_projects(include_archived)
        .map_err(|e| e.to_string())?;
    register_active_roots(&roots, &projects);
    Ok(projects)
}

/// Keep the filesystem allowlist in sync with the live project set (another
/// instance may have added a project since startup), but register only **active**
/// rows. `projects_list(include_archived = true)` (Settings renders archived
/// projects) must not re-approve an archived root — that would let the file
/// explorer reach a project the user archived until the next reseed. Archived
/// rows are still RETURNED so Settings can list them; only the registration is
/// filtered.
fn register_active_roots(roots: &ApprovedRoots, projects: &[Project]) {
    for p in projects {
        if p.archived_at.is_none() {
            register_project_root(roots, &p.project_root);
        }
    }
}

#[tauri::command]
pub fn project_upsert(
    db: State<'_, Arc<Database>>,
    roots: State<'_, ApprovedRoots>,
    project: Project,
) -> Result<(), String> {
    // Gate the persist on the root already being approved. A new project's root
    // is approved by the user-mediated native pick (`pick_project_dir`) before
    // this runs; updating an existing project's metadata is fine because its root
    // is already in the registry. Rejecting an unapproved root closes the
    // "DB-laundering" escalation: a compromised renderer can no longer
    // `project_upsert({project_root: "<any dir>"})` and have a later
    // `projects_list`/restart re-seed allowlist that arbitrary path — the row
    // never lands, so re-seeding stays safe.
    ensure_root_approved(&roots, &project.project_root)?;
    db.upsert_project(&project).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn project_set_archived(
    db: State<'_, Arc<Database>>,
    roots: State<'_, ApprovedRoots>,
    root: String,
    archived_at: Option<i64>,
) -> Result<(), String> {
    db.set_project_archived(&root, archived_at)
        .map_err(|e| e.to_string())?;
    // Archiving drops the project from the active set; reseed so its root is no
    // longer approved (unarchiving re-adds it). Reseed unconditionally — it's
    // cheap and keeps the registry exactly in sync with the live set.
    roots.reseed(db.as_ref());
    Ok(())
}

#[tauri::command]
pub fn project_touch(db: State<'_, Arc<Database>>, root: String, ts: i64) -> Result<(), String> {
    db.touch_project(&root, ts).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn project_delete(
    db: State<'_, Arc<Database>>,
    roots: State<'_, ApprovedRoots>,
    root: String,
) -> Result<(), String> {
    db.delete_project(&root).map_err(|e| e.to_string())?;
    // The registry only grows otherwise; rebuild it from the live project set so
    // a removed root doesn't stay approved for the rest of the process lifetime.
    roots.reseed(db.as_ref());
    Ok(())
}

/// Narrow `sort_order` write for project reordering — touches only `sort_order`,
/// so dragging projects to re-sort can't re-stamp `last_opened_at`/`display_name`
/// and race a concurrent rename/touch.
#[tauri::command]
pub fn update_project_sort_order(
    db: State<'_, Arc<Database>>,
    root: String,
    sort_order: i64,
) -> Result<(), String> {
    db.update_project_sort_order(&root, sort_order)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chats_list(db: State<'_, Arc<Database>>, project_root: String) -> Result<Vec<Chat>, String> {
    db.list_chats(&project_root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_upsert(db: State<'_, Arc<Database>>, chat: Chat) -> Result<(), String> {
    db.upsert_chat(&chat).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_delete(db: State<'_, Arc<Database>>, chat_id: String) -> Result<(), String> {
    db.delete_chat(&chat_id).map_err(|e| e.to_string())
}

/// Narrow title write for the OSC/auto-name flow — touches only `title`, so it
/// can't race the full-row `chat_upsert` and clobber a live `session_id`.
#[tauri::command]
pub fn update_chat_title(
    db: State<'_, Arc<Database>>,
    chat_id: String,
    title: String,
) -> Result<(), String> {
    db.update_chat_title(&chat_id, &title)
        .map_err(|e| e.to_string())
}

/// Narrow `session_id` write for chat session recovery — touches only
/// `session_id`, so it can't race a concurrent title write. `None` clears it.
#[tauri::command]
pub fn update_chat_session_id(
    db: State<'_, Arc<Database>>,
    chat_id: String,
    session_id: Option<String>,
) -> Result<(), String> {
    db.update_chat_session_id(&chat_id, session_id.as_deref())
        .map_err(|e| e.to_string())
}

/// Narrow `sort_order` write for chat reordering — touches only `sort_order`, so
/// dragging chats to re-sort can't race a concurrent narrow `session_id` write
/// and persist a stale recovery handle.
#[tauri::command]
pub fn update_chat_sort_order(
    db: State<'_, Arc<Database>>,
    chat_id: String,
    sort_order: i64,
) -> Result<(), String> {
    db.update_chat_sort_order(&chat_id, sort_order)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn orchestra_task_upsert(
    db: State<'_, Arc<Database>>,
    task: OrchestraTask,
) -> Result<(), String> {
    db.orchestra_task_upsert(&task).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn orchestra_task_delete(db: State<'_, Arc<Database>>, id: String) -> Result<(), String> {
    db.orchestra_task_delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn orchestra_tasks_list(
    db: State<'_, Arc<Database>>,
    project_root: String,
) -> Result<Vec<OrchestraTask>, String> {
    db.orchestra_tasks_for_project(&project_root)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_usage_summary(
    db: State<'_, Arc<Database>>,
    project_root: Option<String>,
) -> Result<Vec<AgentUsageSummary>, String> {
    db.agent_usage_summary(project_root.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_session_latest_for_chat(
    db: State<'_, Arc<Database>>,
    chat_id: String,
) -> Result<Option<AgentSessionRow>, String> {
    db.latest_agent_session_for_chat(&chat_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn operator_audit_insert(
    db: State<'_, Arc<Database>>,
    row: OperatorAuditRow,
) -> Result<(), String> {
    db.operator_audit_insert(&row).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn operator_audit_update(
    db: State<'_, Arc<Database>>,
    id: String,
    status: String,
    result: Option<String>,
) -> Result<(), String> {
    db.operator_audit_update_status(&id, &status, result.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn operator_audit_list(
    db: State<'_, Arc<Database>>,
    limit: i64,
) -> Result<Vec<OperatorAuditRow>, String> {
    db.operator_audit_list_recent(limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_get(
    db: State<'_, Arc<Database>>,
    root: String,
) -> Result<Option<ProjectSettings>, String> {
    db.get_settings(&root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_upsert(
    db: State<'_, Arc<Database>>,
    settings: ProjectSettings,
) -> Result<(), String> {
    db.upsert_settings(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn picks_list(
    db: State<'_, Arc<Database>>,
    project_root: String,
    limit: i64,
) -> Result<Vec<PickHistory>, String> {
    db.list_picks(&project_root, limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pick_insert(db: State<'_, Arc<Database>>, pick: PickHistory) -> Result<i64, String> {
    db.insert_pick(&pick).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn runs_list(
    db: State<'_, Arc<Database>>,
    project_root: String,
    limit: i64,
) -> Result<Vec<RunSessionLog>, String> {
    db.list_runs(&project_root, limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn run_insert(db: State<'_, Arc<Database>>, run: RunSessionLog) -> Result<(), String> {
    db.insert_run(&run).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn run_finish(
    db: State<'_, Arc<Database>>,
    session_id: String,
    ended_at: i64,
    exit_reason: Option<String>,
    exit_code: Option<i64>,
) -> Result<(), String> {
    db.finish_run(&session_id, ended_at, exit_reason.as_deref(), exit_code)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_run_insert(db: State<'_, Arc<Database>>, run: AgentRunLog) -> Result<i64, String> {
    db.insert_agent_run(&run).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_run_finish(
    db: State<'_, Arc<Database>>,
    id: i64,
    finished_at: i64,
    exit_code: Option<i64>,
    hot_reload_count: i64,
) -> Result<(), String> {
    db.finish_agent_run(id, finished_at, exit_code, hot_reload_count)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod projects_list_tests {
    use super::*;
    use crate::fs_commands::approved_canonical;

    fn make_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("pf-projlist-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(&dir).unwrap()
    }

    fn project(root: &std::path::Path, name: &str, archived: Option<i64>) -> Project {
        Project {
            project_root: root.to_string_lossy().into_owned(),
            display_name: name.to_string(),
            created_at: 0,
            last_opened_at: 0,
            sort_order: 0,
            archived_at: archived,
            remote_host: None,
            remote_root: None,
        }
    }

    // The `projects_list(include_archived = true)` path (Settings rendering
    // archived projects) must not re-approve an archived project's root: it
    // registers only active rows, so a gated read on an archived root stays
    // rejected while an active root is reachable.
    #[test]
    fn listing_with_archived_does_not_reapprove_an_archived_root() {
        let active = make_dir("active");
        let archived = make_dir("archived");
        // `db.list_projects(true)` returns both; only the active one registers.
        let rows = vec![
            project(&active, "active", None),
            project(&archived, "archived", Some(1)),
        ];

        let roots = ApprovedRoots::default();
        register_active_roots(&roots, &rows);

        let active_file = active.join("a.txt");
        let archived_file = archived.join("b.txt");
        std::fs::write(&active_file, b"x").unwrap();
        std::fs::write(&archived_file, b"y").unwrap();

        assert!(
            approved_canonical(&active_file.to_string_lossy(), &roots).is_ok(),
            "an active project's root must stay approved",
        );
        assert!(
            approved_canonical(&archived_file.to_string_lossy(), &roots).is_err(),
            "an archived project's root must NOT be approved by projects_list",
        );
    }
}
