//! Filesystem commands for the project file explorer + file preview.

use std::path::Path;

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

/// Basename of a path (for display).
#[tauri::command]
pub fn path_basename(path: String) -> String {
    Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or(path)
}
