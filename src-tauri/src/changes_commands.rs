//! Tauri commands over the #231 change-set domain layer (PR2): a chat's
//! per-turn ChangeSets from persisted timeline events, the live working-tree
//! ChangeSet, and a lazy per-file diff fetch for both sources. Kept in its
//! own module — not `git_commands.rs` or `agent_chat_commands.rs` — so it
//! can land independent of unrelated concurrent work on those files.
//!
//! Safety, locked by #231: every command takes `project_root` and validates
//! it through the same `ApprovedRoots` seam every other filesystem/git
//! command uses (`crate::project_roots::approved_canonical`) — a renderer
//! can't ask about a directory outside an approved project. The two
//! git-live commands additionally check whether `project_root` names a
//! remote-bound Project row — the same `db.list_projects(false)` lookup
//! `pty_commands::authorize_remote_pty` already uses to find a project's
//! remote binding — and return an explicit unsupported state rather than
//! either scanning a coincidentally-matching local path or falling through
//! to `approved_canonical`'s generic "not an approved directory" error:
//! `project_roots::compute_active_project_roots` already excludes a
//! remote-bound root from `ApprovedRoots` entirely, so without this
//! dedicated check the renderer could not distinguish "this project is
//! remote" from "this path is wrong". Per-file paths are validated
//! repo-relative, traversal- and symlink-escape-safe by
//! `pickforge_core::git::working_tree::file_diff` itself, before any `git`
//! invocation runs.

use std::sync::Arc;

use pickforge_core::changes::{
    decode_timeline_events, finish_change_diff_from, group_turn_change_sets, turn_file_diff,
    ChangeDiff, ChangeSet, TimelineTurnEvent,
};
use pickforge_core::db::Database;
use pickforge_core::git::working_tree;
use serde::Serialize;
use tauri::State;

use crate::project_roots::{approved_canonical, ApprovedRoots};

/// Per-turn ChangeSets for `chat_id`'s persisted timeline, folded via
/// `group_turn_change_sets` fed from the real `agent_items`/`agent_messages`
/// read path (`Database::agent_timeline_for_chat`) — not a fixture. Turn
/// snapshots are immutable, so this always reflects exactly what each turn's
/// provider events reported, independent of the live working tree.
/// `project_root` is gated the same as every other command; its canonical
/// form becomes every returned ChangeSet's `repoRoot`.
#[tauri::command]
pub async fn changes_list_turn_change_sets(
    db: State<'_, Arc<Database>>,
    roots: State<'_, ApprovedRoots>,
    chat_id: String,
    project_root: String,
) -> Result<Vec<ChangeSet>, String> {
    let repo_root = approved_canonical(&project_root, &roots)?
        .to_string_lossy()
        .into_owned();
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let entries = db
            .agent_timeline_for_chat(&chat_id)
            .map_err(|err| err.to_string())?;
        let events = decode_timeline_events(&entries);
        Ok(group_turn_change_sets(&chat_id, &repo_root, &events))
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Lazily-fetched turn-snapshot diff text for one file within one turn
/// (#231 PR2's turn-snapshot source of the lazy per-file diff fetch, extended
/// #231 PR5). Re-reads and re-decodes the chat's timeline scoped to
/// `turn_seq` + `path` rather than caching anything server-side — turn
/// snapshots are small and immutable, so re-deriving stays cheap and always
/// agrees with the listing call. `available: false` (not an error) when that
/// turn has no diff-bearing `FileChange` event for `path` at all.
///
/// `skip_lines` is the "load more" affordance for a `truncated: true` result
/// (#231 PR5): `0` for the initial fetch, otherwise the number of diff lines
/// the caller already has, to get the next bounded chunk. Turn-snapshot text
/// is always a valid Rust `String` (decoded from persisted JSON), so unlike
/// the working-tree side there is no raw-byte invalid-UTF-8 signal to
/// compute here — `ChangeDiff::invalid_utf8` stays `false` by construction.
#[tauri::command]
pub async fn changes_turn_file_diff(
    db: State<'_, Arc<Database>>,
    roots: State<'_, ApprovedRoots>,
    chat_id: String,
    project_root: String,
    turn_seq: i64,
    path: String,
    skip_lines: u32,
) -> Result<ChangeDiff, String> {
    approved_canonical(&project_root, &roots)?;
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let entries = db
            .agent_timeline_for_chat(&chat_id)
            .map_err(|err| err.to_string())?;
        let events = decode_timeline_events(&entries);
        Ok(resolve_turn_file_diff(&events, turn_seq, &path, skip_lines))
    })
    .await
    .map_err(|err| err.to_string())?
}

fn resolve_turn_file_diff(
    events: &[TimelineTurnEvent],
    turn_seq: i64,
    path: &str,
    skip_lines: u32,
) -> ChangeDiff {
    match turn_file_diff(events, turn_seq, path) {
        Some(diff) => finish_change_diff_from(diff, false, skip_lines as usize),
        None => ChangeDiff {
            diff: None,
            binary: false,
            truncated: false,
            available: false,
            size_bytes: None,
            invalid_utf8: false,
        },
    }
}

