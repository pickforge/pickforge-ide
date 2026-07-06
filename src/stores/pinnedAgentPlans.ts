import { createSignal } from "solid-js";

const KEY = "pickforge.pinnedAgentPlans";

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
export const pinnedPlanIds = ids;

function persist(next: string[]) {
  setIds(next);
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function isPlanPinned(chatId: string): boolean {
  return ids().includes(chatId);
}

export function setPlanPinned(chatId: string, pinned: boolean) {
  if (pinned) {
    if (!ids().includes(chatId)) persist([...ids(), chatId]);
  } else {
    persist(ids().filter((id) => id !== chatId));
  }
}

export function togglePlanPinned(chatId: string) {
  setPlanPinned(chatId, !isPlanPinned(chatId));
}
