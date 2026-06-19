// The adb device a project's app should run on, shared by the Run control bar
// and the Inspector so both stay in sync. Keyed by projectRoot, persisted in
// localStorage. An empty string means "no explicit choice" (use the first
// connected device).
import { createSignal } from "solid-js";

const KEY = "pickforge.runDevice";

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : {};
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

const [state, setState] = createSignal<Record<string, string>>(load());

function persist(next: Record<string, string>) {
  setState(next);
  localStorage.setItem(KEY, JSON.stringify(next));
}

/** The selected device serial for a project, or "" if none chosen yet. */
export function selectedDevice(root: string | null): string {
  return (root && state()[root]) || "";
}

export function setRunDevice(root: string, serial: string) {
  persist({ ...state(), [root]: serial });
}
