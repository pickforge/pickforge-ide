//! Device-log (logcat) streaming. For React Native / native-Android runs the
//! launched app's stdout is NOT the device log — `adb logcat` is. Rust owns the
//! `adb logcat` child (one per serial), reads its stdout on a dedicated task,
//! parses each line with the core logcat parser, and relays the parsed events to
//! the webview over a `Channel<LogEvent>` (mirroring `mirror_commands.rs`).
//! `logcat_stop` kills the child so no `adb logcat` is left running.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use pickforge_core::android::{logcat_event, LogEvent};
use pickforge_core::user_shell_environment;
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
pub struct LogcatManager(Arc<Mutex<HashMap<String, LogcatSession>>>);

impl LogcatManager {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Monotonic-ish token to tell sessions for the same serial apart (clock nanos).
fn next_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
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
    if let Some(old) = manager.0.lock().await.remove(&serial) {
        stop_child(old).await;
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
    manager.0.lock().await.insert(serial.clone(), LogcatSession { child, epoch });

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
