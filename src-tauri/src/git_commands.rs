//! Git status/diff commands. They shell out to `git`, so they run on a blocking
//! thread off the IPC executor.

use pickforge_core::git::{self, GitStatus, GraphCommit};

#[tauri::command]
pub async fn git_status(project_root: String) -> Result<GitStatus, String> {
    tauri::async_runtime::spawn_blocking(move || git::status(&project_root))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_log_graph(project_root: String, limit: u32) -> Result<Vec<GraphCommit>, String> {
    tauri::async_runtime::spawn_blocking(move || git::log_graph(&project_root, limit))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_diff(project_root: String, path: String, staged: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || git::diff(&project_root, &path, staged))
        .await
        .map_err(|e| e.to_string())
}

/// Git work-trees at or beneath the project root (handles monorepos whose repos
/// live in subfolders like `app/` and `api/`). Absolute paths.
#[tauri::command]
pub async fn git_discover_repos(project_root: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || git::discover_repos(&project_root))
        .await
        .map_err(|e| e.to_string())
}
