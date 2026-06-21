//! A small file-watcher registry for auto hot-reload: watch a project dir and
//! emit `fs-changed` (the changed path) on every `.dart` write. The UI debounces
//! and sends a hot reload when a run is active. Watchers are keyed by id so the
//! UI can stop them when the run ends.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct WatchManager {
    watchers: Mutex<HashMap<u32, RecommendedWatcher>>,
    next_id: AtomicU32,
}

impl WatchManager {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Start watching `path` recursively; emits `fs-changed` for each `.dart` write.
/// Returns a watch id to pass to [`fs_watch_stop`].
#[tauri::command]
pub fn fs_watch_start(
    app: AppHandle,
    manager: State<'_, WatchManager>,
    path: String,
) -> Result<u32, String> {
    let app = app.clone();
    let root = PathBuf::from(&path);
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        // Only content/lifecycle changes — ignore pure access/metadata events.
        if !matches!(
            event.kind,
            EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
        ) {
            return;
        }
        for p in &event.paths {
            if p.extension().and_then(|e| e.to_str()) != Some("dart") {
                continue;
            }
            // Skip generated / VCS dirs — Flutter rewrites .dart_tool on every
            // reload, which would otherwise loop. Check only the path RELATIVE to
            // the watched root, so an ancestor dir named build/.git/etc. (e.g. a
            // checkout under /home/me/build/app) doesn't suppress real saves.
            let rel = p.strip_prefix(&root).unwrap_or(p);
            if rel.components().any(|c| {
                matches!(
                    c.as_os_str().to_str(),
                    Some(".dart_tool") | Some("build") | Some(".git") | Some(".pickforge")
                )
            }) {
                continue;
            }
            let _ = app.emit("fs-changed", p.to_string_lossy().to_string());
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let id = manager.next_id.fetch_add(1, Ordering::Relaxed);
    manager
        .watchers
        .lock()
        .map_err(|_| "watch registry poisoned")?
        .insert(id, watcher);
    Ok(id)
}

/// Stop a watcher started by [`fs_watch_start`] (dropping it ends the watch).
#[tauri::command]
pub fn fs_watch_stop(manager: State<'_, WatchManager>, id: u32) -> Result<(), String> {
    manager
        .watchers
        .lock()
        .map_err(|_| "watch registry poisoned")?
        .remove(&id);
    Ok(())
}
