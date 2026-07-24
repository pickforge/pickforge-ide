//! Folds a chat's timeline of `TurnStarted` / `FileChange` / `TurnDone`
//! [`AgentEvent`]s into per-turn [`ChangeSet`] values (#231 PR 1). Pure and
//! read-only: it never touches the working tree, so a historical turn keeps
//! rendering the exact payload that was captured even after the files it
//! named are edited, deleted or reset later — the issue's "turn snapshots
//! are immutable" rule.
//!
//! Caveat for callers wiring this up: `AgentChatManager`
//! (`crate::agents::manager`) persists `TurnDone` as a timeline item for
//! every provider and both `TurnStatus` values (completed and interrupted)
//! as of #290 — `handle_runner_event`'s `TurnDone` arm now calls
//! `append_item` unconditionally, the same as `FileChange`. `TurnStarted` is
//! still a no-op there and is never persisted.
//!
//! That turns out not to matter much for grouping: this fold opens a turn
//! implicitly on the first `FileChange` seen with none already open (see
//! `file_change_before_any_turn_started_opens_an_implicit_turn` below), so a
//! timeline of durable rows containing only `FileChange` + `TurnDone` — no
//! `TurnStarted` at all — already groups correctly turn-by-turn, closing
//! each accumulator on its `TurnDone` row. Explicit `TurnStarted` mainly
//! sharpens `turn_seq`/`captured_at` to the turn's true opening event rather
//! than its first file change; it is not required for correct grouping.
//!
//! The one-open-`stale:true`-turn fallback (all `FileChange` rows collapse
//! into a single trailing turn) now only bites in three narrower cases: (1)
//! history recorded before #290, which has no persisted `TurnDone` rows to
//! close on; (2) a turn whose terminal event was `TurnFailed` rather than
//! `TurnDone` — this fold does not currently treat `TurnFailed` as a closing
//! event (only `AgentEvent::TurnDone` closes an accumulator), even though
//! `TurnFailed` has been persisted unconditionally all along, so that
//! turn's changes leak into whatever follows it; and (3) a turn that never
//! received any terminal event (e.g. a hard crash mid-turn). (2) is a
//! same-shape one-line follow-up (fold `TurnFailed` the same as `TurnDone`
//! in the match below) if failed-turn receipts turn out to matter for PR2.

use std::collections::HashMap;

use crate::agents::{AgentEvent, FileChangeEntry, FileChangeKind};
use crate::changes::{
    ChangeFileStatus, ChangeScope, ChangeSet, ChangeSource, ChangeTotals, ChangedFile,
};
use crate::git::diff_stat::count_unified_diff_stat;

/// One timeline event already anchored to its persisted ordering/timing —
/// the shape of `AgentTimelineEntry::Item { seq, created_at, .. }` decoded
/// back into an [`AgentEvent`], or an equivalent live event plus its
/// position. `group_turn_change_sets` only inspects `TurnStarted`,
/// `FileChange` and `TurnDone`; every other variant is ignored so a caller
/// can hand over a chat's full timeline without pre-filtering.
#[derive(Debug, Clone, PartialEq)]
pub struct TimelineTurnEvent {
    pub seq: i64,
    /// Unix-millis, matching `AgentTimelineEntry`'s `created_at`.
    pub captured_at: i64,
    pub event: AgentEvent,
}

