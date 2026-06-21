// File-watch bindings for auto hot-reload. The Rust watcher emits `fs-changed`
// for each `.dart` write under a project dir (generated/VCS dirs excluded);
// watchDartChanges debounces a burst into a single onChange call.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const fsWatchStart = (path: string) => invoke<number>("fs_watch_start", { path });
export const fsWatchStop = (id: number) => invoke<void>("fs_watch_stop", { id });

export interface WatchHandle {
  stop: () => void;
}

/** A `.dart` change event from the Rust watcher, tagged with its watch id. */
interface FsChange {
  id: number;
  path: string;
}

/** Watch `dir` for `.dart` writes; calls `onChange` once per debounced burst. */
export async function watchDartChanges(
  dir: string,
  onChange: () => void,
  debounceMs = 600,
): Promise<WatchHandle> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchId: number | null = null;
  // React only to OUR watcher's events (matched by id) — a second, racing
  // watcher's writes must not trip this one's reload.
  const unlisten: UnlistenFn = await listen<FsChange>("fs-changed", (e) => {
    if (watchId == null || e.payload?.id !== watchId) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  });
  try {
    watchId = await fsWatchStart(dir);
  } catch (e) {
    unlisten();
    throw e;
  }
  return {
    stop: () => {
      clearTimeout(timer);
      unlisten();
      if (watchId != null) void fsWatchStop(watchId).catch(() => {});
    },
  };
}
