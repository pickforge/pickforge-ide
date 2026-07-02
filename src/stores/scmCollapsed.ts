// Which source-control repo sections are collapsed, keyed by repo path and kept
// in localStorage (no DB migration) — mirrors the chatSessions opt-in store. A
// path absent from the set is expanded, so repos default to open.
import { createSignal } from "solid-js";

const KEY = "pickforge.scmCollapsed";

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const [collapsed, setCollapsed] = createSignal<string[]>(load());
export const scmCollapsedPaths = collapsed;

function persist(next: string[]) {
  setCollapsed(next);
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function isScmCollapsed(path: string): boolean {
  return collapsed().includes(path);
}

export function toggleScmCollapsed(path: string) {
  persist(isScmCollapsed(path) ? collapsed().filter((p) => p !== path) : [...collapsed(), path]);
}
