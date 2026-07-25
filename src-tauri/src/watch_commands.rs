//! A small file-watcher registry, shared by two callers that both want "tell
//! me when files under this directory change, debounced":
//!  - auto hot-reload (`mode: "dart"`, the original caller): emits `fs-changed`
//!    on every `.dart` write under a project dir.
//!  - the Source Control pane's filesystem-driven refresh (#333, `mode:
//!    "git"`): emits `fs-changed` on ANY write under a project dir, except
//!    inside `.git` (repo-state churn like `refs/`/`logs/`/`objects/` rewrites
//!    on nearly every git operation and carries no UI-relevant signal — only
//!    the two top-level files a `git status`/branch read actually depends on,
//!    `.git/HEAD` and `.git/index`, are let through) and inside common
//!    generated/dependency directories that would otherwise self-trigger in a
//!    loop (`node_modules`, `target`, `dist`, build caches, …).
//!
//! This is a fixed ignore list, not full `.gitignore` semantics — parsing and
//! matching a project's actual ignore rules would need a dedicated crate
//! (e.g. `ignore`) and per-directory `.gitignore` discovery; out of scope for
//! this pass (see #333's decision audit). The fixed list already keeps a
//! normal repo's watch quiet in practice.
//!
//! The UI debounces a burst of events into a single callback (see
//! `src/lib/fsWatch.ts`). Watchers are keyed by id so the UI can stop them
//! independently (e.g. a run ending, or the active project changing).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, State};

/// Which caller a watcher was started for, and therefore which path filter
/// applies. `Dart` is the default (matches every caller before #333, none of
/// which pass `mode` at all).
#[derive(Clone, Copy, PartialEq, Eq)]
enum WatchMode {
    Dart,
    Git,
}

impl WatchMode {
    fn from_param(mode: Option<&str>) -> Self {
        match mode {
            Some("git") => WatchMode::Git,
            _ => WatchMode::Dart,
        }
    }
}

/// Directories a "git" watch never descends into meaningfully — dependency
/// trees and build output that rewrite on nearly every build/install and
/// aren't Git-relevant. Checked as an exact path-component match (not a
/// substring), same as the existing Dart-mode check below.
const GIT_WATCH_IGNORED_DIRS: &[&str] = &[
    "node_modules",
    ".dart_tool",
    "target",
    "dist",
    "build",
    ".venv",
    "venv",
    "__pycache__",
    ".next",
    ".pickforge",
    ".cache",
    "coverage",
    ".turbo",
    ".idea",
    ".vscode",
];

/// Whether a "git" watch should ignore `rel` (already relative to the watched
/// root). `.git` internals are dropped wholesale EXCEPT the two top-level
/// files a status/branch read depends on, `.git/HEAD` and `.git/index` —
/// everything else under `.git` (`refs/`, `logs/`, `objects/`, `index.lock`,
/// …) rewrites on nearly every git operation and would otherwise self-trigger
/// a refresh loop. Also drops the fixed generated/dependency dirs above,
/// wherever they appear in the path (not just at the root).
fn git_watch_ignored(rel: &Path) -> bool {
    let comps: Vec<&str> = rel
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();
    for (i, c) in comps.iter().enumerate() {
        if *c == ".git" {
            let next = comps.get(i + 1).copied();
            let is_top_level_head_or_index =
                comps.len() == i + 2 && matches!(next, Some("HEAD") | Some("index"));
            return !is_top_level_head_or_index;
        }
        if GIT_WATCH_IGNORED_DIRS.contains(c) {
            return true;
        }
    }
    false
}

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

/// One `.dart` change event, tagged with the watch id that produced it so the UI
/// reacts only to its own watcher (two transient watchers must not cross-fire).
#[derive(Clone, serde::Serialize)]
struct FsChange {
    id: u32,
    path: String,
}

