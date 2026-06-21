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

/** Watch `dir` for `.dart` writes; calls `onChange` once per debounced burst. */
export async function watchDartChanges(
  dir: string,
  onChange: () => void,
  debounceMs = 600,
): Promise<WatchHandle> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unlisten: UnlistenFn = await listen("fs-changed", () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  });
  let watchId: number | null = null;
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
