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
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use pickforge_core::{
    dtach_socket_path, kill_dtach_master, prepare_chat_session, run_timeout, select_backend,
    session_name, sessions_dir, tmux_has_session_args, tmux_kill_session_args, tmux_set_titles_args,
    Database, PreparedSession, PtyEvent, PtyManager, RemotePty, SessionBackend,
    SpawnOptions,
};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, Response};
use tauri::State;

use crate::fs_commands::{approved_canonical, ApprovedRoots};
use crate::remote_commands::ensure_remote_ssh_host_allowed;

/// Side-commands (tmux has-session / set-titles / kill-session) must never hang
/// the IPC call; bound them tightly.
const TMUX_PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// The runtime base for PickForge session sockets: `$XDG_RUNTIME_DIR` (a
/// user-private dir per the XDG spec) or the system temp dir as a fallback.
pub(crate) fn runtime_base() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePtyInput {
    host: String,
    remote_root: String,
}

impl From<RemotePtyInput> for RemotePty {
    fn from(value: RemotePtyInput) -> Self {
        Self {
            host: value.host,
            remote_root: value.remote_root,
        }
    }
}

fn remote_root_within_binding(requested: &str, bound: &str) -> bool {
    fn components(path: &str) -> Option<Vec<&str>> {
        if !path.starts_with('/') || path.contains('\0') {
            return None;
        }
        let components = path
            .split('/')
            .filter(|component| !component.is_empty())
            .collect::<Vec<_>>();
        if components.is_empty()
            || components
                .iter()
                .any(|component| matches!(*component, "." | ".."))
        {
            return None;
        }
        Some(components)
    }

    let Some(requested) = components(requested) else {
        return false;
    };
    let Some(bound) = components(bound) else {
        return false;
    };
    requested.starts_with(&bound)
}

pub(crate) fn authorize_remote_pty_binding(
    project_root: Option<&str>,
    remote: &RemotePty,
    binding: Option<(Option<&str>, Option<&str>)>,
    authorize_host: impl FnOnce(&str) -> Result<(), String>,
) -> Result<(), String> {
    let project_root = project_root
        .filter(|root| !root.is_empty())
        .ok_or_else(|| "remote terminal requires a project root".to_string())?;
    let matches_binding = matches!(
        binding,
        Some((Some(host), Some(remote_root)))
            if host == remote.host
                && remote_root_within_binding(&remote.remote_root, remote_root)
    );
    if !matches_binding {
        return Err(format!(
            "remote terminal is not authorized for project {project_root}"
        ));
    }
    authorize_host(&remote.host)
        .map_err(|err| format!("remote terminal authorization failed: {err}"))
}

pub(crate) fn authorize_remote_pty(
    db: &Database,
    project_root: Option<&str>,
    remote: Option<&RemotePty>,
) -> Result<(), String> {
    authorize_remote_pty_with(db, project_root, remote, ensure_remote_ssh_host_allowed)
}

pub(crate) fn authorize_remote_pty_with(
    db: &Database,
    project_root: Option<&str>,
    remote: Option<&RemotePty>,
    authorize_host: impl FnOnce(&str) -> Result<(), String>,
) -> Result<(), String> {
    let Some(remote) = remote else {
        return Ok(());
    };
    let projects = db.list_projects(false).map_err(|err| err.to_string())?;
    let binding = project_root
        .filter(|root| !root.is_empty())
        .and_then(|root| projects.iter().find(|project| project.project_root == root))
        .map(|project| (project.remote_host.as_deref(), project.remote_root.as_deref()));
    authorize_remote_pty_binding(project_root, remote, binding, authorize_host)
}

fn spawn_options(
    cwd: Option<String>,
    command: Option<String>,
    rows: u16,
    cols: u16,
    env: Option<HashMap<String, String>>,
    remote: Option<RemotePty>,
    roots: &ApprovedRoots,
) -> Result<SpawnOptions, String> {
    let cwd = if remote.is_some() {
        None
    } else {
        resolve_spawn_cwd(cwd, roots)?
    };
    Ok(SpawnOptions {
        cwd,
        command,
        rows,
        cols,
        extra_env: env.unwrap_or_default(),
        remote,
        ..Default::default()
    })
}

