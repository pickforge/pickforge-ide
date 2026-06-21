//! Device-mirror commands. Rust runs scrcpy-server + the adb tunnel (see
//! `pickforge_core::android::mirror`) and relays the raw video socket to the
//! webview over a `Channel<Response>` (bytes as an ArrayBuffer, like the PTY);
//! the webview decodes with WebCodecs. Control bytes (touch/scroll/text) are
//! assembled in the UI and written straight to the control socket here.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use pickforge_core::android::{start_session, stop_session, MirrorSession, SERVER_VERSION};
use pickforge_core::pickforge_home;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

/// The server jar is embedded so it ships with the binary (no resource-path
/// juggling across dev/bundle); it's written out to the PickForge home on use.
const SERVER_JAR: &[u8] = include_bytes!("../resources/scrcpy-server-v3.3.3");

#[derive(Default, Clone)]
pub struct MirrorManager(Arc<Mutex<HashMap<String, MirrorSession>>>);

impl MirrorManager {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Write the embedded jar to `~/.pickforge/scrcpy-server-<ver>.jar` and return it.
fn ensure_jar() -> Result<PathBuf, String> {
    let home = pickforge_home(None).map_err(|e| e.to_string())?;
    let path = PathBuf::from(home).join(format!("scrcpy-server-{SERVER_VERSION}.jar"));
    // Always (re)write — it's 90 KB and guarantees the bytes match the version.
    std::fs::write(&path, SERVER_JAR).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Start mirroring `serial`: launch the server, then relay its video socket to
/// `on_video`. Any existing session for the serial is replaced.
#[tauri::command]
pub async fn mirror_start(
    app: AppHandle,
    manager: State<'_, MirrorManager>,
    serial: String,
    on_video: Channel<Response>,
) -> Result<(), String> {
    if let Some(old) = manager.0.lock().await.remove(&serial) {
        stop_session(old).await;
    }
    let jar = ensure_jar()?;
    let mut session = start_session(&serial, &jar).await.map_err(|e| e.to_string())?;
    let video = session.video.take().ok_or("no video socket")?;
    let scid = session.scid.clone();
    manager.0.lock().await.insert(serial.clone(), session);

    let app = app.clone();
    let registry = manager.0.clone();
    tauri::async_runtime::spawn(relay_video(serial, scid, video, on_video, app, registry));
    Ok(())
}

async fn relay_video(
    serial: String,
    scid: String,
    mut video: tokio::net::TcpStream,
    channel: Channel<Response>,
    app: AppHandle,
    registry: Arc<Mutex<HashMap<String, MirrorSession>>>,
) {
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        match video.read(&mut buf).await {
            Ok(0) | Err(_) => break, // EOF or socket error → device gone / stopped
            Ok(n) => {
                if channel.send(Response::new(buf[..n].to_vec())).is_err() {
                    break; // the webview dropped the channel
                }
            }
        }
    }
    // Only tear down + signal if THIS session is still registered — a quick
    // stop+restart may have replaced it with a new session (different scid),
    // which this stale task must not kill.
    let mut reg = registry.lock().await;
    if reg.get(&serial).map(|s| s.scid == scid).unwrap_or(false) {
        let session = reg.remove(&serial);
        drop(reg);
        if let Some(session) = session {
            stop_session(session).await;
        }
        let _ = app.emit("mirror-disconnected", &serial);
    }
}

/// Write raw scrcpy control bytes (assembled in the UI) to the control socket.
#[tauri::command]
pub async fn mirror_send_control(
    manager: State<'_, MirrorManager>,
    serial: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    // Clone the per-session control handle and release the registry lock BEFORE
    // the (possibly blocking) socket write, so a stalled write can't wedge
    // mirror_start/mirror_stop/relay cleanup for every device.
    let control = {
        let reg = manager.0.lock().await;
        reg.get(&serial).ok_or("no active mirror for device")?.control.clone()
    };
    control.lock().await.write_all(&bytes).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn mirror_stop(manager: State<'_, MirrorManager>, serial: String) -> Result<(), String> {
    let session = manager.0.lock().await.remove(&serial);
    if let Some(session) = session {
        stop_session(session).await;
    }
    Ok(())
}
