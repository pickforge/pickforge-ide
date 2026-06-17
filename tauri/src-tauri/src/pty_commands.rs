//! Tauri command layer adapting `pickforge_core::PtyManager` to IPC.
//!
//! stdout streams over a per-session [`Channel<Response>`] — `Response` carries
//! the bytes as a raw IPC body (an ArrayBuffer on the JS side), avoiding the
//! JSON `number[]` bloat a `Channel<Vec<u8>>` would incur. Exit is a separate
//! small JSON channel. Input/resize/kill are request/response `invoke`s.

use pickforge_core::{PtyEvent, PtyManager, SpawnOptions};
use tauri::ipc::{Channel, Response};
use tauri::State;

#[tauri::command]
pub fn pty_spawn(
    manager: State<'_, PtyManager>,
    cwd: Option<String>,
    rows: u16,
    cols: u16,
    on_output: Channel<Response>,
    on_exit: Channel<Option<i32>>,
) -> Result<u32, String> {
    let opts = SpawnOptions { cwd, rows, cols };
    manager
        .spawn(opts, move |event: PtyEvent| match event {
            PtyEvent::Output(bytes) => {
                let _ = on_output.send(Response::new(bytes));
            }
            PtyEvent::Exit(code) => {
                let _ = on_exit.send(code);
            }
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
