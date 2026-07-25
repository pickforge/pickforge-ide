// Per-chat agent activity: `busy` while an agent pane is streaming output, and
// `attention` (amber bracket + chime) once it goes quiet or rings the bell —
// but only for output the user did NOT watch happen. "Unseen" means the chat
// wasn't active/staged, or the window wasn't focused; output that streamed
// while the user was looking (including the echo of their own keystrokes) never alerts.
// Attention persists across later output and across the user merely opening,
// staging, or refocusing onto the chat (#331 — viewing a needs-you chat must
// never silently demote it back to quiet mid-glance). It clears only when the
// user actually acts: sending a message or answering a permission prompt,
// both of which start a fresh turn — see agentTurnStarted/resolveChatAttention.
import { createSignal } from "solid-js";
import { hasAgentPane, isAgentPane } from "../lib/chatAutoName";
import { playAttentionSound } from "../lib/attentionSound";

export const CHAT_BUSY_QUIET_MS = 3500;
export const ATTENTION_MIN_UNSEEN_CHARS = 12;

// Sidebar work-card linger (#306 PR2): a chat that WAS a live card (busy or
// needing attention) and just settled fully quiet keeps reading as
// `justFinished` for this long before the flat list collapses its card down
// to the quiet one-liner — see chatCardVisualState in flatChatSort.ts. Long
// enough to catch on a glance, short enough not to clutter the live section.
export const CARD_LINGER_MS = 4000;

