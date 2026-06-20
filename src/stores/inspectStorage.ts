// Where the Inspector saves widget captures (context md + screenshot). Default
// is PickForge home (~/.pickforge/inspect) so the repo stays clean; per project
// the user can opt into storing them in the repo (<root>/.pickforge/inspect).
import { createSignal } from "solid-js";

const KEY = "pickforge.inspectInRepo";

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

/** True if this project's captures go in the repo (default: false → home). */
export function captureInRepo(root: string | null): boolean {
  return !!(root && state()[root]);
}

export function setCaptureInRepo(root: string, inRepo: boolean) {
  const next = { ...state(), [root]: inRepo };
  setState(next);
  localStorage.setItem(KEY, JSON.stringify(next));
}
