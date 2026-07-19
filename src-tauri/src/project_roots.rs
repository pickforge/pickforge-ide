//! The single owner of the seam between persisted Project state and the
//! canonical set of filesystem roots the renderer may browse/read/open.
//!
//! Before this module existed, "which project roots are approved" was spread
//! across three uncoordinated mutation paths: a startup seed, a per-list
//! add-only registration (never removed a root another process had deleted),
//! and a manual clear-and-rebuild callers had to remember to invoke after
//! archive/delete, in a specific order relative to the native picker. That let
//! a root deleted out from under the running process survive in the registry
//! indefinitely, and made every caller responsible for sequencing its own
//! mutation correctly.
//!
//! [`ApprovedRoots::reconcile`] is now the one seam: Project-state transition
//! in, authoritative path facts out. It fully recomputes the canonical active
//! root set from the DB's live active-Project rows every time it's called —
//! by startup, by every `projects_list` refresh (which is how a root added or
//! removed by another process is picked up), and by every command that
//! mutates Project state (add, archive, reactivate, delete, remote bind/
//! unbind). The database, the native picker, and startup are the adapters
//! that call into this authority; none of them mutate the registry directly
//! anymore.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use pickforge_core::{pickforge_home, Database, Project};

/// The adapter this module reads Project state through. `Database` is the
/// production adapter (below); tests substitute a source that always fails to
/// exercise "startup DB error" and "failed reconciliation" without needing a
/// way to break a real `Database` from outside `pickforge-core`.
trait ProjectSource {
    fn active_projects(&self) -> Result<Vec<Project>, String>;
}

impl ProjectSource for Database {
    fn active_projects(&self) -> Result<Vec<Project>, String> {
        self.list_projects(false).map_err(|e| e.to_string())
    }
}

#[derive(Default)]
struct State {
    /// The PickForge home (`~/.pickforge`) — not part of the Project
    /// projection, so it's kept independent of DB health: a `reconcile` that
    /// fails to read Projects must not also take the home root down with it.
    home: Option<PathBuf>,
    /// The reconciled set of active, local project roots. Fully replaced on
    /// every successful [`ApprovedRoots::reconcile`], never merely added to —
    /// that's what lets a removal (by this process or another) take effect.
    projects: HashSet<PathBuf>,
    /// A directory just vetted by the native picker but not yet persisted as
    /// a Project row. Kept separate from `projects` so it survives an
    /// unrelated `reconcile` running concurrently between the pick and the
    /// follow-up `project_upsert` — callers no longer need to sequence pick
    /// before upsert to avoid a race.
    pending_pick: Option<PathBuf>,
}

/// Canonicalized directories a renderer is allowed to browse / read / open:
/// the PickForge home plus every active, local project root, kept in sync via
/// [`ApprovedRoots::reconcile`].
#[derive(Default)]
pub struct ApprovedRoots(Mutex<State>);

impl ApprovedRoots {
    fn with_state<T>(&self, f: impl FnOnce(&mut State) -> T) -> Option<T> {
        self.0.lock().ok().map(|mut state| f(&mut state))
    }

    /// Recompute the canonical active-root set from the DB's authoritative
    /// Project rows: the PickForge home, plus every active (non-archived),
    /// LOCAL (non-remote-bound — see [`compute_active_project_roots`]) project
    /// root that still canonicalizes and isn't too broad to approve. This
    /// fully REPLACES the previous project-root set, so a root removed by any
    /// process sharing the DB drops out of the registry the next time any
    /// caller reconciles — startup, a `projects_list` refresh, or this
    /// process's own add/archive/delete/reactivate/remote-bind.
    ///
    /// The home root is (re)seeded first, independent of the DB read below, so
    /// a startup DB error still leaves the PickForge home usable. On a DB read
    /// failure the previous project-root set is left untouched — reconciling
    /// fails closed, neither broadened nor narrowed by an error — and the
    /// error is returned for the caller to log.
    pub fn reconcile(&self, db: &Database) -> Result<(), String> {
        self.reconcile_from(db)
    }

