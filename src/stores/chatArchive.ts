// Archived chats, kept in localStorage (keyed by chatId) so no DB migration is
// needed — mirrors the projectGrouping store. Archived chats are hidden from
// the rail until restored.
import { createSignal } from "solid-js";

const KEY = "pickforge.archivedChats";

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const [ids, setIds] = createSignal<string[]>(load());
/** Reactive list of archived chat ids. */
export const archivedChatIds = ids;

function persist(next: string[]) {
  setIds(next);
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function isChatArchived(id: string): boolean {
  return ids().includes(id);
}
export function archiveChat(id: string) {
  if (!ids().includes(id)) persist([...ids(), id]);
}
export function unarchiveChat(id: string) {
  persist(ids().filter((x) => x !== id));
}
