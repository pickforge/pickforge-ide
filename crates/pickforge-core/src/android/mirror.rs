//! scrcpy-server bridge for the device mirror. Rust owns the server process, the
//! adb reverse tunnel, and the sockets; it relays the raw video stream to the
//! webview (which decodes with WebCodecs via @yume-chan/scrcpy) and writes the
//! control protocol back. We pin scrcpy-server v3.3.3 to match the JS library,
//! and set `send_device_meta=false` so the video socket carries only the codec
//! metadata + frames the JS parser expects — no device-name header to strip.

use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};
use tokio::time::timeout;

use crate::process::run;

/// scrcpy-server version — MUST match the bundled jar and what
/// `@yume-chan/scrcpy` understands (its `latest` == 3.3.3).
pub const SERVER_VERSION: &str = "3.3.3";
const REMOTE_JAR: &str = "/data/local/tmp/scrcpy-server.jar";

#[derive(Debug, thiserror::Error)]
pub enum MirrorError {
    #[error("adb command failed: {0}")]
    Adb(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("timed out waiting for the scrcpy server to connect")]
    ConnectTimeout,
}

/// A live mirror: the server process, the (owned) sockets, and the tunnel id.
pub struct MirrorSession {
    pub serial: String,
    pub scid: String,
    pub child: Child,
    /// Taken by the video relay task once (`None` afterwards).
    pub video: Option<TcpStream>,
    pub control: TcpStream,
}

fn adb(args: &[&str]) -> Result<(), MirrorError> {
    let ok = run("adb", args, None, None).map(|o| o.success()).unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err(MirrorError::Adb(args.get(2).copied().unwrap_or("adb").to_string()))
    }
}

/// A 31-bit hex socket id (matches scrcpy's `scid`), seeded by the clock + serial
/// so concurrent mirrors on the same host don't collide.
fn gen_scid(serial: &str) -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let salt = serial.bytes().fold(0u32, |a, b| a.wrapping_mul(31).wrapping_add(b as u32));
    let v = ((nanos as u32) ^ salt) & 0x7fff_ffff;
    format!("{v:08x}")
}

/// Push the bundled server jar, open a reverse tunnel, launch the server, and
/// accept its two sockets (video, then control). The caller keeps the returned
/// session alive and must call [`stop_session`] to tear it down.
pub async fn start_session(serial: &str, jar_path: &Path) -> Result<MirrorSession, MirrorError> {
    let jar = jar_path.to_string_lossy();
    adb(&["-s", serial, "push", &jar, REMOTE_JAR])?;

    let scid = gen_scid(serial);
    let socket_name = format!("localabstract:scrcpy_{scid}");
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    adb(&["-s", serial, "reverse", &socket_name, &format!("tcp:{port}")])?;

    // app_process runs the server jar's main. Reverse tunnel ⇒ no dummy byte.
    let scid_arg = format!("scid={scid}");
    let mut child = Command::new("adb")
        .args([
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
        .kill_on_drop(true)
        .spawn()?;

    // The server connects video first, then control (audio disabled).
    let accept = async {
        let (video, _) = listener.accept().await?;
        let (control, _) = listener.accept().await?;
        Ok::<_, std::io::Error>((video, control))
    };
    let (video, control) = match timeout(Duration::from_secs(15), accept).await {
        Ok(Ok(pair)) => pair,
        _ => {
            let _ = child.kill().await;
            let _ = adb(&["-s", serial, "reverse", "--remove", &socket_name]);
            return Err(MirrorError::ConnectTimeout);
        }
    };
    let _ = video.set_nodelay(true);
    let _ = control.set_nodelay(true);

    Ok(MirrorSession {
        serial: serial.to_string(),
        scid,
        child,
        video: Some(video),
        control,
    })
}

/// Tear down a session: remove the tunnel and kill the server process.
pub async fn stop_session(mut session: MirrorSession) {
    let socket_name = format!("localabstract:scrcpy_{}", session.scid);
    let _ = adb(&["-s", &session.serial, "reverse", "--remove", &socket_name]);
    let _ = session.child.kill().await;
}
