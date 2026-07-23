//! pickforge#214 — regression guard for the REAL normal-exit entrypoint,
//! `kill_recoverable_sessions_on_exit`: it must stay scoped to this
//! process's own private session dir and never reach into the legacy
//! (pre-#209) shared namespace.
//!
//! This lives in its own integration-test binary/process, not beside
//! `pty::sessions`'s other unit tests, because the entrypoint under test
//! permanently closes the process-global recoverable-spawn gate
//! (`close_recoverable_session_spawn_gate`) as its first step. Sharing that
//! call with the rest of `pickforge-core`'s unit test suite (all one
//! process) would poison every other test that spawns a recoverable session
//! afterward — Cargo gives each `tests/*.rs` file its own process, which
//! keeps that side effect contained to just this test.

// The entrypoint's own current-instance-dir safety check (`validated_sessions_dir`,
// unix-only) requires the shared `pickforge` parent to already be a private
// 0700 dir — exactly what the real app's `ensure_sessions_dir` (src-tauri)
// sets up before ever calling this. This test stands in for that caller.
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use pickforge_core::{kill_recoverable_sessions_on_exit, legacy_sessions_dir};

#[cfg(unix)]
#[test]
fn kill_recoverable_sessions_on_exit_never_touches_the_legacy_namespace() {
    let base: PathBuf =
        std::env::temp_dir().join(format!("pf-legacy-exit-entrypoint-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let legacy_dir = legacy_sessions_dir(&base);
    std::fs::create_dir_all(&legacy_dir).expect("create legacy sessions dir");
    let legacy_socket = legacy_dir.join("pf-55555555555555555555555555555555.dtach");
    std::fs::write(&legacy_socket, b"").expect("write legacy artifact");
    // Harden the shared `pickforge` parent the way the real app does before
    // ever calling this entrypoint, so the unrelated (current-instance-dir)
    // safety check doesn't fail this test for a reason that isn't the guard
    // under test.
    std::fs::set_permissions(base.join("pickforge"), std::fs::Permissions::from_mode(0o700))
        .expect("harden the shared pickforge parent dir");

    // The real production exit path — no current-instance session dir exists
    // (nothing to clean there), and no real tmux server exists under this
    // process's private, unique instance name, so this must succeed. The
    // actual guard is what happens to the legacy artifact.
    let result = kill_recoverable_sessions_on_exit(&base);

    assert!(result.is_ok(), "{result:?}");
    assert!(
        legacy_socket.exists(),
        "normal exit-time cleanup must never remove a legacy artifact"
    );
    let _ = std::fs::remove_dir_all(base);
}
