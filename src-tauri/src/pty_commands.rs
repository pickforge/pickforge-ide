//! Tauri command layer adapting `pickforge_core::PtyManager` to IPC.
//!
//! stdout streams over a per-session [`Channel<Response>`] — `Response` carries
//! the bytes as a raw IPC body (an ArrayBuffer on the JS side), avoiding the
//! JSON `number[]` bloat a `Channel<Vec<u8>>` would incur. Exit is a separate
//! small JSON channel. Input/resize/kill are request/response `invoke`s.
//!
//! Session ownership: `pty_write`/`pty_resize`/`pty_kill` are keyed by the
//! numeric session id and guarded by the `PtyManager` registry — an id with no
//! live session returns `PtyError::NotFound`, so none of them can act on an
//! unknown or already-dead session. The ids are a monotonic counter (1, 2, …),
//! so they're enumerable, but there is no foreign-session boundary to cross: the
//! app has a single trusted `main` webview (capabilities scope `["main"]`), so
//! every session belongs to that one renderer and the registry guard suffices.
//! If a second, less-trusted window is ever added, swap the counter for an
//! unguessable id (or scope sessions per-window) — left as-is with this note.

use std::collections::HashMap;

use pickforge_core::{PtyEvent, PtyManager, SpawnOptions};
use tauri::ipc::{Channel, Response};
use tauri::State;

use crate::fs_commands::{approved_canonical, ApprovedRoots};

/// Gate the caller-supplied spawn cwd: a non-empty cwd must resolve UNDER an
/// approved root before we spawn a shell there, so a compromised renderer can't
/// open a pty rooted at an arbitrary directory off disk. A None/empty cwd
/// inherits the app process's directory and needs no check. Returns the
/// *canonical* (symlink-free, `..`-collapsed) cwd to spawn at, so the gate and
/// the actual working directory agree. The interactive shell may `cd` freely
/// AFTER spawn — that's the shell, not IPC; only the spawn cwd is gated.
fn resolve_spawn_cwd(cwd: Option<String>, roots: &ApprovedRoots) -> Result<Option<String>, String> {
    match cwd.filter(|c| !c.is_empty()) {
        Some(cwd) => Ok(Some(approved_canonical(&cwd, roots)?.to_string_lossy().into_owned())),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn pty_spawn(
    manager: State<'_, PtyManager>,
    roots: State<'_, ApprovedRoots>,
    cwd: Option<String>,
    command: Option<String>,
    rows: u16,
    cols: u16,
    // Extra env merged on top of the login-shell env — the `PICKFORGE_*` vars
    // (incl. the MCP `PICKFORGE_IPC_ENDPOINT`) so embedded agents discover the
    // local MCP endpoint. Optional: an interactive shell with no run context
    // passes nothing.
    env: Option<HashMap<String, String>>,
    on_output: Channel<Response>,
    on_exit: Channel<Option<i32>>,
) -> Result<u32, String> {
    let cwd = resolve_spawn_cwd(cwd, &roots)?;
    let opts = SpawnOptions {
        cwd,
        command,
        rows,
        cols,
        extra_env: env.unwrap_or_default(),
        ..Default::default()
    };
    manager
        .spawn(opts, move |event: PtyEvent| match event {
            PtyEvent::Output(bytes) => {
                let _ = on_output.send(Response::new(bytes));
            }
            PtyEvent::Exit(code) => {
                let _ = on_exit.send(code);
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_write(manager: State<'_, PtyManager>, id: u32, data: Vec<u8>) -> Result<(), String> {
    manager.write(id, &data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(
    manager: State<'_, PtyManager>,
    id: u32,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    manager.resize(id, rows, cols).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(manager: State<'_, PtyManager>, id: u32) -> Result<(), String> {
    manager.kill(id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod spawn_cwd_tests {
    use super::*;
    use std::path::Path;

    /// A throwaway approved project root on a fresh registry, returned
    /// canonicalized so tests can compose paths under it.
    fn temp_root(tag: &str) -> (ApprovedRoots, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("pf-ptycwd-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let roots = ApprovedRoots::default();
        roots.insert(&dir);
        (roots, std::fs::canonicalize(&dir).unwrap())
    }

    #[test]
    fn allows_an_in_root_cwd_and_returns_the_canonical_path() {
        let (roots, root) = temp_root("inroot");
        let resolved = resolve_spawn_cwd(Some(root.to_string_lossy().into_owned()), &roots)
            .expect("an in-root cwd must be allowed");
        assert_eq!(resolved.as_deref(), Some(root.to_string_lossy().as_ref()));
    }

    #[test]
    fn allows_a_nested_in_root_cwd() {
        let (roots, root) = temp_root("nested");
        let nested = root.join("packages").join("app");
        std::fs::create_dir_all(&nested).unwrap();
        let resolved = resolve_spawn_cwd(Some(nested.to_string_lossy().into_owned()), &roots)
            .expect("a nested in-root cwd must be allowed");
        assert_eq!(resolved, Some(std::fs::canonicalize(&nested).unwrap().to_string_lossy().into_owned()));
    }

    #[test]
    fn rejects_an_out_of_root_cwd() {
        let (roots, _root) = temp_root("outroot");
        let outside = std::env::temp_dir().join(format!("pf-ptyout-{}", std::process::id()));
        std::fs::create_dir_all(&outside).unwrap();
        assert!(
            resolve_spawn_cwd(Some(outside.to_string_lossy().into_owned()), &roots).is_err(),
            "a cwd outside every approved root must be rejected",
        );
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn rejects_a_dotdot_traversal_out_of_root() {
        let (roots, root) = temp_root("traversal");
        // <root>/../../.. — canonicalization collapses the `..` so the resolved
        // dir is no longer under the approved root.
        let sneaky = root.join("..").join("..").join("..");
        assert!(
            resolve_spawn_cwd(Some(sneaky.to_string_lossy().into_owned()), &roots).is_err(),
            "a `..` traversal out of the approved root must be rejected",
        );
    }

    #[test]
    fn allows_no_cwd_and_an_empty_cwd() {
        let (roots, _root) = temp_root("nocwd");
        assert_eq!(resolve_spawn_cwd(None, &roots).expect("None cwd is fine"), None);
        assert_eq!(
            resolve_spawn_cwd(Some(String::new()), &roots).expect("empty cwd is fine"),
            None,
        );
    }

    #[test]
    fn rejects_a_nonexistent_cwd() {
        let roots = ApprovedRoots::default();
        let missing = std::env::temp_dir()
            .join(format!("pf-ptymissing-{}-nope", std::process::id()));
        assert!(
            !Path::new(&missing).exists(),
            "the probe dir must not exist for this test",
        );
        assert!(
            resolve_spawn_cwd(Some(missing.to_string_lossy().into_owned()), &roots).is_err(),
            "a non-resolving cwd must be rejected",
        );
    }
}
