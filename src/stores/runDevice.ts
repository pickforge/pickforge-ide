// The adb device a project's app should run on, shared by the Run control bar
// and the Inspector so both stay in sync. Keyed by projectRoot, persisted in
// localStorage. An empty string means "no explicit choice" (use the first
// connected device).
import { createSignal } from "solid-js";
import type { RemotePty } from "../lib/pty";

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

function selectionKey(root: string, remote?: RemotePty | null): string {
  return remote
    ? JSON.stringify(["remote", root, remote.host, remote.remoteRoot])
    : root;
}

/** The selected device id for a local project or exact remote binding. */
export function selectedDevice(root: string | null, remote?: RemotePty | null): string {
  return root ? state()[selectionKey(root, remote)] || "" : "";
}

export function setRunDevice(root: string, serial: string, remote?: RemotePty | null) {
  persist({ ...state(), [selectionKey(root, remote)]: serial });
}