/// Explicit working-tree states the issue calls out: a normal `Ready`
/// change-set, `NotARepo` (Git-unavailable / not a repository), and
/// `RemoteUnsupported` (a remote-bound project — no local Git process may be
/// spawned against it; the remote host is not yet an authorized diff seam).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum WorkingTreeChanges {
    Ready { change_set: ChangeSet },
    NotARepo,
    RemoteUnsupported,
}

/// The live working-tree ChangeSet for `project_root` (#231 PR2, `scope:
/// workingTree`, `source: gitLive`). Bounded the same way every other
/// `crate::git` process invocation is (see
/// `pickforge_core::git::working_tree::working_tree_change_set`'s doc
/// comment for the exact `git` invocation shape).
#[tauri::command]
pub async fn changes_working_tree(
    db: State<'_, Arc<Database>>,
    roots: State<'_, ApprovedRoots>,
    project_root: String,
) -> Result<WorkingTreeChanges, String> {
    if is_remote_bound(db.inner(), &project_root)? {
        return Ok(WorkingTreeChanges::RemoteUnsupported);
    }
    let canonical_root = approved_canonical(&project_root, &roots)?
        .to_string_lossy()
        .into_owned();
    tauri::async_runtime::spawn_blocking(move || {
        match working_tree::working_tree_change_set(&canonical_root) {
            Some(change_set) => WorkingTreeChanges::Ready { change_set },
            None => WorkingTreeChanges::NotARepo,
        }
    })
    .await
    .map_err(|err| err.to_string())
}

/// The live unified diff for one repo-relative file in the working tree
/// (#231 PR2's git-live source of the lazy per-file diff fetch, extended
/// #231 PR5's `skip_lines` "load more" affordance — see
/// `pickforge_core::git::working_tree::file_diff`'s doc comment), staged or
/// unstaged.
#[tauri::command]
pub async fn changes_working_tree_file_diff(
    db: State<'_, Arc<Database>>,
    roots: State<'_, ApprovedRoots>,
    project_root: String,
    path: String,
    staged: bool,
    skip_lines: u32,
) -> Result<ChangeDiff, String> {
    if is_remote_bound(db.inner(), &project_root)? {
        return Err("remote projects do not support live diff review yet".to_string());
    }
    let canonical_root = approved_canonical(&project_root, &roots)?
        .to_string_lossy()
        .into_owned();
    tauri::async_runtime::spawn_blocking(move || {
        working_tree::file_diff(&canonical_root, &path, staged, skip_lines)
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Whether `project_root` names an active Project row bound to a remote
/// host — the same `db.list_projects(false)` + exact-match lookup
/// `pty_commands::authorize_remote_pty_with` uses to find a project's remote
/// binding. Runs synchronously (a small, indexed local read) before the
/// heavier `spawn_blocking` git work, so a remote project never reaches
/// `approved_canonical`'s generic rejection.
fn is_remote_bound(db: &Database, project_root: &str) -> Result<bool, String> {
    let projects = db.list_projects(false).map_err(|err| err.to_string())?;
    Ok(projects
        .iter()
        .any(|project| project.project_root == project_root && project.remote_host.is_some()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_turn_file_diff_reports_unavailable_when_no_diff_body_exists() {
        let result = resolve_turn_file_diff(&[], 1, "a.rs", 0);
        assert!(!result.available);
        assert!(result.diff.is_none());
    }

    #[test]
    fn resolve_turn_file_diff_bounds_and_detects_binary_the_same_as_git_live() {
        use pickforge_core::agents::{AgentEvent, FileChangeEntry, FileChangeKind};

        let events = vec![
            TimelineTurnEvent {
                seq: 1,
                captured_at: 100,
                event: AgentEvent::TurnStarted,
            },
            TimelineTurnEvent {
                seq: 2,
                captured_at: 110,
                event: AgentEvent::FileChange {
                    item_id: "item-1".to_string(),
                    changes: vec![FileChangeEntry {
                        path: "a.rs".to_string(),
                        kind: FileChangeKind::Modify,
                        diff: Some("+one\n-two\n".to_string()),
                    }],
                },
            },
        ];
        let result = resolve_turn_file_diff(&events, 1, "a.rs", 0);
        assert!(result.available);
        assert!(!result.binary);
        assert_eq!(result.diff.as_deref(), Some("+one\n-two\n"));
    }

    #[test]
    fn resolve_turn_file_diff_load_more_skips_already_seen_lines() {
        use pickforge_core::agents::{AgentEvent, FileChangeEntry, FileChangeKind};

        let events = vec![
            TimelineTurnEvent {
                seq: 1,
                captured_at: 100,
                event: AgentEvent::TurnStarted,
            },
            TimelineTurnEvent {
                seq: 2,
                captured_at: 110,
                event: AgentEvent::FileChange {
                    item_id: "item-1".to_string(),
                    changes: vec![FileChangeEntry {
                        path: "a.rs".to_string(),
                        kind: FileChangeKind::Modify,
                        diff: Some("+one\n+two\n+three\n".to_string()),
                    }],
                },
            },
        ];
        let result = resolve_turn_file_diff(&events, 1, "a.rs", 1);
        assert_eq!(result.diff.as_deref(), Some("+two\n+three\n"));
    }

    #[test]
    fn is_remote_bound_reads_the_project_rows_exact_match() {
        let db = Database::open_in_memory().unwrap();
        assert!(!is_remote_bound(&db, "/nonexistent").unwrap());
    }
}