fn chat_spawn_options(
    cwd: Option<String>,
    rows: u16,
    cols: u16,
    env: Option<HashMap<String, String>>,
    remote: Option<RemotePty>,
    prepared: &PreparedSession,
    roots: &ApprovedRoots,
) -> Result<SpawnOptions, String> {
    let remote_chat = remote.is_some();
    let mut opts = spawn_options(cwd, None, rows, cols, env, remote, roots)?;
    opts.program_override = (!remote_chat).then(|| prepared.program_override.clone()).flatten();
    opts.detach_on_drop = !remote_chat && prepared.backend != SessionBackend::Raw;
    Ok(opts)
}

#[tauri::command]
pub fn pty_spawn(
    manager: State<'_, PtyManager>,
    roots: State<'_, ApprovedRoots>,
    db: State<'_, Arc<Database>>,
    cwd: Option<String>,
    project_root: Option<String>,
    command: Option<String>,
    rows: u16,
    cols: u16,
    // Extra env merged on top of the login-shell env — the `PICKFORGE_*` vars
    // (incl. the MCP `PICKFORGE_IPC_ENDPOINT`) so embedded agents discover the
    // local MCP endpoint. Optional: an interactive shell with no run context
    // passes nothing.
    env: Option<HashMap<String, String>>,
    remote: Option<RemotePtyInput>,
    on_output: Channel<Response>,
    on_exit: Channel<Option<i32>>,
) -> Result<u32, String> {
    let remote = remote.map(Into::into);
    authorize_remote_pty(&db, project_root.as_deref(), remote.as_ref())?;
    let opts = spawn_options(cwd, command, rows, cols, env, remote, &roots)?;
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

/// Detach (don't kill) a session-backed chat pane: the dtach/tmux session and
/// the agent shell inside it keep running for the next attach. Falls back to a
/// full kill for a raw (non-recoverable) pane, so a renderer that calls this on
/// any pane still tears it down cleanly. Used on pane close / unmount.
#[tauri::command]
pub fn pty_detach(manager: State<'_, PtyManager>, id: u32) -> Result<(), String> {
    manager.detach(id).map_err(|e| e.to_string())
}

/// The chat-session spawn result handed back to the renderer.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSpawnResult {
    pub pty_id: u32,
    /// The backend actually used: "dtach" | "tmux" | "raw" (raw = degraded
    /// fallback because the requested backend wasn't installed).
    pub backend: String,
    /// `"<backend>:<name>"` to persist on the chat (null only for a raw open
    /// with no prior session to preserve).
    pub session_id: Option<String>,
    /// Best-effort "created" | "attached".
    pub status: String,
    /// True when the requested backend was unavailable and we degraded to a raw
    /// shell — the terminal still works, only recovery is lost this session.
    pub degraded: bool,
}

