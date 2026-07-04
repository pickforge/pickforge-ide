//! iOS simulator commands. One-shot `simctl` ops run on blocking threads; log
//! streaming owns the `xcrun ... log stream` child and relays parsed os_log
//! events over a Tauri channel.

use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use pickforge_core::android::{DeviceEntry, DeviceKind, DeviceState};
use pickforge_core::ios::{
    oslog::{parse_oslog_line, OsLogEvent},
    simctl::{self, SimDevice, SimState},
};
use pickforge_core::user_shell_environment;
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
pub struct OsLogManager(Arc<Mutex<HashMap<String, OsLogSession>>>);

impl OsLogManager {
    pub fn new() -> Self {
        Self::default()
    }

    async fn replace_session(&self, udid: &str, session: OsLogSession) -> Option<OsLogSession> {
        self.0.lock().await.insert(udid.to_string(), session)
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
pub async fn oslog_start(
    app: AppHandle,
    manager: State<'_, OsLogManager>,
    udid: String,
    on_line: Channel<OsLogEvent>,
) -> Result<(), String> {
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

    if let Some(old) = manager
        .replace_session(&udid, OsLogSession { child, epoch })
        .await
    {
        stop_child(old).await;
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