interface ChatActivityState {
  busy: boolean;
  attention: boolean;
  justFinished: boolean;
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
// Live "last activity" timestamps (#306's flat chat list sorts the quiet
// bucket by this) — a plain Map, not a signal: the flat list re-derives it
// from a memo that already tracks `activity()`, so a second reactive source
// here would be redundant. Session-only (in-memory), not persisted to the
// `chats.last_activity_at` DB column — a DB write per turn is heavier than
// PR1 should carry; see flatChatSort.ts.
const lastActivityMs = new Map<string, number>();
// Pending "collapse the lingering card" timers, one per chat currently in the
// justFinished window — see write()'s linger transition below.
const lingerTimers = new Map<string, ReturnType<typeof setTimeout>>();
let activeChatId: string | null = null;
let stagedChatIds: ReadonlySet<string> = new Set();
let windowFocused = typeof document !== "undefined" ? document.hasFocus() : true;

if (typeof window !== "undefined") {
  window.addEventListener("focus", () => setWindowFocusForActivity(true));
  window.addEventListener("blur", () => setWindowFocusForActivity(false));
}

function clearLingerTimer(chatId: string) {
  const timer = lingerTimers.get(chatId);
  if (timer === undefined) return false;
  clearTimeout(timer);
  lingerTimers.delete(chatId);
  return true;
}

function write(chatId: string, patch: Partial<ChatActivityState>) {
  const current = states.get(chatId) ?? { busy: false, attention: false, justFinished: false };
  const wasLive = current.busy || current.attention;
  const next = { ...current, ...patch };
  if (
    states.has(chatId) &&
    next.busy === current.busy &&
    next.attention === current.attention &&
    next.justFinished === current.justFinished
  ) {
    return;
  }
  states.set(chatId, next);
  // A busy transition (either direction) or a fresh chime is real chat-driven
  // activity; clearing attention because the user looked (markChatSeen) is
  // not — so it's excluded, or opening a chat would wrongly bump it to the
  // top of the quiet sort AND (below) start a card linger just from opening
  // a needs-you chat you're already looking at.
  const realActivity = patch.busy !== undefined || patch.attention === true;
  if (realActivity) lastActivityMs.set(chatId, Date.now());
  setActivity((snapshot) => ({ ...snapshot, [chatId]: next }));

  // Sidebar work-card linger (#306 PR2): re-entering a live state cancels any
  // pending collapse; leaving one (via real activity, not just the user
  // looking away) starts the linger window. Recurses once, at most — the
  // nested `write` only patches `justFinished`, which never re-triggers this
  // block (busy/attention are unchanged), so it can't loop.
  const isLive = next.busy || next.attention;
  if (isLive) {
    if (clearLingerTimer(chatId)) write(chatId, { justFinished: false });
  } else if (wasLive && realActivity) {
    clearLingerTimer(chatId);
    write(chatId, { justFinished: true });
    lingerTimers.set(
      chatId,
      setTimeout(() => {
        lingerTimers.delete(chatId);
        write(chatId, { justFinished: false });
      }, CARD_LINGER_MS),
    );
  }
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
 *  forget what already streamed — only output from here on counts toward a
 *  new alert. Does NOT clear a standing `attention` flag (#331): merely
 *  looking at a needs-you chat must never auto-demote it back to quiet mid-
 *  glance — see `resolveChatAttention` for what actually clears it. */
function markChatSeen(chatId: string) {
  const cycle = cycles.get(chatId);
  if (cycle) cycle.unseenChars = 0;
}

/** The user did something that resolves a standing needs-you: sent a message
 *  or (for structured agent chats) answered a permission prompt that resumes
 *  the turn — both surface as a fresh `agentTurnStarted` (#331). Opening or
 *  refocusing onto the chat (`markChatSeen`) never calls this. */
function resolveChatAttention(chatId: string) {
  if (states.get(chatId)?.attention) write(chatId, { attention: false });
}

export function chatBusy(chatId: string): boolean {
  return activity()[chatId]?.busy ?? false;
}

export function chatAttention(chatId: string): boolean {
  return activity()[chatId]?.attention ?? false;
}

/** True for CARD_LINGER_MS after a live (busy/attention) chat settles fully
 *  quiet via real activity — the sidebar work card's "just finished, still
 *  holding" window (#306 PR2). See chatCardVisualState in flatChatSort.ts. */
export function chatJustFinished(chatId: string): boolean {
  return activity()[chatId]?.justFinished ?? false;
}

/** This session's live last-activity time for a chat, or undefined if it
 *  hasn't had a busy/attention transition since the app started — callers
 *  fall back to the chat's persisted `lastActivityAt` in that case. */
export function chatLastActivityMs(chatId: string): number | undefined {
  return lastActivityMs.get(chatId);
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

function stepGround(c: number): { next: Scan; visible: boolean } {
  if (c === 0x1b) return { next: ESC, visible: false };
  if (c === 0x9b) return { next: CSI, visible: false };
  if (c === 0x9d) return { next: OSC_STR, visible: false };
  if (c === 0x90 || c === 0x98 || c === 0x9e || c === 0x9f) return { next: DCS_STR, visible: false };
  if (c > 0x20 && c !== 0x7f && (c < 0x80 || c > 0x9f)) return { next: GROUND, visible: true };
  return { next: GROUND, visible: false };
}

function stepEsc(c: number): Scan {
  if (c === 0x5b) return CSI; // ESC [
  if (c === 0x5d) return OSC_STR; // ESC ]
  if (c === 0x50 || c === 0x58 || c === 0x5e || c === 0x5f) return DCS_STR; // ESC P/X/^/_
  if (c >= 0x20 && c <= 0x2f) return ESC; // intermediate — ESC ( B et al.
  if (c !== 0x1b) return GROUND; // final byte of the escape
  return ESC;
}

function stepCsi(c: number): Scan {
  if (c === 0x1b) return ESC; // aborted mid-sequence
  if (c === 0x18 || c === 0x1a) return GROUND; // CAN/SUB abort
  if (c >= 0x40 && c <= 0x7e) return GROUND; // final byte
  return CSI;
}

function stepOscStr(c: number): Scan {
  if (c === 0x07 || c === 0x9c) return GROUND; // BEL / C1 ST
  if (c === 0x18 || c === 0x1a) return GROUND; // CAN/SUB abort
  if (c === 0x1b) return OSC_ESC;
  return OSC_STR;
}

/** `holdIndex` signals the VT "anywhere" rule: ESC aborts the string and
 * starts a new sequence — without re-processing this byte under `ESC`, an
 * unterminated OSC/DCS (binary spew) would swallow all later output forever. */
function stepOscEsc(c: number): { next: Scan; holdIndex: boolean } {
  if (c === 0x5c) return { next: GROUND, holdIndex: false }; // ESC \ = ST
  if (c !== 0x1b) return { next: ESC, holdIndex: true };
  return { next: OSC_ESC, holdIndex: false };
}

function stepDcsStr(c: number): Scan {
  if (c === 0x9c) return GROUND; // C1 ST only — BEL is payload here
  if (c === 0x18 || c === 0x1a) return GROUND; // CAN/SUB abort
  if (c === 0x1b) return DCS_ESC;
  return DCS_STR;
}

/** Same VT "anywhere" rule as `stepOscEsc`, for a DCS/SOS/PM/APC string. */
function stepDcsEsc(c: number): { next: Scan; holdIndex: boolean } {
  if (c === 0x5c) return { next: GROUND, holdIndex: false }; // ESC \ = ST
  if (c !== 0x1b) return { next: ESC, holdIndex: true };
  return { next: DCS_ESC, holdIndex: false };
}

function countVisibleChars(chatId: string, paneId: string, chunk: string): number {
  const key = scanKey(chatId, paneId);
  let state: Scan = scanStates.get(key) ?? GROUND;
  let count = 0;
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk.charCodeAt(i);
    switch (state) {
      case GROUND: {
        const step = stepGround(c);
        state = step.next;
        if (step.visible) count++;
        break;
      }
      case ESC:
        state = stepEsc(c);
        break;
      case CSI:
        state = stepCsi(c);
        break;
      case OSC_STR:
        state = stepOscStr(c);
        break;
      case OSC_ESC: {
        const step = stepOscEsc(c);
        state = step.next;
        if (step.holdIndex) i--;
        break;
      }
      case DCS_STR:
        state = stepDcsStr(c);
        break;
      case DCS_ESC: {
        const step = stepDcsEsc(c);
        state = step.next;
        if (step.holdIndex) i--;
        break;
      }
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
  // Starting a new turn is the user acting — sending a message, or answering
  // a permission prompt that resumes the turn — the one thing that resolves
  // a standing needs-you (#331). Merely opening/refocusing the chat does not
  // (see markChatSeen); this is the ONLY place `attention` clears itself
  // outside a fresh unseen alert overwriting it.
  resolveChatAttention(chatId);
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
  clearLingerTimer(chatId);
  unseenGraceUntil.delete(chatId);
  lastActivityMs.delete(chatId);
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
