// File-watch bindings, shared by two callers: auto hot-reload (`"dart"` mode
// — the Rust watcher emits `fs-changed` for each `.dart` write under a
// project dir, generated/VCS dirs excluded) and the Source Control pane's
// filesystem-driven refresh (#333, `"git"` mode — any write outside `.git`
// internals besides `HEAD`/`index` and common generated/dependency dirs; see
// `src-tauri/src/watch_commands.rs`'s `git_watch_ignored`). Both go through
// the same debounced-burst-into-one-callback watch below.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type WatchMode = "dart" | "git";

export const fsWatchStart = (path: string, mode: WatchMode = "dart") =>
  invoke<number>("fs_watch_start", { path, mode });
export const fsWatchStop = (id: number) => invoke<void>("fs_watch_stop", { id });

export interface WatchHandle {
  stop: () => void;
}

/** A change event from the Rust watcher, tagged with its watch id. */
interface FsChange {
  id: number;
  path: string;
}

/** Coalesces rapid-fire calls into a single `onFire` after `delayMs` of
 *  quiet — a burst of filesystem events (a save touching several files, a
 *  branch checkout rewriting many at once) becomes one refresh, not one per
 *  event. Pulled out as its own pure-ish helper (no `listen`/Tauri
 *  dependency) so the coalescing behavior itself is unit-testable with fake
 *  timers, independent of the watcher plumbing around it. */
export function createDebouncedTrigger(onFire: () => void, delayMs: number): {
  notify: () => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    notify: () => {
      clearTimeout(timer);
      timer = setTimeout(onFire, delayMs);
    },
    cancel: () => {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Watch `dir` in `mode`; calls `onChange` once per debounced burst of
 *  matching writes. Shared implementation for `watchDartChanges` (hot
 *  reload) and `watchGitChanges` (#333, Source Control auto-refresh) —
 *  both differ only in which Rust-side filter applies and the default
 *  debounce window. */
async function watchFsChanges(
  dir: string,
  mode: WatchMode,
  onChange: () => void,
  debounceMs: number,
): Promise<WatchHandle> {
  let watchId: number | null = null;
  const trigger = createDebouncedTrigger(onChange, debounceMs);
  // React only to OUR watcher's events (matched by id) — a second, racing
  // watcher's writes must not trip this one's reload.
  const unlisten: UnlistenFn = await listen<FsChange>("fs-changed", (e) => {
    if (watchId == null || e.payload?.id !== watchId) return;
    trigger.notify();
  });
  try {
    watchId = await fsWatchStart(dir, mode);
  } catch (e) {
    unlisten();
    throw e;
  }
  return {
    stop: () => {
      trigger.cancel();
      unlisten();
      if (watchId != null) void fsWatchStop(watchId).catch(() => {});
    },
  };
}

/** Watch `dir` for `.dart` writes; calls `onChange` once per debounced burst. */
export function watchDartChanges(dir: string, onChange: () => void, debounceMs = 600): Promise<WatchHandle> {
  return watchFsChanges(dir, "dart", onChange, debounceMs);
}

/** Watch `dir` (a project/repo root) for any write outside `.git` internals
 *  and generated/dependency dirs (#333); calls `onChange` once per debounced
 *  burst — the Source Control pane's cue to re-scan git status without a
 *  polling loop. A shorter default debounce than `watchDartChanges`: a git
 *  status scan is far cheaper than a hot reload, so there's less need to
 *  wait out a long burst before refreshing. */
export function watchGitChanges(dir: string, onChange: () => void, debounceMs = 400): Promise<WatchHandle> {
  return watchFsChanges(dir, "git", onChange, debounceMs);
}
