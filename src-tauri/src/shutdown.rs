//! Exactly-once graceful shutdown for confirmed app-exit events.
//! Crash/SIGKILL containment is PR 2; remote lease cleanup is PR 3.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use pickforge_core::{
    agents::AgentChatManager, close_recoverable_session_spawn_gate,
    kill_recoverable_sessions_on_exit, PtyManager, TunnelManager, VoiceSessionManager,
};
use tauri::Manager;

use crate::ios_commands::OsLogManager;
use crate::logcat_commands::LogcatManager;
use crate::mirror_commands::MirrorManager;
use crate::pty_commands::runtime_base;

pub fn run_once(app: &tauri::AppHandle) {
    static DONE: AtomicBool = AtomicBool::new(false);
    if DONE.swap(true, Ordering::SeqCst) {
        return;
    }

    app.state::<AgentChatManager>().shutdown();
    close_recoverable_session_spawn_gate();
    let incomplete_ptys = app.state::<PtyManager>().shutdown();
    if incomplete_ptys != 0 {
        eprintln!("PTY cleanup incomplete: {incomplete_ptys} session(s)");
    }
    if let Err(error) = kill_recoverable_sessions_on_exit(&runtime_base()) {
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
        tokio::join!(mirrors.shutdown(), logcats.shutdown(), oslogs.shutdown());
    });
}
