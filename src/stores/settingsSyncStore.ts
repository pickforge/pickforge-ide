// Settings sync engine. Dark behind the `settingsSync` flag and only active when
// signed in. Opt-in is off by default; enabling it runs a full pull-then-push
// per enabled group with last-writer-wins. Syncs fire on: sign-in, a change to
// the sync toggles, window focus, and the manual "Sync now" action.
import { createEffect, createRoot, createSignal } from "solid-js";
import {
  pullGroup,
  pushGroup,
  SyncError,
  type Json,
  type SupabaseClientLike,
  type SyncFieldGroup,
} from "@pickforge/sync";
import { getProSupabaseClient } from "../lib/proAuth";
import { accountSession } from "./account";
import { flagEnabled, subscribeToFlagChanges } from "./flags";
import {
  applyAppSettings,
  applyKeybindings,
  applyOperatorConfig,
  applyRemoteBindings,
  collectAppSettings,
  collectKeybindings,
  collectOperatorConfig,
  collectRemoteBindings,
} from "../lib/settingsSync";

export const SYNC_GROUPS: SyncFieldGroup[] = [
  "appSettings",
  "operatorConfig",
  "keybindings",
  "remoteBindings",
];

export interface SettingsSyncState {
  optedIn: boolean;
  groups: Record<SyncFieldGroup, boolean>;
}

const STATE_KEY = "pickforge.settingsSync";
const META_KEY = "pickforge.settingsSync.meta";

const BLOCKED_MESSAGE = "A value was blocked from syncing.";
const GENERIC_ERROR = "Settings sync hit a snag — it will retry.";

function defaultGroups(): Record<SyncFieldGroup, boolean> {
  return { appSettings: true, operatorConfig: true, keybindings: true, remoteBindings: true };
}

function loadState(): SettingsSyncState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return { optedIn: false, groups: defaultGroups() };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const groups = defaultGroups();
    const saved = parsed.groups;
    if (saved && typeof saved === "object") {
      for (const group of SYNC_GROUPS) {
        const value = (saved as Record<string, unknown>)[group];
        if (typeof value === "boolean") groups[group] = value;
      }
    }
    return { optedIn: parsed.optedIn === true, groups };
  } catch {
    return { optedIn: false, groups: defaultGroups() };
  }
}

const [state, setState] = createSignal<SettingsSyncState>(loadState());
const [lastSyncedAt, setLastSyncedAt] = createSignal<string | null>(null);
const [syncError, setSyncError] = createSignal<string | null>(null);
const [syncing, setSyncing] = createSignal(false);
const [tick, setTick] = createSignal(0);

export const settingsSyncState = state;
export const settingsSyncing = syncing;
export const settingsSyncErrorMessage = syncError;

function persistState(next: SettingsSyncState) {
  setState(next);
  localStorage.setItem(STATE_KEY, JSON.stringify(next));
}

// ---- per-group metadata: the last synced snapshot + its edit timestamp ----

interface GroupMeta {
  hash: string | null;
  mtime: string;
}

function loadMeta(): Record<string, GroupMeta> {
  try {
    const raw = localStorage.getItem(META_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, GroupMeta>) : {};
  } catch {
    return {};
  }
}

function readGroupMeta(group: SyncFieldGroup): GroupMeta {
  const meta = loadMeta()[group];
  if (meta && typeof meta.mtime === "string") {
    return { hash: typeof meta.hash === "string" ? meta.hash : null, mtime: meta.mtime };
  }
  return { hash: null, mtime: EPOCH };
}

function writeGroupMeta(group: SyncFieldGroup, meta: GroupMeta) {
  const all = loadMeta();
  all[group] = meta;
  localStorage.setItem(META_KEY, JSON.stringify(all));
}

// ---- canonical microsecond UTC timestamps, monotonic within a process ----

const EPOCH = "0000-00-00T00:00:00.000000Z";
let lastMicros = 0;

