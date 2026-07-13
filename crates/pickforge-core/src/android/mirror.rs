//! scrcpy-server bridge for the device mirror. Rust owns the server process, the
//! adb reverse tunnel, and the sockets; it relays the raw video stream to the
//! webview (which decodes with WebCodecs via @yume-chan/scrcpy) and writes the
//! control protocol back. We pin scrcpy-server v3.3.3 to match the JS library,
//! and set `send_device_meta=false` so the video socket carries only the codec
//! metadata + frames the JS parser expects — no device-name header to strip.

use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

use crate::process::{run_timeout, user_shell_environment};

/// scrcpy-server version — MUST match the bundled jar and what
/// `@yume-chan/scrcpy` understands (its `latest` == 3.3.3).
pub const SERVER_VERSION: &str = "3.3.3";
const REMOTE_JAR: &str = "/data/local/tmp/scrcpy-server.jar";
const ADB_SETUP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, thiserror::Error)]
pub enum MirrorError {
    #[error("adb command failed: {0}")]
    Adb(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("timed out waiting for the scrcpy server to connect")]
    ConnectTimeout,
    #[error("mirror startup was cancelled")]
    Cancelled,
}

/// A live mirror: the server process, the (owned) sockets, and the tunnel id.
pub struct MirrorSession {
    pub serial: String,
    pub scid: String,
    pub child: Child,
    /// Taken by the video relay task once (`None` afterwards).
    pub video: Option<TcpStream>,
    /// Behind its own lock so a control write never blocks the mirror registry.
    pub control: Arc<Mutex<TcpStream>>,
}

fn adb(args: &[&str]) -> Result<(), MirrorError> {
    let ok = run_timeout("adb", args, None, None, ADB_SETUP_TIMEOUT)
        .map(|o| o.success())
        .unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err(MirrorError::Adb(
            args.get(2).copied().unwrap_or("adb").to_string(),
        ))
    }
}

/// A 31-bit hex socket id (matches scrcpy's `scid`), seeded by the clock + serial
/// so concurrent mirrors on the same host don't collide.
fn gen_scid(serial: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let salt = serial
        .bytes()
        .fold(0u32, |a, b| a.wrapping_mul(31).wrapping_add(b as u32));
    let v = ((nanos as u32) ^ salt) & 0x7fff_ffff;
    format!("{v:08x}")
}

/// Push the bundled server jar, open a reverse tunnel, launch the server, and
/// accept its two sockets (video, then control). The caller keeps the returned
/// session alive and must call [`stop_session`] to tear it down.
pub async fn start_session(serial: &str, jar_path: &Path) -> Result<MirrorSession, MirrorError> {
    start_session_cancellable(serial, jar_path, Arc::new(AtomicBool::new(false))).await
}

pub async fn start_session_cancellable(
    serial: &str,
    jar_path: &Path,
    cancelled: Arc<AtomicBool>,
) -> Result<MirrorSession, MirrorError> {
    let jar = jar_path.to_string_lossy();
    adb(&["-s", serial, "push", &jar, REMOTE_JAR])?;

    let scid = gen_scid(serial);
    let socket_name = format!("localabstract:scrcpy_{scid}");
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    adb(&[
        "-s",
        serial,
        "reverse",
        &socket_name,
        &format!("tcp:{port}"),
    ])?;

    // app_process runs the server jar's main. Reverse tunnel ⇒ no dummy byte.
    let scid_arg = format!("scid={scid}");
    let mut cmd = Command::new("adb");
    cmd.args([
        "-s",
        serial,
        "shell",
        "CLASSPATH=/data/local/tmp/scrcpy-server.jar",
        "app_process",
        "/",
        "com.genymobile.scrcpy.Server",
        SERVER_VERSION,
        &scid_arg,
        "log_level=info",
        "audio=false",
        "video=true",
        "video_codec=h264",
        "send_device_meta=false",
        "send_dummy_byte=false",
        "send_codec_meta=true",
        "send_frame_meta=true",
        "tunnel_forward=false",
        "control=true",
        "cleanup=true",
    ])
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .kill_on_drop(true);
    // Spawn with the login-shell env so `adb` resolves like the other Android
    // commands — GUI-launched apps otherwise have a minimal PATH.
    cmd.env_clear();
    for (k, v) in user_shell_environment() {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn()?;

    // The server connects video first, then control (audio disabled).
    let accept = async {
        let (video, _) = listener.accept().await?;
        let (control, _) = listener.accept().await?;
        Ok::<_, std::io::Error>((video, control))
    };
    let cancelled_wait = async {
        while !cancelled.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    };
    let (video, control) = tokio::select! {
        result = timeout(Duration::from_secs(15), accept) => match result {
            Ok(Ok(pair)) => pair,
            _ => {
                let _ = child.kill().await;
                remove_reverse(serial.to_string(), socket_name).await;
                return Err(MirrorError::ConnectTimeout);
            }
        },
        _ = cancelled_wait => {
            let _ = child.kill().await;
            remove_reverse(serial.to_string(), socket_name).await;
            return Err(MirrorError::Cancelled);
        }
    };
    let _ = video.set_nodelay(true);
    let _ = control.set_nodelay(true);

    Ok(MirrorSession {
        serial: serial.to_string(),
        scid,
        child,
        video: Some(video),
        control: Arc::new(Mutex::new(control)),
    })
}

const REVERSE_REMOVE_TIMEOUT: Duration = Duration::from_secs(1);

async fn remove_reverse(serial: String, socket_name: String) {
    let _ = tokio::task::spawn_blocking(move || {
        let args = [
            "-s",
            serial.as_str(),
            "reverse",
            "--remove",
            socket_name.as_str(),
        ];
        let _ = run_timeout("adb", &args, None, None, REVERSE_REMOVE_TIMEOUT);
    })
    .await;
}

/// Tear down a session. Reap the owned child first; reverse-tunnel cleanup is
/// best-effort and bounded so a wedged adb cannot stall app shutdown.
pub async fn stop_session(mut session: MirrorSession) {
    let _ = session.child.kill().await;
    remove_reverse(
        session.serial,
        format!("localabstract:scrcpy_{}", session.scid),
    )
    .await;
}
