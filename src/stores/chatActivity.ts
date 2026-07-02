// Per-chat agent activity: `busy` while an agent pane is streaming output, and
// `attention` (amber bracket + chime) once it goes quiet or rings the bell —
// but only for output the user did NOT watch happen. "Unseen" means the chat
// wasn't active/staged, or the window wasn't focused; output that streamed
// while the user was looking (including the echo of their own keystrokes) never alerts.
// Attention persists across later output and clears only when the user comes
// back to the chat (activation, staging, or window refocus on visible chats).
import { createSignal } from "solid-js";
import { hasAgentPane, isAgentPane } from "../lib/chatAutoName";
import { playAttentionSound } from "../lib/attentionSound";

export const CHAT_BUSY_QUIET_MS = 3500;
export const ATTENTION_MIN_UNSEEN_CHARS = 12;

interface ChatActivityState {
  busy: boolean;
  attention: boolean;
}

interface BusyCycle {
  timer: ReturnType<typeof setTimeout>;
  unseenChars: number;
}

// Source of truth is a plain Map so store functions can read state without
// creating reactive subscriptions (a signal read inside a caller's effect would
// silently track it); the signal mirrors it for the UI.
const states = new Map<string, ChatActivityState>();
const [activity, setActivity] = createSignal<Record<string, ChatActivityState>>({});
const cycles = new Map<string, BusyCycle>();
let activeChatId: string | null = null;
let stagedChatIds: ReadonlySet<string> = new Set();
let windowFocused = typeof document !== "undefined" ? document.hasFocus() : true;

if (typeof window !== "undefined") {
  window.addEventListener("focus", () => setWindowFocusForActivity(true));
  window.addEventListener("blur", () => setWindowFocusForActivity(false));
}

function write(chatId: string, patch: Partial<ChatActivityState>) {
  const current = states.get(chatId) ?? { busy: false, attention: false };
  const next = { ...current, ...patch };
  if (states.has(chatId) && next.busy === current.busy && next.attention === current.attention) {
    return;
  }
  states.set(chatId, next);
  setActivity((snapshot) => ({ ...snapshot, [chatId]: next }));
}

/** The user is not looking at this chat right now: it isn't the active chat,
 *  isn't staged on screen, or the window itself is unfocused. Only unseen
 *  activity may raise attention. */
function isUnseen(chatId: string): boolean {
  return !windowFocused || (activeChatId !== chatId && !stagedChatIds.has(chatId));
}

function clearCycle(chatId: string): BusyCycle | undefined {
  const cycle = cycles.get(chatId);
  if (!cycle) return undefined;
  clearTimeout(cycle.timer);
  cycles.delete(chatId);
  return cycle;
}

function setAttention(chatId: string) {
  if (!isUnseen(chatId)) return; // the user is watching — nothing to alert
  if (states.get(chatId)?.attention) return; // already flagged; never re-chime
  write(chatId, { attention: true });
  playAttentionSound();
}

function finishBusyCycle(chatId: string) {
  const cycle = clearCycle(chatId);
  if (!cycle) return;
  write(chatId, { busy: false });
  if (cycle.unseenChars >= ATTENTION_MIN_UNSEEN_CHARS) setAttention(chatId);
}

/** The user just caught up with this chat (opened it / refocused the window):
 *  drop its attention flag and forget what already streamed — only output from
 *  here on counts toward a new alert. */
function markChatSeen(chatId: string) {
  if (states.get(chatId)?.attention) write(chatId, { attention: false });
  const cycle = cycles.get(chatId);
  if (cycle) cycle.unseenChars = 0;
}

export function chatBusy(chatId: string): boolean {
  return activity()[chatId]?.busy ?? false;
}

export function chatAttention(chatId: string): boolean {
  return activity()[chatId]?.attention ?? false;
}

export function setActiveChatForActivity(chatId: string | null) {
  activeChatId = chatId;
  if (chatId && windowFocused) markChatSeen(chatId);
}

export function setStagedChatsForActivity(chatIds: string[]) {
  stagedChatIds = new Set(chatIds);
  if (windowFocused) {
    for (const chatId of stagedChatIds) markChatSeen(chatId);
  }
}

export function setWindowFocusForActivity(focused: boolean) {
  windowFocused = focused;
  if (!focused) return;
  if (activeChatId) markChatSeen(activeChatId);
  for (const chatId of stagedChatIds) markChatSeen(chatId);
}

// ---- visible-output scanner ----
// Counts printable characters while skipping escape sequences. A tiny state
// machine per pane (NOT a regex) so sequences split across pty chunks are still
// skipped, string-type controls (OSC/DCS/APC/PM/SOS) are consumed to their
// terminator, and the cost stays linear in the chunk length.
type Scan = 0 | 1 | 2 | 3 | 4 | 5 | 6;
const GROUND = 0; // printable text
const ESC = 1; // after a lone ESC
const CSI = 2; // inside a CSI, until its final byte
const OSC_STR = 3; // inside an OSC, until BEL or ST
const OSC_ESC = 4; // saw ESC inside an OSC — a following `\` is ST
const DCS_STR = 5; // inside DCS/SOS/PM/APC, until ST (BEL does NOT terminate)
const DCS_ESC = 6; // saw ESC inside a DCS-class string
const scanStates = new Map<string, Scan>();
const scanKey = (chatId: string, paneId: string) => `${chatId}\u0000${paneId}`;

