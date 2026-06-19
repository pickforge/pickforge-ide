// Per-project expansion of the nested chat list in the projects tree. Persisted
// in localStorage; a project's chats default to expanded (absent key = open).
import { createSignal } from "solid-js";

const KEY = "pickforge.chatTree";

function load(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : {};
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

const [state, setState] = createSignal<Record<string, boolean>>(load());

function persist(next: Record<string, boolean>) {
  setState(next);
  localStorage.setItem(KEY, JSON.stringify(next));
}

/** True when a project's chat children are shown (default: expanded). */
export function chatsExpanded(root: string): boolean {
  return state()[root] !== false;
}

export function toggleChats(root: string) {
  persist({ ...state(), [root]: !chatsExpanded(root) });
}

/** Collapse or expand every project's chats at once. */
export function setAllChats(roots: string[], expanded: boolean) {
  const next = { ...state() };
  for (const r of roots) next[r] = expanded;
  persist(next);
}

export function anyChatsExpanded(roots: string[]): boolean {
  return roots.some((r) => chatsExpanded(r));
}
