mod agent_chat_commands;
mod cdp_commands;
mod db_commands;
mod device_commands;
mod fs_commands;
mod git_commands;
#[cfg(target_os = "linux")]
mod graphics_commands;
mod ios_commands;
mod logcat_commands;
mod mcp_commands;
mod mirror_commands;
mod operator_commands;
mod picklab_commands;
mod process_commands;
mod project_roots;
mod pty_commands;
mod remote_commands;
mod shutdown;
mod telemetry_commands;
#[cfg(test)]
mod test_support;
mod voice_commands;
mod vm_commands;
mod watch_commands;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use pickforge_core::{
    agents::AgentChatManager, load_telemetry_config, pickforge_home, CdpClient, Database,
    PickforgeHomeError, PtyManager, TunnelManager, VmServiceClient, VoiceSessionManager,
};
use tauri::{path::BaseDirectory, Manager, RunEvent};
#[cfg(any(target_os = "linux", all(target_os = "windows", debug_assertions)))]
use tauri_plugin_deep_link::DeepLinkExt;

const SENTRY_DSN: &str =
    "https://14e43b283ec20c3174df7b690d812d1c@o4511699702317056.ingest.us.sentry.io/4511699813728261";

fn resolve_database_path(
    env: Option<&HashMap<String, String>>,
) -> Result<PathBuf, PickforgeHomeError> {
    pickforge_home(env).map(|home| PathBuf::from(home).join("pickforge.db"))
}

fn open_database() -> Arc<Database> {
    let path = resolve_database_path(None)
        .expect("resolve PickForge home directory (set PICKFORGE_HOME to override)");
    Arc::new(Database::open(&path).expect("failed to open pickforge database"))
}

fn bridge_app_root(bridge_path: &Path, dev_root: PathBuf) -> PathBuf {
    bridge_path
        .parent()
        .and_then(|scripts_dir| scripts_dir.parent())
        .map(PathBuf::from)
        .unwrap_or(dev_root)
}

fn resolve_agent_app_root(app: &tauri::App) -> PathBuf {
    let dev_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    match app
        .path()
        .resolve("scripts/claude-bridge.ts", BaseDirectory::Resource)
    {
        Ok(path) if path.exists() => bridge_app_root(&path, dev_root),
        _ => dev_root,
    }
}

fn resolve_pi_session_root(app: &tauri::App) -> PathBuf {
    let root = pickforge_home(None)
        .ok()
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .unwrap_or_else(|| {
            app.path()
                .app_data_dir()
                .expect("resolve durable PickForge user-data directory")
        });
    assert!(
        root.is_absolute(),
        "PickForge user-data directory must be absolute"
    );
    root
}

fn file_name_only(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .find(|part| !part.is_empty())
        .unwrap_or(path)
        .to_string()
}

fn strip_debug_image_paths(event: &mut sentry::protocol::Event<'_>) {
    for image in &mut event.debug_meta.to_mut().images {
        match image {
            sentry::protocol::DebugImage::Symbolic(image) => {
                image.name = file_name_only(&image.name);
                if let Some(debug_file) = &mut image.debug_file {
                    *debug_file = file_name_only(debug_file);
                }
            }
            sentry::protocol::DebugImage::Wasm(image) => {
                image.code_file = file_name_only(&image.code_file);
                if let Some(debug_file) = &mut image.debug_file {
                    *debug_file = file_name_only(debug_file);
                }
            }
            _ => {}
        }
    }
}

