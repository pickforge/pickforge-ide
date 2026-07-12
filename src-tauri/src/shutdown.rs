//! Exactly-once graceful shutdown for confirmed app-exit events.
//! Crash/SIGKILL containment is PR 2; remote lease cleanup is PR 3.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use pickforge_core::{
    agents::AgentChatManager, kill_recoverable_sessions_on_exit, PtyManager, TunnelManager,
    VoiceSessionManager,
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
    app.state::<PtyManager>().shutdown();
    if let Err(error) = kill_recoverable_sessions_on_exit(&runtime_base()) {
        eprintln!("recoverable session cleanup incomplete: {error}");
    }
    app.state::<pickforge_core::android::EmulatorManager>()
        .shutdown();
    app.state::<Arc<VoiceSessionManager>>().shutdown();
    app.state::<TunnelManager>().shutdown();

    let mirrors = app.state::<MirrorManager>().inner().clone();
    let logcats = app.state::<LogcatManager>().inner().clone();
    let oslogs = app.state::<OsLogManager>().inner().clone();
    tauri::async_runtime::block_on(async {
        let _ = tokio::join!(
            tokio::time::timeout(ASYNC_STOP_TIMEOUT, mirrors.shutdown()),
            tokio::time::timeout(ASYNC_STOP_TIMEOUT, logcats.shutdown()),
            tokio::time::timeout(ASYNC_STOP_TIMEOUT, oslogs.shutdown()),
        );
    });
}
