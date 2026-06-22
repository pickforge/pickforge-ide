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

/** The recovery backend to REQUEST for a chat: "raw" when recovery is off,
 *  "tmux" when the chat opted into a named tmux session, else "dtach". The Rust
 *  side downgrades to "raw" if the chosen backend isn't installed. */
export function chatBackend(chatId: string): ChatBackend {
  if (!recover()) return "raw";
  return isChatTmux(chatId) ? "tmux" : "dtach";
}
