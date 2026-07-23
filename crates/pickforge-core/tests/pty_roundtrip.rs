//! End-to-end check of the PTY data path: spawn `$SHELL`, type a marked
//! command, and confirm the marker streams back through the sink. This is the
//! Phase 0 exit criterion expressed as an automatable test (no GUI needed).

use std::collections::HashMap;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::sync::mpsc;
use std::thread::sleep;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use pickforge_core::{PtyError, PtyEvent, PtyManager, RemotePty, SpawnOptions};

#[test]
fn shell_echo_round_trips_through_the_sink() {
    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel::<PtyEvent>();

    let id = manager
        .spawn(
            SpawnOptions {
                cwd: None,
                rows: 24,
                cols: 80,
                ..Default::default()
            },
            move |event| {
                let _ = tx.send(event);
            },
        )
        .expect("spawn shell");
    assert_eq!(manager.len(), 1, "session should be registered");

    // Let the shell come up, then run a uniquely marked echo.
    sleep(Duration::from_millis(400));
    manager
        .write(id, b"echo pf_marker_42\n")
        .expect("write to shell");

    let mut seen = String::new();
    let deadline = Instant::now() + Duration::from_secs(6);
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(PtyEvent::Output(bytes)) => {
                seen.push_str(&String::from_utf8_lossy(&bytes));
                if seen.contains("pf_marker_42") {
                    break;
                }
            }
            Ok(PtyEvent::Exit(_)) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    manager.kill(id).ok();
    assert!(
        seen.contains("pf_marker_42"),
        "expected the echoed marker in shell output, got: {seen:?}"
    );
}

