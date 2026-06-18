//! Target detection + Android device commands. ADB ops shell out, so they run
//! on a blocking thread; detection is fast file I/O.

use pickforge_core::android::{self, A11yNode, AdbDevice};
use pickforge_core::{detect_target, TargetDetection};

#[tauri::command]
pub fn target_detect(project_root: String) -> TargetDetection {
    detect_target(&project_root)
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