    fn reconcile_from(&self, source: &impl ProjectSource) -> Result<(), String> {
        self.ensure_home_root();
        let projects = source.active_projects()?;
        let next = compute_active_project_roots(&projects);
        self.with_state(|state| state.projects = next)
            .ok_or_else(|| "approved-root registry poisoned".to_string())
    }

    fn ensure_home_root(&self) {
        let Ok(home) = pickforge_home(None) else { return };
        // Create home if missing so it canonicalizes — the inspector writes here.
        let _ = std::fs::create_dir_all(&home);
        let Ok(canon) = std::fs::canonicalize(&home) else { return };
        self.with_state(|state| state.home = Some(canon));
    }

    /// Approve `dir` directly (canonicalizing it), independent of
    /// `reconcile`. Used by tests to seed a fixture project root without a
    /// `Database` — no production Project-transition path calls this anymore;
    /// they all go through `reconcile`.
    #[cfg(test)]
    pub fn insert(&self, dir: &Path) {
        self.with_state(|state| insert_canonical(&mut state.projects, dir));
    }

    /// Canonicalize `dir`, reject a too-broad pick (`/`, a drive root, the
    /// home directory), and record it as the single pending pick. Used by the
    /// user-mediated `pick_project_dir`: the renderer persists the returned
    /// canonical path as the DB `project_root`, and a later
    /// `ensure_root_approved`/`approved_canonical` check against the pending
    /// pick passes — even if an unrelated `reconcile` runs in between, since
    /// `reconcile` never touches `pending_pick`. Returns the canonical path.
    pub fn note_picked(&self, dir: &Path) -> Result<PathBuf, String> {
        let canon = std::fs::canonicalize(dir).map_err(|e| e.to_string())?;
        if is_too_broad_to_approve(&canon) {
            return Err("the picked directory is too broad to be a project root".into());
        }
        self.with_state(|state| state.pending_pick = Some(canon.clone()))
            .ok_or_else(|| "approved-root registry poisoned".to_string())?;
        Ok(canon)
    }

    /// True when `canon` (an already-canonicalized path) is itself an
    /// approved root — i.e. a directory that was reconciled or picked, not
    /// merely a child of one. Used by the `project_upsert` gate so only a
    /// pick-vetted or already-active root passes.
    pub fn is_approved_root(&self, canon: &Path) -> bool {
        self.with_state(|state| {
            state.home.as_deref() == Some(canon)
                || state.projects.contains(canon)
                || state.pending_pick.as_deref() == Some(canon)
        })
        .unwrap_or(false)
    }

    /// True when `canon` (an already-canonicalized path) is one of, or sits
    /// under, an approved root.
    pub fn contains(&self, canon: &Path) -> bool {
        self.with_state(|state| {
            state.home.as_deref().is_some_and(|home| canon.starts_with(home))
                || state.projects.iter().any(|root| canon.starts_with(root))
                || state
                    .pending_pick
                    .as_deref()
                    .is_some_and(|pending| canon.starts_with(pending))
        })
        .unwrap_or(false)
    }
}

/// Filter+canonicalize the DB's active Project rows into the set of roots
/// that may become a local filesystem authority. A remote-bound project's
/// local mirror is never that authority — once a project is bound to a
/// remote host, the remote machine is the source of truth for its files (see
/// `docs/architecture/remote-host-mode.md`), so its `project_root` is
/// excluded here even while the row itself stays active. A root that can't be
/// canonicalized (missing, or not yet created) or is too broad (`/`, a drive
/// root, the home directory) is skipped, same as a startup-seeded root always
/// was.
fn compute_active_project_roots(projects: &[Project]) -> HashSet<PathBuf> {
    let mut set = HashSet::new();
    for p in projects {
        if p.remote_host.is_some() {
            continue;
        }
        insert_canonical(&mut set, Path::new(&p.project_root));
    }
    set
}

