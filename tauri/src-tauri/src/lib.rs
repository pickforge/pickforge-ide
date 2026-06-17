mod process_commands;
mod pty_commands;

use pickforge_core::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PtyManager::new())
        .invoke_handler(tauri::generate_handler![
            pty_commands::pty_spawn,
            pty_commands::pty_write,
            pty_commands::pty_resize,
            pty_commands::pty_kill,
            process_commands::detect_binaries,
        ])
        .run(tauri::generate_context!())
        .expect("error while running pickforge");
}
