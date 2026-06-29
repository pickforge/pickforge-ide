//! Filesystem commands for the project file explorer + file preview.

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use pickforge_core::{pickforge_home, Database};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Canonicalized directories a renderer is allowed to browse / read / open:
/// the PickForge home (`~/.pickforge`, holding the shared inspect captures) plus
/// every known project root. Seeded at startup ([`seed_approved_roots`]) and
/// extended only by a user-mediated native pick ([`pick_project_dir`]) or a
/// re-seed from already-persisted DB roots, so the file explorer, launch.json
/// discovery, and capture reads resolve under an approved root while an
/// arbitrary off-disk path — or one a compromised renderer asks for — is
/// rejected.
#[derive(Default)]
pub struct ApprovedRoots(pub Mutex<HashSet<PathBuf>>);

impl ApprovedRoots {
    /// Canonicalize `dir` (resolving symlinks/`..`) and add it to the allowlist.
    /// A path that can't be canonicalized (e.g. a not-yet-created project) is
    /// skipped — it gets added once it exists and is registered again. A
    /// filesystem root (`/`, a Windows drive root) or the user's home directory
    /// is rejected outright: those are too broad to be a project root, so even a
    /// bad caller can't approve the whole disk through this helper.
    pub fn insert(&self, dir: &Path) {
        if let Ok(canon) = std::fs::canonicalize(dir) {
            if is_too_broad_to_approve(&canon) {
                return;
            }
            if let Ok(mut set) = self.0.lock() {
                set.insert(canon);
            }
        }
    }

    /// Clear the allowlist and rebuild it from authoritative sources: the
    /// PickForge home plus every **active** project root in `db`. Used after a
    /// project leaves the active set (deleted or archived) so its root doesn't
    /// stay approved for the rest of the process lifetime — the registry only
    /// ever grows otherwise.
    pub fn reseed(&self, db: &Database) {
        if let Ok(mut set) = self.0.lock() {
            set.clear();
        }
        seed_home_root(self);
        if let Ok(projects) = db.list_projects(false) {
            for p in projects {
                self.insert(Path::new(&p.project_root));
            }
        }
    }

    /// Canonicalize `dir`, reject a too-broad pick (`/`, a drive root, the home
    /// directory), register the canonical directory, and return it. Used by the
    /// user-mediated [`pick_project_dir`]: the registered approved root and the
    /// canonical path returned to the renderer (which becomes the DB
    /// `project_root`) are the same value, so the later `project_upsert` gate
    /// matches. A non-canonicalizable or too-broad pick is rejected.
    fn register_picked(&self, dir: &Path) -> Result<PathBuf, String> {
        let canon = std::fs::canonicalize(dir).map_err(|e| e.to_string())?;
        if is_too_broad_to_approve(&canon) {
            return Err("the picked directory is too broad to be a project root".into());
        }
        if let Ok(mut set) = self.0.lock() {
            set.insert(canon.clone());
        }
        Ok(canon)
    }

    /// True when `canon` (an already-canonicalized path) is itself an approved
    /// root — i.e. a directory that was registered, not merely a child of one.
    /// Used by the `project_upsert` gate so only a `pick`-vetted root passes.
    pub fn is_approved_root(&self, canon: &Path) -> bool {
        self.0
            .lock()
            .map(|set| set.contains(canon))
            .unwrap_or(false)
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

/// Reject a path that is too broad to ever be a project root: a filesystem root
/// (`/`, a Windows drive root like `C:\`) or the user's home directory itself.
/// `dir` is expected to be canonicalized already.
fn is_too_broad_to_approve(dir: &Path) -> bool {
    if dir.parent().is_none() {
        // A filesystem root has no parent (`/`, `C:\`).
        return true;
    }
    if let Some(home) = user_home_dir() {
        if let Ok(canon_home) = std::fs::canonicalize(&home) {
            if dir == canon_home {
                return true;
            }
        }
    }
    false
}

/// The user's OS home directory (`$HOME`, or `%USERPROFILE%`/`%HOMEDRIVE%%HOMEPATH%`
/// on Windows) — distinct from the PickForge home (`~/.pickforge`), which is an
/// approved root. Used only to reject approving the home directory itself.
fn user_home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            if !profile.trim().is_empty() {
                return Some(PathBuf::from(profile));
            }
        }
        let drive = std::env::var("HOMEDRIVE").unwrap_or_default();
        let path = std::env::var("HOMEPATH").unwrap_or_default();
        if !drive.is_empty() && !path.is_empty() {
            return Some(PathBuf::from(format!("{drive}{path}")));
        }
        None
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
    }
}