function nowCanonical(): string {
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

// ---- group IO: collect a payload / apply one back into the local stores ----

async function collectGroup(group: SyncFieldGroup): Promise<Json> {
  switch (group) {
    case "appSettings":
      return collectAppSettings();
    case "operatorConfig":
      return collectOperatorConfig();
    case "keybindings":
      return collectKeybindings();
    case "remoteBindings": {
      const { workspace } = await import("./workspace");
      return collectRemoteBindings(workspace.projects);
    }
  }
}

async function applyGroup(group: SyncFieldGroup, payload: Json): Promise<void> {
  switch (group) {
    case "appSettings":
      return applyAppSettings(payload);
    case "operatorConfig":
      return applyOperatorConfig(payload);
    case "keybindings":
      return applyKeybindings(payload);
    case "remoteBindings": {
      const [{ workspace, setProjectRemoteLocal }, db] = await Promise.all([
        import("./workspace"),
        import("../lib/db"),
      ]);
      await applyRemoteBindings(payload, {
        projects: workspace.projects,
        async setBinding(root, remoteHost, remoteRoot) {
          await db.projectRemoteSet(root, remoteHost, remoteRoot);
          setProjectRemoteLocal(root, remoteHost, remoteRoot);
        },
      });
    }
  }
}

// ---- engine ----

interface SyncContext {
  supabase: SupabaseClientLike;
  userId: string;
}

function context(): SyncContext | null {
  const session = accountSession();
  if (!settingsSyncEnabled() || !session) return null;
  try {
    // The real client is a runtime superset of the sync engine's structural
    // client type (its query builder chains eq/is/lt/order after select).
    const supabase = getProSupabaseClient() as unknown as SupabaseClientLike;
    return { supabase, userId: session.userId };
  } catch {
    return null;
  }
}

async function syncGroup(ctx: SyncContext, group: SyncFieldGroup): Promise<void> {
  const local = await collectGroup(group);
  const localStr = JSON.stringify(local);
  const meta = readGroupMeta(group);
  const changedLocally = meta.hash !== null && localStr !== meta.hash;
  const mtime = changedLocally ? nowCanonical() : meta.mtime;

  const server = await pullGroup({ supabase: ctx.supabase, userId: ctx.userId, group });

  const serverWins =
    server !== null &&
    // First time this group is seen (no local snapshot): adopt the server value.
    (meta.hash === null || server.updatedAt > mtime);

  if (serverWins && server) {
    await applyGroup(group, server.payload);
    writeGroupMeta(group, { hash: JSON.stringify(await collectGroup(group)), mtime: server.updatedAt });
    return;
  }

  // Nothing new locally and the server is not ahead — already in sync.
  if (!changedLocally && meta.hash !== null && server !== null) return;

  const result = await pushGroup({
    supabase: ctx.supabase,
    userId: ctx.userId,
    group,
    payload: local,
    updatedAt: changedLocally || meta.hash === null ? nowCanonical() : mtime,
  });

  if (result.status === "written") {
    writeGroupMeta(group, { hash: localStr, mtime: result.record.updatedAt });
    return;
  }

  // A concurrent writer won the race — adopt whatever the server now holds.
  if (result.record) {
    await applyGroup(group, result.record.payload);
    writeGroupMeta(group, {
      hash: JSON.stringify(await collectGroup(group)),
      mtime: result.record.updatedAt,
    });
  } else {
    writeGroupMeta(group, { hash: localStr, mtime: nowCanonical() });
  }
}

let inFlight: Promise<void> | null = null;

/** Sync the given groups (default: all enabled). No-op when disabled/signed out.
 *  Concurrent callers share the in-flight run. */
export function sync(groups: SyncFieldGroup[] = enabledGroups()): Promise<void> {
  const ctx = context();
  if (!ctx || groups.length === 0) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = runSync(ctx, groups).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync(ctx: SyncContext, groups: SyncFieldGroup[]): Promise<void> {
  setSyncing(true);
  let blocked = false;
  let failed = false;
  try {
    for (const group of groups) {
      try {
        await syncGroup(ctx, group);
      } catch (error) {
        if (error instanceof SyncError && error.code === "boundary_violation") {
          blocked = true;
        } else {
          failed = true;
        }
      }
    }
    setLastSyncedAt(new Date().toISOString());
    setSyncError(blocked ? BLOCKED_MESSAGE : failed ? GENERIC_ERROR : null);
  } finally {
    setSyncing(false);
  }
}

function enabledGroups(): SyncFieldGroup[] {
  const current = state();
  if (!current.optedIn) return [];
  return SYNC_GROUPS.filter((group) => current.groups[group]);
}

// ---- public state helpers ----

export function settingsSyncEnabled(): boolean {
  return flagEnabled("settingsSync") && accountSession() !== null;
}

export function setSettingsSyncOptIn(optedIn: boolean): void {
  persistState({ ...state(), optedIn });
  setSyncError(null);
  if (optedIn) void sync();
}

export function setSettingsSyncGroup(group: SyncFieldGroup, on: boolean): void {
  persistState({ ...state(), groups: { ...state().groups, [group]: on } });
  if (on && state().optedIn) void sync([group]);
}

export function syncNow(): void {
  void sync();
}

/** Relative "last synced" label, or null before the first sync of a session. */
export function lastSyncedRelative(): string | null {
  tick();
  const iso = lastSyncedAt();
  if (!iso) return null;
  const delta = Date.now() - Date.parse(iso);
  if (!Number.isFinite(delta)) return null;
  if (delta < 5_000) return "just now";
  if (delta < 60_000) return `${Math.round(delta / 1_000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  return `${Math.round(delta / 3_600_000)}h ago`;
}

let bootstrapDisposed: (() => void) | null = null;

/** Wire the automatic sync triggers: sign-in, flag flips, and window focus.
 *  Returns a disposer. Safe to call once at app start. */
export function installSettingsSyncBootstrap(): () => void {
  if (bootstrapDisposed) return bootstrapDisposed;

  let disposeRoot = () => {};
  createRoot((dispose) => {
    disposeRoot = dispose;
    // Fires on sign-in (session becomes non-null) and on flag changes, since
    // settingsSyncEnabled() reads the flag version signal.
    createEffect(() => {
      if (settingsSyncEnabled() && state().optedIn) void sync();
    });
  });

  const relabelTimer = window.setInterval(() => setTick((value) => value + 1), 30_000);
  const unsubscribeFlags = subscribeToFlagChanges(() => setTick((value) => value + 1));

  const onFocus = () => {
    if (settingsSyncEnabled() && state().optedIn) void sync();
  };
  let unlistenFocus: (() => void) | undefined;
  void (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused) onFocus();
      });
    } catch {
      window.addEventListener("focus", onFocus);
      unlistenFocus = () => window.removeEventListener("focus", onFocus);
    }
  })();

  bootstrapDisposed = () => {
    disposeRoot();
    window.clearInterval(relabelTimer);
    unsubscribeFlags();
    unlistenFocus?.();
    bootstrapDisposed = null;
  };
  return bootstrapDisposed;
}
