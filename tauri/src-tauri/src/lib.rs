mod db_commands;
mod process_commands;
mod pty_commands;

use std::path::PathBuf;

use pickforge_core::{pickforge_home, Database, PtyManager};

fn open_database() -> Database {
    let path = pickforge_home(None)
        .map(|home| PathBuf::from(home).join("pickforge.db"))
        .unwrap_or_else(|_| PathBuf::from("pickforge.db"));
    Database::open(&path).expect("failed to open pickforge database")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PtyManager::new())
        .manage(open_database())
        .invoke_handler(tauri::generate_handler![
            pty_commands::pty_spawn,
            pty_commands::pty_write,
            pty_commands::pty_resize,
            pty_commands::pty_kill,
            process_commands::detect_binaries,
            db_commands::projects_list,
            db_commands::project_upsert,
            db_commands::project_set_archived,
            db_commands::project_touch,
            db_commands::project_delete,
            db_commands::chats_list,
            db_commands::chat_upsert,
            db_commands::chat_delete,
            db_commands::settings_get,
            db_commands::settings_upsert,
            db_commands::picks_list,
            db_commands::pick_insert,
            db_commands::runs_list,
            db_commands::run_insert,
            db_commands::run_finish,
        ])
        .run(tauri::generate_context!())
        .expect("error while running pickforge");
}