/// Ensure this process's dtach socket directory is user-private (`0700`),
/// current-user-owned, and not a symlink. Its `pickforge` parent receives the
/// same hardening. Reject foreign or group/other-accessible paths.
#[cfg(unix)]
fn ensure_sessions_dir(dir: &Path) -> Result<(), String> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};

    // Create the `pickforge` parent first, then this process's private child.
    for d in [dir.parent(), Some(dir)].into_iter().flatten() {
        match std::fs::symlink_metadata(d) {
            Ok(meta) => {
                if !meta.file_type().is_dir() {
                    return Err(format!("session path {} is not a directory", d.display()));
                }
                if meta.uid() != unsafe { libc::getuid() } {
                    return Err(format!(
                        "session dir {} is not owned by the current user",
                        d.display()
                    ));
                }
                if meta.permissions().mode() & 0o077 != 0 {
                    std::fs::set_permissions(d, std::fs::Permissions::from_mode(0o700))
                        .map_err(|e| format!("cannot tighten session dir perms: {e}"))?;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                std::fs::DirBuilder::new()
                    .recursive(false)
                    .mode(0o700)
                    .create(d)
                    .map_err(|e| format!("cannot create private session dir {}: {e}", d.display()))?;
            }
            Err(e) => return Err(format!("cannot stat session dir {}: {e}", d.display())),
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn ensure_sessions_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())
}

/// Best-effort: turn ON window-title reporting for the private tmux server so an
/// OSC 2 title set inside a pane propagates out for the chat-title flow. Run on
/// every tmux chat open; `-gq` makes it an idempotent no-op once set. Never
/// fails the spawn — a missing/old tmux just means no title flow.
fn tmux_enable_titles() {
    for args in tmux_set_titles_args() {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let _ = run_timeout("tmux", &refs, None, None, TMUX_PROBE_TIMEOUT);
    }
}

/// Spawn (attach-or-create) a chat's shell under its recovery backend so a
/// running agent survives the pane closing and the app restarting. Falls back to
/// a RAW interactive shell when the requested backend isn't installed. NEVER the
/// one-shot Debug-Console path (that's `pty_spawn` with a `command`).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn pty_spawn_chat(
    manager: State<'_, PtyManager>,
    roots: State<'_, ApprovedRoots>,
    db: State<'_, Arc<Database>>,
    chat_id: String,
    project_root: String,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    backend: String,
    // The session id already stored on this chat (preserved on a raw fallback).
    session_id: Option<String>,
    remote: Option<RemotePtyInput>,
    rows: u16,
    cols: u16,
    on_output: Channel<Response>,
    on_exit: Channel<Option<i32>>,
) -> Result<ChatSpawnResult, String> {
    let remote = remote.map(Into::into);
    authorize_remote_pty(&db, Some(&project_root), remote.as_ref())?;
    let remote_chat = remote.is_some();
    // Hash the CANONICAL project root (canonicalize via the same gate, falling
    // back to the raw string if it isn't an approved root — naming only needs
    // stability, not approval), so `~/app`, `app/`, symlinks don't fork sessions.
    let canonical_root = approved_canonical(&project_root, &roots)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(project_root);

    let requested = SessionBackend::from_tag(&backend);
    // Chat recovery stays local-only: remote shells use a raw SSH PTY.
    let selected = if remote_chat {
        SessionBackend::Raw
    } else {
        select_backend(requested)
    };
    let degraded =
        !remote_chat && selected == SessionBackend::Raw && requested != SessionBackend::Raw;

    let base = runtime_base();

    // For dtach, the sockets dir must be a private 0700 dir before we bind in it.
    if selected == SessionBackend::Dtach {
        ensure_sessions_dir(&sessions_dir(&base)).map_err(|e| {
            format!("cannot prepare dtach session dir: {e}")
        })?;
    }

    let name = session_name(&canonical_root, &chat_id);
    let prepared = prepare_chat_session(
        &base,
        &canonical_root,
        &chat_id,
        selected,
        session_id.as_deref(),
        |sock| sock.exists(),
        |n| {
            let args = tmux_has_session_args(n);
            let refs: Vec<&str> = args.iter().map(String::as_str).collect();
            run_timeout("tmux", &refs, None, None, TMUX_PROBE_TIMEOUT)
                .map(|o| o.success())
                .unwrap_or(false)
        },
    );

    let opts = chat_spawn_options(cwd, rows, cols, env, remote, &prepared, &roots)?;

    let pty_id = manager
        .spawn(opts, move |event: PtyEvent| match event {
            PtyEvent::Output(bytes) => {
                let _ = on_output.send(Response::new(bytes));
            }
            PtyEvent::Exit(code) => {
                let _ = on_exit.send(code);
            }
        })
        .map_err(|e| {
            // A spawn failure mustn't leave a half-bound name around.
            let _ = &name;
            e.to_string()
        })?;

    // tmux: enable window-title reporting AFTER the spawn — `new-session -A`
    // above is what brings the private `-L pickforge` server up, so a set-option
    // run before it could land on no server (or a half-started one) and the very
    // first tmux-backed chat would never propagate its OSC title. Running it now,
    // against the live server, guarantees set-titles applies; `-gq` keeps every
    // later open an idempotent no-op.
    if selected == SessionBackend::Tmux {
        tmux_enable_titles();
    }

    Ok(ChatSpawnResult {
        pty_id,
        backend: prepared.backend.tag().to_string(),
        session_id: prepared.session_id,
        status: prepared.status.as_str().to_string(),
        degraded,
    })
}

