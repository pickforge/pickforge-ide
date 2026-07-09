// Settings sync engine. Dark behind the `settingsSync` flag and only active when
// signed in. Opt-in is off by default; enabling it runs a full pull-then-push
// per enabled group with last-writer-wins. Syncs fire on: sign-in, a change to
// the sync toggles, window focus, and the manual "Sync now" action.
//
// All sync state (opt-in, group toggles, per-group meta) is keyed PER USER so a
// second account on the same machine never inherits the first account's opt-in
// or content hashes; signing out keeps each user's blob for their next sign-in.
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
  nowCanonical,
  settingsEditTime,
  withSettingsEditsMuted,
} from "../lib/settingsSyncEdits";
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

const BLOCKED_MESSAGE = "A value was blocked from syncing.";
const GENERIC_ERROR = "Settings sync hit a snag — it will retry.";

function stateKey(userId: string): string {
  return `${STATE_KEY}.${userId}`;
}

function metaKey(userId: string): string {
  return `${STATE_KEY}.${userId}.meta`;
}

function defaultGroups(): Record<SyncFieldGroup, boolean> {
  return { appSettings: true, operatorConfig: true, keybindings: true, remoteBindings: true };
}

function defaultState(): SettingsSyncState {
  return { optedIn: false, groups: defaultGroups() };
}

function loadState(userId: string | null): SettingsSyncState {
  if (!userId) return defaultState();
  try {
    const raw = localStorage.getItem(stateKey(userId));
    if (!raw) return defaultState();
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
    return defaultState();
  }
}

const [state, setState] = createSignal<SettingsSyncState>(defaultState());
const [lastSyncedAt, setLastSyncedAt] = createSignal<string | null>(null);
const [syncError, setSyncError] = createSignal<string | null>(null);
const [syncing, setSyncing] = createSignal(false);
const [tick, setTick] = createSignal(0);

export const settingsSyncing = syncing;
export const settingsSyncErrorMessage = syncError;

let loadedUserId: string | null | undefined;

/** Reload the state signal when the signed-in user changes. Reading the session
 *  here also subscribes reactive consumers to sign-in/out flips. */
function ensureUserState(): string | null {
  const userId = accountSession()?.userId ?? null;
  if (loadedUserId !== userId) {
    loadedUserId = userId;
    setState(loadState(userId));
    setLastSyncedAt(null);
    setSyncError(null);
  }
  return userId;
}

export function settingsSyncState(): SettingsSyncState {
  ensureUserState();
  return state();
}

function persistState(userId: string, next: SettingsSyncState) {
  setState(next);
  localStorage.setItem(stateKey(userId), JSON.stringify(next));
}

// ---- per-group metadata: the last synced snapshot + its sync timestamp ----

interface GroupMeta {
  hash: string | null;
  mtime: string;
}

const EPOCH = "0000-00-00T00:00:00.000000Z";

