// Per-group edit timestamps for settings sync. Stamped when a syncable setting
// is EDITED (hooked into the source stores' setters), not when a sync runs, so
// last-writer-wins compares real edit times across machines: a machine that
// edited earlier but syncs later must lose to a newer write. Machine-global on
// purpose — edit times describe this machine's local state, not an account.
import type { SyncFieldGroup } from "@pickforge/sync";

const EDITS_KEY = "pickforge.settingsSync.edits";

let muteDepth = 0;
let lastMicros = 0;

/** Canonical microsecond UTC timestamp, monotonic within the process. */
export function nowCanonical(): string {
  let micros = Date.now() * 1000;
  if (micros <= lastMicros) micros = lastMicros + 1;
  lastMicros = micros;
  const date = new Date(Math.floor(micros / 1000));
  const sub = micros % 1000;
  const fraction =
    String(date.getUTCMilliseconds()).padStart(3, "0") + String(sub).padStart(3, "0");
  const p = (value: number, size = 2) => String(value).padStart(size, "0");
  return (
    `${p(date.getUTCFullYear(), 4)}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}` +
    `T${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}.${fraction}Z`
  );
}

function loadEdits(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(localStorage.getItem(EDITS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Record that a group's source state was edited now. No-op while a sync apply
 *  is writing server values back into the stores. */
export function noteSettingsEdit(group: SyncFieldGroup): void {
  if (muteDepth > 0) return;
  try {
    const edits = loadEdits();
    edits[group] = nowCanonical();
    localStorage.setItem(EDITS_KEY, JSON.stringify(edits));
  } catch {
  }
}

/** The last recorded edit time for a group, or null when none was captured. */
export function settingsEditTime(group: SyncFieldGroup): string | null {
  const value = loadEdits()[group];
  return typeof value === "string" ? value : null;
}

/** Run fn with edit stamping muted — server-apply writes are not local edits. */
export async function withSettingsEditsMuted<T>(fn: () => T | Promise<T>): Promise<T> {
  muteDepth += 1;
  try {
    return await fn();
  } finally {
    muteDepth -= 1;
  }
}
