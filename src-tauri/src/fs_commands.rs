//! Filesystem commands for the project file explorer + file preview.

use std::path::Path;

use base64::Engine;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// List a directory: directories first, then files, alphabetical. Hidden
/// dotfiles and common heavy build dirs are skipped.
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    const SKIP: &[&str] = &["node_modules", ".git", "target", "build", ".dart_tool"];
    let read = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut entries: Vec<DirEntry> = Vec::new();
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || SKIP.contains(&name.as_str()) {
            continue;
        }
        let p = entry.path();
        let is_dir = p.is_dir();
        entries.push(DirEntry {
            name,
            path: p.to_string_lossy().into_owned(),
            is_dir,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Read up to `max_bytes` of a text file (lossy UTF-8) for preview.
#[tauri::command]
pub fn read_text_file(path: String, max_bytes: usize) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let end = bytes.len().min(max_bytes);
    Ok(String::from_utf8_lossy(&bytes[..end]).into_owned())
}

/// Read a PNG file as a `data:image/png;base64,…` URL for inline `<img>` display
/// (the web view can't load arbitrary file paths, and the asset protocol is off).
/// Capped at 16 MiB so a stray path can't blow up memory; null if missing/oversized.
#[tauri::command]
pub fn read_image_data_url(path: String) -> Result<Option<String>, String> {
    const MAX_BYTES: u64 = 16 * 1024 * 1024;
    let meta = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(_) => return Ok(None),
    };
    if !meta.is_file() || meta.len() > MAX_BYTES {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Some(format!("data:image/png;base64,{b64}")))
}

/// Basename of a path (for display).
#[tauri::command]
pub fn path_basename(path: String) -> String {
    Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or(path)
}

/// Open a path with the OS default handler (the user's default editor for files).
/// Shells out to the platform opener on a blocking thread.
#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        let (program, args): (&str, Vec<&str>) = ("open", vec![path.as_str()]);
        #[cfg(target_os = "windows")]
        let (program, args): (&str, Vec<&str>) = ("cmd", vec!["/C", "start", "", path.as_str()]);
        #[cfg(all(unix, not(target_os = "macos")))]
        let (program, args): (&str, Vec<&str>) = ("xdg-open", vec![path.as_str()]);

        let out = pickforge_core::run(program, &args, None, None).map_err(|e| e.to_string())?;
        if out.success() {
            Ok(())
        } else {
            Err(format!("{program} exited with {:?}", out.code))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
