//! Process/detection commands. `detect_binaries` resolves the login-shell env
//! the first time (potentially slow), so it runs on a blocking thread to keep
//! the UI responsive.

use pickforge_core::is_on_user_path;

#[tauri::command]
pub async fn detect_binaries(names: Vec<String>) -> Result<Vec<bool>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        names.iter().map(|name| is_on_user_path(name)).collect()
    })
    .await
    .map_err(|e| e.to_string())
}
