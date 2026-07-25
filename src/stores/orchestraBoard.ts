// Pure column-grouping and subset-filter primitives for the Orchestra board
// (#319, #196 PR1, behind the `orchestraBoard` flag). Pure and DI-free on
// purpose, like flatChatSort.ts, so unit tests exercise them without pulling
// in OrchestraView's solid-js component tree.
import type { OrchestraTask, OrchestraTaskStatus } from "../lib/orchestra";

// The 5 existing task lifecycle statuses, unchanged — the board's columns.
// Single source of truth: OrchestraView's status-cycle button imports this
// same array instead of keeping its own copy, so the board and the flat
// list's status pill can never drift apart.
export const STATUS_ORDER: OrchestraTaskStatus[] = [
  "planned",
  "building",
  "reviewing",
  "fixing",
  "done",
];

export interface BoardColumn {
  status: OrchestraTaskStatus;
  tasks: OrchestraTask[];
}

/** Buckets tasks into their status column, in STATUS_ORDER. Each task's
 *  relative order within its column is preserved from the input — callers
 *  pass the already-sorted task list (see orchestra.ts's sortedTasks), so a
 *  column's card order matches the flat list's task order.
 *
 *  The Rust side stores `status` as an unrestricted string — the TS union is
 *  a compile-time hint, not a runtime guarantee. A persisted value outside
 *  STATUS_ORDER (a future status, manual DB edit, etc.) folds into the
 *  earliest column (`planned`) rather than vanishing from every column: the
 *  task must always land somewhere. The card still renders its literal
 *  status text, so an unrecognized value stays visible/debuggable instead of
 *  being silently relabeled. */
export function groupTasksByStatus(tasks: readonly OrchestraTask[]): BoardColumn[] {
  const known = new Set<string>(STATUS_ORDER);
  const buckets = new Map<OrchestraTaskStatus, OrchestraTask[]>(STATUS_ORDER.map((s) => [s, []]));
  const fallback = STATUS_ORDER[0];
  for (const task of tasks) {
    const bucket = known.has(task.status) ? task.status : fallback;
    buckets.get(bucket)!.push(task);
  }
  return STATUS_ORDER.map((status) => ({ status, tasks: buckets.get(status)! }));
}

/** Chat ids referenced as a task's builder or reviewer — the board's only
 *  notion of "tracked" chat. */
export function taskLinkedChatIds(tasks: readonly OrchestraTask[]): Set<string> {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (task.builderChatId) ids.add(task.builderChatId);
    if (task.reviewerChatId) ids.add(task.reviewerChatId);
  }
  return ids;
}

/** The locked subset rule (#196 plan §3): the board is a strict subset lens
 *  over task-linked chats, never a rival total of the sidebar. An ad-hoc chat
 *  with no OrchestraTask assignment never survives this filter — it stays
 *  sidebar-only. */
export function filterTaskLinkedChats<C extends { chatId: string }>(
  chats: readonly C[],
  tasks: readonly OrchestraTask[],
): C[] {
  const ids = taskLinkedChatIds(tasks);
  return chats.filter((chat) => ids.has(chat.chatId));
}