function loadMeta(userId: string): Record<string, GroupMeta> {
  try {
    const raw = localStorage.getItem(metaKey(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, GroupMeta>) : {};
  } catch {
    return {};
  }
}

function readGroupMeta(userId: string, group: SyncFieldGroup): GroupMeta {
  const meta = loadMeta(userId)[group];
  if (meta && typeof meta.mtime === "string") {
    return { hash: typeof meta.hash === "string" ? meta.hash : null, mtime: meta.mtime };
  }
  return { hash: null, mtime: EPOCH };
}

function writeGroupMeta(userId: string, group: SyncFieldGroup, meta: GroupMeta) {
  const all = loadMeta(userId);
  all[group] = meta;
  localStorage.setItem(metaKey(userId), JSON.stringify(all));
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
  // Muted: writing server values through the store setters must not stamp new
  // local edit times, or every pull would immediately look like a local edit.
  await withSettingsEditsMuted(async () => {
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
  });
}

// ---- engine ----

interface SyncContext {
  supabase: SupabaseClientLike;
  userId: string;
}

function context(): SyncContext | null {
  const userId = ensureUserState();
  if (!userId || !settingsSyncEnabled()) return null;
  try {
    // The real client is a runtime superset of the sync engine's structural
    // client type (its query builder chains eq/is/lt/order after select).
    const supabase = getProSupabaseClient() as unknown as SupabaseClientLike;
    return { supabase, userId };
  } catch {
    return null;
  }
}

/** remoteBindings collects/applies against workspace.projects, and the first
 *  automatic sync (the sign-in effect) can fire before loadWorkspace() has
 *  populated it — so every run waits for the workspace `loaded` signal, the
 *  same gate the focus-refresh path relies on. Polled: it flips exactly once
 *  at startup, so the loop lives only for that window. */
async function workspaceReady(): Promise<void> {
  const { workspace } = await import("./workspace");
  while (!workspace.loaded) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function syncGroup(ctx: SyncContext, group: SyncFieldGroup): Promise<void> {
  const local = await collectGroup(group);
  const localStr = JSON.stringify(local);
  const meta = readGroupMeta(ctx.userId, group);
  const changedLocally = meta.hash === null || localStr !== meta.hash;
  // LWW compares real edit times: a dirty group carries the timestamp of the
  // EDIT (stamped by the source store's setter), not of this sync run, so a
  // machine that edited earlier but syncs later still loses to a newer write.
  const localMtime = changedLocally ? settingsEditTime(group) ?? nowCanonical() : meta.mtime;

  const server = await pullGroup({ supabase: ctx.supabase, userId: ctx.userId, group });

  const serverWins =
    server !== null &&
    // First sync for this user on this machine: adopt the account's value.
    (meta.hash === null || server.updatedAt > localMtime);

  if (serverWins && server) {
    await applyGroup(group, server.payload);
    writeGroupMeta(ctx.userId, group, {
      hash: JSON.stringify(await collectGroup(group)),
      mtime: server.updatedAt,
    });
    return;
  }

  // Nothing new locally and the server is not ahead — already in sync.
  if (!changedLocally && server !== null) return;

  const result = await pushGroup({
    supabase: ctx.supabase,
    userId: ctx.userId,
    group,
    payload: local,
    updatedAt: localMtime,
  });

  if (result.status === "written") {
    writeGroupMeta(ctx.userId, group, { hash: localStr, mtime: result.record.updatedAt });
    return;
  }

  // A concurrent writer won the race — adopt whatever the server now holds.
  if (result.record) {
    await applyGroup(group, result.record.payload);
    writeGroupMeta(ctx.userId, group, {
      hash: JSON.stringify(await collectGroup(group)),
      mtime: result.record.updatedAt,
    });
  } else {
    writeGroupMeta(ctx.userId, group, { hash: localStr, mtime: nowCanonical() });
  }
}

let inFlight: Promise<void> | null = null;

/** Sync the given groups (default: all enabled). No-op when disabled/signed out.
 *  Concurrent callers share the in-flight run. */
export function sync(groups?: SyncFieldGroup[]): Promise<void> {
  const ctx = context();
  const targets = groups ?? enabledGroups();
  if (!ctx || targets.length === 0) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = runSync(ctx, targets).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync(ctx: SyncContext, groups: SyncFieldGroup[]): Promise<void> {
  setSyncing(true);
  let blocked = false;
  let failed = false;
  let succeeded = 0;
  try {
    try {
      await workspaceReady();
    } catch {
      setSyncError(GENERIC_ERROR);
      return;
    }
    for (const group of groups) {
      try {
        await syncGroup(ctx, group);
        succeeded += 1;
      } catch (error) {
        if (error instanceof SyncError && error.code === "boundary_violation") {
          blocked = true;
        } else {
          failed = true;
        }
      }
    }
    // "Last synced" stays honest: only bump it when at least one group made it.
    if (succeeded > 0) setLastSyncedAt(new Date().toISOString());
    setSyncError(blocked ? BLOCKED_MESSAGE : failed ? GENERIC_ERROR : null);
  } finally {
    setSyncing(false);
  }
}

function enabledGroups(): SyncFieldGroup[] {
  const current = settingsSyncState();
  if (!current.optedIn) return [];
  return SYNC_GROUPS.filter((group) => current.groups[group]);
}

// ---- public state helpers ----

export function settingsSyncEnabled(): boolean {
  return flagEnabled("settingsSync") && accountSession() !== null;
}

export function setSettingsSyncOptIn(optedIn: boolean): void {
  const userId = ensureUserState();
  if (!userId) return;
  persistState(userId, { ...state(), optedIn });
  setSyncError(null);
  if (optedIn) void sync();
}

export function setSettingsSyncGroup(group: SyncFieldGroup, on: boolean): void {
  const userId = ensureUserState();
  if (!userId) return;
  persistState(userId, { ...state(), groups: { ...state().groups, [group]: on } });
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
      if (settingsSyncEnabled() && settingsSyncState().optedIn) void sync();
    });
  });

  const relabelTimer = window.setInterval(() => setTick((value) => value + 1), 30_000);
  const unsubscribeFlags = subscribeToFlagChanges(() => setTick((value) => value + 1));

  const onFocus = () => {
    if (settingsSyncEnabled() && settingsSyncState().optedIn) void sync();
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
