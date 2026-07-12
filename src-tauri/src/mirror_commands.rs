//! Device-mirror commands. Rust runs scrcpy-server + the adb tunnel (see
//! `pickforge_core::android::mirror`) and relays the raw video socket to the
//! webview over a `Channel<Response>` (bytes as an ArrayBuffer, like the PTY);
//! the webview decodes with WebCodecs. Control bytes (touch/scroll/text) are
//! assembled in the UI and written straight to the control socket here.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
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
pub struct MirrorManager(
    Arc<Mutex<HashMap<String, MirrorSession>>>,
    Arc<AtomicBool>,
);

impl MirrorManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn is_shutting_down(&self) -> bool {
        self.1.load(Ordering::SeqCst)
    }

    async fn replace_session(
        &self,
        serial: &str,
        session: MirrorSession,
    ) -> Result<Option<MirrorSession>, MirrorSession> {
        let mut sessions = self.0.lock().await;
        if self.is_shutting_down() {
            return Err(session);
        }
        Ok(sessions.insert(serial.to_string(), session))
    }

    pub async fn shutdown(&self) {
        self.1.store(true, Ordering::SeqCst);
        let sessions = {
            let mut reg = self.0.lock().await;
            reg.drain().map(|(_, session)| session).collect::<Vec<_>>()
        };
        for session in sessions {
            stop_session(session).await;
        }
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
    if manager.is_shutting_down() {
        return Err("mirror manager is shutting down".to_string());
    }
    if let Some(old) = manager.0.lock().await.remove(&serial) {
        stop_session(old).await;
    }
    let jar = ensure_jar()?;
    let mut session = start_session(&serial, &jar).await.map_err(|e| e.to_string())?;
    let Some(video) = session.video.take() else {
        stop_session(session).await;
        return Err("no video socket".to_string());
    };
    let scid = session.scid.clone();
    match manager.replace_session(&serial, session).await {
        Ok(Some(old)) => stop_session(old).await,
        Ok(None) => {}
        Err(session) => {
            stop_session(session).await;
            return Err("mirror manager is shutting down".to_string());
        }
    }

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

/// How long a single scrcpy control message of a given type must be on the wire.
/// Forwarding raw bytes blind lets a renderer write a *partial* message — e.g. a
/// lone `[2]` for `InjectTouch` — and the scrcpy server, which reads each message
/// as a fixed-size (or self-describing) record, then treats the next real packet
/// as the rest of that truncated one and stays wedged. So we model each type's
/// wire length and require the payload to be exactly one well-formed message.
enum ControlLen {
    /// The whole message is this many bytes, type byte included.
    Fixed(usize),
    /// `header` fixed bytes, then a length-prefixed body. `prefix_at` is the byte
    /// offset of the big-endian length field, `prefix_width` its size (1/2/4),
    /// and the total must be exactly `header + <decoded prefix>`.
    Prefixed { header: usize, prefix_at: usize, prefix_width: usize },
    /// Two length-prefixed bodies back to back (only `UHidCreate`): a u8-prefixed
    /// name then a u16-prefixed descriptor. `header` covers the bytes up to and
    /// including the first prefix; the second prefix sits right after the name.
    UHidCreate { header: usize, first_at: usize },
}

/// The scrcpy 3.3.3 server's control-message wire format, keyed by the type byte
/// (the message's index in the server's control table — `InjectKeyCode`=0 …
/// `ResetVideo`=17). Lengths verified against the v3.3.3 server's
/// `ControlMessageReader`. A type byte outside this table isn't a real message.
/// Bump alongside `SERVER_VERSION` if the server's table ever changes.
fn control_len(type_byte: u8) -> Option<ControlLen> {
    use ControlLen::*;
    Some(match type_byte {
        0 => Fixed(14),  // InjectKeyCode: action1 + keyCode4 + repeat4 + metaState4
        1 => Prefixed { header: 5, prefix_at: 1, prefix_width: 4 }, // InjectText: u32 text
        2 => Fixed(32),  // InjectTouch
        3 => Fixed(21),  // InjectScroll
        4 => Fixed(2),   // BackOrScreenOn: action1
        5 => Fixed(1),   // ExpandNotificationPanel
        6 => Fixed(1),   // ExpandSettingsPanel
        7 => Fixed(1),   // CollapsePanels
        8 => Fixed(2),   // GetClipboard: copyKey1
        9 => Prefixed { header: 14, prefix_at: 10, prefix_width: 4 }, // SetClipboard: seq8+paste1+u32 text
        10 => Fixed(2),  // SetDisplayPower: on1
        11 => Fixed(1),  // RotateDevice
        // UHidCreate: id2 + vendorId2 + productId2 + u8 name + u16 descriptor
        12 => UHidCreate { header: 8, first_at: 7 },
        13 => Prefixed { header: 5, prefix_at: 3, prefix_width: 2 }, // UHidInput: id2 + u16 data
        14 => Fixed(3),  // UHidDestroy: id2
        15 => Fixed(1),  // OpenHardKeyboardSettings
        16 => Prefixed { header: 2, prefix_at: 1, prefix_width: 1 }, // StartApp: u8 name
        17 => Fixed(1),  // ResetVideo
        _ => return None,
    })
}

/// Read a big-endian unsigned length prefix of `width` bytes (1/2/4) at `at`.
/// Returns None if it would read past the slice.
fn read_prefix(bytes: &[u8], at: usize, width: usize) -> Option<usize> {
    let end = at.checked_add(width)?;
    let field = bytes.get(at..end)?;
    Some(field.iter().fold(0usize, |acc, &b| (acc << 8) | b as usize))
}

/// Reject a control payload that is empty, oversized, of an unknown type, or
/// truncated/over-claiming for its type, before it ever reaches the socket.
/// Validates each message is exactly one well-formed scrcpy control message so a
/// partial or padded write can't desync the device's control stream. Pulled out
/// so it can be unit-tested without a live device/session.
fn validate_control_payload(bytes: &[u8]) -> Result<(), String> {
    let Some(&type_byte) = bytes.first() else {
        return Err("empty control payload".into());
    };
    if bytes.len() > MAX_CONTROL_BYTES {
        return Err("control payload exceeds the maximum size".into());
    }
    let Some(spec) = control_len(type_byte) else {
        return Err("unknown control message type".into());
    };
    let expected = match spec {
        ControlLen::Fixed(n) => n,
        ControlLen::Prefixed { header, prefix_at, prefix_width } => {
            if bytes.len() < header {
                return Err("truncated control message header".into());
            }
            let body = read_prefix(&bytes, prefix_at, prefix_width)
                .ok_or("truncated control message length prefix")?;
            header
                .checked_add(body)
                .ok_or("control message length overflow")?
        }
        ControlLen::UHidCreate { header, first_at } => {
            if bytes.len() < header {
                return Err("truncated control message header".into());
            }
            // u8 name length, then a u16 descriptor length right after the name.
            let name = read_prefix(&bytes, first_at, 1)
                .ok_or("truncated control message length prefix")?;
            let desc_at = header.checked_add(name).ok_or("control message length overflow")?;
            let desc = read_prefix(&bytes, desc_at, 2)
                .ok_or("truncated control message length prefix")?;
            desc_at
                .checked_add(2)
                .and_then(|n| n.checked_add(desc))
                .ok_or("control message length overflow")?
        }
    };
    if bytes.len() != expected {
        return Err("malformed control message length for its type".into());
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
mod shutdown_tests {
    use super::*;

    async fn fake_session(scid: &str) -> (MirrorSession, u32) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let control = tokio::net::TcpStream::connect(listener.local_addr().unwrap())
            .await
            .unwrap();
        let child = tokio::process::Command::new("sleep")
            .arg("30")
            .kill_on_drop(true)
            .spawn()
            .expect("spawn sleep");
        let pid = child.id().expect("child pid");
        (
            MirrorSession {
                serial: "emulator-5554".to_string(),
                scid: scid.to_string(),
                child,
                video: None,
                control: Arc::new(Mutex::new(control)),
            },
            pid,
        )
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn shutdown_kills_all_sessions_and_is_idempotent() {
        let (session, pid) = fake_session("00000001").await;
        let manager = MirrorManager::new();
        manager
            .0
            .lock()
            .await
            .insert("emulator-5554".to_string(), session);

        manager.shutdown().await;

        assert!(manager.0.lock().await.is_empty(), "registry must drain");
        assert_ne!(
            unsafe { libc::kill(pid as i32, 0) },
            0,
            "mirror server child must be dead after shutdown",
        );

        manager.shutdown().await;
        assert!(manager.0.lock().await.is_empty());

        let (raced, raced_pid) = fake_session("00000002").await;
        let raced = match manager.replace_session("emulator-5554", raced).await {
            Err(raced) => raced,
            Ok(_) => panic!("shutdown gate must reject raced session"),
        };
        stop_session(raced).await;
        assert_ne!(unsafe { libc::kill(raced_pid as i32, 0) }, 0);
    }
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
    fn allows_a_well_formed_inject_touch() {
        // type byte 2 (InjectTouch) is a fixed 32-byte message.
        let mut msg = vec![2u8];
        msg.extend_from_slice(&[0u8; 31]);
        assert_eq!(msg.len(), 32);
        assert!(
            validate_control_payload(&msg).is_ok(),
            "a well-formed inject-touch message must be allowed",
        );
    }

    #[test]
    fn rejects_a_truncated_fixed_message() {
        // A lone `[2]` claims InjectTouch but carries none of its 31 fixed bytes;
        // scrcpy would consume the next packet as the rest — exactly the wedge.
        assert!(
            validate_control_payload(&[2u8]).is_err(),
            "a truncated fixed-size control message must be rejected",
        );
        // One byte short of the 32-byte message is still malformed.
        let short = vec![2u8; 31];
        assert!(
            validate_control_payload(&short).is_err(),
            "a fixed-size message one byte short must be rejected",
        );
    }

    #[test]
    fn rejects_a_fixed_message_with_a_trailing_byte() {
        // A correct InjectTouch plus one stray byte isn't a single message.
        let mut msg = vec![2u8; 33];
        msg[0] = 2;
        assert!(
            validate_control_payload(&msg).is_err(),
            "a fixed-size message with trailing bytes must be rejected",
        );
    }

    #[test]
    fn allows_a_well_formed_inject_text() {
        // type 1 InjectText: type1 + u32 length + that many text bytes.
        let text = b"hello";
        let mut msg = vec![1u8];
        msg.extend_from_slice(&(text.len() as u32).to_be_bytes());
        msg.extend_from_slice(text);
        assert!(
            validate_control_payload(&msg).is_ok(),
            "a well-formed length-prefixed inject-text must be allowed",
        );
    }

    #[test]
    fn rejects_inject_text_claiming_more_than_provided() {
        // The u32 length prefix claims 100 bytes of text but only 3 are present —
        // scrcpy would block waiting for the rest. Reject it.
        let mut msg = vec![1u8];
        msg.extend_from_slice(&100u32.to_be_bytes());
        msg.extend_from_slice(b"abc");
        assert!(
            validate_control_payload(&msg).is_err(),
            "an over-claiming length prefix must be rejected",
        );
    }

    #[test]
    fn rejects_inject_text_with_a_short_body() {
        // Prefix says 2 bytes but 5 follow — a padded/short-body message.
        let mut msg = vec![1u8];
        msg.extend_from_slice(&2u32.to_be_bytes());
        msg.extend_from_slice(b"abcde");
        assert!(
            validate_control_payload(&msg).is_err(),
            "a length prefix shorter than the body must be rejected",
        );
    }

    #[test]
    fn rejects_inject_text_with_a_truncated_prefix() {
        // type1 + only 2 of the 4 length-prefix bytes.
        let msg = vec![1u8, 0, 0];
        assert!(
            validate_control_payload(&msg).is_err(),
            "a message cut off inside its length prefix must be rejected",
        );
    }

    #[test]
    fn allows_an_empty_text_message() {
        // A zero-length InjectText is exactly the 5-byte header.
        let mut msg = vec![1u8];
        msg.extend_from_slice(&0u32.to_be_bytes());
        assert!(
            validate_control_payload(&msg).is_ok(),
            "a zero-length text message (header only) must be allowed",
        );
    }

    #[test]
    fn allows_a_well_formed_uhid_create() {
        // type 12 UHidCreate: id2+vendorId2+productId2 + u8 name-len + name +
        // u16 desc-len + desc. Use a 2-byte name and a 3-byte descriptor.
        let mut msg = vec![12u8, 0, 1, 0, 2, 0, 3]; // type + id + vendor + product
        msg.push(2); // name length (u8)
        msg.extend_from_slice(b"hi"); // name
        msg.extend_from_slice(&3u16.to_be_bytes()); // descriptor length (u16)
        msg.extend_from_slice(&[0xaa, 0xbb, 0xcc]); // descriptor
        assert!(
            validate_control_payload(&msg).is_ok(),
            "a well-formed UHidCreate with both length prefixes must be allowed",
        );
    }

    #[test]
    fn rejects_a_uhid_create_with_a_lying_descriptor_length() {
        let mut msg = vec![12u8, 0, 1, 0, 2, 0, 3];
        msg.push(2);
        msg.extend_from_slice(b"hi");
        msg.extend_from_slice(&9u16.to_be_bytes()); // claims 9 descriptor bytes…
        msg.extend_from_slice(&[0xaa]); // …but provides one
        assert!(
            validate_control_payload(&msg).is_err(),
            "a UHidCreate whose descriptor length doesn't match must be rejected",
        );
    }

    #[test]
    fn allows_each_empty_control_message() {
        // The single-byte (type-only) messages: panels, rotate, reset, etc.
        for t in [5u8, 6, 7, 11, 15, 17] {
            assert!(
                validate_control_payload(&[t]).is_ok(),
                "the empty control message type {t} must be allowed",
            );
            assert!(
                validate_control_payload(&[t, 0]).is_err(),
                "an empty control message type {t} with a trailing byte must be rejected",
            );
        }
    }

    #[test]
    fn rejects_an_unknown_message_type() {
        let msg = vec![18u8, 0, 0, 0]; // 18 is past ResetVideo (17)
        assert!(
            validate_control_payload(&msg).is_err(),
            "a type byte past the known scrcpy range must be rejected",
        );
    }
}
