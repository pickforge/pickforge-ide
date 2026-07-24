// Typed client for the #231 change-set commands (PR2). Interfaces mirror
// pickforge-core's `changes`/`git::working_tree` models (camelCase over the
// wire, same as every other Tauri command in this app). `capturedAt` is
// Unix-ms, matching the rest of the crate's persisted timestamps.
import { invoke } from "@tauri-apps/api/core";

/** What a `ChangeSet` covers: one agent turn, or the live working tree. */
export type ChangeScope = "turn" | "workingTree";

/** Where a `ChangeSet`'s data came from — see the issue's "attribution is
 *  honest" rule: a provider snapshot is labeled as agent-turn changes, a Git
 *  snapshot captured only at turn completion is a workspace snapshot, and a
 *  live working-tree read is Git-authoritative. */
export type ChangeSource = "providerSnapshot" | "gitSnapshot" | "gitLive";

/** Locked five-way status vocabulary from the change-set contract (#231). */
export type ChangeFileStatus = "add" | "modify" | "delete" | "rename" | "conflict";

/** One file's status/stat row inside a `ChangeSet`. `additions`/`deletions`
 *  are `null` — never `0` — whenever the true count isn't known (binary,
 *  truncated, or no diff at all); render "unknown", never a silently wrong
 *  zero. */
export interface ChangedFile {
  path: string;
  oldPath: string | null;
  status: ChangeFileStatus;
  /** `null` ONLY when staged/unstaged isn't meaningful for this change-set's
   *  source — a turn/provider snapshot, which has no index. For a git-live
   *  (working-tree) row the concept always applies and is always non-null:
   *  `true` when this row has that kind of change, `false` when it's known
   *  not to. A file with BOTH a staged and an unstaged change appears as two
   *  separate rows (one per call), each with its own flags — never one row
   *  with both `true`. */
  staged: boolean | null;
  unstaged: boolean | null;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
  truncated: boolean;
  diffAvailable: boolean;
}

export interface ChangeTotals {
  files: number;
  additions: number;
  deletions: number;
}

/** One normalized snapshot of changed files: a turn's provider-reported
 *  changes, a historical Git snapshot, or the live working tree. */
export interface ChangeSet {
  id: string;
  scope: ChangeScope;
  source: ChangeSource;
  chatId: string | null;
  turnSeq: number | null;
  repoRoot: string;
  capturedAt: number;
  /** Turn scope: still open (no closing `TurnDone`/`TurnFailed` observed
   *  yet). Working-tree scope: always `false` — a live read is fresh by
   *  construction the moment it's returned; the STORE tracks its own
   *  cached-copy freshness separately (see `stores/changes.ts`), not via
   *  this field. */
  stale: boolean;
  /** `true` when `files` is a bounded PREFIX of the true changed-file set —
   *  a git listing invocation (numstat/name-status/porcelain status) hit its
   *  entry-count or byte bound. Always `false` for turn scope (folding a
   *  persisted timeline has no such listing-level cap). */
  truncated: boolean;
  files: ChangedFile[];
  totals: ChangeTotals;
}

/** Lazily-fetched unified-diff text for one file. Not part of `ChangeSet`/
 *  `ChangedFile` — the listing stays cheap (`diffAvailable: boolean` only);
 *  the diff body is a separate, bounded round trip per file. */
export interface ChangeDiff {
  /** `null` when `binary` is true or `available` is false. */
  diff: string | null;
  binary: boolean;
  /** `true` when `diff` is a bounded prefix of the true diff (a time, byte,
   *  or line bound was hit), not the complete body. */
  truncated: boolean;
  /** `false` when the source has no diff at all for this file (a turn that
   *  never captured one for this path, or a failed git command) — distinct
   *  from `binary`, which means a diff exists but has no text form. */
  available: boolean;
}

/** The explicit working-tree states the issue calls out, alongside the
 *  normal `ready` case: `notARepo` (Git-unavailable / not a repository) and
 *  `remoteUnsupported` (a remote-bound project — no local Git process may be
 *  spawned against it). */
export type WorkingTreeChanges =
  | { state: "ready"; changeSet: ChangeSet }
  | { state: "notARepo" }
  | { state: "remoteUnsupported" };

/** A chat's per-turn ChangeSets, folded from its persisted timeline. Turn
 *  snapshots are immutable — this reflects exactly what each turn's
 *  provider events reported, independent of the live working tree. */
export const changesListTurnChangeSets = (chatId: string, projectRoot: string) =>
  invoke<ChangeSet[]>("changes_list_turn_change_sets", { chatId, projectRoot });

/** Lazily-fetched turn-snapshot diff text for one file within one turn. */
export const changesTurnFileDiff = (
  chatId: string,
  projectRoot: string,
  turnSeq: number,
  path: string,
) => invoke<ChangeDiff>("changes_turn_file_diff", { chatId, projectRoot, turnSeq, path });

/** The live working-tree ChangeSet for a project root. */
export const changesWorkingTree = (projectRoot: string) =>
  invoke<WorkingTreeChanges>("changes_working_tree", { projectRoot });

/** The live unified diff for one repo-relative file in the working tree,
 *  staged or unstaged. */
export const changesWorkingTreeFileDiff = (projectRoot: string, path: string, staged: boolean) =>
  invoke<ChangeDiff>("changes_working_tree_file_diff", { projectRoot, path, staged });
