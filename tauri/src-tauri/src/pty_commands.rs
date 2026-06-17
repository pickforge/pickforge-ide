//! Tauri command layer adapting `pickforge_core::PtyManager` to IPC.
//!
//! Output streams over a per-session [`Channel`] (ordered + fast — the right
//! primitive for high throughput; events are explicitly *not*). Input, resize
//! and kill are request/response `invoke` commands.

use pickforge_core::{PtyEvent, PtyManager, SpawnOptions};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

/// One message in a session's output stream. Adjacently tagged so the JS side
/// switches on `type` and reads `data`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "data")]
pub enum PtyMessage {
    /// Raw bytes from the pty master (may split UTF-8 across chunks — the
    /// frontend's xterm `write(Uint8Array)` reassembles them).
    Output(Vec<u8>),
    /// The shell exited.
    Exit(Option<i32>),
}

#[tauri::command]
pub fn pty_spawn(
    manager: State<'_, PtyManager>,
    cwd: Option<String>,
    rows: u16,
    cols: u16,
    on_message: Channel<PtyMessage>,
) -> Result<u32, String> {
    let opts = SpawnOptions { cwd, rows, cols };
    manager
        .spawn(opts, move |event: PtyEvent| {
            let message = match event {
                PtyEvent::Output(bytes) => PtyMessage::Output(bytes),
                PtyEvent::Exit(code) => PtyMessage::Exit(code),
            };
            let _ = on_message.send(message);
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_write(manager: State<'_, PtyManager>, id: u32, data: Vec<u8>) -> Result<(), String> {
    manager.write(id, &data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(
    manager: State<'_, PtyManager>,
    id: u32,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    manager.resize(id, rows, cols).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(manager: State<'_, PtyManager>, id: u32) -> Result<(), String> {
    manager.kill(id).map_err(|e| e.to_string())
}