/// Destroy a chat's recovery session on chat delete, so it doesn't linger after
/// its chat is gone. tmux is killed declaratively (`kill-session`); dtach has no
/// kill verb, so we find + terminate the dtach MASTER process bound to this
/// session's socket (matched by the exact socket path in its argv — so we never
/// touch an unrelated dtach) and THEN remove the socket. Killing the master is
/// what stops the shell/agent inside a dtach session whose pane was already
/// closed (or after an app restart); removing only the socket would orphan it.
#[tauri::command]
pub fn pty_destroy_chat_session(session_id: String) -> Result<(), String> {
    let (tag, name) = session_id
        .split_once(':')
        .ok_or_else(|| format!("malformed session id: {session_id}"))?;
    match SessionBackend::from_tag(tag) {
        SessionBackend::Tmux => {
            let args = tmux_kill_session_args(name);
            let refs: Vec<&str> = args.iter().map(String::as_str).collect();
            // Best-effort: a missing session / server is already "destroyed".
            let _ = run_timeout("tmux", &refs, None, None, TMUX_PROBE_TIMEOUT);
            Ok(())
        }
        SessionBackend::Dtach => {
            let sock = dtach_socket_path(&runtime_base(), name);
            // Terminate the dtach master holding this socket FIRST — otherwise the
            // shell/agent inside it keeps running after we unlink the socket. Only
            // matches a dtach whose argv carries this exact (unique) socket path.
            kill_dtach_master(&sock).map_err(|error| error.to_string())?;
            // Only remove a real socket/file — never follow a symlink someone
            // swapped in for the path.
            if let Ok(meta) = std::fs::symlink_metadata(&sock) {
                if !meta.file_type().is_symlink() {
                    std::fs::remove_file(&sock).map_err(|error| error.to_string())?;
                }
            }
            Ok(())
        }
        SessionBackend::Raw => Ok(()), // nothing to destroy
    }
}

#[cfg(test)]
mod spawn_cwd_tests {
    use super::*;
    use pickforge_core::Project;
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

    #[test]
    fn remote_spawn_threads_the_remote_and_skips_the_local_cwd_gate() {
        let remote = RemotePty {
            host: "mac-mini".to_string(),
            remote_root: "/Users/dev/app".to_string(),
        };
        let opts = spawn_options(
            Some("/not/an/approved/local/path".to_string()),
            None,
            24,
            80,
            None,
            Some(remote.clone()),
            &ApprovedRoots::default(),
        )
        .expect("a remote spawn must not validate its local cwd");

        assert_eq!(opts.cwd, None);
        assert_eq!(opts.remote, Some(remote));
    }

    #[test]
    fn remote_spawn_rejects_missing_or_mismatched_project_bindings() {
        let remote = RemotePty {
            host: "mac-mini".to_string(),
            remote_root: "/Users/dev/app".to_string(),
        };

        let missing_root = authorize_remote_pty_binding(
            None,
            &remote,
            Some((Some("mac-mini"), Some("/Users/dev/app"))),
            |_| panic!("host verification must not run without a project root"),
        )
        .unwrap_err();
        assert!(missing_root.contains("requires a project root"));

        let unbound = authorize_remote_pty_binding(Some("/app"), &remote, None, |_| {
            panic!("host verification must not run for an unbound project")
        })
        .unwrap_err();
        assert!(unbound.contains("not authorized for project /app"));

        let mismatched = authorize_remote_pty_binding(
            Some("/app"),
            &remote,
            Some((Some("linux-box"), Some("/srv/app"))),
            |_| panic!("host verification must not run for a mismatched binding"),
        )
        .unwrap_err();
        assert!(mismatched.contains("not authorized for project /app"));
    }