/// Add the PickForge home (`~/.pickforge`) to the registry — it holds the shared
/// inspect captures the renderer reads. Shared by startup seeding and reseed.
fn seed_home_root(roots: &ApprovedRoots) {
    if let Ok(home) = pickforge_home(None) {
        // Create home if missing so it canonicalizes — the inspector writes here.
        let _ = std::fs::create_dir_all(&home);
        roots.insert(Path::new(&home));
    }
}

/// Seed the registry with the PickForge home and every **active** (non-archived)
/// project root in the DB. Called once at startup. Archived projects are
/// excluded so a project the user archived isn't silently re-approved at the
/// next launch — this matches [`ApprovedRoots::reseed`], so startup and the
/// later reseeds agree on exactly the active set.
pub fn seed_approved_roots(roots: &ApprovedRoots, db: &Database) {
    seed_home_root(roots);
    if let Ok(projects) = db.list_projects(false) {
        for p in projects {
            roots.insert(Path::new(&p.project_root));
        }
    }
}

/// Add a single project root to the registry. Only called for roots that are
/// already persisted/vetted — a startup-seeded DB root re-seeded by
/// `projects_list`, or the user-picked directory from [`pick_project_dir`].
pub fn register_project_root(roots: &ApprovedRoots, project_root: &str) {
    roots.insert(Path::new(project_root));
}

/// Confirm `project_root` is an already-approved root before it is persisted.
/// `project_upsert` calls this so the DB can never gain a root that wasn't
/// vetted through the user-mediated [`pick_project_dir`]: a renderer can't
/// `project_upsert({project_root: "<any dir>"})` and have a later re-seed
/// allowlist it. The root canonicalizes to the same value `pick_project_dir`
/// registered, so a legitimate add (whose root was just picked) passes, while an
/// unvetted root — one not in the registry, or one that doesn't even resolve —
/// is rejected.
pub fn ensure_root_approved(roots: &ApprovedRoots, project_root: &str) -> Result<(), String> {
    let canon = std::fs::canonicalize(project_root)
        .map_err(|_| "project root is not an approved directory".to_string())?;
    if !roots.is_approved_root(&canon) {
        return Err("project root is not an approved directory".into());
    }
    Ok(())
}

/// Open the **native** directory picker from the Rust side and, on a user pick,
/// register the **canonical** chosen directory as an approved root. This is the
/// only path by which a new root becomes approved: the renderer can no longer
/// hand `project_upsert` an arbitrary `project_root` and have it allowlisted —
/// the approval is gated on a user-mediated native pick the renderer can't forge.
/// A too-broad pick (`/`, a drive root, or the home directory) is rejected
/// before anything is registered. The returned path is canonical and verbatim-
/// prefix-stripped, so the value the renderer persists as the DB `project_root`
/// equals the registered approved root and the later `project_upsert` gate
/// matches. Returns the path, or `None` if the user cancelled.
#[tauri::command]
pub async fn pick_project_dir(app: AppHandle) -> Result<Option<String>, String> {
    // `blocking_pick_folder` must not run on the main thread; async commands run
    // on a worker thread, so this is safe.
    let picked = app.dialog().file().blocking_pick_folder();
    let Some(file_path) = picked else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    let roots = app.state::<ApprovedRoots>();
    let canon = roots.register_picked(&path)?;
    Ok(Some(display_path(&canon)))
}

