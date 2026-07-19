//! Tauri command layer over `pickforge_core::Database`. Sync commands — SQLite
//! reads/writes are local and sub-millisecond.

use pickforge_core::{
    AgentRunLog, AgentSessionRow, AgentUsageSummary, Chat, Database, OperatorAuditRow,
    OrchestraTask, PickHistory, Project, RunSessionLog,
};
use std::sync::Arc;
use tauri::State;

use crate::project_roots::{ensure_root_approved, reconcile_or_log, ApprovedRoots};

#[tauri::command]
pub fn projects_list(
    db: State<'_, Arc<Database>>,
    roots: State<'_, ApprovedRoots>,
    include_archived: bool,
) -> Result<Vec<Project>, String> {
    let projects = db
        .list_projects(include_archived)
        .map_err(|e| e.to_string())?;
    // Reconcile the approved-root registry against the DB's live active set on
    // every list — another process may have added, archived, or deleted a
    // project since this one last reconciled, and this fully replaces (rather
    // than merely adds to) the registry, so an externally observed removal
    // takes effect too. `include_archived` only affects what's RETURNED to the
    // caller (Settings renders archived projects); `reconcile` always sources
    // from the active set.
    reconcile_or_log(&roots, &db);
    Ok(projects)
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
    db.upsert_project(&project).map_err(|e| e.to_string())?;
    reconcile_or_log(&roots, &db);
    Ok(())
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
    // Archiving drops the project from the active set; reconcile so its root is
    // no longer approved (unarchiving re-adds it).
    reconcile_or_log(&roots, &db);
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
    // A deleted root must not stay approved for the rest of the process
    // lifetime; reconcile against the now-updated live project set.
    reconcile_or_log(&roots, &db);
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

/// Narrow title write. Omitted metadata preserves the pre-feature title-only
/// storage semantics; supplying both fields atomically persists provenance.
/// The returned boolean tells automatic callers whether durable ownership still
/// allowed their compare-and-set write.
#[tauri::command]
pub fn update_chat_title(
    db: State<'_, Arc<Database>>,
    chat_id: String,
    title: String,
    title_source: Option<String>,
    title_updated_at: Option<i64>,
) -> Result<bool, String> {
    match (title_source.as_deref(), title_updated_at) {
        (None, None) => db.update_chat_title(&chat_id, &title).map(|_| true),
        (Some(source), Some(updated_at)) => {
            db.update_chat_title_with_metadata(&chat_id, &title, source, updated_at)
        }
        _ => Err(pickforge_core::db::DbError::Other(
            "title_source and title_updated_at must be supplied together".into(),
        )),
    }
    .map_err(|e| e.to_string())
}

/// Narrow ownership-only write used by “Resume automatic titles”. The returned
/// boolean reports whether the monotonic compare-and-set applied.
#[tauri::command]
pub fn update_chat_title_ownership(
    db: State<'_, Arc<Database>>,
    chat_id: String,
    title_source: String,
    title_updated_at: i64,
) -> Result<bool, String> {
    db.update_chat_title_ownership(&chat_id, &title_source, title_updated_at)
        .map_err(|e| e.to_string())
}

/// Narrow provider identity write used by agent switches. It must not carry a
/// stale title/provenance snapshot from the frontend.
#[tauri::command]
pub fn update_chat_agent(
    db: State<'_, Arc<Database>>,
    chat_id: String,
    agent_id: String,
    kind: String,
) -> Result<(), String> {
    db.update_chat_agent(&chat_id, &agent_id, &kind)
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

#[cfg(test)]
mod projects_list_tests {
    use super::*;
    use crate::project_roots::approved_canonical;

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
    // archived projects) must not re-approve an archived project's root:
    // `reconcile` always sources the registry from the DB's active set
    // (`list_projects(false)`), independent of what `include_archived` returns
    // to the caller.
    #[test]
    fn listing_with_archived_does_not_reapprove_an_archived_root() {
        let db = Database::open_in_memory().expect("in-memory db");
        let active = make_dir("active");
        let archived = make_dir("archived");
        db.upsert_project(&project(&active, "active", None)).unwrap();
        db.upsert_project(&project(&archived, "archived", Some(1)))
            .unwrap();

        let roots = ApprovedRoots::default();
        // Mirrors `projects_list(include_archived: true)`: the returned rows
        // include the archived one, but reconciling must not approve it.
        let _ = db.list_projects(true).unwrap();
        reconcile_or_log(&roots, &db);

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
