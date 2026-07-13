//! Device-log (logcat) streaming. For React Native / native-Android runs the
//! launched app's stdout is NOT the device log — `adb logcat` is. Rust owns the
//! `adb logcat` child (one per serial), reads its stdout on a dedicated task,
//! parses each line with the core logcat parser, and relays the parsed events to
//! the webview over a `Channel<LogEvent>` (mirroring `mirror_commands.rs`).
//! `logcat_stop` kills the child so no `adb logcat` is left running.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use pickforge_core::android::{logcat_event, LogEvent};
use pickforge_core::{user_shell_environment, StartGate};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

/// A live logcat stream: the `adb logcat` child and a generation token so a
/// quick stop+restart's stale reader task can't tear down the new session.
struct LogcatSession {
    child: Child,
    epoch: u64,
}

#[derive(Default, Clone)]
pub struct LogcatManager(
    Arc<Mutex<HashMap<String, LogcatSession>>>,
    Arc<AtomicBool>,
    Arc<StartGate>,
);

impl LogcatManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn is_shutting_down(&self) -> bool {
        self.1.load(Ordering::SeqCst)
    }

    async fn replace_session(
        &self,
        serial: &str,
        session: LogcatSession,
    ) -> Result<Option<LogcatSession>, LogcatSession> {
        let mut sessions = self.0.lock().await;
        if self.is_shutting_down() {
            return Err(session);
        }
        Ok(sessions.insert(serial.to_string(), session))
    }

    pub async fn shutdown(&self) {
        self.2.close();
        self.1.store(true, Ordering::SeqCst);
        let sessions = {
            let mut reg = self.0.lock().await;
            reg.drain().map(|(_, session)| session).collect::<Vec<_>>()
        };
        for session in sessions {
            stop_child(session).await;
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        while self.2.active() != 0 && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    }
}

/// Strictly-monotonic, process-local token to tell sessions for the same serial
/// apart. A counter (not a wall clock) so two sessions can never collide on the
/// same epoch — a stale reader must never match a newer session's token and tear
/// it down.
fn next_epoch() -> u64 {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    COUNTER.fetch_add(1, Ordering::Relaxed)
}

/// Start streaming `adb logcat` for `serial`, relaying parsed lines to `on_line`.
/// Any existing stream for the serial is replaced. `-v threadtime` is the format
/// the core parser reads; `-T 1` follows from the tail so the (possibly huge)
/// ring buffer isn't dumped, while the buffer is left intact (no `-c`).
#[tauri::command]
pub async fn logcat_start(
    app: AppHandle,
    manager: State<'_, LogcatManager>,
    serial: String,
    on_line: Channel<LogEvent>,
) -> Result<(), String> {
    let _start_permit = manager
        .2
        .begin()
        .map_err(|_| "logcat manager is shutting down".to_string())?;
    if manager.is_shutting_down() {
        return Err("logcat manager is shutting down".to_string());
    }
    let mut cmd = Command::new("adb");
    cmd.args(["-s", &serial, "logcat", "-v", "threadtime", "-T", "1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    // Spawn with the login-shell env so `adb` resolves like the other Android
    // commands — GUI-launched apps otherwise have a minimal PATH.
    cmd.env_clear();
    for (k, v) in user_shell_environment() {
        cmd.env(k, v);
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("no logcat stdout")?;
    let epoch = next_epoch();

    // Replace any existing session atomically under one lock: bump the epoch and
    // insert the new session, taking the displaced one in the same critical
    // section. This guarantees (a) exactly one session per serial in the map and
    // (b) the displaced session's reader (older epoch) can never match the new
    // session and tear it down. Kill the displaced child OUTSIDE the lock so the
    // blocking wait never wedges concurrent start/stop/cleanup for any device.
    match manager
        .replace_session(&serial, LogcatSession { child, epoch })
        .await
    {
        Ok(Some(old)) => stop_child(old).await,
        Ok(None) => {}
        Err(session) => {
            stop_child(session).await;
            return Err("logcat manager is shutting down".to_string());
        }
    }

    let registry = manager.0.clone();
    tauri::async_runtime::spawn(relay_lines(serial, epoch, stdout, on_line, app, registry));
    Ok(())
}

async fn relay_lines(
    serial: String,
    epoch: u64,
    stdout: tokio::process::ChildStdout,
    channel: Channel<LogEvent>,
    app: AppHandle,
    registry: Arc<Mutex<HashMap<String, LogcatSession>>>,
) {
    let mut lines = BufReader::new(stdout).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if let Some(event) = logcat_event(&line) {
                    if channel.send(event).is_err() {
                        break; // the webview dropped the channel
                    }
                }
            }
            Ok(None) | Err(_) => break, // EOF or read error → device gone / stopped
        }
    }
    // Only tear down + signal if THIS session is still registered — a quick
    // stop+restart may have replaced it with a newer session (different epoch),
    // which this stale task must not kill.
    let mut reg = registry.lock().await;
    if reg.get(&serial).map(|s| s.epoch == epoch).unwrap_or(false) {
        if let Some(session) = reg.remove(&serial) {
            drop(reg);
            stop_child(session).await;
        }
        let _ = app.emit("logcat-disconnected", &serial);
    }
}

