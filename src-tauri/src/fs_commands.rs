//! Filesystem commands for the project file explorer + file preview.

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use pickforge_core::{pickforge_home, Database};
use serde::Serialize;
use tauri::State;

/// Canonicalized directories a renderer is allowed to browse / read / open:
/// the PickForge home (`~/.pickforge`, holding the shared inspect captures) plus
/// every known project root. Seeded at startup ([`seed_approved_roots`]) and
/// extended whenever a project is registered ([`register_project_root`]) so the
/// file explorer, launch.json discovery, and capture reads all resolve under an
/// approved root while an arbitrary off-disk path is rejected.
#[derive(Default)]
pub struct ApprovedRoots(pub Mutex<HashSet<PathBuf>>);

impl ApprovedRoots {
    /// Canonicalize `dir` (resolving symlinks/`..`) and add it to the allowlist.
    /// A path that can't be canonicalized (e.g. a not-yet-created project) is
    /// skipped — it gets added once it exists and is registered again.
    pub fn insert(&self, dir: &Path) {
        if let Ok(canon) = std::fs::canonicalize(dir) {
            if let Ok(mut set) = self.0.lock() {
                set.insert(canon);
            }
        }
    }

    /// True when `canon` (an already-canonicalized path) is one of, or sits
    /// under, an approved root.
    fn contains(&self, canon: &Path) -> bool {
        self.0
            .lock()
            .map(|set| set.iter().any(|root| canon.starts_with(root)))
            .unwrap_or(false)
    }
}

/// Seed the registry with the PickForge home and every project root in the DB.
/// Called once at startup; project roots added later flow through
/// [`register_project_root`].
pub fn seed_approved_roots(roots: &ApprovedRoots, db: &Database) {
    if let Ok(home) = pickforge_home(None) {
        // Create home if missing so it canonicalizes — the inspector writes here.
        let _ = std::fs::create_dir_all(&home);
        roots.insert(Path::new(&home));
    }
    if let Ok(projects) = db.list_projects(true) {
        for p in projects {
            roots.insert(Path::new(&p.project_root));
        }
    }
}

/// Add a single project root to the registry (called from `project_upsert` /
/// `projects_list` so the allowlist tracks the live project set).
pub fn register_project_root(roots: &ApprovedRoots, project_root: &str) {
    roots.insert(Path::new(project_root));
}