/// Start watching `path` recursively; emits `fs-changed` ({ id, path }) for
/// each relevant write. `mode` selects the filter: `"dart"` (default, when
/// omitted — every pre-#333 caller) matches only `.dart` writes outside
/// generated/VCS dirs; `"git"` (#333) matches any write outside `.git`
/// internals (besides `HEAD`/`index`) and common generated/dependency dirs —
/// see [`git_watch_ignored`]. Returns a watch id to pass to [`fs_watch_stop`].
#[tauri::command]
pub fn fs_watch_start(
    app: AppHandle,
    manager: State<'_, WatchManager>,
    path: String,
    mode: Option<String>,
) -> Result<u32, String> {
    // Allocate the id up front so the watcher closure can tag every event with
    // it — the UI filters on this id so a racing watcher can't cross-fire.
    let id = manager.next_id.fetch_add(1, Ordering::Relaxed);
    let watch_mode = WatchMode::from_param(mode.as_deref());
    let app = app.clone();
    let root = PathBuf::from(&path);
    let watch_root = root.clone(); // `root` is moved into the closure below
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
            // Check only the path RELATIVE to the watched root, so an ancestor
            // dir named build/.git/etc. (e.g. a checkout under
            // /home/me/build/app) doesn't suppress real writes inside it.
            let rel = p.strip_prefix(&root).unwrap_or(p);
            match watch_mode {
                WatchMode::Dart => {
                    if p.extension().and_then(|e| e.to_str()) != Some("dart") {
                        continue;
                    }
                    // Skip generated / VCS dirs — Flutter rewrites .dart_tool on
                    // every reload, which would otherwise loop.
                    if rel.components().any(|c| {
                        matches!(
                            c.as_os_str().to_str(),
                            Some(".dart_tool") | Some("build") | Some(".git") | Some(".pickforge")
                        )
                    }) {
                        continue;
                    }
                }
                WatchMode::Git => {
                    if git_watch_ignored(rel) {
                        continue;
                    }
                }
            }
            let _ = app.emit(
                "fs-changed",
                FsChange { id, path: p.to_string_lossy().to_string() },
            );
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&watch_root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_watch_allows_ordinary_source_writes() {
        assert!(!git_watch_ignored(Path::new("src/lib.rs")));
        assert!(!git_watch_ignored(Path::new("nested/dir/file.txt")));
    }

    #[test]
    fn git_watch_allows_top_level_head_and_index() {
        assert!(!git_watch_ignored(Path::new(".git/HEAD")));
        assert!(!git_watch_ignored(Path::new(".git/index")));
    }

    #[test]
    fn git_watch_ignores_git_internals_other_than_head_index() {
        assert!(git_watch_ignored(Path::new(".git/refs/heads/main")));
        assert!(git_watch_ignored(Path::new(".git/logs/HEAD")));
        assert!(git_watch_ignored(Path::new(".git/objects/ab/cdef")));
        assert!(git_watch_ignored(Path::new(".git/index.lock")));
    }

    #[test]
    fn git_watch_ignores_nested_git_dir_regardless_of_position() {
        // A monorepo sub-repo's own `.git/` under a watched parent root.
        assert!(git_watch_ignored(Path::new("packages/app/.git/refs/heads/main")));
        assert!(!git_watch_ignored(Path::new("packages/app/.git/HEAD")));
    }

    #[test]
    fn git_watch_ignores_generated_and_dependency_dirs() {
        assert!(git_watch_ignored(Path::new("node_modules/pkg/index.js")));
        assert!(git_watch_ignored(Path::new("target/debug/build")));
        assert!(git_watch_ignored(Path::new("apps/web/dist/main.js")));
        assert!(git_watch_ignored(Path::new(".pickforge/state.json")));
    }

    #[test]
    fn watch_mode_from_param_defaults_to_dart() {
        assert!(WatchMode::from_param(None) == WatchMode::Dart);
        assert!(WatchMode::from_param(Some("bogus")) == WatchMode::Dart);
        assert!(WatchMode::from_param(Some("git")) == WatchMode::Git);
    }
}