fn scrub_event(mut event: sentry::protocol::Event<'static>) -> sentry::protocol::Event<'static> {
    event.server_name = None;
    event.breadcrumbs = Default::default();
    strip_debug_image_paths(&mut event);
    event
}

fn sentry_enabled(consent: bool, debug_override: Option<&str>) -> bool {
    consent && (!cfg!(debug_assertions) || debug_override == Some("1"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Start the local crash-containment layer (#208 PR 2) when opted in via
/// `PICKFORGE_LOCAL_CRASH_CONTAINMENT` (compiled default: off — the guardian
/// must start before any frontend flag state exists, so a WebView-side flag
/// cannot gate it). Unix spawns the guardian child; Windows creates the
/// kill-on-close Job Object. Owned spawns register with it automatically.
fn start_crash_containment() {
    if !pickforge_core::local_crash_containment_enabled() {
        return;
    }
    let environment = pickforge_core::user_shell_environment();
    let ctx = pickforge_core::ContainmentContext {
        sessions_dir: Some(pickforge_core::sessions_dir(&pty_commands::runtime_base())),
        tmux_server: Some(pickforge_core::recoverable_tmux_server_name().to_string()),
        tmux_program: pickforge_core::which_in("tmux", environment),
    };
    if let Err(error) = pickforge_core::start_local_crash_containment(&ctx) {
        eprintln!("failed to start local crash containment: {error}");
    }
}

#[allow(clippy::too_many_lines)] // TODO(#263): split the legacy Tauri bootstrap.
pub fn run() {
    start_crash_containment();
    let context = tauri::generate_context!();
    let release = format!(
        "pickforge@{}",
        context
            .config()
            .version
            .clone()
            .expect("version in tauri.conf.json")
    );
    let consent = load_telemetry_config().crash_reports;
    let debug_override = std::env::var("PICKFORGE_SENTRY_DEBUG").ok();
    let enabled = sentry_enabled(consent, debug_override.as_deref());
    let client = sentry::init((
        if enabled { SENTRY_DSN } else { "" },
        sentry::ClientOptions {
            release: Some(release.into()),
            before_send: Some(Arc::new(|event| Some(scrub_event(event)))),
            ..Default::default()
        },
    ));
    let _minidump_guard = if enabled {
        match tauri_plugin_sentry::minidump::init(&client) {
            Ok(guard) => Some(guard),
            Err(error) => {
                eprintln!("failed to initialize sentry minidump handler: {error}");
                None
            }
        }
    } else {
        None
    };

    // Linux/Wayland: force the window's app_id to the bundle identifier. GTK derives
    // xdg_toplevel.set_app_id from g_get_prgname(), which defaults to the binary name
    // ("pickforge-tauri") — `enableGTKAppId` does NOT override it under WebKitGTK. This
    // must run before any GTK/display/window init (i.e. before tauri::Builder), so the
    // installed dev.pickforge.app.desktop + icon match. set_application_name sets the
    // human-readable name shown by some shells.
    #[cfg(target_os = "linux")]
    {
        gtk::glib::set_prgname(Some(context.config().identifier.as_str()));
        gtk::glib::set_application_name("PickForge");
    }

    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(if enabled {
            tauri_plugin_sentry::init(&client)
        } else {
            tauri_plugin_sentry::init_with_no_injection(&client)
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init());

    // The updater is desktop-only (no mobile self-update).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    let database = open_database();
    // Allowlist of filesystem roots the renderer may browse/read/open: PickForge
    // home plus every active, local project root. `reconcile` is the one seam
    // that keeps this in sync with the DB's live Project set (see
    // `project_roots`); every command that mutates Project state calls it again
    // after its own write.
    let approved_roots = project_roots::ApprovedRoots::default();
    if let Err(err) = approved_roots.reconcile(database.as_ref()) {
        eprintln!("failed to seed approved project roots at startup: {err}");
    }
    let manager_database = Arc::clone(&database);

    builder
        .setup(move |app| {
            #[cfg(any(target_os = "linux", all(target_os = "windows", debug_assertions)))]
            if let Err(error) = app.deep_link().register_all() {
                eprintln!("failed to register deep link schemes: {error}");
            }

            app.manage(AgentChatManager::new(
                Arc::clone(&manager_database),
                resolve_agent_app_root(app),
                resolve_pi_session_root(app),
            ));
            // The static assetProtocol scope only covers the default
            // ~/.pickforge; a PICKFORGE_HOME override relocates the stash, so
            // admit the resolved directory at runtime or its thumbnails 404.
            let _ = app
                .asset_protocol_scope()
                .allow_directory(agent_chat_commands::stash_image_dir(), true);
            Ok(())
        })
        .manage(PtyManager::new())
        .manage(pickforge_core::android::EmulatorManager::new())
        .manage(Arc::new(VoiceSessionManager::new()))
        .manage(VmServiceClient::new())
        .manage(CdpClient::new())
        .manage(watch_commands::WatchManager::new())
        .manage(mirror_commands::MirrorManager::new())
        .manage(logcat_commands::LogcatManager::new())
        .manage(ios_commands::OsLogManager::new())
        .manage(remote_commands::RemoteHostState::new())
        .manage(TunnelManager::new())
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
            pty_commands::pty_askpass_status,
            pty_commands::list_legacy_sessions,
            pty_commands::stop_legacy_session,
            process_commands::detect_binaries,
            process_commands::probe_agent_cli,
            process_commands::probe_pi_kit,
            process_commands::probe_agent_auth,
            process_commands::list_pi_kit_runs,
            process_commands::abandon_pi_kit_lane,
            remote_commands::remote_host_status,
            remote_commands::remote_host_start,
            remote_commands::remote_host_stop,
            remote_commands::remote_host_issue_pairing_code,
            remote_commands::remote_host_revoke_client,
            remote_commands::remote_tailscale_ssh_set,
            remote_commands::project_remote_set,
            remote_commands::project_remote_clear,
            remote_commands::remote_host_health,
            remote_commands::remote_nearest_pubspec,
            remote_commands::remote_detect_binaries,
            remote_commands::remote_pubspec_uses_flutter,
            remote_commands::remote_flutter_devices,
            remote_commands::remote_tunnel_open,
            remote_commands::remote_tunnel_close,
            picklab_commands::picklab_status,
            fs_commands::list_dir,
            fs_commands::read_text_file,
            fs_commands::read_image_data_url,
            fs_commands::path_basename,
            fs_commands::open_path,
            fs_commands::open_external_url,
            fs_commands::pick_project_dir,
            fs_commands::save_text_file,
            device_commands::target_detect,
            device_commands::find_nearest_pubspec,
            device_commands::adb_list_devices,
            device_commands::android_device_list,
            device_commands::android_launch_avd,
            device_commands::android_wait_for_device,
            device_commands::adb_screenshot,
            device_commands::adb_dump_uiautomator,
            ios_commands::ios_device_list,
            ios_commands::ios_boot_device,
            ios_commands::ios_screenshot,
            ios_commands::ios_dump_accessibility,
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
            db_commands::update_chat_title_ownership,
            db_commands::update_chat_agent,
            db_commands::update_chat_session_id,
            db_commands::update_chat_sort_order,
            db_commands::orchestra_task_upsert,
            db_commands::orchestra_task_delete,
            db_commands::orchestra_tasks_list,
            db_commands::agent_usage_summary,
            db_commands::agent_session_latest_for_chat,
            db_commands::operator_audit_insert,
            db_commands::operator_audit_update,
            db_commands::operator_audit_list,
            operator_commands::operator_route_raw,
            voice_commands::voice_start,
            voice_commands::voice_stop,
            voice_commands::voice_cancel,
            voice_commands::voice_status,
            telemetry_commands::telemetry_get,
            telemetry_commands::telemetry_set,
            #[cfg(target_os = "linux")]
            graphics_commands::linux_graphics_get,
            #[cfg(target_os = "linux")]
            graphics_commands::linux_graphics_set,
            #[cfg(target_os = "linux")]
            graphics_commands::linux_graphics_boot_mode_get,
            #[cfg(target_os = "linux")]
            graphics_commands::linux_graphics_recommendation_get,
            #[cfg(target_os = "linux")]
            graphics_commands::linux_graphics_recommendation_dismiss,
            db_commands::picks_list,
            db_commands::pick_insert,
            db_commands::runs_list,
            db_commands::run_insert,
            db_commands::run_finish,
            db_commands::agent_run_insert,
            agent_chat_commands::agent_chat_start,
            agent_chat_commands::agent_chat_send,
            agent_chat_commands::agent_chat_set_model,
            agent_chat_commands::agent_chat_set_mode,
            agent_chat_commands::agent_chat_dispose,
            agent_chat_commands::agent_chat_interrupt,
            agent_chat_commands::agent_chat_approve,
            agent_chat_commands::agent_chat_steer,
            agent_chat_commands::agent_chat_follow_up,
            agent_chat_commands::agent_chat_history,
            agent_chat_commands::agent_skills_list,
            agent_chat_commands::agent_stash_image,
            agent_chat_commands::agent_stash_clipboard_image,
            agent_chat_commands::agent_stash_image_from_path,
            agent_chat_commands::agent_clipboard_text,
            agent_chat_commands::agent_clipboard_file_paths,
            agent_chat_commands::codex_config_default_effort,
            vm_commands::vm_connect,
            vm_commands::vm_disconnect,
            vm_commands::vm_status,
            vm_commands::vm_get_vm,
            vm_commands::vm_widget_tree,
            vm_commands::vm_widget_tree_semantic,
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
            ios_commands::oslog_start,
            ios_commands::oslog_stop,
            mcp_commands::mcp_start,
            mcp_commands::mcp_stop,
            mcp_commands::mcp_publish_state,
            mcp_commands::mcp_push_log,
            mcp_commands::mcp_run_started,
            mcp_commands::mcp_take_swarm_requests,
            mcp_commands::mcp_update_swarm_run,
            mcp_commands::mcp_swarm_status,
        ])
        .build(context)
        .expect("error while building pickforge")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                shutdown::run_once(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::test_support::{EnvRestore, PICKFORGE_HOME_ENV_LOCK};

    struct TempHome {
        path: PathBuf,
    }

    impl TempHome {
        fn new(name: &str) -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "pickforge-open-database-{name}-{}-{stamp}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn resolve_database_path_honours_pickforge_home_override() {
        let mut env = HashMap::new();
        env.insert("PICKFORGE_HOME".to_string(), "/custom/home".to_string());

        assert_eq!(
            resolve_database_path(Some(&env)).unwrap(),
            PathBuf::from("/custom/home/pickforge.db")
        );
    }

    #[cfg(unix)]
    #[test]
    fn resolve_database_path_errors_instead_of_falling_back_to_launch_dir() {
        let env = HashMap::new();

        assert!(resolve_database_path(Some(&env)).is_err());
    }

    #[test]
    fn open_database_writes_under_home_not_launch_directory() {
        let _guard = PICKFORGE_HOME_ENV_LOCK.lock().unwrap();
        let _restore = EnvRestore::capture();
        let temp_home = TempHome::new("smoke");
        let launch_dir = std::env::current_dir().unwrap();
        std::env::set_var("PICKFORGE_HOME", &temp_home.path);

        let database = open_database();
        drop(database);

        assert!(temp_home.path.join("pickforge.db").exists());
        assert!(!launch_dir.join("pickforge.db").exists());
        assert!(!launch_dir.join("pickforge.db-shm").exists());
        assert!(!launch_dir.join("pickforge.db-wal").exists());
    }

    #[test]
    fn scrub_event_clears_server_name_and_breadcrumbs() {
        let event = sentry::protocol::Event {
            server_name: Some("workstation".into()),
            breadcrumbs: vec![sentry::protocol::Breadcrumb {
                message: Some("terminal text".into()),
                ..Default::default()
            }]
            .into(),
            ..Default::default()
        };

        let event = scrub_event(event);

        assert!(event.server_name.is_none());
        assert!(event.breadcrumbs.is_empty());
    }

    #[test]
    fn scrub_event_strips_debug_image_paths_and_preserves_ids() {
        let symbolic_id: sentry::types::DebugId =
            "494f3aea-88fa-4296-9644-fa8ef5d139b6-1234".parse().unwrap();
        let wasm_id: sentry::types::Uuid = "8c954262-f905-4992-8a61-f60825f4553b".parse().unwrap();
        let event = sentry::protocol::Event {
            debug_meta: Cow::Owned(sentry::protocol::DebugMeta {
                images: vec![
                    sentry::protocol::SymbolicDebugImage {
                        name: "/home/alice/AppDir/pickforge".into(),
                        arch: None,
                        image_addr: 0.into(),
                        image_size: 4096,
                        image_vmaddr: 0.into(),
                        id: symbolic_id,
                        code_id: None,
                        debug_file: Some("C:\\Users\\alice\\pickforge.debug".into()),
                    }
                    .into(),
                    sentry::protocol::WasmDebugImage {
                        name: "module".into(),
                        debug_id: wasm_id,
                        debug_file: Some("/home/alice/module.debug.wasm".into()),
                        code_id: None,
                        code_file: "/home/alice/module.wasm".into(),
                    }
                    .into(),
                ],
                ..Default::default()
            }),
            ..Default::default()
        };

        let event = scrub_event(event);

        match &event.debug_meta.images[0] {
            sentry::protocol::DebugImage::Symbolic(image) => {
                assert_eq!(image.name, "pickforge");
                assert_eq!(image.debug_file.as_deref(), Some("pickforge.debug"));
                assert_eq!(image.id, symbolic_id);
            }
            image => panic!("expected symbolic image, got {image:?}"),
        }

        match &event.debug_meta.images[1] {
            sentry::protocol::DebugImage::Wasm(image) => {
                assert_eq!(image.code_file, "module.wasm");
                assert_eq!(image.debug_file.as_deref(), Some("module.debug.wasm"));
                assert_eq!(image.debug_id, wasm_id);
            }
            image => panic!("expected wasm image, got {image:?}"),
        }
    }

    #[test]
    fn debug_claude_bridge_root_stays_on_repo_or_resource_scripts() {
        let repo_root = PathBuf::from("/workspace/pickforge");
        let bridge_path = repo_root.join("scripts").join("claude-bridge.ts");
        let user_data = PathBuf::from("/home/user/.pickforge");

        assert_eq!(bridge_app_root(&bridge_path, user_data), repo_root);
    }

    #[test]
    fn sentry_enabled_requires_consent_and_debug_override() {
        assert!(!sentry_enabled(false, None));
        assert!(!sentry_enabled(false, Some("1")));
        assert_eq!(sentry_enabled(true, None), !cfg!(debug_assertions));
        assert_eq!(sentry_enabled(true, Some("0")), !cfg!(debug_assertions));
        assert!(sentry_enabled(true, Some("1")));
    }
}
