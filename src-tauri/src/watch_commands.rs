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

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, State};

/// Which caller a watcher was started for, and therefore which path filter
/// applies. `Dart` is the default when `mode` is omitted (every pre-#333
/// caller). Any OTHER string is rejected outright (#333 review P3) — a typo'd
/// or forward-incompatible mode value must never silently degrade to the
/// wrong filter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WatchMode {
    Dart,
    Git,
}

impl WatchMode {
    fn from_param(mode: Option<&str>) -> Result<Self, String> {
        match mode {
            None | Some("dart") => Ok(WatchMode::Dart),
            Some("git") => Ok(WatchMode::Git),
            Some(other) => Err(format!("invalid watch mode: {other:?}")),
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

/// Resolves `repo_root`'s real git-state directory — the equivalent of
/// `git rev-parse --git-path HEAD`/`--git-path index`'s parent, without
/// shelling out. For an ordinary repo this is just `<repo_root>/.git` (a
/// directory). For a LINKED WORKTREE (`git worktree add`, including this very
/// checkout: its `.git` is a plain text FILE reading `gitdir: <path>`), `HEAD`
/// and `index` instead live in a per-worktree private dir under the MAIN
/// repo's `.git/worktrees/<name>/` — often entirely outside `repo_root`'s own
/// directory tree, so a recursive watch of `repo_root` alone never observes
/// writes there (#333 review P2: `git add`/`reset`/`commit` in a linked
/// worktree touch only that dir, never anything under `repo_root`). Returns
/// `None` if `.git` doesn't exist or the pointer file can't be read/parsed.
fn resolve_git_state_dir(repo_root: &Path) -> Option<PathBuf> {
    let dot_git = repo_root.join(".git");
    let meta = std::fs::symlink_metadata(&dot_git).ok()?;
    if meta.is_dir() {
        return Some(dot_git);
    }
    if !meta.is_file() {
        return None;
    }
    let contents = std::fs::read_to_string(&dot_git).ok()?;
    let gitdir = contents.lines().find_map(|line| line.strip_prefix("gitdir:"))?.trim();
    if gitdir.is_empty() {
        return None;
    }
    let resolved = if Path::new(gitdir).is_absolute() {
        PathBuf::from(gitdir)
    } else {
        repo_root.join(gitdir)
    };
    // Best-effort canonicalize (resolves a relative `../` pointer to its real
    // absolute form); fall back to the joined-but-uncanonicalized path if the
    // target doesn't exist yet or canonicalization otherwise fails; the
    // caller's own watch/comparison still works against either form.
    Some(std::fs::canonicalize(&resolved).unwrap_or(resolved))
}

/// The `HEAD`/`index` paths a "git" watch must always let through, resolved
/// across `root` and every discovered sub-repo beneath it (a monorepo's
/// `app/`, `api/`, … each get their own worktree resolution) — see
/// [`resolve_git_state_dir`]. Also returns the DISTINCT state dirs
/// themselves, so the caller can add an explicit non-recursive watch on each
/// one that isn't already inside `root`'s own recursively-watched tree (a
/// linked worktree's private gitdir lives under the MAIN repo's checkout,
/// wholly outside `root`).
fn git_head_index_watch_targets(root: &Path) -> (HashSet<PathBuf>, Vec<PathBuf>) {
    let root_str = root.to_string_lossy().into_owned();
    let mut state_dirs: Vec<PathBuf> = pickforge_core::git::discover_repos(&root_str)
        .into_iter()
        .filter_map(|repo_root| resolve_git_state_dir(Path::new(&repo_root)))
        .collect();
    state_dirs.sort();
    state_dirs.dedup();

    let mut head_index_paths = HashSet::new();
    for dir in &state_dirs {
        head_index_paths.insert(dir.join("HEAD"));
        head_index_paths.insert(dir.join("index"));
    }
    let extra_watch_dirs = state_dirs.into_iter().filter(|dir| !dir.starts_with(root)).collect();
    (head_index_paths, extra_watch_dirs)
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
    let watch_mode = WatchMode::from_param(mode.as_deref())?;
    let app = app.clone();
    let root = PathBuf::from(&path);
    let watch_root = root.clone(); // `root` is moved into the closure below

    // #333 review P2: resolved BEFORE the watcher is created, so the extra
    // dirs below can be added to the same watcher instance right after —
    // `git`-mode only (the Dart caller's `.git` handling is unaffected and
    // doesn't need a linked worktree's private gitdir).
    let (head_index_paths, extra_watch_dirs) = if watch_mode == WatchMode::Git {
        git_head_index_watch_targets(&root)
    } else {
        (HashSet::new(), Vec::new())
    };

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
                    // A linked worktree's `HEAD`/`index` live OUTSIDE `root`
                    // entirely (see `resolve_git_state_dir`) — `rel`'s
                    // component-based ignore check can't recognize them
                    // (there's no `.git` component directly preceding them),
                    // so they're allowed through by exact path match first.
                    if !head_index_paths.contains(p) && git_watch_ignored(rel) {
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
    for dir in &extra_watch_dirs {
        // Best-effort: a repo whose resolved gitdir has since vanished (e.g. a
        // worktree removed mid-scan) just doesn't get this extra watch — the
        // recursive watch on `root` and the generic filter still apply.
        let _ = watcher.watch(dir, RecursiveMode::NonRecursive);
    }

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
    fn watch_mode_from_param_defaults_to_dart_and_accepts_git() {
        assert!(WatchMode::from_param(None) == Ok(WatchMode::Dart));
        assert!(WatchMode::from_param(Some("dart")) == Ok(WatchMode::Dart));
        assert!(WatchMode::from_param(Some("git")) == Ok(WatchMode::Git));
    }

    #[test]
    fn watch_mode_from_param_rejects_an_unknown_mode() {
        // #333 review P3: a typo'd/unknown mode must be rejected outright, not
        // silently degrade to Dart (that previously locked in "bogus" -> Dart).
        assert_eq!(
            WatchMode::from_param(Some("bogus")),
            Err("invalid watch mode: \"bogus\"".to_string()),
        );
    }

    // ---- resolve_git_state_dir / git_head_index_watch_targets: linked worktrees ----

    use std::process::Command;
    use std::sync::mpsc;
    use std::time::Duration;

    fn run_git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(dir)
            .status()
            .expect("git available for tests");
        assert!(status.success(), "git {args:?} failed");
    }

    fn init_repo(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pf-watch-{}-{tag}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        run_git(&dir, &["init", "-q"]);
        run_git(&dir, &["config", "user.email", "test@pickforge.dev"]);
        run_git(&dir, &["config", "user.name", "PickForge Test"]);
        std::fs::write(dir.join("README.md"), "hello\n").unwrap();
        run_git(&dir, &["add", "-A"]);
        run_git(&dir, &["commit", "-q", "-m", "initial"]);
        std::fs::canonicalize(&dir).unwrap()
    }

    /// Adds a LINKED worktree (`git worktree add`) at a fresh temp path,
    /// checked out on a new branch — the case #333 review P2 flagged: this
    /// worktree's own `.git` is a plain FILE (`gitdir: <path>`), not a
    /// directory, pointing at a private dir under the MAIN repo's
    /// `.git/worktrees/<name>/`.
    fn add_worktree(main_repo: &Path, tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pf-watch-worktree-{}-{tag}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        run_git(
            main_repo,
            &["worktree", "add", "-q", "-b", &format!("wt-{tag}"), dir.to_str().unwrap()],
        );
        std::fs::canonicalize(&dir).unwrap()
    }

    #[test]
    fn resolve_git_state_dir_is_the_dot_git_dir_for_a_normal_repo() {
        let repo = init_repo("normal");
        assert_eq!(resolve_git_state_dir(&repo), Some(repo.join(".git")));
        let _ = std::fs::remove_dir_all(&repo);
    }

    #[test]
    fn resolve_git_state_dir_resolves_a_linked_worktrees_private_gitdir() {
        let main_repo = init_repo("main-for-resolve");
        let worktree = add_worktree(&main_repo, "resolve");

        // The worktree's own `.git` is a FILE, not a directory — the case the
        // prior (pre-#333-review) watcher silently mishandled.
        assert!(worktree.join(".git").is_file());

        let state_dir = resolve_git_state_dir(&worktree).expect("resolves a state dir");
        assert!(state_dir.join("HEAD").is_file(), "resolved dir has its own HEAD");
        assert!(
            !state_dir.starts_with(&worktree),
            "the private gitdir lives outside the worktree's own tree, under the main repo's .git/worktrees/",
        );

        let _ = std::fs::remove_dir_all(&main_repo);
        let _ = std::fs::remove_dir_all(&worktree);
    }

    #[test]
    fn git_head_index_watch_targets_covers_a_linked_worktree_outside_root() {
        let main_repo = init_repo("main-for-targets");
        let worktree = add_worktree(&main_repo, "targets");

        let (head_index_paths, extra_watch_dirs) = git_head_index_watch_targets(&worktree);
        let state_dir = resolve_git_state_dir(&worktree).expect("resolves a state dir");
        assert!(head_index_paths.contains(&state_dir.join("HEAD")));
        assert!(head_index_paths.contains(&state_dir.join("index")));
        assert!(
            extra_watch_dirs.contains(&state_dir),
            "the resolved private gitdir (outside `root`) must get its own explicit watch",
        );

        let _ = std::fs::remove_dir_all(&main_repo);
        let _ = std::fs::remove_dir_all(&worktree);
    }

    /// #333 review P2's requested regression test: `git worktree add`, then an
    /// operation that mutates ONLY the worktree's private index (never a file
    /// under the worktree's own directory) — `git rm --cached` unstages a
    /// tracked file without touching its on-disk bytes. Reproduces the exact
    /// prior bug end to end (real `notify` watcher + real git), independent of
    /// Tauri's `AppHandle`/`emit` plumbing: builds the SAME watch-target set
    /// `fs_watch_start` would (recursive on `root` + non-recursive on each
    /// resolved extra gitdir) and the SAME allow/ignore decision per event,
    /// just sending matched paths into a channel instead of emitting them.
    #[test]
    fn git_watch_observes_an_index_only_mutation_in_a_linked_worktree() {
        let main_repo = init_repo("main-for-index-mutation");
        let worktree = add_worktree(&main_repo, "index-mutation");

        let (head_index_paths, extra_watch_dirs) = git_head_index_watch_targets(&worktree);
        assert!(!extra_watch_dirs.is_empty(), "a linked worktree must get an extra watch dir");

        let (tx, rx) = mpsc::channel::<PathBuf>();
        let root = worktree.clone();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            if !matches!(
                event.kind,
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
            ) {
                return;
            }
            for p in &event.paths {
                let rel = p.strip_prefix(&root).unwrap_or(p);
                if head_index_paths.contains(p) || !git_watch_ignored(rel) {
                    let _ = tx.send(p.clone());
                }
            }
        })
        .expect("recommended_watcher");
        watcher
            .watch(&worktree, RecursiveMode::Recursive)
            .expect("watch worktree root");
        for dir in &extra_watch_dirs {
            watcher.watch(dir, RecursiveMode::NonRecursive).expect("watch extra gitdir");
        }

        // Give the watcher backend a moment to actually start observing
        // before the mutation, same allowance other notify-backed setups need.
        std::thread::sleep(Duration::from_millis(300));

        // Index-only mutation: unstages README.md without touching its
        // on-disk content — no event under `worktree` itself should be
        // required for this to be observed; only the private gitdir's
        // `index` file changes.
        run_git(&worktree, &["rm", "--cached", "-q", "README.md"]);

        let saw_index_event = {
            let deadline = std::time::Instant::now() + Duration::from_secs(10);
            let mut seen = false;
            while std::time::Instant::now() < deadline {
                let remaining = deadline.saturating_duration_since(std::time::Instant::now());
                match rx.recv_timeout(remaining.min(Duration::from_millis(500))) {
                    Ok(path) if path.file_name().and_then(|n| n.to_str()) == Some("index") => {
                        seen = true;
                        break;
                    }
                    Ok(_) => continue,
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
            seen
        };
        assert!(saw_index_event, "expected an fs-changed-equivalent event for the worktree's private index file");

        drop(watcher);
        let _ = std::fs::remove_dir_all(&main_repo);
        let _ = std::fs::remove_dir_all(&worktree);
    }
}
