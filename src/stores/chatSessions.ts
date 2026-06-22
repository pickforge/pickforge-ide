// Per-chat session-recovery preferences, kept in localStorage (no DB migration
// needed) — mirrors the chatArchive store.
//
// Two knobs:
//   * a GLOBAL "Recover chat sessions" toggle (default ON) — when off, every
//     chat pane spawns a plain shell (today's behaviour);
//   * a per-chat opt-in to back the chat with a named tmux session instead of
//     the default dtach. dtach is the default for any chat not in this set.
import { createSignal } from "solid-js";
import type { ChatBackend } from "../lib/pty";

const RECOVER_KEY = "pickforge.recoverChatSessions";
const TMUX_KEY = "pickforge.tmuxChats";

// ---- global recovery toggle ----
function loadRecover(): boolean {
  // Default ON: only an explicit "false" disables it.
  return localStorage.getItem(RECOVER_KEY) !== "false";
}
const [recover, setRecover] = createSignal<boolean>(loadRecover());
/** Reactive: is per-chat session recovery enabled at all? */
export const recoverChatSessions = recover;
export function setRecoverChatSessions(on: boolean) {
  setRecover(on);
  localStorage.setItem(RECOVER_KEY, on ? "true" : "false");
}

// ---- per-chat tmux opt-in ----
function loadTmux(): string[] {
  try {
    const raw = localStorage.getItem(TMUX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
const [tmuxIds, setTmuxIds] = createSignal<string[]>(loadTmux());
/** Reactive list of chat ids pinned to a named tmux session. */
export const tmuxChatIds = tmuxIds;

function persistTmux(next: string[]) {
  setTmuxIds(next);
  localStorage.setItem(TMUX_KEY, JSON.stringify(next));
}

export function isChatTmux(chatId: string): boolean {
  return tmuxIds().includes(chatId);
}
export function setChatTmux(chatId: string, on: boolean) {
  if (on === isChatTmux(chatId)) return;
  persistTmux(on ? [...tmuxIds(), chatId] : tmuxIds().filter((x) => x !== chatId));
}

/** The recovery backend a stored `session_id` is tagged with (`"<backend>:..."`),
 *  or null if there's no usable handle. A "raw:" handle is preserved on degrade
 *  but isn't a recoverable backend, so it returns null too. */
export function backendFromSessionId(sessionId: string | null | undefined): ChatBackend | null {
  if (!sessionId) return null;
  const tag = sessionId.split(":", 1)[0];
  return tag === "dtach" || tag === "tmux" ? tag : null;
}

/** The recovery backend to REQUEST for a chat. Recovery off → "raw". Otherwise,
 *  an existing chat is REOPENED with the backend its persisted `session_id` is
 *  tagged with — so a tmux-backed chat never silently reopens as dtach (which
 *  would abandon the old session and overwrite the handle). Only a chat with no
 *  stored handle (brand new, or after an explicit migration cleared it) falls
 *  back to the per-chat tmux opt-in, else dtach. The Rust side still downgrades to
 *  "raw" if the chosen backend isn't installed. */
export function chatBackend(chatId: string, sessionId?: string | null): ChatBackend {
  if (!recover()) return "raw";
  return backendFromSessionId(sessionId) ?? (isChatTmux(chatId) ? "tmux" : "dtach");
}
