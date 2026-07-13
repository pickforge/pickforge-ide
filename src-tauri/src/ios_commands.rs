//! iOS simulator commands. One-shot `simctl` ops run on blocking threads; log
//! streaming owns the `xcrun ... log stream` child and relays parsed os_log
//! events over a Tauri channel.

use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use pickforge_core::android::{A11yNode, DeviceEntry, DeviceKind, DeviceState};
use pickforge_core::ios::{
    oslog::{parse_oslog_line, OsLogEvent},
    simctl::{self, SimDevice, SimState},
};
use pickforge_core::{user_shell_environment, StartGate};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const MAX_OSLOG_LINE_BYTES: usize = 16 * 1024;

struct OsLogSession {
    child: Child,
    epoch: u64,
}

#[derive(Default, Clone)]
pub struct OsLogManager(
    Arc<Mutex<HashMap<String, OsLogSession>>>,
    Arc<AtomicBool>,
    Arc<StartGate>,
);

impl OsLogManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn is_shutting_down(&self) -> bool {
        self.1.load(Ordering::SeqCst)
    }

    async fn replace_session(
        &self,
        udid: &str,
        session: OsLogSession,
    ) -> Result<Option<OsLogSession>, OsLogSession> {
        let mut sessions = self.0.lock().await;
        if self.is_shutting_down() {
            return Err(session);
        }
        Ok(sessions.insert(udid.to_string(), session))
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
        let gate = Arc::clone(&self.2);
        let _ = tokio::task::spawn_blocking(move || gate.wait()).await;
    }
}

fn next_epoch() -> u64 {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    COUNTER.fetch_add(1, Ordering::Relaxed)
}

