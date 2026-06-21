mod db_commands;
mod device_commands;
mod fs_commands;
mod git_commands;
mod process_commands;
mod pty_commands;
mod vm_commands;
mod watch_commands;

use std::path::PathBuf;

use pickforge_core::{pickforge_home, Database, PtyManager, VmServiceClient};

fn open_database() -> Database {
    let path = pickforge_home(None)
        .map(|home| PathBuf::from(home).join("pickforge.db"))
        .unwrap_or_else(|_| PathBuf::from("pickforge.db"));
    Database::open(&path).expect("failed to open pickforge database")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init());

    // The updater is desktop-only (no mobile self-update).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .manage(PtyManager::new())
        .manage(VmServiceClient::new())
        .manage(watch_commands::WatchManager::new())
        .manage(open_database())
        .invoke_handler(tauri::generate_handler![
            pty_commands::pty_spawn,
            pty_commands::pty_write,
            pty_commands::pty_resize,
            pty_commands::pty_kill,
            process_commands::detect_binaries,
            fs_commands::list_dir,
            fs_commands::read_text_file,
            fs_commands::path_basename,
            fs_commands::open_path,
            device_commands::target_detect,
            device_commands::find_nearest_pubspec,
            device_commands::adb_list_devices,
            device_commands::android_device_list,
            device_commands::android_launch_avd,
            device_commands::android_wait_for_device,
            device_commands::adb_screenshot,
            device_commands::adb_dump_uiautomator,
            git_commands::git_status,
            git_commands::git_diff,
            git_commands::git_discover_repos,
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
            db_commands::agent_run_insert,
            db_commands::agent_run_finish,
            vm_commands::vm_connect,
            vm_commands::vm_disconnect,
            vm_commands::vm_status,
            vm_commands::vm_get_vm,
            vm_commands::vm_widget_tree,
            vm_commands::vm_find_isolate,
            vm_commands::vm_set_selection,
            vm_commands::vm_show_select_mode,
            vm_commands::vm_selected_widget,
            vm_commands::vm_dispose_group,
            vm_commands::vm_screenshot,
            vm_commands::vm_widget_properties,
            vm_commands::inspect_dir,
            vm_commands::inspect_save,
            watch_commands::fs_watch_start,
            watch_commands::fs_watch_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running pickforge");
}