    #[test]
    fn remote_spawn_rejects_a_host_that_fails_tailnet_authorization() {
        let remote = RemotePty {
            host: "mac-mini".to_string(),
            remote_root: "/Users/dev/app".to_string(),
        };
        let err = authorize_remote_pty_binding(
            Some("/app"),
            &remote,
            Some((Some("mac-mini"), Some("/Users/dev/app"))),
            |_| Err("remote host is not an online tailnet peer: host is offline".to_string()),
        )
        .unwrap_err();

        assert!(err.contains("remote terminal authorization failed"));
        assert!(err.contains("not an online tailnet peer"));
    }

    #[test]
    fn remote_spawn_authorizes_an_exact_binding_before_spawning() {
        let remote = RemotePty {
            host: "mac-mini".to_string(),
            remote_root: "/Users/dev/app".to_string(),
        };
        let mut authorized_host = None;

        authorize_remote_pty_binding(
            Some("/app"),
            &remote,
            Some((Some("mac-mini"), Some("/Users/dev/app"))),
            |host| {
                authorized_host = Some(host.to_string());
                Ok(())
            },
        )
        .expect("an exact remote binding with an online host must be allowed");

        assert_eq!(authorized_host.as_deref(), Some("mac-mini"));
    }

    #[test]
    fn remote_spawn_authorizes_a_detected_app_below_the_bound_root() {
        let remote = RemotePty {
            host: "mac-mini".to_string(),
            remote_root: "/srv/repo/apps/flutter_app".to_string(),
        };

        authorize_remote_pty_binding(
            Some("/app"),
            &remote,
            Some((Some("mac-mini"), Some("/srv/repo"))),
            |_| Ok(()),
        )
        .expect("a detected app below the binding must be allowed");

        for escaped in ["/srv/repo/../secret", "/srv/repo-copy/app"] {
            let escaped = RemotePty {
                host: "mac-mini".to_string(),
                remote_root: escaped.to_string(),
            };
            assert!(authorize_remote_pty_binding(
                Some("/app"),
                &escaped,
                Some((Some("mac-mini"), Some("/srv/repo"))),
                |_| Ok(()),
            )
            .is_err());
        }
    }

    #[test]
    fn remote_spawn_reads_the_binding_from_the_projects_table() {
        let db = Database::open_in_memory().unwrap();
        db.upsert_project(&Project {
            project_root: "/app".to_string(),
            display_name: "App".to_string(),
            created_at: 0,
            last_opened_at: 0,
            sort_order: 0,
            archived_at: None,
            remote_host: Some("mac-mini".to_string()),
            remote_root: Some("/Users/dev/app".to_string()),
        })
        .unwrap();
        let remote = RemotePty {
            host: "mac-mini".to_string(),
            remote_root: "/Users/dev/app".to_string(),
        };

        authorize_remote_pty_with(&db, Some("/app"), Some(&remote), |_| Ok(()))
            .expect("the stored binding must authorize the matching remote pty");

        let mismatch = RemotePty {
            host: "mac-mini".to_string(),
            remote_root: "/Users/dev/other".to_string(),
        };
        let err = authorize_remote_pty_with(&db, Some("/app"), Some(&mismatch), |_| Ok(()))
            .unwrap_err();
        assert!(err.contains("not authorized for project /app"));
    }

    #[test]
    fn remote_chat_spawn_drops_the_local_recovery_override() {
        let prepared = PreparedSession {
            backend: SessionBackend::Dtach,
            session_id: Some("dtach:pf-existing".to_string()),
            program_override: Some(("dtach".to_string(), vec!["-a".to_string()])),
            status: pickforge_core::SessionStatus::Created,
            dtach_socket: None,
        };
        let opts = chat_spawn_options(
            Some("/not/an/approved/local/path".to_string()),
            24,
            80,
            None,
            Some(RemotePty {
                host: "mac-mini".to_string(),
                remote_root: "/Users/dev/app".to_string(),
            }),
            &prepared,
            &ApprovedRoots::default(),
        )
        .expect("a remote chat must not validate its local cwd");

        assert_eq!(opts.cwd, None);
        assert!(opts.program_override.is_none());
        assert!(!opts.detach_on_drop);
        assert!(opts.remote.is_some());
    }
}
