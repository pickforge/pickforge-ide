//! End-to-end check of the PTY data path: spawn `$SHELL`, type a marked
//! command, and confirm the marker streams back through the sink. This is the
//! Phase 0 exit criterion expressed as an automatable test (no GUI needed).

use std::sync::mpsc;
use std::thread::sleep;
use std::time::{Duration, Instant};

use pickforge_core::{PtyEvent, PtyManager, SpawnOptions};

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
    manager.write(id, b"echo pf_marker_42\n").expect("write to shell");

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
    assert!(seen.contains("pf_cmd_marker"), "expected command output, got: {seen:?}");
    assert!(exited, "command-mode pty should exit on its own, not idle at a prompt");
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
fn resize_and_kill_are_idempotent_enough() {
    let manager = PtyManager::new();
    let id = manager
        .spawn(SpawnOptions::default(), |_event| {})
        .expect("spawn shell");

    manager.resize(id, 40, 120).expect("resize live session");
    manager.kill(id).expect("kill once");
    // Second kill / resize after removal must not panic.
    manager.kill(id).expect("kill again is a no-op");
    assert!(manager.resize(id, 10, 10).is_err(), "resize after kill errors");
    assert!(manager.is_empty(), "registry drained after kill");
}
