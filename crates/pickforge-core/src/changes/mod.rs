//! Normalized change-set model shared by provider turn snapshots, historical
//! Git snapshots and the live Git working tree (#231). This module holds only
//! the domain types and pure folding logic — no process spawning, no Tauri
//! wiring. Git-side parsing that *produces* [`ChangedFile`] rows lives beside
//! the `git` module (`crate::git::diff_stat`); provider-turn grouping lives in
//! [`turn`].

pub mod turn;

pub use turn::{decode_timeline_events, group_turn_change_sets, turn_file_diff, TimelineTurnEvent};

use serde::{Deserialize, Serialize};

/// What a [`ChangeSet`] covers: one agent turn, or the live working tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeScope {
    Turn,
    WorkingTree,
}

/// Where a [`ChangeSet`]'s data came from. Attribution is honest: a provider
/// snapshot is labeled as agent-turn changes, while a Git snapshot captured
/// only at turn completion is a workspace snapshot, not proof the agent
/// caused every change (see the issue's "Attribution is honest" rule).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeSource {
    ProviderSnapshot,
    GitSnapshot,
    GitLive,
}

/// One file's status/stat row inside a [`ChangeSet`].
///
/// `additions`/`deletions` are `None` — never `0` — whenever the true count
/// is not known: binary content, a bounded/truncated parse, or a provider
/// event that carried no diff at all. Callers must render "unknown", not a
/// silently wrong zero.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: ChangeFileStatus,
    /// `None` when staged/unstaged is not a meaningful concept for this
    /// change-set's source (e.g. a provider turn snapshot); `Some(true)`
    /// when this file has that kind of change, `Some(false)` when the
    /// producing Git call is known to have found none of that kind.
    pub staged: Option<bool>,
    pub unstaged: Option<bool>,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
    pub binary: bool,
    pub truncated: bool,
    pub diff_available: bool,
}

/// Locked five-way status vocabulary from the change-set contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeFileStatus {
    Add,
    Modify,
    Delete,
    Rename,
    Conflict,
}

/// Aggregate counts for a [`ChangeSet`]. `additions`/`deletions` sum only the
/// files whose stats are known (see [`ChangedFile`] doc comment) — a
/// change-set containing any binary/truncated/statless file therefore always
/// under-reports true totals by construction. Rendering must treat these
/// totals as a floor, never as exact, whenever `files.len() >
/// files_with_known_stats`; the UI layer decides how to signal that honestly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeTotals {
    pub files: u64,
    pub additions: u64,
    pub deletions: u64,
}

impl ChangeTotals {
    /// Sums only known additions/deletions, per the module doc comment.
    pub fn from_files(files: &[ChangedFile]) -> Self {
        let mut totals = Self {
            files: files.len() as u64,
            additions: 0,
            deletions: 0,
        };
        for file in files {
            totals.additions += file.additions.unwrap_or(0);
            totals.deletions += file.deletions.unwrap_or(0);
        }
        totals
    }
}

/// One normalized snapshot of changed files: a turn's provider-reported
/// changes, a historical Git snapshot, or the live working tree.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSet {
    pub id: String,
    pub scope: ChangeScope,
    pub source: ChangeSource,
    pub chat_id: Option<String>,
    pub turn_seq: Option<i64>,
    pub repo_root: String,
    /// Unix-millis, matching the rest of the crate's persisted timestamps.
    pub captured_at: i64,
    /// Turn scope: true until the turn's closing event is observed (still
    /// in flight, or interrupted with no closing event at all — see
    /// [`turn::group_turn_change_sets`]). Working-tree scope: true when the
    /// snapshot is known out of date relative to the live Git state; PR2
    /// owns computing that.
    pub stale: bool,
    pub files: Vec<ChangedFile>,
    pub totals: ChangeTotals,
}

/// Lazily-fetched unified-diff text for one file (#231 PR2), shared by the
/// git-live per-file fetch (`crate::git::working_tree::file_diff`) and the
/// turn-snapshot per-file fetch ([`turn::turn_file_diff`]). Not part of
/// [`ChangeSet`]/[`ChangedFile`] — the issue's locked contract keeps a
/// listing cheap (`diff_available: bool` only); the actual diff body is a
/// separate, bounded round trip per file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeDiff {
    /// `None` when `binary` is true (a diff body is never sent for binary
    /// content) or when `available` is false. Otherwise the unified-diff
    /// text, possibly a bounded prefix of it — see `truncated`.
    pub diff: Option<String>,
    pub binary: bool,
    /// `true` when `diff` is a bounded prefix of the true diff (a time,
    /// byte, or line bound was hit) rather than the complete body.
    pub truncated: bool,
    /// `false` when the source has no diff at all for this file: a
    /// provider turn that never captured one for this path, or a git
    /// command that failed (repo missing, path not found). Distinct from
    /// `binary`, which means a diff conceptually exists but has no
    /// meaningful text form.
    pub available: bool,
}

/// Builds a [`ChangeDiff`] from raw diff text plus whether the byte capture
/// that produced it was already truncated upstream (a bounded *process*
/// capture — pass `false` for a turn-snapshot source, which has no such
/// capture step of its own). Shared by the git-live
/// (`crate::git::working_tree::file_diff`) and turn-snapshot (the Tauri
/// command layer's `changes_turn_file_diff`) per-file diff fetches, so
/// binary detection and display-bounding happen exactly once, the same way,
/// for both sources: [`crate::git::diff_stat::count_unified_diff_stat`] for
/// binary detection, [`crate::git::diff_stat::bound_diff_display`] for the
/// byte/line display bound.
pub fn finish_change_diff(text: &str, capture_truncated: bool) -> ChangeDiff {
    if text.is_empty() {
        return ChangeDiff {
            diff: Some(String::new()),
            binary: false,
            truncated: capture_truncated,
            available: true,
        };
    }
    let stat = crate::git::diff_stat::count_unified_diff_stat(text);
    if stat.binary {
        return ChangeDiff {
            diff: None,
            binary: true,
            truncated: capture_truncated,
            available: true,
        };
    }
    let (bounded_text, text_truncated) = crate::git::diff_stat::bound_diff_display(text);
    ChangeDiff {
        diff: Some(bounded_text),
        binary: false,
        truncated: capture_truncated || text_truncated,
        available: true,
    }
}