function countVisibleChars(chatId: string, paneId: string, chunk: string): number {
  const key = scanKey(chatId, paneId);
  let state: Scan = scanStates.get(key) ?? GROUND;
  let count = 0;
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk.charCodeAt(i);
    switch (state) {
      case GROUND:
        if (c === 0x1b) state = ESC;
        else if (c === 0x9b) state = CSI;
        else if (c === 0x9d) state = OSC_STR;
        else if (c === 0x90 || c === 0x98 || c === 0x9e || c === 0x9f) state = DCS_STR;
        else if (c > 0x20 && c !== 0x7f && (c < 0x80 || c > 0x9f)) count++;
        break;
      case ESC:
        if (c === 0x5b) state = CSI; // ESC [
        else if (c === 0x5d) state = OSC_STR; // ESC ]
        else if (c === 0x50 || c === 0x58 || c === 0x5e || c === 0x5f)
          state = DCS_STR; // ESC P/X/^/_
        else if (c >= 0x20 && c <= 0x2f) break; // intermediate — ESC ( B et al.
        else if (c !== 0x1b) state = GROUND; // final byte of the escape
        break;
      case CSI:
        if (c === 0x1b) state = ESC; // aborted mid-sequence
        else if (c === 0x18 || c === 0x1a) state = GROUND; // CAN/SUB abort
        else if (c >= 0x40 && c <= 0x7e) state = GROUND; // final byte
        break;
      case OSC_STR:
        if (c === 0x07 || c === 0x9c) state = GROUND; // BEL / C1 ST
        else if (c === 0x18 || c === 0x1a) state = GROUND; // CAN/SUB abort
        else if (c === 0x1b) state = OSC_ESC;
        break;
      case OSC_ESC:
        if (c === 0x5c) state = GROUND; // ESC \ = ST
        else if (c !== 0x1b) {
          // The VT "anywhere" rule: ESC aborts the string and starts a new
          // sequence — without this an unterminated OSC/DCS (binary spew)
          // would swallow all later output forever.
          state = ESC;
          i--;
        }
        break;
      case DCS_STR:
        if (c === 0x9c) state = GROUND; // C1 ST only — BEL is payload here
        else if (c === 0x18 || c === 0x1a) state = GROUND; // CAN/SUB abort
        else if (c === 0x1b) state = DCS_ESC;
        break;
      case DCS_ESC:
        if (c === 0x5c) state = GROUND; // ESC \ = ST
        else if (c !== 0x1b) {
          state = ESC;
          i--;
        }
        break;
    }
  }
  scanStates.set(key, state);
  return count;
}

// Re-attaching a dtach/tmux session replays the agent's screen — output (and
// even a replayed BEL) the user already saw last session. A short grace window
// after the attach keeps the replay from counting as fresh unseen activity.
export const REATTACH_REPLAY_GRACE_MS = 2000;
const unseenGraceUntil = new Map<string, number>();

export function graceChatUnseen(chatId: string, ms: number) {
  unseenGraceUntil.set(chatId, Date.now() + ms);
}

function inUnseenGrace(chatId: string): boolean {
  const until = unseenGraceUntil.get(chatId);
  if (until === undefined) return false;
  if (Date.now() < until) return true;
  unseenGraceUntil.delete(chatId);
  return false;
}

export function recordChatOutput(chatId: string, paneId: string, chunk: string) {
  if (!isAgentPane(chatId, paneId)) return;
  const visible = countVisibleChars(chatId, paneId, chunk);
  if (visible === 0) return;
  const previous = cycles.get(chatId);
  if (previous) clearTimeout(previous.timer);
  else write(chatId, { busy: true });
  const counts = isUnseen(chatId) && !inUnseenGrace(chatId);
  const unseenChars = (previous?.unseenChars ?? 0) + (counts ? visible : 0);
  const timer = setTimeout(() => finishBusyCycle(chatId), CHAT_BUSY_QUIET_MS);
  cycles.set(chatId, { timer, unseenChars });
}

export function recordChatAttention(chatId: string, paneId: string) {
  if (!isAgentPane(chatId, paneId)) return;
  if (inUnseenGrace(chatId)) return; // a replayed BEL from the last session
  setAttention(chatId);
}

// ---- structured agent chats (turn-based, no pty panes) ----
// An agent chat has no shells to scan, so its busy/attention run off the turn
// lifecycle instead of the char-counting cycle: a turn glows the row busy, and
// a turn finishing raises attention (chime + marker) only when the user did not
// watch it happen. Same UI treatment as the pty path, reusing write/setAttention.
export function agentTurnStarted(chatId: string) {
  write(chatId, { busy: true });
}

export function agentTurnDone(chatId: string) {
  write(chatId, { busy: false });
  setAttention(chatId);
}

/** A turn ended because the user interrupted it (or a send failed): drop the
 *  busy glow but never chime — they were right here when it stopped. */
export function agentTurnCleared(chatId: string) {
  write(chatId, { busy: false });
}

/** A pane was closed (its shell killed). Drop its scanner state; if the chat
 *  has no agent panes left, cancel the pending busy cycle so a dead pane can't
 *  chime later. Call AFTER revoking the pane's agent ownership. */
export function handlePaneClosed(chatId: string, paneId: string) {
  scanStates.delete(scanKey(chatId, paneId));
  if (hasAgentPane(chatId)) return;
  if (clearCycle(chatId)) write(chatId, { busy: false });
}

export function clearChatActivity(chatId: string) {
  clearCycle(chatId);
  unseenGraceUntil.delete(chatId);
  const prefix = `${chatId}\u0000`;
  for (const key of scanStates.keys()) {
    if (key.startsWith(prefix)) scanStates.delete(key);
  }
  if (!states.delete(chatId)) return;
  setActivity((snapshot) => {
    const next = { ...snapshot };
    delete next[chatId];
    return next;
  });
}
