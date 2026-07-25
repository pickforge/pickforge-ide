// Sort/classification for the flat chat-first sidebar (#306 PR1, behind the
// `flatChatList` flag). Pure and DI-friendly on purpose: `sortFlatChats` takes
// a `stateOf` lookup instead of reading `chatActivity` directly, so unit tests
// can pin per-chat states without touching that store's reactive/timer
// internals, and so PR2's card renderer can reuse the same classification the
// sort already computed instead of re-deriving it per row.
import type { Chat } from "../lib/db";
import { chatAttention, chatBusy } from "./chatActivity";

export type ChatLifecycleState = "needsYou" | "working" | "quiet";

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

/** Sorts chats needs-you -> working -> quiet, across projects. Ties within a
 *  bucket fall back to most-recent activity first — the issue only specifies
 *  this ordering for the quiet bucket, but applying it uniformly keeps the
 *  whole list's order legible instead of an unspecified/insertion order for
 *  the live buckets. `stateOf` defaults to the live store; tests inject a
 *  fixed map instead. */
export function sortFlatChats(
  chats: readonly Chat[],
  stateOf: (chatId: string) => ChatLifecycleState = chatLifecycleState,
): Chat[] {
  return [...chats].sort((a, b) => {
    const rankDiff = STATE_RANK[stateOf(a.chatId)] - STATE_RANK[stateOf(b.chatId)];
    if (rankDiff !== 0) return rankDiff;
    return b.lastActivityAt - a.lastActivityAt;
  });
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