#[test]
fn command_mode_runs_once_and_exits() {
    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel::<PtyEvent>();

    let id = manager
        .spawn(
            SpawnOptions {
                command: Some("echo pf_cmd_marker".to_string()),
                rows: 24,
                cols: 80,
                ..Default::default()
            },
            move |event| {
                let _ = tx.send(event);
            },
        )
        .expect("spawn command");

    // The one-shot command must stream its output AND then exit on its own,
    // without lingering at an interactive shell prompt.
    let mut seen = String::new();
    let mut exited = false;
    let deadline = Instant::now() + Duration::from_secs(6);
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(PtyEvent::Output(bytes)) => seen.push_str(&String::from_utf8_lossy(&bytes)),
            Ok(PtyEvent::Exit(_)) => {
                exited = true;
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    manager.kill(id).ok();
    assert!(
        seen.contains("pf_cmd_marker"),
        "expected command output, got: {seen:?}"
    );
    assert!(
        exited,
        "command-mode pty should exit on its own, not idle at a prompt"
    );
}

#[cfg(unix)]
#[test]
fn kill_terminates_a_foreground_jobs_descendants() {
    // The bug: killing only the shell child orphans a foreground job's
    // descendants (think `flutter run`), which keep running. We run a job that
    // sleeps then writes a marker; a correct group-kill stops it before the
    // marker is ever written.
    let dir = std::env::temp_dir();
    let marker = dir.join(format!(
        "pickforge-pty-killtest-{}-{:?}",
        std::process::id(),
        Instant::now()
    ));
    let _ = std::fs::remove_file(&marker);

    let manager = PtyManager::new();
    let id = manager
        .spawn(SpawnOptions::default(), |_event| {})
        .expect("spawn shell");

    // Let the shell come up, then launch a long foreground job. `exec` replaces
    // the subshell so the sleeper is a direct descendant in the shell's group.
    sleep(Duration::from_millis(400));
    let cmd = format!("sh -c 'sleep 3; : > {}'\n", marker.display());
    manager.write(id, cmd.as_bytes()).expect("write job");

    // Give the job time to actually start before we kill the session.
    sleep(Duration::from_millis(500));
    manager.kill(id).expect("kill session");

    // Wait past the job's own sleep: if the descendant survived the kill it
    // would create the marker by now.
    sleep(Duration::from_secs(4));
    assert!(
        !marker.exists(),
        "foreground job descendant survived the session kill (marker was written)"
    );
    let _ = std::fs::remove_file(&marker);
}

#[test]
fn one_shot_command_ignores_a_program_override_and_stays_raw() {
    // The Debug Console one-shot path (`command = Some`) must NEVER be wrapped in
    // a session, even if a bogus `program_override` is supplied: it has to run
    // the command and exit, not attach to a dtach/tmux session. Point the
    // override at a binary that would NOT produce the marker, so the test only
    // passes if the override was ignored and `$SHELL -c <command>` ran.
    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel::<PtyEvent>();

    let id = manager
        .spawn(
            SpawnOptions {
                command: Some("echo pf_oneshot_wins".to_string()),
                program_override: Some(("/bin/false".to_string(), vec![])),
                detach_on_drop: true, // also must be neutralised for one-shot
                rows: 24,
                cols: 80,
                ..Default::default()
            },
            move |event| {
                let _ = tx.send(event);
            },
        )
        .expect("spawn one-shot");

    let mut seen = String::new();
    let mut exited = false;
    let deadline = Instant::now() + Duration::from_secs(6);
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(PtyEvent::Output(bytes)) => seen.push_str(&String::from_utf8_lossy(&bytes)),
            Ok(PtyEvent::Exit(_)) => {
                exited = true;
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    manager.kill(id).ok();
    assert!(
        seen.contains("pf_oneshot_wins"),
        "one-shot command must run despite a program_override; got: {seen:?}"
    );
    assert!(exited, "one-shot must still exit on its own");
}

#[test]
fn detach_on_a_raw_session_tears_it_down_like_kill() {
    // `detach` is the pane-close path for SESSION-BACKED panes; called on a RAW
    // (non-detachable) session it must fall back to a full teardown so a raw
    // shell is never leaked. A default SpawnOptions has detach_on_drop = false.
    let manager = PtyManager::new();
    let id = manager
        .spawn(SpawnOptions::default(), |_event| {})
        .expect("spawn shell");
    assert_eq!(manager.len(), 1);

    manager.detach(id).expect("detach a raw session");
    assert!(
        manager.is_empty(),
        "raw session must be torn down, not leaked"
    );
    // Idempotent: detaching an already-gone session is a no-op, never a panic.
    manager.detach(id).expect("second detach is a no-op");
}

#[cfg(unix)]
#[test]
fn detach_of_a_session_backed_pane_completes_without_hanging() {
    // P1 regression: on detach we drop master + writer, but the READER THREAD
    // owns a CLONED master fd, so the client could never see the hangup and
    // `child.wait()` would block forever (leaking the thread + a stuck client).
    // The fix SIGHUPs the client pid so it exits regardless, then joins the
    // reader. Here a `detach_on_drop` session runs a plain shell (no dtach needed
    // in CI); SIGHUP makes the shell exit, the reader hits EOF, and detach must
    // return PROMPTLY rather than block. We run detach on a worker thread and
    // fail if it hasn't finished within a generous bound.
    let manager = std::sync::Arc::new(PtyManager::new());
    let id = manager
        .spawn(
            SpawnOptions {
                // No real dtach in CI: mark it detachable so we exercise the
                // detach (SIGHUP-client + join-reader) path, not the kill path.
                detach_on_drop: true,
                rows: 24,
                cols: 80,
                ..Default::default()
            },
            |_event| {},
        )
        .expect("spawn session-backed shell");
    assert_eq!(manager.len(), 1);
    sleep(Duration::from_millis(300)); // let the shell + reader come up

    let (tx, rx) = mpsc::channel::<()>();
    let m = std::sync::Arc::clone(&manager);
    let worker = std::thread::spawn(move || {
        m.detach(id).expect("detach must succeed");
        let _ = tx.send(());
    });

    // If the reader-thread fd kept the client alive, this recv would time out.
    rx.recv_timeout(Duration::from_secs(8))
        .expect("detach hung — the reader thread fd kept the client from detaching");
    worker.join().expect("detach worker panicked");
    assert!(manager.is_empty(), "registry must drain after detach");
}

#[cfg(unix)]
#[test]
fn shutdown_terminates_children_and_grandchildren_and_rejects_spawns() {
    let marker = std::env::temp_dir().join(format!(
        "pickforge-pty-shutdown-{}-{:?}",
        std::process::id(),
        Instant::now()
    ));
    let _ = std::fs::remove_file(&marker);

    let manager = PtyManager::new();
    let id = manager
        .spawn(SpawnOptions::default(), |_event| {})
        .expect("spawn shell");
    sleep(Duration::from_millis(400));
    let cmd = format!("sh -c 'sleep 3; : > {}'\n", marker.display());
    manager.write(id, cmd.as_bytes()).expect("write job");
    sleep(Duration::from_millis(500));

    manager.shutdown();
    assert!(manager.is_empty(), "registry must drain on shutdown");

    assert!(
        matches!(
            manager.spawn(SpawnOptions::default(), |_event| {}),
            Err(PtyError::ShuttingDown)
        ),
        "spawn after shutdown must be rejected"
    );
    manager.shutdown();

    sleep(Duration::from_secs(4));
    assert!(
        !marker.exists(),
        "descendant survived shutdown (marker was written)"
    );
    let _ = std::fs::remove_file(&marker);
}

#[cfg(unix)]
#[test]
fn shutdown_tears_down_detachable_clients_too() {
    let manager = std::sync::Arc::new(PtyManager::new());
    let _id = manager
        .spawn(
            SpawnOptions {
                detach_on_drop: true,
                rows: 24,
                cols: 80,
                ..Default::default()
            },
            |_event| {},
        )
        .expect("spawn detachable shell");
    assert_eq!(manager.len(), 1);
    sleep(Duration::from_millis(300));

    let (tx, rx) = mpsc::channel::<()>();
    let m = std::sync::Arc::clone(&manager);
    let worker = std::thread::spawn(move || {
        m.shutdown();
        let _ = tx.send(());
    });
    rx.recv_timeout(Duration::from_secs(8))
        .expect("shutdown hung on a detachable client");
    worker.join().expect("shutdown worker panicked");
    assert!(
        manager.is_empty(),
        "detachable client must be torn down on shutdown"
    );
}

#[cfg(unix)]
#[test]
fn shutdown_uses_one_shared_grace_for_all_pty_sessions() {
    let manager = PtyManager::new();
    for _ in 0..4 {
        manager
            .spawn(SpawnOptions::default(), |_event| {})
            .expect("spawn shell");
    }
    sleep(Duration::from_millis(300));

    let started = Instant::now();
    manager.shutdown();
    let elapsed = started.elapsed();

    assert!(manager.is_empty());
    assert!(
        elapsed < Duration::from_millis(500),
        "four PTYs consumed serial grace periods: {elapsed:?}"
    );
}

#[test]
fn resize_and_kill_are_idempotent_enough() {
    let manager = PtyManager::new();
    let id = manager
        .spawn(SpawnOptions::default(), |_event| {})
        .expect("spawn shell");

    manager.resize(id, 40, 120).expect("resize live session");
    manager.kill(id).expect("kill once");
    // Second kill / resize after removal must not panic.
    manager.kill(id).expect("kill again is a no-op");
    assert!(
        manager.resize(id, 10, 10).is_err(),
        "resize after kill errors"
    );
    assert!(manager.is_empty(), "registry drained after kill");
}

#[cfg(unix)]
#[test]
#[allow(clippy::too_many_lines)] // TODO(#263): split the legacy integration test.
fn remote_pty_spawn_uses_ssh_argv_and_keeps_pty_io_and_resize() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_nanos();
    let dir =
        std::env::temp_dir().join(format!("pickforge-fake-ssh-{}-{nonce}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create fake ssh dir");
    let fake_ssh = dir.join("ssh");
    let argv_log = dir.join("argv.log");
    let size_before = dir.join("size-before.log");
    let size_after = dir.join("size-after.log");
    let missing_cwd = dir.join("missing-local-cwd");
    assert!(!missing_cwd.exists(), "test cwd must stay nonexistent");

    std::fs::write(
        &fake_ssh,
        r#"#!/bin/sh
set -eu
: > "$PF_FAKE_SSH_ARGV"
printf '%s\n' "$#" >> "$PF_FAKE_SSH_ARGV"
for arg in "$@"; do
  printf '<%s>\n' "$arg" >> "$PF_FAKE_SSH_ARGV"
done
stty size > "$PF_FAKE_SSH_SIZE_BEFORE" 2>/dev/null || true
printf 'PF_FAKE_SSH_READY\n'
IFS= read -r line
printf 'PF_FAKE_SSH_STDIN:%s\n' "$line"
stty size > "$PF_FAKE_SSH_SIZE_AFTER" 2>/dev/null || true
"#,
    )
    .expect("write fake ssh");
    let mut perms = std::fs::metadata(&fake_ssh)
        .expect("fake ssh metadata")
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&fake_ssh, perms).expect("make fake ssh executable");

    let old_path = std::env::var("PATH").unwrap_or_default();
    let mut extra_env = HashMap::new();
    extra_env.insert("PATH".to_string(), format!("{}:{old_path}", dir.display()));
    extra_env.insert(
        "PF_FAKE_SSH_ARGV".to_string(),
        argv_log.to_string_lossy().into_owned(),
    );
    extra_env.insert(
        "PF_FAKE_SSH_SIZE_BEFORE".to_string(),
        size_before.to_string_lossy().into_owned(),
    );
    extra_env.insert(
        "PF_FAKE_SSH_SIZE_AFTER".to_string(),
        size_after.to_string_lossy().into_owned(),
    );

    let manager = PtyManager::new();
    let (tx, rx) = mpsc::channel::<PtyEvent>();
    let id = manager
        .spawn(
            SpawnOptions {
                cwd: Some(missing_cwd.to_string_lossy().into_owned()),
                rows: 7,
                cols: 19,
                extra_env,
                remote: Some(RemotePty {
                    host: "mac-mini".to_string(),
                    remote_root: "/Users/dev/app root".to_string(),
                    remote_process_leases: false,
                }),
                ..Default::default()
            },
            move |event| {
                let _ = tx.send(event);
            },
        )
        .expect("spawn remote pty");

    let mut seen = String::new();
    let deadline = Instant::now() + Duration::from_secs(6);
    while Instant::now() < deadline && !seen.contains("PF_FAKE_SSH_READY") {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(PtyEvent::Output(bytes)) => seen.push_str(&String::from_utf8_lossy(&bytes)),
            Ok(PtyEvent::Exit(_)) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    assert!(
        seen.contains("PF_FAKE_SSH_READY"),
        "fake ssh did not start: {seen:?}"
    );

    manager.resize(id, 13, 31).expect("resize remote pty");
    manager
        .write(id, b"pf_remote_input\n")
        .expect("write remote pty");

    let mut exited = false;
    let deadline = Instant::now() + Duration::from_secs(6);
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(PtyEvent::Output(bytes)) => seen.push_str(&String::from_utf8_lossy(&bytes)),
            Ok(PtyEvent::Exit(_)) => {
                exited = true;
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    manager.kill(id).ok();

    let argv = std::fs::read_to_string(&argv_log).expect("read argv log");
    assert_eq!(
        argv.lines().collect::<Vec<_>>(),
        vec![
            "10",
            "<-o>",
            "<ConnectTimeout=5>",
            "<-o>",
            "<StrictHostKeyChecking=accept-new>",
            "<-o>",
            "<EscapeChar=none>",
            "<-tt>",
            "<-->",
            "<mac-mini>",
            "<cd '/Users/dev/app root' && exec \"$SHELL\" -l>",
        ]
    );
    assert!(
        seen.contains("PF_FAKE_SSH_STDIN:pf_remote_input"),
        "stdin did not reach fake ssh: {seen:?}"
    );
    assert!(exited, "fake ssh should exit after stdin");
    assert_eq!(
        std::fs::read_to_string(&size_before)
            .expect("read initial size")
            .trim(),
        "7 19"
    );
    assert_eq!(
        std::fs::read_to_string(&size_after)
            .expect("read resized size")
            .trim(),
        "13 31"
    );

    let _ = std::fs::remove_dir_all(dir);
}