/// Folds `events` (already ordered by `seq`) into one [`ChangeSet`] per
/// turn. A turn opens on `TurnStarted` and closes on the next `TurnDone`;
/// `FileChange` entries between them are deduplicated per path and folded in
/// arrival order (last status wins, stats only ever gain — never lose — a
/// known value; see [`TurnAccumulator::fold_one`]). A turn with no closing
/// `TurnDone` yet (still running, or interrupted with no terminal event at
/// all) is still emitted, marked `stale: true`.
pub fn group_turn_change_sets(
    chat_id: &str,
    repo_root: &str,
    events: &[TimelineTurnEvent],
) -> Vec<ChangeSet> {
    let mut turns = Vec::new();
    let mut current: Option<TurnAccumulator> = None;

    for item in events {
        match &item.event {
            AgentEvent::TurnStarted => {
                if let Some(acc) = current.take() {
                    turns.push(acc.finish(true));
                }
                current = Some(TurnAccumulator::new(item.seq, item.captured_at));
            }
            AgentEvent::FileChange { changes, .. } => {
                current
                    .get_or_insert_with(|| TurnAccumulator::new(item.seq, item.captured_at))
                    .fold_changes(changes, item.captured_at);
            }
            AgentEvent::TurnDone { .. } => {
                if let Some(mut acc) = current.take() {
                    acc.captured_at = item.captured_at;
                    turns.push(acc.finish(false));
                }
            }
            _ => {}
        }
    }
    if let Some(acc) = current.take() {
        turns.push(acc.finish(true));
    }

    for turn in &mut turns {
        turn.id = format!("turn:{chat_id}:{}", turn.turn_seq.unwrap_or_default());
        turn.chat_id = Some(chat_id.to_string());
        turn.repo_root = repo_root.to_string();
    }
    turns
}

/// Accumulates one open turn's deduplicated per-path [`ChangedFile`] rows.
struct TurnAccumulator {
    turn_seq: i64,
    captured_at: i64,
    order: Vec<String>,
    files: HashMap<String, ChangedFile>,
}

impl TurnAccumulator {
    fn new(turn_seq: i64, captured_at: i64) -> Self {
        Self {
            turn_seq,
            captured_at,
            order: Vec::new(),
            files: HashMap::new(),
        }
    }

    fn fold_changes(&mut self, changes: &[FileChangeEntry], captured_at: i64) {
        self.captured_at = captured_at;
        for change in changes {
            self.fold_one(change);
        }
    }

    /// Dedup/fold rule for repeated events on the same path within one turn:
    /// status is last-write-wins (the most recent event is the path's final
    /// state this turn); additions/deletions only ever move from unknown to
    /// known, never the reverse, so a later event with no diff attached
    /// cannot erase an earlier known count; binary/truncated are sticky once
    /// observed; a file is diff-available as soon as any one event for it
    /// carried a diff body.
    fn fold_one(&mut self, change: &FileChangeEntry) {
        let stat = change
            .diff
            .as_deref()
            .map(count_unified_diff_stat)
            .unwrap_or(crate::git::diff_stat::DiffBodyStat {
                additions: None,
                deletions: None,
                binary: false,
                truncated: false,
            });
        let status = map_provider_status(&change.kind);

        if let Some(existing) = self.files.get_mut(&change.path) {
            existing.status = status;
            existing.additions = stat.additions.or(existing.additions);
            existing.deletions = stat.deletions.or(existing.deletions);
            existing.binary |= stat.binary;
            existing.truncated |= stat.truncated;
            existing.diff_available |= change.diff.is_some();
            return;
        }

        self.order.push(change.path.clone());
        self.files.insert(
            change.path.clone(),
            ChangedFile {
                path: change.path.clone(),
                old_path: None,
                status,
                staged: None,
                unstaged: None,
                additions: stat.additions,
                deletions: stat.deletions,
                binary: stat.binary,
                truncated: stat.truncated,
                diff_available: change.diff.is_some(),
            },
        );
    }

    fn finish(self, stale: bool) -> ChangeSet {
        let files: Vec<ChangedFile> = self
            .order
            .into_iter()
            .filter_map(|path| self.files.get(&path).cloned())
            .collect();
        let totals = ChangeTotals::from_files(&files);
        ChangeSet {
            id: String::new(),
            scope: ChangeScope::Turn,
            source: ChangeSource::ProviderSnapshot,
            chat_id: None,
            turn_seq: Some(self.turn_seq),
            repo_root: String::new(),
            captured_at: self.captured_at,
            stale,
            files,
            totals,
        }
    }
}

