// Auto hot-reload toggle: when on, saving a .dart file in the running project
// triggers a hot reload. Persisted; default on (the point of the AI loop).
import { createSignal } from "solid-js";

const KEY = "pickforge.autoReload";

function load(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    return raw == null ? true : raw === "1";
  } catch {
    return true;
  }
}

const [enabled, setEnabled] = createSignal(load());

export const autoReloadEnabled = enabled;

export function setAutoReload(on: boolean) {
  setEnabled(on);
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* private mode — in-memory only */
  }
}

export function toggleAutoReload() {
  setAutoReload(!enabled());
}