fn insert_canonical(set: &mut HashSet<PathBuf>, dir: &Path) {
    if let Ok(canon) = std::fs::canonicalize(dir) {
        if !is_too_broad_to_approve(&canon) {
            set.insert(canon);
        }
    }
}

/// Reject a path that is too broad to ever be a project root: a filesystem
/// root (`/`, a Windows drive root like `C:\`) or the user's home directory
/// itself. `dir` is expected to be canonicalized already.
fn is_too_broad_to_approve(dir: &Path) -> bool {
    if dir.parent().is_none() {
        // A filesystem root has no parent (`/`, `C:\`).
        return true;
    }
    if let Some(home) = user_home_dir() {
        if let Ok(canon_home) = std::fs::canonicalize(&home) {
            if dir == canon_home {
                return true;
            }
        }
    }
    false
}

/// The user's OS home directory (`$HOME`, or `%USERPROFILE%`/`%HOMEDRIVE%%HOMEPATH%`
/// on Windows) — distinct from the PickForge home (`~/.pickforge`), which is an
/// approved root. Used only to reject approving the home directory itself.
fn user_home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            if !profile.trim().is_empty() {
                return Some(PathBuf::from(profile));
            }
        }
        let drive = std::env::var("HOMEDRIVE").unwrap_or_default();
        let path = std::env::var("HOMEPATH").unwrap_or_default();
        if !drive.is_empty() && !path.is_empty() {
            return Some(PathBuf::from(format!("{drive}{path}")));
        }
        None
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
    }
}

/// Confirm `project_root` is an already-approved root before it is persisted.
/// `project_upsert` calls this so the DB can never gain a root that wasn't
/// vetted through the user-mediated `pick_project_dir`: a renderer can't
/// `project_upsert({project_root: "<any dir>"})` and have a later reconcile
/// allowlist it. The root canonicalizes to the same value `pick_project_dir`
/// registered, so a legitimate add (whose root was just picked) passes, while
/// an unvetted root — one not in the registry, or one that doesn't even
/// resolve — is rejected.
pub fn ensure_root_approved(roots: &ApprovedRoots, project_root: &str) -> Result<(), String> {
    let canon = std::fs::canonicalize(project_root)
        .map_err(|_| "project root is not an approved directory".to_string())?;
    if !roots.is_approved_root(&canon) {
        return Err("project root is not an approved directory".into());
    }
    Ok(())
}

/// Canonicalize `path` and confirm it resolves under an approved root. Returns
/// the canonical path so callers read the resolved (symlink-free) location.
/// Canonicalization collapses `..` and follows symlinks, so neither traversal
/// nor a symlinked escape can leave the approved area.
pub fn approved_canonical(path: &str, roots: &ApprovedRoots) -> Result<PathBuf, String> {
    let canon = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !roots.contains(&canon) {
        return Err("path is outside an approved project root".into());
    }
    Ok(canon)
}