#[tauri::command]
pub async fn ios_device_list() -> Result<Vec<DeviceEntry>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }

    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            simctl::list_devices().map(|devices| {
                devices
                    .into_iter()
                    .map(sim_device_entry)
                    .collect::<Vec<DeviceEntry>>()
            })
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn ios_boot_device(udid: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || simctl::boot_device(&udid))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ios_screenshot(
    udid: String,
    output_dir: String,
    output_name: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        capture_ios_screenshot(&udid, &output_dir, &output_name)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ios_dump_accessibility(udid: String) -> Result<A11yNode, String> {
    tauri::async_runtime::spawn_blocking(move || {
        pickforge_core::ios::accessibility::dump_accessibility(&udid).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn oslog_start(
    app: AppHandle,
    manager: State<'_, OsLogManager>,
    udid: String,
    on_line: Channel<OsLogEvent>,
) -> Result<(), String> {
    let _start_permit = manager
        .2
        .begin()
        .map_err(|_| "os_log manager is shutting down".to_string())?;
    if manager.is_shutting_down() {
        return Err("os_log manager is shutting down".to_string());
    }
    let mut cmd = Command::new("xcrun");
    cmd.args([
        "simctl", "spawn", &udid, "log", "stream", "--style", "compact", "--level", "info",
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::null())
    .kill_on_drop(true);
    cmd.env_clear();
    for (k, v) in user_shell_environment() {
        cmd.env(k, v);
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("no os_log stdout")?;
    let epoch = next_epoch();

    match manager
        .replace_session(&udid, OsLogSession { child, epoch })
        .await
    {
        Ok(Some(old)) => stop_child(old).await,
        Ok(None) => {}
        Err(session) => {
            stop_child(session).await;
            return Err("os_log manager is shutting down".to_string());
        }
    }

    let registry = manager.0.clone();
    tauri::async_runtime::spawn(relay_lines(udid, epoch, stdout, on_line, app, registry));
    Ok(())
}

async fn relay_lines(
    udid: String,
    epoch: u64,
    stdout: tokio::process::ChildStdout,
    channel: Channel<OsLogEvent>,
    app: AppHandle,
    registry: Arc<Mutex<HashMap<String, OsLogSession>>>,
) {
    let mut lines = BufReader::new(stdout);
    loop {
        match next_bounded_line(&mut lines).await {
            Ok(Some(line)) => {
                if let Some(event) = parse_oslog_line(&line) {
                    if channel.send(event).is_err() {
                        break;
                    }
                }
            }
            Ok(None) | Err(_) => break,
        }
    }
    let mut reg = registry.lock().await;
    if reg.get(&udid).map(|s| s.epoch == epoch).unwrap_or(false) {
        if let Some(session) = reg.remove(&udid) {
            drop(reg);
            stop_child(session).await;
        }
        let _ = app.emit("oslog-disconnected", &udid);
    }
}

async fn next_bounded_line(
    reader: &mut BufReader<tokio::process::ChildStdout>,
) -> std::io::Result<Option<String>> {
    let mut out = Vec::new();
    let mut saw_bytes = false;

    loop {
        let (consume_len, line_done, eof) = {
            let available = reader.fill_buf().await?;
            if available.is_empty() {
                (0, true, true)
            } else {
                saw_bytes = true;
                let consume_len = available
                    .iter()
                    .position(|&b| b == b'\n')
                    .map(|i| i + 1)
                    .unwrap_or(available.len());
                let remaining = MAX_OSLOG_LINE_BYTES.saturating_sub(out.len());
                if remaining > 0 {
                    out.extend_from_slice(&available[..consume_len.min(remaining)]);
                }
                let line_done = available.get(consume_len.saturating_sub(1)) == Some(&b'\n');
                (consume_len, line_done, false)
            }
        };

        if eof {
            if !saw_bytes && out.is_empty() {
                return Ok(None);
            }
            break;
        }

        reader.consume(consume_len);
        if line_done {
            break;
        }
    }

    while matches!(out.last(), Some(b'\n' | b'\r')) {
        out.pop();
    }
    Ok(Some(String::from_utf8_lossy(&out).into_owned()))
}

async fn stop_child(mut session: OsLogSession) {
    let _ = session.child.kill().await;
}

#[tauri::command]
pub async fn oslog_stop(manager: State<'_, OsLogManager>, udid: String) -> Result<(), String> {
    let session = manager.0.lock().await.remove(&udid);
    if let Some(session) = session {
        stop_child(session).await;
    }
    Ok(())
}

fn sim_device_entry(device: SimDevice) -> DeviceEntry {
    DeviceEntry {
        serial: Some(device.udid),
        avd_id: None,
        display_name: format!("{} ({})", device.name, device.runtime),
        state: match device.state {
            SimState::Booted => DeviceState::Running,
            SimState::Shutdown => DeviceState::Stopped,
            SimState::Other => DeviceState::Offline,
        },
        kind: DeviceKind::Simulator,
    }
}

pub(crate) fn capture_ios_screenshot(
    udid: &str,
    output_dir: &str,
    output_name: &str,
) -> Option<String> {
    if output_name.is_empty() || output_name.contains('/') || output_name.contains('\\') {
        return None;
    }
    let bytes = simctl::capture_screenshot(udid).ok()?;
    std::fs::create_dir_all(output_dir).ok()?;
    let path = Path::new(output_dir).join(output_name);
    std::fs::write(&path, bytes).ok()?;
    Some(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spawn_sleeper() -> Child {
        Command::new("sleep")
            .arg("30")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .expect("spawn sleep")
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn shutdown_kills_all_streams_and_is_idempotent() {
        let manager = OsLogManager::new();
        let first = spawn_sleeper();
        let second = spawn_sleeper();
        let first_pid = first.id().expect("first pid");
        let second_pid = second.id().expect("second pid");
        let _ = manager
            .replace_session(
                "udid-1",
                OsLogSession {
                    child: first,
                    epoch: next_epoch(),
                },
            )
            .await;
        let _ = manager
            .replace_session(
                "udid-2",
                OsLogSession {
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

        let raced = OsLogSession {
            child: spawn_sleeper(),
            epoch: next_epoch(),
        };
        let raced_pid = raced.child.id().expect("raced pid");
        let raced = match manager.replace_session("udid-3", raced).await {
            Err(raced) => raced,
            Ok(_) => panic!("shutdown gate must reject raced session"),
        };
        stop_child(raced).await;
        assert_ne!(unsafe { libc::kill(raced_pid as i32, 0) }, 0);
    }
}
