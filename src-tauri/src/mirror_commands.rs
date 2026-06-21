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

/// Largest scrcpy control message we'll forward. The biggest legitimate message
/// (inject-text / set-clipboard) carries a short string; a touch/scroll/key
/// message is tens of bytes. A few KiB comfortably covers any single real
/// message while refusing an unbounded write to the device's control socket.
const MAX_CONTROL_BYTES: usize = 4 * 1024;

/// The highest scrcpy control message type byte the v3.x server speaks. The wire
/// type is the message's index in the server's control-message table; for the
/// pinned server (3.3.3 → the JS lib's 3.0 table) that table holds 18 entries,
/// so valid type bytes are `0..=17` (`InjectKeyCode`=0 … `ResetVideo`=17). The
/// first byte of a control message is its type; anything past this range isn't a
/// real message, so we reject it rather than write arbitrary leading bytes to
/// the socket. A conservative sanity check, not a full protocol parse — bump it
/// if `SERVER_VERSION` ever grows the table.
const MAX_CONTROL_TYPE: u8 = 17;

/// Reject a control payload that is empty, oversized, or not a recognised scrcpy
/// control message before it ever reaches the socket. Pulled out so it can be
/// unit-tested without a live device/session.
fn validate_control_payload(bytes: &[u8]) -> Result<(), String> {
    let Some(&type_byte) = bytes.first() else {
        return Err("empty control payload".into());
    };
    if bytes.len() > MAX_CONTROL_BYTES {
        return Err("control payload exceeds the maximum size".into());
    }
    if type_byte > MAX_CONTROL_TYPE {
        return Err("unknown control message type".into());
    }
    Ok(())
}

/// Write raw scrcpy control bytes (assembled in the UI) to the control socket.
#[tauri::command]
pub async fn mirror_send_control(
    manager: State<'_, MirrorManager>,
    serial: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    // Bound + sanity-check the payload BEFORE taking the control-socket lock, so
    // an empty, oversized, or bogus message is rejected without touching the
    // socket (and can't wedge or flood the device control channel).
    validate_control_payload(&bytes)?;
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

#[cfg(test)]
mod control_payload_tests {
    use super::*;

    #[test]
    fn rejects_an_empty_payload() {
        assert!(
            validate_control_payload(&[]).is_err(),
            "an empty control payload must be rejected",
        );
    }

    #[test]
    fn rejects_an_oversized_payload() {
        let big = vec![0u8; MAX_CONTROL_BYTES + 1];
        assert!(
            validate_control_payload(&big).is_err(),
            "a payload past the max size must be rejected",
        );
    }

    #[test]
    fn allows_a_normal_small_payload() {
        // A typical inject-touch message: type byte 2 (INJECT_TOUCH_EVENT)
        // followed by its fixed fields. Tens of bytes, well under the cap.
        let mut msg = vec![2u8];
        msg.extend_from_slice(&[0u8; 31]);
        assert!(
            validate_control_payload(&msg).is_ok(),
            "a normal small control message must be allowed",
        );
    }

    #[test]
    fn allows_a_payload_exactly_at_the_cap() {
        let mut msg = vec![0u8; MAX_CONTROL_BYTES];
        msg[0] = MAX_CONTROL_TYPE; // a recognised type byte
        assert!(
            validate_control_payload(&msg).is_ok(),
            "a payload exactly at the cap must be allowed",
        );
    }

    #[test]
    fn rejects_an_unknown_message_type() {
        let msg = vec![MAX_CONTROL_TYPE + 1, 0, 0, 0];
        assert!(
            validate_control_payload(&msg).is_err(),
            "a type byte past the known scrcpy range must be rejected",
        );
    }
}
