// Sort/classification for the flat chat-first sidebar (#306 PR1, behind the
// `flatChatList` flag). Pure and DI-friendly on purpose: `sortFlatChats` takes
// a `stateOf` lookup instead of reading `chatActivity` directly, so unit tests
// can pin per-chat states without touching that store's reactive/timer
// internals, and so PR2's card renderer can reuse the same classification the
// sort already computed instead of re-deriving it per row.
import type { Chat } from "../lib/db";
import { chatAttention, chatBusy, chatJustFinished, chatLastActivityMs } from "./chatActivity";

export type ChatLifecycleState = "needsYou" | "working" | "quiet";

/** The states the PR2 work-card renderer draws: the two live lifecycle
 *  states, plus `justFinished` — a chat that just left one of them and is
 *  lingering (see CARD_LINGER_MS in chatActivity.ts) before its card
 *  collapses to the quiet one-liner. */
export type CardVisualState = "needsYou" | "working" | "justFinished";

const STATE_RANK: Record<ChatLifecycleState, number> = {
  needsYou: 0,
  working: 1,
  quiet: 2,
};

/** A chat's current lifecycle bucket, reading the live `chatActivity` store:
 *  attention (unseen output/turn-end) beats busy (still streaming) beats quiet. */
export function chatLifecycleState(chatId: string): ChatLifecycleState {
  if (chatAttention(chatId)) return "needsYou";
  if (chatBusy(chatId)) return "working";
  return "quiet";
}

/** `chatLifecycleState` with the work-card linger folded in (#306 PR2): a
 *  chat that's genuinely quiet but still lingering (chatJustFinished) reads
 *  as `justFinished` here instead of `quiet`, so the flat list keeps it in
 *  the live/card bucket for the linger window. Drives both which renderer a
 *  chat gets (FlatWorkCard vs. the one-liner) and the live/quiet split. */
export function chatCardVisualState(chatId: string): CardVisualState | "quiet" {
  const state = chatLifecycleState(chatId);
  if (state !== "quiet") return state;
  return chatJustFinished(chatId) ? "justFinished" : "quiet";
}

/** A chat's most-recent-activity timestamp for sort purposes: the session's
 *  live `chatActivity` timestamp (bumped on every busy/attention transition —
 *  see chatActivity.ts) when this chat has had one, else its DB-persisted
 *  `lastActivityAt` (set once at chat creation and otherwise stale — a chat
 *  that's been quietly worked on all session without a fresh app load falls
 *  back to that creation-time value, which is the best available signal
 *  without a heavier per-turn DB write). */
export function chatActivityMs(chat: Chat): number {
  return chatLastActivityMs(chat.chatId) ?? chat.lastActivityAt;
}

/** Sorts chats needs-you -> working -> quiet, across projects. Ties within a
 *  bucket fall back to most-recent activity first — the issue only specifies
 *  this ordering for the quiet bucket, but applying it uniformly keeps the
 *  whole list's order legible instead of an unspecified/insertion order for
 *  the live buckets. `stateOf`/`activityMsOf` default to the live stores;
 *  tests inject fixed values instead. */
export function sortFlatChats(
  chats: readonly Chat[],
  stateOf: (chatId: string) => ChatLifecycleState = chatLifecycleState,
  activityMsOf: (chat: Chat) => number = chatActivityMs,
): Chat[] {
  return [...chats].sort((a, b) => {
    const rankDiff = STATE_RANK[stateOf(a.chatId)] - STATE_RANK[stateOf(b.chatId)];
    if (rankDiff !== 0) return rankDiff;
    return activityMsOf(b) - activityMsOf(a);
  });
}

/** Chats visible in the flat list for a single-select project filter. Needs-
 *  you chats stay visible from EVERY project regardless of the filter — the
 *  flat list's whole premise is "everything that needs me across projects",
 *  so narrowing the filter must never hide one. Working/quiet chats are
 *  narrowed to the selected project (or every project when `filterRoot` is
 *  null, i.e. "All"). `chatsByRoot` only needs to carry already-visible
 *  (non-archived, primary) chats — callers filter those before calling in. */
export function visibleFlatChats(
  chatsByRoot: ReadonlyMap<string, readonly Chat[]>,
  filterRoot: string | null,
  stateOf: (chatId: string) => ChatLifecycleState = chatLifecycleState,
): Chat[] {
  const out: Chat[] = [];
  for (const [root, chats] of chatsByRoot) {
    const inFilter = filterRoot === null || root === filterRoot;
    for (const chat of chats) {
      if (inFilter || stateOf(chat.chatId) === "needsYou") out.push(chat);
    }
  }
  return out;
}

/** Compact relative time for the one-liner meta (`project · time`): "now" for
 *  the first minute, then bare "Nm"/"Nh"/"Nd" — no "ago" suffix, matching the
 *  locked mockup's eyebrow style rather than the fuller `relTime` used in the
 *  remote-health tooltips. */
export function shortRelTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