/// Provider `FileChangeEntry.kind` maps 1:1 onto the locked status
/// vocabulary; providers never report `conflict` (that's a Git-live-only
/// concept), so this mapping is total and infallible.
fn map_provider_status(kind: &FileChangeKind) -> ChangeFileStatus {
    match kind {
        FileChangeKind::Add => ChangeFileStatus::Add,
        FileChangeKind::Modify => ChangeFileStatus::Modify,
        FileChangeKind::Delete => ChangeFileStatus::Delete,
        FileChangeKind::Rename => ChangeFileStatus::Rename,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::TurnStatus;

    fn started(seq: i64, at: i64) -> TimelineTurnEvent {
        TimelineTurnEvent {
            seq,
            captured_at: at,
            event: AgentEvent::TurnStarted,
        }
    }

    fn done(seq: i64, at: i64) -> TimelineTurnEvent {
        TimelineTurnEvent {
            seq,
            captured_at: at,
            event: AgentEvent::TurnDone {
                status: TurnStatus::Completed,
            },
        }
    }

    fn file_change(
        seq: i64,
        at: i64,
        path: &str,
        kind: FileChangeKind,
        diff: Option<&str>,
    ) -> TimelineTurnEvent {
        TimelineTurnEvent {
            seq,
            captured_at: at,
            event: AgentEvent::FileChange {
                item_id: format!("item-{seq}"),
                changes: vec![FileChangeEntry {
                    path: path.to_string(),
                    kind,
                    diff: diff.map(str::to_string),
                }],
            },
        }
    }

    #[test]
    fn groups_one_closed_turn() {
        let events = vec![
            started(1, 100),
            file_change(
                2,
                110,
                "src/lib.rs",
                FileChangeKind::Modify,
                Some("+a\n-b\n"),
            ),
            done(3, 120),
        ];
        let turns = group_turn_change_sets("chat-1", "/repo", &events);
        assert_eq!(turns.len(), 1);
        let turn = &turns[0];
        assert_eq!(turn.scope, ChangeScope::Turn);
        assert_eq!(turn.source, ChangeSource::ProviderSnapshot);
        assert_eq!(turn.chat_id.as_deref(), Some("chat-1"));
        assert_eq!(turn.turn_seq, Some(1));
        assert_eq!(turn.repo_root, "/repo");
        assert_eq!(turn.captured_at, 120);
        assert!(!turn.stale);
        assert_eq!(turn.files.len(), 1);
        assert_eq!(turn.files[0].additions, Some(1));
        assert_eq!(turn.files[0].deletions, Some(1));
        assert_eq!(turn.totals.files, 1);
    }

    #[test]
    fn dedup_folds_repeated_path_in_order_last_status_wins() {
        let events = vec![
            started(1, 100),
            file_change(2, 110, "src/lib.rs", FileChangeKind::Add, Some("+one\n")),
            file_change(
                3,
                115,
                "src/lib.rs",
                FileChangeKind::Modify,
                Some("+two\n+three\n"),
            ),
            done(4, 120),
        ];
        let turns = group_turn_change_sets("chat-1", "/repo", &events);
        assert_eq!(turns[0].files.len(), 1, "same path folds to one row");
        let file = &turns[0].files[0];
        assert_eq!(file.status, ChangeFileStatus::Modify, "last event wins");
        // Latest event's own stats replace the prior known value (it's the
        // freshest count for that path), not summed across events.
        assert_eq!(file.additions, Some(2));
    }

    #[test]
    fn dedup_keeps_known_stats_when_a_later_event_has_no_diff() {
        let events = vec![
            started(1, 100),
            file_change(
                2,
                110,
                "src/lib.rs",
                FileChangeKind::Modify,
                Some("+a\n-b\n"),
            ),
            file_change(3, 115, "src/lib.rs", FileChangeKind::Modify, None),
            done(4, 120),
        ];
        let turns = group_turn_change_sets("chat-1", "/repo", &events);
        let file = &turns[0].files[0];
        // A later event with no diff must not erase the earlier known count.
        assert_eq!(file.additions, Some(1));
        assert_eq!(file.deletions, Some(1));
    }

    #[test]
    fn dedup_preserves_arrival_order_across_distinct_paths() {
        let events = vec![
            started(1, 100),
            file_change(2, 110, "b.rs", FileChangeKind::Add, None),
            file_change(3, 111, "a.rs", FileChangeKind::Add, None),
            done(4, 120),
        ];
        let turns = group_turn_change_sets("chat-1", "/repo", &events);
        let paths: Vec<&str> = turns[0].files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["b.rs", "a.rs"]);
    }

    #[test]
    fn groups_multiple_turns_without_cross_turn_dedup() {
        let events = vec![
            started(1, 100),
            file_change(2, 105, "a.rs", FileChangeKind::Add, None),
            done(3, 110),
            started(4, 200),
            file_change(5, 205, "a.rs", FileChangeKind::Modify, None),
            done(6, 210),
        ];
        let turns = group_turn_change_sets("chat-1", "/repo", &events);
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].turn_seq, Some(1));
        assert_eq!(turns[0].files[0].status, ChangeFileStatus::Add);
        assert_eq!(turns[1].turn_seq, Some(4));
        assert_eq!(turns[1].files[0].status, ChangeFileStatus::Modify);
        assert_ne!(turns[0].id, turns[1].id);
    }

    #[test]
    fn interrupted_turn_with_no_turn_done_is_emitted_stale() {
        let events = vec![
            started(1, 100),
            file_change(2, 105, "a.rs", FileChangeKind::Add, None),
            // No TurnDone: the session was interrupted mid-turn.
        ];
        let turns = group_turn_change_sets("chat-1", "/repo", &events);
        assert_eq!(turns.len(), 1);
        assert!(turns[0].stale);
        assert_eq!(turns[0].files.len(), 1);
    }

    #[test]
    fn a_turn_started_without_a_prior_turn_done_still_closes_the_previous_one() {
        let events = vec![
            started(1, 100),
            file_change(2, 105, "a.rs", FileChangeKind::Add, None),
            // Next TurnStarted arrives with no TurnDone in between.
            started(3, 200),
            file_change(4, 205, "b.rs", FileChangeKind::Add, None),
            done(5, 210),
        ];
        let turns = group_turn_change_sets("chat-1", "/repo", &events);
        assert_eq!(turns.len(), 2);
        assert!(
            turns[0].stale,
            "closed only by the next TurnStarted, not TurnDone"
        );
        assert!(!turns[1].stale);
    }

    #[test]
    fn missing_provider_stats_stay_none_never_invented() {
        let events = vec![
            started(1, 100),
            file_change(2, 105, "a.rs", FileChangeKind::Add, None),
            done(3, 110),
        ];
        let turns = group_turn_change_sets("chat-1", "/repo", &events);
        let file = &turns[0].files[0];
        assert_eq!(file.additions, None);
        assert_eq!(file.deletions, None);
        assert_eq!(turns[0].totals.additions, 0, "totals sum only known values");
        assert_eq!(turns[0].totals.files, 1);
    }

    #[test]
    fn file_change_before_any_turn_started_opens_an_implicit_turn() {
        let events = vec![
            file_change(1, 100, "a.rs", FileChangeKind::Add, None),
            done(2, 110),
        ];
        let turns = group_turn_change_sets("chat-1", "/repo", &events);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].turn_seq, Some(1));
    }

    #[test]
    fn events_outside_the_three_tracked_kinds_are_ignored() {
        let events = vec![
            started(1, 100),
            TimelineTurnEvent {
                seq: 2,
                captured_at: 105,
                event: AgentEvent::TextFinal {
                    item_id: None,
                    text: "hello".into(),
                },
            },
            file_change(3, 106, "a.rs", FileChangeKind::Add, None),
            done(4, 110),
        ];
        let turns = group_turn_change_sets("chat-1", "/repo", &events);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].files.len(), 1);
    }
}
