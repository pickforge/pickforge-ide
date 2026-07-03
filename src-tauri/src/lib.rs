mod agent_chat_commands;
mod cdp_commands;
mod db_commands;
mod device_commands;
mod fs_commands;
mod git_commands;
mod logcat_commands;
mod mcp_commands;
mod mirror_commands;
mod process_commands;
mod pty_commands;
mod vm_commands;
mod watch_commands;

use std::path::PathBuf;
use std::sync::Arc;

use pickforge_core::{
    agents::AgentChatManager, pickforge_home, CdpClient, Database, PtyManager, VmServiceClient,
};
use tauri::{path::BaseDirectory, Manager};

fn open_database() -> Arc<Database> {
    let path = pickforge_home(None)
        .map(|home| PathBuf::from(home).join("pickforge.db"))
        .unwrap_or_else(|_| PathBuf::from("pickforge.db"));
    Arc::new(Database::open(&path).expect("failed to open pickforge database"))
}

fn resolve_agent_app_root(app: &tauri::App) -> PathBuf {
    let dev_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    match app
        .path()
        .resolve("scripts/claude-bridge.ts", BaseDirectory::Resource)
    {
        Ok(path) if path.exists() => path
            .parent()
            .and_then(|scripts_dir| scripts_dir.parent())
            .map(PathBuf::from)
            .unwrap_or(dev_root),
        _ => dev_root,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Linux/Wayland: force the window's app_id to the bundle identifier. GTK derives
    // xdg_toplevel.set_app_id from g_get_prgname(), which defaults to the binary name
    // ("pickforge-tauri") — `enableGTKAppId` does NOT override it under WebKitGTK. This
    // must run before any GTK/display/window init (i.e. before tauri::Builder), so the
    // installed dev.pickforge.app.desktop + icon match. set_application_name sets the
    // human-readable name shown by some shells.
    #[cfg(target_os = "linux")]
    {
        gtk::glib::set_prgname(Some("dev.pickforge.app"));
        gtk::glib::set_application_name("PickForge");
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init());

    // The updater is desktop-only (no mobile self-update).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    let database = open_database();
    // Allowlist of filesystem roots the renderer may browse/read/open: PickForge
    // home plus every known project root. Seeded from the DB before the app runs;
    // a new root is added only by the user-mediated `pick_project_dir`, and
    // `project_delete`/`project_set_archived` reseed it as projects leave the set.
    let approved_roots = fs_commands::ApprovedRoots::default();
    fs_commands::seed_approved_roots(&approved_roots, database.as_ref());
    let manager_database = Arc::clone(&database);

    builder
        .setup(move |app| {
            app.manage(AgentChatManager::new(
                Arc::clone(&manager_database),
                resolve_agent_app_root(app),
            ));
            Ok(())
        })
        .manage(PtyManager::new())
        .manage(VmServiceClient::new())
        .manage(CdpClient::new())
        .manage(watch_commands::WatchManager::new())
        .manage(mirror_commands::MirrorManager::new())
        .manage(logcat_commands::LogcatManager::new())
        .manage(approved_roots)
        .manage(Arc::clone(&database))
        .manage(mcp_commands::McpState::new())
        .invoke_handler(tauri::generate_handler![
            pty_commands::pty_spawn,
            pty_commands::pty_write,
            pty_commands::pty_resize,
            pty_commands::pty_kill,
            pty_commands::pty_detach,
            pty_commands::pty_spawn_chat,
            pty_commands::pty_destroy_chat_session,
            process_commands::detect_binaries,
            fs_commands::list_dir,
            fs_commands::read_text_file,
            fs_commands::read_image_data_url,
            fs_commands::path_basename,
            fs_commands::open_path,
            fs_commands::pick_project_dir,
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
            git_commands::git_log_graph,
            db_commands::projects_list,
            db_commands::project_upsert,
            db_commands::project_set_archived,
            db_commands::project_touch,
            db_commands::project_delete,
            db_commands::update_project_sort_order,
            db_commands::chats_list,
            db_commands::chat_upsert,
            db_commands::chat_delete,
            db_commands::update_chat_title,
            db_commands::update_chat_session_id,
            db_commands::update_chat_sort_order,
            db_commands::orchestra_task_upsert,
            db_commands::orchestra_task_delete,
            db_commands::orchestra_tasks_list,
            db_commands::agent_usage_summary,
            db_commands::settings_get,
            db_commands::settings_upsert,
            db_commands::picks_list,
            db_commands::pick_insert,
            db_commands::runs_list,
            db_commands::run_insert,
            db_commands::run_finish,
            db_commands::agent_run_insert,
            db_commands::agent_run_finish,
            agent_chat_commands::agent_chat_start,
            agent_chat_commands::agent_chat_send,
            agent_chat_commands::agent_chat_set_model,
            agent_chat_commands::agent_chat_dispose,
            agent_chat_commands::agent_chat_interrupt,
            agent_chat_commands::agent_chat_approve,
            agent_chat_commands::agent_chat_steer,
            agent_chat_commands::agent_chat_history,
            agent_chat_commands::agent_skills_list,
            agent_chat_commands::agent_stash_image,
            agent_chat_commands::codex_config_default_effort,
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
            cdp_commands::cdp_discover,
            cdp_commands::cdp_attach,
            cdp_commands::cdp_detach,
            cdp_commands::cdp_status,
            cdp_commands::cdp_dom_tree,
            cdp_commands::cdp_map_source,
            cdp_commands::cdp_fetch_source_map,
            watch_commands::fs_watch_start,
            watch_commands::fs_watch_stop,
            mirror_commands::mirror_start,
            mirror_commands::mirror_send_control,
            mirror_commands::mirror_stop,
            logcat_commands::logcat_start,
            logcat_commands::logcat_stop,
            mcp_commands::mcp_start,
            mcp_commands::mcp_stop,
            mcp_commands::mcp_publish_state,
            mcp_commands::mcp_push_log,
            mcp_commands::mcp_run_started,
        ])
        .run(tauri::generate_context!())
        .expect("error while running pickforge");
}