async fn stop_child(mut session: LogcatSession) {
    let _ = session.child.kill().await;
}

/// Stop streaming for `serial`: kill the `adb logcat` child (its reader task ends
/// on the stdout EOF). No-op when nothing is streaming for the serial.
#[tauri::command]
pub async fn logcat_stop(manager: State<'_, LogcatManager>, serial: String) -> Result<(), String> {
    let session = manager.0.lock().await.remove(&serial);
    if let Some(session) = session {
        stop_child(session).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spawn_sleeper() -> Child {
        // Stand-in for the `adb logcat` child: a long-lived process we can detect
        // being killed. `kill_on_drop` mirrors the real spawn so a leaked handle
        // is reaped if the test panics.
        Command::new("sleep")
            .arg("30")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .expect("spawn sleep")
    }

    #[test]
    fn epochs_are_strictly_monotonic_and_unique() {
        let a = next_epoch();
        let b = next_epoch();
        let c = next_epoch();
        assert!(a < b && b < c, "epochs must strictly increase: {a} {b} {c}");
    }

    // Start-on-an-already-live-serial: the second start must displace the first,
    // leave EXACTLY one session for the serial, and the displaced child must be
    // dead (no leaked `adb logcat`). This exercises the same atomic replace path
    // the command uses.
    #[tokio::test]
    async fn second_start_replaces_and_kills_the_first() {
        let manager = LogcatManager::new();
        let serial = "emulator-5554";

        let epoch1 = next_epoch();
        let first = LogcatSession {
            child: spawn_sleeper(),
            epoch: epoch1,
        };
        assert!(matches!(
            manager.replace_session(serial, first).await,
            Ok(None)
        ));

        let epoch2 = next_epoch();
        let second = LogcatSession {
            child: spawn_sleeper(),
            epoch: epoch2,
        };
        let displaced = match manager.replace_session(serial, second).await {
            Ok(Some(displaced)) => displaced,
            _ => panic!("first session is displaced"),
        };

        // Exactly one session remains, and it's the newer one.
        {
            let reg = manager.0.lock().await;
            assert_eq!(reg.len(), 1);
            assert_eq!(reg.get(serial).map(|s| s.epoch), Some(epoch2));
        }

        // The displaced child is killed (no leaked logcat). After the kill it has
        // exited, so try_wait yields a status.
        let mut old = displaced;
        stop_child_for_test(&mut old).await;
        assert!(
            old.child.try_wait().expect("try_wait").is_some(),
            "displaced child must be dead",
        );

        // A stale reader for the OLD epoch must no-op against the current session.
        let reg = manager.0.lock().await;
        let stale_matches = reg.get(serial).map(|s| s.epoch == epoch1).unwrap_or(false);
        assert!(
            !stale_matches,
            "stale (older) epoch must not match the live session"
        );
    }

    async fn stop_child_for_test(session: &mut LogcatSession) {
        let _ = session.child.kill().await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn shutdown_kills_all_streams_and_is_idempotent() {
        let manager = LogcatManager::new();
        let first = spawn_sleeper();
        let second = spawn_sleeper();
        let first_pid = first.id().expect("first pid");
        let second_pid = second.id().expect("second pid");
        let _ = manager
            .replace_session(
                "emulator-5554",
                LogcatSession {
                    child: first,
                    epoch: next_epoch(),
                },
            )
            .await;
        let _ = manager
            .replace_session(
                "emulator-5556",
                LogcatSession {
                    child: second,
                    epoch: next_epoch(),
                },
            )
            .await;

        manager.shutdown().await;

        assert!(manager.0.lock().await.is_empty(), "registry must drain");
        for pid in [first_pid, second_pid] {
            assert_ne!(
                unsafe { libc::kill(pid as i32, 0) },
                0,
                "child {pid} must be dead after shutdown",
            );
        }

        manager.shutdown().await;
        assert!(manager.0.lock().await.is_empty());

        let raced = LogcatSession {
            child: spawn_sleeper(),
            epoch: next_epoch(),
        };
        let raced_pid = raced.child.id().expect("raced pid");
        let raced = match manager.replace_session("emulator-5558", raced).await {
            Err(raced) => raced,
            Ok(_) => panic!("shutdown gate must reject raced session"),
        };
        stop_child(raced).await;
        assert_ne!(unsafe { libc::kill(raced_pid as i32, 0) }, 0);
    }
}
