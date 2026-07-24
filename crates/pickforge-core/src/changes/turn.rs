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
//! into a single trailing turn) now only bites in two narrower cases: (1)
//! history recorded before #290, which has no persisted `TurnDone`/
//! `TurnFailed` rows to close on; and (2) a turn that never received any
//! terminal event at all (e.g. a hard crash mid-turn). A turn whose terminal
//! event was `TurnFailed` rather than `TurnDone` closes the same way `TurnDone`
//! does (#231 PR2) — `TurnFailed` has been persisted unconditionally since
//! #290, same as `TurnDone`, so treating only one of the two as a boundary
//! would leak a failed turn's changes into whatever follows it.

use std::collections::HashMap;

use crate::agents::{AgentEvent, FileChangeEntry, FileChangeKind};
use crate::changes::{
    ChangeFileStatus, ChangeScope, ChangeSet, ChangeSource, ChangeTotals, ChangedFile,
};
use crate::git::diff_stat::{count_unified_diff_stat, known_counts, DiffBodyStat};

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
/// turn. A turn opens on `TurnStarted` and closes on the next `TurnDone` OR
/// `TurnFailed` — both are terminal events persisted unconditionally (#290),
/// so either one closes the accumulator identically; `FileChange` entries
/// between them are deduplicated per path and folded in arrival order:
/// status is last-write-wins, but stats are first-known-wins and either
/// sticky `binary`/`truncated` flag clears both counts to `None` even if one
/// was already known (see [`TurnAccumulator::fold_one`]). A turn with no
/// closing terminal event yet (still running, or interrupted with no
/// terminal event at all) is still emitted, marked `stale: true`.
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
            AgentEvent::TurnDone { .. } | AgentEvent::TurnFailed { .. } => {
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
    /// state this turn); additions/deletions are first-known-wins — the
    /// first event to report a known count keeps it, a later event's known
    /// count never overwrites it (avoids picking an arbitrary "more
    /// correct" one across dedup-folded events); binary/truncated are
    /// sticky once observed, and per the crate-wide invariant
    /// (`crate::git::diff_stat::known_counts`), whenever either sticky flag
    /// is true both counts are `None` even if a count was already known
    /// before this event; a file is diff-available as soon as any one event
    /// for it carried a diff body.
    fn fold_one(&mut self, change: &FileChangeEntry) {
        let stat = change
            .diff
            .as_deref()
            .map(count_unified_diff_stat)
            .unwrap_or(DiffBodyStat {
                additions: None,
                deletions: None,
                binary: false,
                truncated: false,
            });
        let status = map_provider_status(&change.kind);

        if let Some(existing) = self.files.get_mut(&change.path) {
            existing.status = status;
            existing.binary |= stat.binary;
            existing.truncated |= stat.truncated;
            existing.diff_available |= change.diff.is_some();
            let additions = existing.additions.or(stat.additions);
            let deletions = existing.deletions.or(stat.deletions);
            (existing.additions, existing.deletions) =
                known_counts(additions, deletions, existing.binary, existing.truncated);
            return;
        }

        let (additions, deletions) =
            known_counts(stat.additions, stat.deletions, stat.binary, stat.truncated);
        self.order.push(change.path.clone());
        self.files.insert(
            change.path.clone(),
            ChangedFile {
                path: change.path.clone(),
                old_path: None,
                status,
                staged: None,
                unstaged: None,
                additions,
                deletions,
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

/// Decodes a chat's full persisted timeline — as returned by
/// `Database::agent_timeline_for_chat`, the real `agent_items`/`agent_messages`
/// read path — into the ordered [`TimelineTurnEvent`] slice
/// [`group_turn_change_sets`] expects (#231 PR2). `AgentTimelineEntry::Message`
/// rows carry no `AgentEvent` and are skipped. An `Item` row whose JSON
/// `payload` doesn't deserialize as `AgentEvent` — a wire-shape drift this
/// crate doesn't control, e.g. a future provider event kind this build
/// predates — is skipped rather than failing the whole read: one bad
/// historical row must not black out a chat's entire change history.
pub fn decode_timeline_events(entries: &[crate::db::AgentTimelineEntry]) -> Vec<TimelineTurnEvent> {
    entries
        .iter()
        .filter_map(|entry| match entry {
            crate::db::AgentTimelineEntry::Item {
                seq,
                payload,
                created_at,
                ..
            } => serde_json::from_str::<AgentEvent>(payload)
                .ok()
                .map(|event| TimelineTurnEvent {
                    seq: *seq,
                    captured_at: *created_at,
                    event,
                }),
            crate::db::AgentTimelineEntry::Message { .. } => None,
        })
        .collect()
}

/// Returns the raw provider diff text `FileChange` events carried for `path`
/// within the requested `turn_seq`'s window (#231 PR2) — the lazy per-file
/// diff fetch's turn-snapshot source. Turn boundaries are detected the same
/// way [`group_turn_change_sets`] detects them (explicit `TurnStarted` or an
/// implicit open on the first `FileChange` with no turn open, closed by the
/// next `TurnStarted`/`TurnDone`/`TurnFailed`), so the same `turn_seq` a
/// listing call returned resolves to the same window here.
///
/// Last-write-wins: the most recent `FileChange` event carrying a diff body
/// for `path` in that window is returned, mirroring the fold's status
/// semantics (the final state of the file this turn) — unlike stats, which
/// are first-known-wins for a different reason (avoiding double-counting
/// across a dedup fold, not picking "the" representative value). Returns
/// `None` when the turn has no diff-bearing event for `path` at all.
pub fn turn_file_diff<'a>(
    events: &'a [TimelineTurnEvent],
    turn_seq: i64,
    path: &str,
) -> Option<&'a str> {
    let mut open_seq: Option<i64> = None;
    let mut found: Option<&str> = None;

    for item in events {
        match &item.event {
            AgentEvent::TurnStarted => {
                open_seq = Some(item.seq);
            }
            AgentEvent::FileChange { changes, .. } => {
                if open_seq.is_none() {
                    open_seq = Some(item.seq); // implicit turn open
                }
                if open_seq == Some(turn_seq) {
                    for change in changes {
                        if change.path == path {
                            if let Some(diff) = change.diff.as_deref() {
                                found = Some(diff);
                            }
                        }
                    }
                }
            }
            AgentEvent::TurnDone { .. } | AgentEvent::TurnFailed { .. } => {
                open_seq = None;
            }
            _ => {}
        }
    }
    found
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

    fn failed(seq: i64, at: i64) -> TimelineTurnEvent {
        TimelineTurnEvent {
            seq,
            captured_at: at,
            event: AgentEvent::TurnFailed {
                error: "boom".to_string(),
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
        // Stats are first-known-wins, not last-known-wins: the first event's
        // count (1 addition from "+one\n") is kept, not overwritten by the
        // second event's count (2 additions).
        assert_eq!(file.additions, Some(1));
    }

    #[test]
    fn dedup_first_known_stat_wins_over_a_later_different_known_value() {
        let events = vec![
            started(1, 100),
            file_change(2, 110, "src/lib.rs", FileChangeKind::Modify, Some("+one\n")),
            file_change(
                3,
                115,
                "src/lib.rs",
                FileChangeKind::Modify,
                Some("+a\n+b\n+c\n"),
            ),
            done(4, 120),
        ];
        let turns = group_turn_change_sets("chat-1", "/repo", &events);
        let file = &turns[0].files[0];
        assert_eq!(
            file.additions,
            Some(1),
            "first known count is never overwritten"
        );
        assert_eq!(file.deletions, Some(0));
    }

    #[test]
    fn dedup_sticky_binary_clears_previously_known_counts() {
        let events = vec![
            started(1, 100),
            file_change(2, 110, "img.png", FileChangeKind::Modify, Some("+a\n-b\n")),
            file_change(
                3,
                115,
                "img.png",
                FileChangeKind::Modify,
                Some(
                    "diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n",
                ),
            ),
            done(4, 120),
        ];
        let turns = group_turn_change_sets("chat-1", "/repo", &events);
        let file = &turns[0].files[0];
        assert!(file.binary);
        // The invariant `binary || truncated => both counts None` holds even
        // though an earlier event in the same turn had a known count.
        assert_eq!(file.additions, None);
        assert_eq!(file.deletions, None);
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

    #[test]
    fn turn_failed_closes_a_turn_the_same_as_turn_done() {
        let events = vec![
            started(1, 100),
            file_change(2, 105, "a.rs", FileChangeKind::Add, None),
            failed(3, 110),
            started(4, 200),
            file_change(5, 205, "b.rs", FileChangeKind::Add, None),
            done(6, 210),
        ];
        let turns = group_turn_change_sets("chat-1", "/repo", &events);
        assert_eq!(turns.len(), 2, "TurnFailed must close the first turn, not merge into the second");
        assert!(!turns[0].stale, "closed by TurnFailed, so not still-open");
        assert_eq!(turns[0].files[0].path, "a.rs");
        assert_eq!(turns[1].files[0].path, "b.rs");
    }

    #[test]
    fn decode_timeline_events_reads_the_real_agent_items_path_and_folds_correctly() {
        use crate::db::Database;

        let db = Database::open_in_memory().unwrap();
        let chat_id = "chat-decode";
        let session_id = "sess-1";

        for event in [
            AgentEvent::TurnStarted,
            AgentEvent::FileChange {
                item_id: "item-1".to_string(),
                changes: vec![FileChangeEntry {
                    path: "src/lib.rs".to_string(),
                    kind: FileChangeKind::Modify,
                    diff: Some("+a\n-b\n".to_string()),
                }],
            },
            AgentEvent::TurnDone {
                status: TurnStatus::Completed,
            },
        ] {
            let payload = serde_json::to_string(&event).unwrap();
            let kind = serde_json::to_value(&event)
                .unwrap()
                .get("kind")
                .unwrap()
                .as_str()
                .unwrap()
                .to_string();
            db.agent_item_append(session_id, chat_id, &kind, &payload)
                .unwrap();
        }
        // A plain chat message must be skipped, not choke the decode.
        db.agent_message_append(session_id, chat_id, "user", "hello")
            .unwrap();

        let entries = db.agent_timeline_for_chat(chat_id).unwrap();
        let events = decode_timeline_events(&entries);
        let turns = group_turn_change_sets(chat_id, "/repo", &events);

        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].files.len(), 1);
        assert_eq!(turns[0].files[0].path, "src/lib.rs");
        assert_eq!(turns[0].files[0].additions, Some(1));
        assert!(!turns[0].stale);
    }

    #[test]
    fn turn_file_diff_returns_the_last_diff_seen_for_the_path_in_that_turn() {
        let events = vec![
            started(1, 100),
            file_change(2, 110, "a.rs", FileChangeKind::Modify, Some("+one\n")),
            file_change(3, 115, "a.rs", FileChangeKind::Modify, Some("+two\n+three\n")),
            done(4, 120),
        ];
        assert_eq!(
            turn_file_diff(&events, 1, "a.rs"),
            Some("+two\n+three\n"),
            "last event's diff wins, unlike stats which are first-known-wins"
        );
    }

    #[test]
    fn turn_file_diff_returns_none_for_a_path_with_no_diff_body() {
        let events = vec![
            started(1, 100),
            file_change(2, 105, "a.rs", FileChangeKind::Add, None),
            done(3, 110),
        ];
        assert_eq!(turn_file_diff(&events, 1, "a.rs"), None);
    }

    #[test]
    fn turn_file_diff_scopes_to_the_requested_turn_only() {
        let events = vec![
            started(1, 100),
            file_change(2, 105, "a.rs", FileChangeKind::Add, Some("+first turn\n")),
            done(3, 110),
            started(4, 200),
            file_change(5, 205, "a.rs", FileChangeKind::Modify, Some("+second turn\n")),
            done(6, 210),
        ];
        assert_eq!(turn_file_diff(&events, 1, "a.rs"), Some("+first turn\n"));
        assert_eq!(turn_file_diff(&events, 4, "a.rs"), Some("+second turn\n"));
        assert_eq!(turn_file_diff(&events, 999, "a.rs"), None);
    }
}