/// Strip the Windows verbatim / verbatim-UNC prefix (`\\?\`, `\\?\UNC\`) that
/// `std::fs::canonicalize` prepends, so a path RETURNED to the renderer is the
/// normal form its callers expect. On non-Windows this is the identity. The
/// canonical (prefixed) path is still used for the containment check internally;
/// only the value handed back to the frontend is normalized.
fn display_path(path: &Path) -> String {
    #[cfg(windows)]
    {
        let s = path.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{rest}");
        }
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
        s.into_owned()
    }
    #[cfg(not(windows))]
    {
        path.to_string_lossy().into_owned()
    }
}

/// Canonicalize `path` and confirm it resolves under an approved root. Returns
/// the canonical path so callers read the resolved (symlink-free) location.
/// Canonicalization collapses `..` and follows symlinks, so neither traversal
/// nor a symlinked escape can leave the approved area.
pub(crate) fn approved_canonical(path: &str, roots: &ApprovedRoots) -> Result<PathBuf, String> {
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
            // The entry inherits `dir`'s canonical (on Windows, `\\?\`-prefixed)
            // form; strip the verbatim prefix so the renderer gets a normal path
            // it can hand back to `list_dir`/`read_text_file`.
            path: display_path(&p),
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
pub fn read_image_data_url(
    roots: State<'_, ApprovedRoots>,
    path: String,
) -> Result<Option<String>, String> {
    read_image_data_url_inner(&roots, path)
}

fn read_image_data_url_inner(
    roots: &ApprovedRoots,
    path: String,
) -> Result<Option<String>, String> {
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
    // Beyond the structural `.pickforge/inspect` shape, the file must sit under an
    // approved root (a project root or PickForge home) — so a renderer can't read
    // a capture it planted in an inspect-shaped dir outside any known project.
    if !roots.contains(&canon) {
        return Err("image path is outside an approved project root".into());
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

    /// An `ApprovedRoots` that approves the project root owning
    /// `<root>/.pickforge/inspect`, so the new approved-root gate passes.
    fn approved_for(inspect_dir: &Path) -> ApprovedRoots {
        let project_root = inspect_dir
            .parent() // .pickforge
            .and_then(Path::parent) // project root
            .expect("inspect dir has a project root");
        let roots = ApprovedRoots::default();
        roots.insert(project_root);
        roots
    }

    const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

    #[test]
    fn reads_a_png_under_the_inspect_root() {
        let root = temp_inspect_root("ok");
        let roots = approved_for(&root);
        let png = root.join("a11y-screenshot.png");
        std::fs::write(&png, PNG_MAGIC).unwrap();
        let url = read_image_data_url_inner(&roots, png.to_string_lossy().into_owned())
            .expect("read")
            .expect("some data url");
        assert!(url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn rejects_a_png_outside_an_approved_root() {
        // A capture sitting in an inspect-shaped dir that belongs to no approved
        // project root must be rejected even though its shape passes.
        let root = temp_inspect_root("unapproved");
        let png = root.join("a11y-screenshot.png");
        std::fs::write(&png, PNG_MAGIC).unwrap();
        let res = read_image_data_url_inner(&ApprovedRoots::default(), png.to_string_lossy().into_owned());
        assert!(res.is_err(), "an unapproved inspect-dir capture must be rejected");
    }

    #[test]
    fn rejects_a_file_outside_the_inspect_root() {
        let outside = std::env::temp_dir().join(format!("pf-secret-{}.png", std::process::id()));
        std::fs::write(&outside, PNG_MAGIC).unwrap();
        let res = read_image_data_url_inner(&ApprovedRoots::default(), outside.to_string_lossy().into_owned());
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
        let res = read_image_data_url_inner(&ApprovedRoots::default(), sneaky.to_string_lossy().into_owned());
        assert!(res.is_err(), "a traversal path must be rejected");
        let _ = std::fs::remove_file(&secret);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_escape_from_the_inspect_root() {
        use std::os::unix::fs::symlink;
        let root = temp_inspect_root("symlink");
        let roots = approved_for(&root);
        let secret = std::env::temp_dir().join(format!("pf-symsecret-{}.png", std::process::id()));
        std::fs::write(&secret, PNG_MAGIC).unwrap();
        let link = root.join("link.png");
        let _ = std::fs::remove_file(&link);
        symlink(&secret, &link).unwrap();
        // The link sits under the inspect root, but canonicalization resolves it
        // to the out-of-root target, whose parent is not an inspect root.
        let res = read_image_data_url_inner(&roots, link.to_string_lossy().into_owned());
        assert!(res.is_err(), "a symlink escaping the inspect root must be rejected");
        let _ = std::fs::remove_file(&secret);
    }

    #[test]
    fn returns_none_for_a_non_png_under_the_root() {
        let root = temp_inspect_root("notpng");
        let roots = approved_for(&root);
        let txt = root.join("a11y-screenshot.png");
        std::fs::write(&txt, b"not a png at all").unwrap();
        let res = read_image_data_url_inner(&roots, txt.to_string_lossy().into_owned()).expect("ok");
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

    /// A throwaway project root that exists on disk, returned canonicalized.
    fn make_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("pf-fsreg-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(&dir).unwrap()
    }

    #[test]
    fn registering_a_filesystem_root_is_rejected() {
        // Even a bad caller can't approve `/` (or a drive root): it has no parent,
        // so `insert` drops it and a read under it stays rejected.
        let roots = ApprovedRoots::default();
        let fs_root = if cfg!(windows) { "C:\\" } else { "/" };
        register_project_root(&roots, fs_root);
        // The registry is empty, so any concrete path is out of bounds.
        let probe = make_dir("fsroot-probe").join("anything.txt");
        std::fs::write(&probe, b"x").unwrap();
        assert!(
            approved_canonical(&probe.to_string_lossy(), &roots).is_err(),
            "approving a filesystem root must not allowlist the whole disk",
        );
    }

    #[test]
    fn registering_the_home_directory_is_rejected() {
        // The user's home is too broad to be a project root — reject it even if a
        // caller hands it in. (Uses the real HOME; falls back to USERPROFILE on
        // Windows via `user_home_dir`.)
        let Some(home) = user_home_dir() else { return };
        let Ok(canon_home) = std::fs::canonicalize(&home) else { return };
        let roots = ApprovedRoots::default();
        register_project_root(&roots, &canon_home.to_string_lossy());
        // Home itself must not have been approved.
        assert!(
            !roots.contains(&canon_home),
            "approving the home directory must be rejected",
        );
    }

    #[test]
    fn renderer_supplied_root_is_not_approved_by_registration() {
        // Mirrors a renderer calling `project_upsert({project_root:"/"})`: the
        // upsert no longer registers, and even if it did, `/` is rejected — a path
        // outside any real project root stays out of bounds.
        let roots = ApprovedRoots::default();
        let real = make_dir("legit");
        roots.insert(&real); // a normal project root works
        register_project_root(&roots, if cfg!(windows) { "C:\\" } else { "/" });
        let outside = std::env::temp_dir().join(format!("pf-fsx-{}.txt", std::process::id()));
        std::fs::write(&outside, b"secret").unwrap();
        assert!(
            approved_canonical(&outside.to_string_lossy(), &roots).is_err(),
            "a path under the (wrongly) approved `/` must still be rejected",
        );
        // The legitimate root still works.
        let ok = real.join("pubspec.yaml");
        std::fs::write(&ok, b"name: app").unwrap();
        assert!(approved_canonical(&ok.to_string_lossy(), &roots).is_ok());
        let _ = std::fs::remove_file(&outside);
    }

    #[test]
    fn reseed_drops_a_removed_root_but_keeps_a_live_one() {
        use pickforge_core::{Database, Project};

        let db = Database::open_in_memory().expect("in-memory db");
        let keep = make_dir("keep");
        let gone = make_dir("gone");
        let mk = |root: &std::path::Path, name: &str| Project {
            project_root: root.to_string_lossy().into_owned(),
            display_name: name.to_string(),
            created_at: 0,
            last_opened_at: 0,
            sort_order: 0,
            archived_at: None,
        };
        db.upsert_project(&mk(&keep, "keep")).unwrap();
        db.upsert_project(&mk(&gone, "gone")).unwrap();

        let roots = ApprovedRoots::default();
        seed_approved_roots(&roots, &db);

        // Both roots are gated-readable while their rows exist.
        let keep_file = keep.join("a.txt");
        let gone_file = gone.join("b.txt");
        std::fs::write(&keep_file, b"x").unwrap();
        std::fs::write(&gone_file, b"y").unwrap();
        assert!(approved_canonical(&keep_file.to_string_lossy(), &roots).is_ok());
        assert!(approved_canonical(&gone_file.to_string_lossy(), &roots).is_ok());

        // Delete one project and reseed — its root must no longer be approved,
        // while the surviving root still reads.
        db.delete_project(&gone.to_string_lossy()).unwrap();
        roots.reseed(&db);
        assert!(
            approved_canonical(&gone_file.to_string_lossy(), &roots).is_err(),
            "a deleted project's root must no longer be approved after reseed",
        );
        assert!(
            approved_canonical(&keep_file.to_string_lossy(), &roots).is_ok(),
            "a surviving project's root must still be approved after reseed",
        );
    }

    #[test]
    fn reseed_drops_an_archived_root() {
        use pickforge_core::{Database, Project};

        let db = Database::open_in_memory().expect("in-memory db");
        let root = make_dir("archive");
        db.upsert_project(&Project {
            project_root: root.to_string_lossy().into_owned(),
            display_name: "archived".to_string(),
            created_at: 0,
            last_opened_at: 0,
            sort_order: 0,
            archived_at: None,
        })
        .unwrap();

        let roots = ApprovedRoots::default();
        seed_approved_roots(&roots, &db);
        let file = root.join("c.txt");
        std::fs::write(&file, b"z").unwrap();
        assert!(approved_canonical(&file.to_string_lossy(), &roots).is_ok());

        // Archive it (still in the table, but no longer active) and reseed — the
        // reseed uses the active set, so an archived root drops out of the registry.
        db.set_project_archived(&root.to_string_lossy(), Some(1)).unwrap();
        roots.reseed(&db);
        assert!(
            approved_canonical(&file.to_string_lossy(), &roots).is_err(),
            "an archived project's root must no longer be approved after reseed",
        );
    }

    // ---- Fix 1: project_upsert can't launder an arbitrary root through the DB ----

    #[test]
    fn upsert_gate_rejects_an_unvetted_root_and_a_gated_read_stays_rejected() {
        // Mirrors a compromised renderer calling
        // `project_upsert({project_root: "<unvetted dir>"})`: the dir was never
        // run through `pick_project_dir`, so it isn't an approved root and the
        // gate (`ensure_root_approved`, which `project_upsert` calls) rejects it.
        let roots = ApprovedRoots::default();
        let unvetted = make_dir("unvetted");
        assert!(
            ensure_root_approved(&roots, &unvetted.to_string_lossy()).is_err(),
            "an unvetted root must not pass the project_upsert gate",
        );
        // And since the gate blocks the persist, the root never enters the
        // registry — a later gated read under it stays rejected.
        let file = unvetted.join("secret.txt");
        std::fs::write(&file, b"x").unwrap();
        assert!(
            approved_canonical(&file.to_string_lossy(), &roots).is_err(),
            "a read under an unvetted (rejected) root must be denied",
        );
    }

    #[test]
    fn upsert_gate_accepts_a_pick_vetted_root() {
        // The legit flow: `pick_project_dir` registers the user-picked dir
        // (here via `register_picked`, the same helper) and returns its canonical
        // path; the renderer persists that path, so `project_upsert`'s gate finds
        // it already approved and passes.
        let roots = ApprovedRoots::default();
        let picked = make_dir("picked");
        let canon = roots.register_picked(&picked).expect("picked dir registers");
        assert!(
            ensure_root_approved(&roots, &canon.to_string_lossy()).is_ok(),
            "a pick-vetted root must pass the project_upsert gate",
        );
    }

    #[test]
    fn upsert_gate_rejects_a_nonexistent_root() {
        // A path that doesn't even resolve (can't be canonicalized) is rejected
        // rather than silently passing — a renderer can't smuggle a made-up path.
        let roots = ApprovedRoots::default();
        let missing = std::env::temp_dir()
            .join(format!("pf-fsmissing-{}-does-not-exist", std::process::id()));
        assert!(
            ensure_root_approved(&roots, &missing.to_string_lossy()).is_err(),
            "a non-resolving root must be rejected by the gate",
        );
    }

    // ---- Fix 2: startup seed excludes archived projects ----

    #[test]
    fn startup_seed_excludes_archived_projects() {
        use pickforge_core::{Database, Project};

        let db = Database::open_in_memory().expect("in-memory db");
        let active = make_dir("seed-active");
        let archived = make_dir("seed-archived");
        let mk = |root: &std::path::Path, name: &str, arch: Option<i64>| Project {
            project_root: root.to_string_lossy().into_owned(),
            display_name: name.to_string(),
            created_at: 0,
            last_opened_at: 0,
            sort_order: 0,
            archived_at: arch,
        };
        db.upsert_project(&mk(&active, "active", None)).unwrap();
        db.upsert_project(&mk(&archived, "archived", Some(1))).unwrap();

        let roots = ApprovedRoots::default();
        seed_approved_roots(&roots, &db);

        let active_file = active.join("a.txt");
        let archived_file = archived.join("b.txt");
        std::fs::write(&active_file, b"x").unwrap();
        std::fs::write(&archived_file, b"y").unwrap();
        assert!(
            approved_canonical(&active_file.to_string_lossy(), &roots).is_ok(),
            "an active project's root must be approved at startup",
        );
        assert!(
            approved_canonical(&archived_file.to_string_lossy(), &roots).is_err(),
            "an archived project's root must NOT be approved at startup",
        );
    }

    // ---- Fix 4: pick_project_dir's broad-pick rejection ----

    #[test]
    fn register_picked_rejects_a_filesystem_root() {
        let roots = ApprovedRoots::default();
        let fs_root = if cfg!(windows) { "C:\\" } else { "/" };
        assert!(
            roots.register_picked(Path::new(fs_root)).is_err(),
            "picking a filesystem root must be rejected before registering",
        );
        assert!(
            roots.0.lock().unwrap().is_empty(),
            "a rejected broad pick must not register anything",
        );
    }

    #[test]
    fn register_picked_rejects_the_home_directory() {
        let Some(home) = user_home_dir() else { return };
        if std::fs::canonicalize(&home).is_err() {
            return;
        }
        let roots = ApprovedRoots::default();
        assert!(
            roots.register_picked(&home).is_err(),
            "picking the home directory must be rejected before registering",
        );
    }

    #[test]
    fn register_picked_returns_the_canonical_dir_and_approves_it() {
        // The returned path is canonical (and verbatim-prefix-stripped) and is
        // the registered approved root, so the value the renderer persists as the
        // DB project_root matches what the gate later checks.
        let roots = ApprovedRoots::default();
        let dir = make_dir("picked-canon");
        let returned = roots.register_picked(&dir).expect("registers");
        assert_eq!(returned, std::fs::canonicalize(&dir).unwrap());
        assert!(roots.is_approved_root(&returned), "the picked dir is approved");
    }

    // ---- Fix 3: verbatim/UNC prefix stripped from returned paths ----

    #[test]
    fn display_path_strips_the_windows_verbatim_prefix() {
        // On non-Windows this is the identity; on Windows the `\\?\` (and
        // `\\?\UNC\`) prefix std::fs::canonicalize adds is stripped so the
        // renderer gets a normal path.
        #[cfg(windows)]
        {
            assert_eq!(
                display_path(Path::new(r"\\?\C:\Users\me\proj")),
                r"C:\Users\me\proj",
            );
            assert_eq!(
                display_path(Path::new(r"\\?\UNC\server\share\proj")),
                r"\\server\share\proj",
            );
        }
        let plain = make_dir("display");
        assert_eq!(display_path(&plain), plain.to_string_lossy());
    }
}
