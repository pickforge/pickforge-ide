//! Target detection + Android device commands. ADB ops shell out, so they run
//! on a blocking thread; detection is fast file I/O.

use std::path::{Path, PathBuf};
use std::time::Duration;

use pickforge_core::android::{self, A11yNode, AdbDevice, DeviceEntry, EmulatorManager};
use pickforge_core::{detect_target, nearest_pubspec_dir, TargetDetection};
use tauri::State;

#[tauri::command]
pub fn target_detect(project_root: String) -> TargetDetection {
    detect_target(&project_root)
}

/// Resolve a launch config's Flutter project dir: the nearest enclosing
/// `pubspec.yaml` at or above `program` (Dart-Code's cwd-from-program rule).
/// `program` may be relative to `root`; `${workspaceFolder*}` is expanded by the
/// frontend before this call. Returns the absolute dir, or `None` if no pubspec
/// exists up the tree (caller then keeps the default cwd).
#[tauri::command]
pub fn find_nearest_pubspec(program: String, root: String) -> Option<String> {
    let prog = Path::new(&program);
    let abs: PathBuf = if prog.is_absolute() {
        prog.to_path_buf()
    } else {
        Path::new(&root).join(prog)
    };
    // A directory / test path (trailing sep, a real dir, or no file extension)
    // starts the walk at itself; a file starts at its parent.
    let looks_like_dir =
        program.ends_with('/') || program.ends_with('\\') || abs.is_dir() || abs.extension().is_none();
    let start = if looks_like_dir {
        abs.clone()
    } else {
        abs.parent().map(Path::to_path_buf).unwrap_or(abs)
    };
    nearest_pubspec_dir(&start).map(|p| p.to_string_lossy().into_owned())
}

/// Merged device list for the UI: running adb devices + installed-but-stopped
/// AVDs, friendly-named and deduped by AVD id.
#[tauri::command]
pub async fn android_device_list() -> Result<Vec<DeviceEntry>, String> {
    tauri::async_runtime::spawn_blocking(android::device_list)
        .await
        .map_err(|e| e.to_string())
}

/// Boot a stopped AVD as a PickForge-owned child (it dies with the app).
/// Returns once spawned, not once booted.
#[tauri::command]
pub async fn android_launch_avd(
    manager: State<'_, EmulatorManager>,
    avd_id: String,
) -> Result<(), String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.launch_avd(&avd_id))
        .await
        .map_err(|e| e.to_string())?
}

/// Wait until `serial` is online (adb `device` state) or `timeout_ms` elapses.
#[tauri::command]
pub async fn android_wait_for_device(serial: String, timeout_ms: u64) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        android::wait_for_online(
            &serial,
            Duration::from_millis(timeout_ms),
            Duration::from_secs(1),
        )
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn adb_list_devices() -> Result<Vec<AdbDevice>, String> {
    tauri::async_runtime::spawn_blocking(android::list_devices)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn adb_screenshot(
    serial: String,
    output_dir: String,
    output_name: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        android::capture_screenshot(&serial, &output_dir, &output_name)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn adb_dump_uiautomator(serial: String) -> Result<Option<A11yNode>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        android::dump_uiautomator_xml(&serial).and_then(|xml| android::parse_uiautomator(&xml).ok())
    })
    .await
    .map_err(|e| e.to_string())
}
