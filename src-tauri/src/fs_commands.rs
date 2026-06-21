//! Filesystem commands for the project file explorer + file preview.

use std::io::Read;
use std::path::Path;

use base64::Engine;
use pickforge_core::pickforge_home;
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

const MAX_IMAGE_BYTES: u64 = 16 * 1024 * 1024;

/// True only for the inspector's own capture area: PickForge home `<home>/inspect`,
/// or a project's `<root>/.pickforge/inspect`. Mirrors `inspect_save`'s
/// `is_inspect_root` so a renderer can't read an arbitrary file off disk.
fn is_inspect_root(dir: &Path) -> bool {
    if let Ok(home) = pickforge_home(None) {
        if let Ok(canon_home) = std::fs::canonicalize(Path::new(&home).join("inspect")) {
            if dir == canon_home {
                return true;
            }
        }
    }
    dir.file_name().and_then(|n| n.to_str()) == Some("inspect")
        && dir.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()) == Some(".pickforge")
}

/// Read a PNG screenshot as a `data:image/png;base64,…` URL for inline `<img>`
/// display (the web view can't load arbitrary file paths, and the asset protocol
/// is off). Only files under the inspector capture root (`<home>/inspect` or
/// `<root>/.pickforge/inspect`) are readable — this is the screenshot
/// `adb_screenshot` wrote via `inspect_dir`, never an arbitrary caller path.
/// Capped at 16 MiB during the read (bounded, never a full allocation); null if
/// missing/oversized/not a PNG.
#[tauri::command]
pub fn read_image_data_url(path: String) -> Result<Option<String>, String> {
    // Canonicalize the file and confirm its parent dir is an inspector capture
    // root. Canonicalization resolves symlinks, so a symlinked file or dir can't
    // escape the approved area (matches `inspect_save`'s containment re-check).
    let canon = match std::fs::canonicalize(&path) {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    let parent = canon
        .parent()
        .ok_or_else(|| "image path has no parent directory".to_string())?;
    if !is_inspect_root(parent) {
        return Err("image path is outside the inspector capture directory".into());
    }
    let meta = std::fs::metadata(&canon).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Ok(None);
    }
    // Bounded read: stop after MAX_IMAGE_BYTES + 1 so an oversized (or growing)
    // file can't be slurped whole into memory before the cap is checked.
    let file = std::fs::File::open(&canon).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Ok(None);
    }
    // Validate the PNG magic so a non-image file can't be smuggled back as one.
    const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if !bytes.starts_with(&PNG_MAGIC) {
        return Ok(None);
    }
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

#[cfg(test)]
mod read_image_tests {
    use super::*;

    // A project-local inspect root (`<tmp>/.pickforge/inspect`) — `is_inspect_root`
    // accepts this shape independent of HOME, so the test needs no env juggling.
    fn temp_inspect_root(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("pf-readimg-{}-{tag}", std::process::id()))
            .join(".pickforge")
            .join("inspect");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(&dir).unwrap()
    }

    const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

    #[test]
    fn reads_a_png_under_the_inspect_root() {
        let root = temp_inspect_root("ok");
        let png = root.join("a11y-screenshot.png");
        std::fs::write(&png, PNG_MAGIC).unwrap();
        let url = read_image_data_url(png.to_string_lossy().into_owned())
            .expect("read")
            .expect("some data url");
        assert!(url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn rejects_a_file_outside_the_inspect_root() {
        let outside = std::env::temp_dir().join(format!("pf-secret-{}.png", std::process::id()));
        std::fs::write(&outside, PNG_MAGIC).unwrap();
        let res = read_image_data_url(outside.to_string_lossy().into_owned());
        assert!(res.is_err(), "an out-of-root path must be rejected");
        let _ = std::fs::remove_file(&outside);
    }

    #[test]
    fn rejects_traversal_out_of_the_inspect_root() {
        let root = temp_inspect_root("traversal");
        let secret = std::env::temp_dir().join(format!("pf-trav-{}.png", std::process::id()));
        std::fs::write(&secret, PNG_MAGIC).unwrap();
        // <root>/../../../<secret> — canonicalization collapses the `..` so the
        // resolved parent is no longer an inspect root.
        let sneaky = root.join("..").join("..").join("..").join(
            secret
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
        );
        let res = read_image_data_url(sneaky.to_string_lossy().into_owned());
        assert!(res.is_err(), "a traversal path must be rejected");
        let _ = std::fs::remove_file(&secret);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_escape_from_the_inspect_root() {
        use std::os::unix::fs::symlink;
        let root = temp_inspect_root("symlink");
        let secret = std::env::temp_dir().join(format!("pf-symsecret-{}.png", std::process::id()));
        std::fs::write(&secret, PNG_MAGIC).unwrap();
        let link = root.join("link.png");
        let _ = std::fs::remove_file(&link);
        symlink(&secret, &link).unwrap();
        // The link sits under the inspect root, but canonicalization resolves it
        // to the out-of-root target, whose parent is not an inspect root.
        let res = read_image_data_url(link.to_string_lossy().into_owned());
        assert!(res.is_err(), "a symlink escaping the inspect root must be rejected");
        let _ = std::fs::remove_file(&secret);
    }

    #[test]
    fn returns_none_for_a_non_png_under_the_root() {
        let root = temp_inspect_root("notpng");
        let txt = root.join("a11y-screenshot.png");
        std::fs::write(&txt, b"not a png at all").unwrap();
        let res = read_image_data_url(txt.to_string_lossy().into_owned()).expect("ok");
        assert!(res.is_none(), "a non-PNG must yield None");
    }
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