/// Reconcile the registry with the DB's live active-Project set, logging
/// (rather than failing the caller) on error. Called by every Tauri command
/// that mutates Project state, so the registry stays in sync with the DB
/// immediately rather than waiting for the next unrelated `projects_list`
/// refresh — the command that changed Project state already succeeded by the
/// time this runs, so a reconcile failure here is observability, not a reason
/// to fail that command.
pub fn reconcile_or_log(roots: &ApprovedRoots, db: &Database) {
    if let Err(err) = roots.reconcile(db) {
        eprintln!("failed to reconcile approved project roots: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pf-projroot-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(&dir).unwrap()
    }

    fn project(root: &Path, name: &str, archived: Option<i64>) -> Project {
        Project {
            project_root: root.to_string_lossy().into_owned(),
            display_name: name.to_string(),
            created_at: 0,
            last_opened_at: 0,
            sort_order: 0,
            archived_at: archived,
            remote_host: None,
            remote_root: None,
        }
    }

    fn remote_project(root: &Path, name: &str) -> Project {
        Project {
            remote_host: Some("mac-mini".to_string()),
            remote_root: Some("/Users/dev/app".to_string()),
            ..project(root, name, None)
        }
    }

    struct FailingSource;
    impl ProjectSource for FailingSource {
        fn active_projects(&self) -> Result<Vec<Project>, String> {
            Err("db unavailable".into())
        }
    }

    struct FixedSource(Vec<Project>);
    impl ProjectSource for FixedSource {
        fn active_projects(&self) -> Result<Vec<Project>, String> {
            Ok(self.0.clone())
        }
    }

    // ---- reconcile: add + remove in one pass (the core fix) ----

    #[test]
    fn reconcile_approves_active_roots_and_drops_ones_no_longer_active() {
        let keep = make_dir("keep");
        let gone = make_dir("gone");
        let roots = ApprovedRoots::default();
        roots
            .reconcile_from(&FixedSource(vec![
                project(&keep, "keep", None),
                project(&gone, "gone", None),
            ]))
            .unwrap();
        assert!(roots.is_approved_root(&keep));
        assert!(roots.is_approved_root(&gone));

        // The next reconcile reflects "gone" no longer being in the active
        // set — e.g. another process deleted it — without any explicit
        // removal call.
        roots
            .reconcile_from(&FixedSource(vec![project(&keep, "keep", None)]))
            .unwrap();
        assert!(roots.is_approved_root(&keep));
        assert!(
            !roots.is_approved_root(&gone),
            "a root no longer in the active set must drop out on reconcile",
        );
    }

    #[test]
    fn reconcile_readmits_a_reactivated_root() {
        let root = make_dir("reactivate");
        let roots = ApprovedRoots::default();
        roots
            .reconcile_from(&FixedSource(vec![project(&root, "p", None)]))
            .unwrap();
        assert!(roots.is_approved_root(&root));

        // Archived: `list_projects(false)` would no longer return it.
        roots.reconcile_from(&FixedSource(vec![])).unwrap();
        assert!(!roots.is_approved_root(&root));

        // Reactivated: back in the active set.
        roots
            .reconcile_from(&FixedSource(vec![project(&root, "p", None)]))
            .unwrap();
        assert!(roots.is_approved_root(&root), "a reactivated root must be re-approved");
    }

    // ---- remote projects never gain local authority ----

    #[test]
    fn reconcile_excludes_a_remote_bound_project_root() {
        let root = make_dir("remote");
        let roots = ApprovedRoots::default();
        roots
            .reconcile_from(&FixedSource(vec![remote_project(&root, "remote")]))
            .unwrap();
        assert!(
            !roots.is_approved_root(&root),
            "a remote-bound project's local root must not become a local filesystem authority",
        );
    }

    #[test]
    fn reconcile_readmits_a_root_once_its_remote_binding_is_cleared() {
        let root = make_dir("unbind");
        let roots = ApprovedRoots::default();
        roots
            .reconcile_from(&FixedSource(vec![remote_project(&root, "p")]))
            .unwrap();
        assert!(!roots.is_approved_root(&root));

        roots
            .reconcile_from(&FixedSource(vec![project(&root, "p", None)]))
            .unwrap();
        assert!(roots.is_approved_root(&root), "clearing a remote binding must restore local authority");
    }

    // ---- failed reconciliation: fail closed ----

    #[test]
    fn reconcile_leaves_the_prior_set_untouched_on_a_db_error() {
        let keep = make_dir("failsafe-keep");
        let roots = ApprovedRoots::default();
        roots
            .reconcile_from(&FixedSource(vec![project(&keep, "keep", None)]))
            .unwrap();
        assert!(roots.is_approved_root(&keep));

        let err = roots.reconcile_from(&FailingSource).unwrap_err();
        assert!(err.contains("db unavailable"));
        assert!(
            roots.is_approved_root(&keep),
            "a reconcile failure must not narrow the registry",
        );
    }

    #[test]
    fn reconcile_seeds_the_home_root_even_when_the_db_read_fails() {
        let roots = ApprovedRoots::default();
        let err = roots.reconcile_from(&FailingSource);
        assert!(err.is_err());
        let home = std::fs::canonicalize(pickforge_home(None).unwrap()).unwrap();
        assert!(
            roots.is_approved_root(&home),
            "the PickForge home must stay approved independent of Project-read health",
        );
    }

    // ---- absent / overly broad roots ----

    #[test]
    fn reconcile_skips_a_project_root_that_no_longer_exists_on_disk() {
        let missing = std::env::temp_dir().join(format!(
            "pf-projroot-missing-{}-does-not-exist",
            std::process::id()
        ));
        let roots = ApprovedRoots::default();
        roots
            .reconcile_from(&FixedSource(vec![project(&missing, "gone", None)]))
            .unwrap();
        assert!(!roots.is_approved_root(&missing));
    }

    #[test]
    fn reconcile_skips_a_filesystem_root_even_if_a_row_names_it() {
        let fs_root = if cfg!(windows) { "C:\\" } else { "/" };
        let roots = ApprovedRoots::default();
        roots
            .reconcile_from(&FixedSource(vec![project(
                Path::new(fs_root),
                "root",
                None,
            )]))
            .unwrap();
        let probe = make_dir("broad-probe").join("anything.txt");
        std::fs::write(&probe, b"x").unwrap();
        assert!(
            approved_canonical(&probe.to_string_lossy(), &roots).is_err(),
            "approving a filesystem root must not allowlist the whole disk",
        );
    }

    // ---- symlink aliases dedupe to one canonical root ----

    #[cfg(unix)]
    #[test]
    fn reconcile_dedupes_a_symlink_alias_of_an_active_root() {
        use std::os::unix::fs::symlink;
        let real = make_dir("symlink-real");
        let alias = std::env::temp_dir().join(format!("pf-projroot-alias-{}", std::process::id()));
        let _ = std::fs::remove_file(&alias);
        symlink(&real, &alias).unwrap();
        let roots = ApprovedRoots::default();
        roots
            .reconcile_from(&FixedSource(vec![
                project(&real, "real", None),
                project(&alias, "alias", None),
            ]))
            .unwrap();
        assert!(roots.is_approved_root(&real));
        let _ = std::fs::remove_file(&alias);
    }

    // ---- pending pick survives an unrelated concurrent reconcile ----

    #[test]
    fn pending_pick_is_not_cleared_by_an_unrelated_reconcile() {
        let picked = make_dir("pending");
        let roots = ApprovedRoots::default();
        let canon = roots.note_picked(&picked).expect("pick registers");

        // A `projects_list` refresh happening between the pick and the
        // renderer's follow-up `project_upsert` must not reject the pick.
        roots.reconcile_from(&FixedSource(vec![])).unwrap();
        assert!(
            roots.is_approved_root(&canon),
            "an unrelated reconcile must not clear a pending pick",
        );
    }

    #[test]
    fn pending_pick_rejects_a_filesystem_root() {
        let roots = ApprovedRoots::default();
        let fs_root = if cfg!(windows) { "C:\\" } else { "/" };
        assert!(roots.note_picked(Path::new(fs_root)).is_err());
    }

    #[test]
    fn pending_pick_rejects_the_home_directory() {
        let Some(home) = user_home_dir() else { return };
        if std::fs::canonicalize(&home).is_err() {
            return;
        }
        let roots = ApprovedRoots::default();
        assert!(roots.note_picked(&home).is_err());
    }

    #[test]
    fn pending_pick_grants_containment_for_a_nested_read() {
        let picked = make_dir("pending-nested");
        let roots = ApprovedRoots::default();
        roots.note_picked(&picked).unwrap();
        let file = picked.join("pubspec.yaml");
        std::fs::write(&file, b"name: app").unwrap();
        assert!(approved_canonical(&file.to_string_lossy(), &roots).is_ok());
    }

    // ---- ensure_root_approved / approved_canonical gates ----

    #[test]
    fn upsert_gate_rejects_an_unvetted_root() {
        let roots = ApprovedRoots::default();
        let unvetted = make_dir("unvetted");
        assert!(ensure_root_approved(&roots, &unvetted.to_string_lossy()).is_err());
    }

    #[test]
    fn upsert_gate_accepts_a_pick_vetted_root() {
        let roots = ApprovedRoots::default();
        let picked = make_dir("picked");
        let canon = roots.note_picked(&picked).unwrap();
        assert!(ensure_root_approved(&roots, &canon.to_string_lossy()).is_ok());
    }

    #[test]
    fn upsert_gate_rejects_a_nonexistent_root() {
        let roots = ApprovedRoots::default();
        let missing = std::env::temp_dir()
            .join(format!("pf-projroot-missing2-{}", std::process::id()));
        assert!(ensure_root_approved(&roots, &missing.to_string_lossy()).is_err());
    }

    #[test]
    fn approved_canonical_rejects_dotdot_traversal_out_of_an_approved_root() {
        let roots = ApprovedRoots::default();
        let root = make_dir("traversal");
        roots.insert(&root);
        let secret =
            std::env::temp_dir().join(format!("pf-projroot-secret-{}.txt", std::process::id()));
        std::fs::write(&secret, b"top secret").unwrap();
        let sneaky = root
            .join("..")
            .join("..")
            .join("..")
            .join(secret.file_name().unwrap());
        assert!(approved_canonical(&sneaky.to_string_lossy(), &roots).is_err());
        let _ = std::fs::remove_file(&secret);
    }

    // ---- remote bind/unbind via the real DB API (mirrors `remote_commands`) ----

    #[test]
    fn reconcile_after_projects_set_remote_drops_local_authority() {
        let db = Database::open_in_memory().expect("in-memory db");
        let root = make_dir("remote-set");
        db.upsert_project(&project(&root, "p", None)).unwrap();

        let roots = ApprovedRoots::default();
        roots.reconcile(&db).unwrap();
        assert!(roots.is_approved_root(&root));

        db.projects_set_remote(&root.to_string_lossy(), "mac-mini", "/Users/dev/app")
            .unwrap();
        roots.reconcile(&db).unwrap();
        assert!(
            !roots.is_approved_root(&root),
            "binding a project to a remote host must drop its local root's authority",
        );

        db.projects_clear_remote(&root.to_string_lossy()).unwrap();
        roots.reconcile(&db).unwrap();
        assert!(
            roots.is_approved_root(&root),
            "clearing the remote binding must restore local authority",
        );
    }

    // ---- multi-process add/remove observed via reconcile ----

    #[test]
    fn reconcile_observes_a_cross_process_delete_using_a_real_database() {
        let db = Database::open_in_memory().expect("in-memory db");
        let keep = make_dir("mp-keep");
        let gone = make_dir("mp-gone");
        db.upsert_project(&project(&keep, "keep", None)).unwrap();
        db.upsert_project(&project(&gone, "gone", None)).unwrap();

        let roots = ApprovedRoots::default();
        roots.reconcile(&db).unwrap();
        assert!(roots.is_approved_root(&keep));
        assert!(roots.is_approved_root(&gone));

        // Simulate another process deleting the project.
        db.delete_project(&gone.to_string_lossy()).unwrap();
        roots.reconcile(&db).unwrap();
        assert!(roots.is_approved_root(&keep));
        assert!(
            !roots.is_approved_root(&gone),
            "a root deleted by another process must drop out after reconcile",
        );
    }
}