/// Canonicalize `path` and confirm it resolves under an approved root. Returns
/// the canonical path so callers read the resolved (symlink-free) location.
/// Canonicalization collapses `..` and follows symlinks, so neither traversal
/// nor a symlinked escape can leave the approved area.
fn approved_canonical(path: &str, roots: &ApprovedRoots) -> Result<PathBuf, String> {
    let canon = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !roots.contains(&canon) {
        return Err("path is outside an approved project root".into());
    }
    Ok(canon)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// List a directory: directories first, then files, alphabetical. Hidden
/// dotfiles and common heavy build dirs are skipped. The directory must resolve
/// under an approved root (a project root or PickForge home).
#[tauri::command]
pub fn list_dir(roots: State<'_, ApprovedRoots>, path: String) -> Result<Vec<DirEntry>, String> {
    const SKIP: &[&str] = &["node_modules", ".git", "target", "build", ".dart_tool"];
    let dir = approved_canonical(&path, &roots)?;
    let read = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
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

/// Hard ceiling on a preview read, regardless of the `max_bytes` the renderer
/// asks for — a compromised renderer can't request an unbounded allocation.
const MAX_TEXT_PREVIEW_BYTES: usize = 8 * 1024 * 1024;

/// Read up to `max_bytes` of a text file (lossy UTF-8) for preview, never more
/// than [`MAX_TEXT_PREVIEW_BYTES`]. The file must resolve under an approved root,
/// and the read is bounded BEFORE allocation — at most the capped byte count is
/// pulled off disk, so an arbitrarily large file can't be slurped whole into
/// memory.
#[tauri::command]
pub fn read_text_file(
    roots: State<'_, ApprovedRoots>,
    path: String,
    max_bytes: usize,
) -> Result<String, String> {
    let canon = approved_canonical(&path, &roots)?;
    read_text_bounded(&canon, max_bytes.min(MAX_TEXT_PREVIEW_BYTES))
}

/// Read at most `max_bytes` from `path` as lossy UTF-8. `Read::take` bounds the
/// read at the source, so the buffer never grows past `max_bytes` regardless of
/// the file's actual size.
fn read_text_bounded(path: &Path, max_bytes: usize) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(max_bytes as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
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
/// Shells out to the platform opener on a blocking thread. The path must resolve
/// under an approved root, so a renderer can't ask the OS to open an arbitrary
/// file off disk.
#[tauri::command]
pub async fn open_path(roots: State<'_, ApprovedRoots>, path: String) -> Result<(), String> {
    let path = approved_canonical(&path, &roots)?
        .to_string_lossy()
        .into_owned();
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

#[cfg(test)]
mod approved_root_tests {
    use super::*;

    /// A throwaway project root on the registry, returned canonicalized so tests
    /// can compose paths under it.
    fn temp_root(tag: &str) -> (ApprovedRoots, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("pf-fsroot-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let roots = ApprovedRoots::default();
        roots.insert(&dir);
        (roots, std::fs::canonicalize(&dir).unwrap())
    }

    #[test]
    fn allows_a_path_under_an_approved_root() {
        let (roots, root) = temp_root("ok");
        let file = root.join("pubspec.yaml");
        std::fs::write(&file, b"name: app").unwrap();
        let canon = approved_canonical(&file.to_string_lossy(), &roots).expect("under root");
        assert_eq!(canon, std::fs::canonicalize(&file).unwrap());
    }

    #[test]
    fn allows_a_nested_path_under_an_approved_root() {
        let (roots, root) = temp_root("nested");
        let nested = root.join(".vscode");
        std::fs::create_dir_all(&nested).unwrap();
        let file = nested.join("launch.json");
        std::fs::write(&file, b"{}").unwrap();
        assert!(approved_canonical(&file.to_string_lossy(), &roots).is_ok());
    }

    #[test]
    fn rejects_a_path_outside_every_approved_root() {
        let (roots, _root) = temp_root("outside");
        let secret =
            std::env::temp_dir().join(format!("pf-fssecret-{}.txt", std::process::id()));
        std::fs::write(&secret, b"top secret").unwrap();
        let res = approved_canonical(&secret.to_string_lossy(), &roots);
        assert!(res.is_err(), "an out-of-root path must be rejected");
        let _ = std::fs::remove_file(&secret);
    }

    #[test]
    fn rejects_dotdot_traversal_out_of_an_approved_root() {
        let (roots, root) = temp_root("traversal");
        let secret =
            std::env::temp_dir().join(format!("pf-fstrav-{}.txt", std::process::id()));
        std::fs::write(&secret, b"top secret").unwrap();
        // <root>/../../../<secret> — canonicalization collapses the `..` so the
        // resolved path is no longer under the approved root.
        let sneaky = root
            .join("..")
            .join("..")
            .join("..")
            .join(secret.file_name().unwrap());
        let res = approved_canonical(&sneaky.to_string_lossy(), &roots);
        assert!(res.is_err(), "a `..` traversal must be rejected");
        let _ = std::fs::remove_file(&secret);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_escaping_an_approved_root() {
        use std::os::unix::fs::symlink;
        let (roots, root) = temp_root("symlink");
        let secret =
            std::env::temp_dir().join(format!("pf-fssym-{}.txt", std::process::id()));
        std::fs::write(&secret, b"top secret").unwrap();
        let link = root.join("link.txt");
        let _ = std::fs::remove_file(&link);
        symlink(&secret, &link).unwrap();
        // The link sits under the approved root, but canonicalization resolves it
        // to the out-of-root target.
        let res = approved_canonical(&link.to_string_lossy(), &roots);
        assert!(res.is_err(), "a symlink escaping the approved root must be rejected");
        let _ = std::fs::remove_file(&secret);
    }

    #[test]
    fn read_text_bounded_never_allocates_more_than_max_bytes() {
        let (_roots, root) = temp_root("bounded");
        let big = root.join("huge.txt");
        // 1 MiB on disk, but we only ask for 64 bytes.
        std::fs::write(&big, vec![b'a'; 1024 * 1024]).unwrap();
        let out = read_text_bounded(&big, 64).expect("bounded read");
        assert_eq!(out.len(), 64, "read must stop at max_bytes, not slurp the file");
    }

    #[test]
    fn read_text_bounded_returns_whole_small_file() {
        let (_roots, root) = temp_root("small");
        let f = root.join("small.txt");
        std::fs::write(&f, b"hello").unwrap();
        let out = read_text_bounded(&f, 1024).expect("read");
        assert_eq!(out, "hello");
    }

    #[test]
    fn preview_cap_bounds_an_over_eager_max_bytes() {
        // The command clamps `max_bytes` to MAX_TEXT_PREVIEW_BYTES, so even a
        // renderer asking for usize::MAX never reads past the ceiling.
        let (_roots, root) = temp_root("cap");
        let f = root.join("over.txt");
        std::fs::write(&f, vec![b'a'; MAX_TEXT_PREVIEW_BYTES + 4096]).unwrap();
        let out = read_text_bounded(&f, usize::MAX.min(MAX_TEXT_PREVIEW_BYTES)).expect("read");
        assert_eq!(out.len(), MAX_TEXT_PREVIEW_BYTES);
    }
}
