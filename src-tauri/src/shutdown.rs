//! Exactly-once graceful shutdown for confirmed app-exit events.
//! Crash/SIGKILL containment is PR 2; remote lease cleanup is PR 3.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use pickforge_core::{
    agents::AgentChatManager, close_recoverable_session_spawn_gate,
    kill_recoverable_sessions_on_exit, PtyManager, TunnelManager, VoiceSessionManager,
};
use tauri::Manager;

use crate::ios_commands::OsLogManager;
use crate::logcat_commands::LogcatManager;
use crate::mirror_commands::MirrorManager;
use crate::pty_commands::runtime_base;

const ASYNC_STOP_TIMEOUT: Duration = Duration::from_secs(5);

pub fn run_once(app: &tauri::AppHandle) {
    static DONE: AtomicBool = AtomicBool::new(false);
    if DONE.swap(true, Ordering::SeqCst) {
        return;
    }

    app.state::<AgentChatManager>().shutdown();
    let recoverable_deadline = Instant::now() + ASYNC_STOP_TIMEOUT;
    let incomplete_spawns = close_recoverable_session_spawn_gate(recoverable_deadline);
    if incomplete_spawns != 0 {
        eprintln!("recoverable spawn quiescence incomplete: {incomplete_spawns} owner(s)");
    }
    let incomplete_ptys = app.state::<PtyManager>().shutdown();
    if incomplete_ptys != 0 {
        eprintln!("PTY cleanup incomplete: {incomplete_ptys} session(s)");
    }
    if let Err(error) = kill_recoverable_sessions_on_exit(&runtime_base(), recoverable_deadline) {
        eprintln!("recoverable session cleanup incomplete: {error}");
    }
    app.state::<pickforge_core::android::EmulatorManager>()
        .shutdown();
    let incomplete_voice = app.state::<Arc<VoiceSessionManager>>().shutdown();
    if incomplete_voice != 0 {
        eprintln!("voice session cleanup incomplete: {incomplete_voice} session(s)");
    }
    app.state::<TunnelManager>().shutdown();

    let mirrors = app.state::<MirrorManager>().inner().clone();
    let logcats = app.state::<LogcatManager>().inner().clone();
    let oslogs = app.state::<OsLogManager>().inner().clone();
    tauri::async_runtime::block_on(async {
        let (mirror, logcat, oslog) = tokio::join!(
            tokio::time::timeout(ASYNC_STOP_TIMEOUT, mirrors.shutdown()),
            tokio::time::timeout(ASYNC_STOP_TIMEOUT, logcats.shutdown()),
            tokio::time::timeout(ASYNC_STOP_TIMEOUT, oslogs.shutdown()),
        );
        for (name, result) in [("mirror", mirror), ("logcat", logcat), ("oslog", oslog)] {
            if result.is_err() {
                eprintln!("{name} cleanup incomplete after {ASYNC_STOP_TIMEOUT:?}");
            }
        }
    });
}
