// Auto-update client over the Tauri updater plugin. The plugin checks the
// GitHub "latest.json" endpoint configured in tauri.conf.json and verifies the
// signature against the embedded public key. No-ops outside Tauri (VRT/browser).
import { createSignal } from "solid-js";
import type { Update } from "@tauri-apps/plugin-updater";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "none"
  | "downloading"
  | "ready"
  | "error";

const [status, setStatus] = createSignal<UpdateStatus>("idle");
const [available, setAvailable] = createSignal<{ version: string; notes?: string } | null>(null);
const [error, setError] = createSignal<string | null>(null);

export const updateStatus = status;
export const updateAvailable = available;
export const updateError = error;

let pending: Update | null = null;

function inTauri(): boolean {
  return typeof window !== "undefined" &&
    !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

/** Check for an update. `silent` keeps the UI quiet on failure (startup check). */
export async function checkForUpdate(silent = false): Promise<void> {
  if (!inTauri()) return;
  setError(null);
  setStatus("checking");
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      pending = update;
      setAvailable({ version: update.version, notes: update.body });
      setStatus("available");
    } else {
      // A previously-found update may have been retracted (or we've since
      // updated): clear the cached update so the badge/install button don't keep
      // offering something the updater no longer reports.
      pending = null;
      setAvailable(null);
      setStatus("none");
    }
  } catch (e) {
    setError(String(e));
    setStatus(silent ? "idle" : "error");
  }
}

/** Download + install the pending update, then relaunch. */
export async function installUpdate(): Promise<void> {
  if (!pending) return;
  setError(null);
  setStatus("downloading");
  try {
    await pending.downloadAndInstall();
    setStatus("ready");
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    setError(String(e));
    setStatus("error");
  }
}
