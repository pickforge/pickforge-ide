//! Filesystem commands for the project file explorer + file preview.

use std::io::Read;
use std::path::{Path, PathBuf};

use base64::Engine;
use pickforge_core::pickforge_home;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::project_roots::{approved_canonical, ApprovedRoots};

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
    let canon = roots.note_picked(&path)?;
    Ok(Some(display_path(&canon)))
}

/// Open a native Save-As dialog and write `contents` to the chosen file. The
/// destination is the user's explicit native pick, so no approved-root gate
/// applies — the same user-mediated trust model as [`pick_project_dir`]. Used by
/// the account data export. Returns the saved path, or `None` if cancelled.
#[tauri::command]
pub async fn save_text_file(
    app: AppHandle,
    default_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    // `blocking_save_file` must not run on the main thread; async commands run
    // on a worker thread, so this is safe.
    let picked = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("JSON", &["json"])
        .blocking_save_file();
    let Some(file_path) = picked else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    // The export carries personal data (email, credit ledger). Create it
    // owner-only from the start on Unix (0600) so it never briefly exists as the
    // umask default (world-readable 0644) with data already written.
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).map_err(|e| e.to_string())?;
    // `.mode()` only applies when the file is created. If the path already
    // existed, `open` truncated it to empty but kept its old (possibly 0644)
    // perms — tighten to owner-only BEFORE writing any sensitive bytes, so the
    // content is never present in a group/world-readable file even briefly.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    file.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
    // Enforce owner-only after the write too, belt-and-suspenders.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(Some(display_path(&path)))
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

/// One generic rejection message for every [`resolve_chat_citation`] failure
/// (unapproved root, missing candidate, escape, wrong type) — so a caller can
/// never distinguish "outside the project" from "doesn't exist" and probe
/// off-root existence a citation-shaped path at a time.
const CHAT_CITATION_REJECTED: &str = "citation path is not an existing file in this chat's project";

/// Resolve a chat workspace-citation `candidate` (#234) against the chat's
/// OWN `project_root` — not the general approved-roots registry every other
/// `fs_commands` read goes through. That distinction is the whole point: two
/// sibling directories can both be approved active PickForge projects, but a
/// citation typed in project A's chat must never resolve into project B's
/// tree just because both happen to be approved roots. Scoping containment
/// to the exact caller-supplied root (itself required to already BE an
/// approved root, so a compromised renderer can't invent one) is narrower
/// than [`approved_canonical`]'s "any approved root" check on purpose.
///
/// Only an existing REGULAR file is ever returned (the issue's V1 rule — no
/// directories, no "create it" affordance); canonicalizing both root and
/// candidate resolves symlinks and collapses `..`, so neither traversal nor a
/// symlinked escape can leave `project_root`. A relative `candidate` joins
/// the root; an absolute one is used as-is and must still canonicalize
/// inside the root.
fn resolve_chat_citation_path(
    roots: &ApprovedRoots,
    project_root: &str,
    candidate: &str,
) -> Result<PathBuf, String> {
    let canon_root = std::fs::canonicalize(project_root)
        .map_err(|_| CHAT_CITATION_REJECTED.to_string())?;
    if !roots.is_approved_root(&canon_root) {
        return Err(CHAT_CITATION_REJECTED.to_string());
    }

    if candidate.is_empty() || candidate.as_bytes().iter().any(|b| *b < 0x20 || *b == 0x7f) {
        return Err(CHAT_CITATION_REJECTED.to_string());
    }
    let candidate_path = Path::new(candidate);
    let joined = if candidate_path.is_absolute() {
        candidate_path.to_path_buf()
    } else {
        canon_root.join(candidate_path)
    };

    let canon_candidate =
        std::fs::canonicalize(&joined).map_err(|_| CHAT_CITATION_REJECTED.to_string())?;
    if !canon_candidate.starts_with(&canon_root) {
        return Err(CHAT_CITATION_REJECTED.to_string());
    }
    let metadata =
        std::fs::metadata(&canon_candidate).map_err(|_| CHAT_CITATION_REJECTED.to_string())?;
    if !metadata.is_file() {
        return Err(CHAT_CITATION_REJECTED.to_string());
    }
    Ok(canon_candidate)
}

/// Tauri command wrapper for [`resolve_chat_citation_path`]: returns the
/// resolved file's display-normalized canonical path, or the one generic
/// rejection message. The frontend classifier (`src/lib/chatLinkTarget.ts`)
/// has already validated `path`'s syntax before this is ever called — this
/// is the trust boundary that turns "syntactically plausible citation" into
/// "an existing file this chat is actually allowed to open".
#[tauri::command]
pub fn resolve_chat_citation(
    roots: State<'_, ApprovedRoots>,
    project_root: String,
    path: String,
) -> Result<String, String> {
    resolve_chat_citation_path(&roots, &project_root, &path).map(|p| display_path(&p))
}

fn validate_external_url(url: &str) -> Result<String, String> {
    const HOSTLESS_HTTPS_PREFIX: &str = "https:///";
    // Reject raw control characters (including NUL) up front — the `url`
    // crate's WHATWG parser silently strips ASCII tab/newline rather than
    // rejecting them, and percent-encodes other C0 controls into the parsed
    // URL instead of erroring, so "malformed/control-character input" needs
    // this explicit gate rather than relying on `Url::parse` to fail closed.
    if url.chars().any(|c| c.is_control()) {
        return Err("https URL must not contain control characters".into());
    }
    let trimmed = url.trim_start();
    if matches!(
        trimmed.get(..HOSTLESS_HTTPS_PREFIX.len()),
        Some(prefix) if prefix.eq_ignore_ascii_case(HOSTLESS_HTTPS_PREFIX)
    ) {
        return Err("https URL must include a host".into());
    }
    let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" {
        return Err("only https URLs can be opened".into());
    }
    if parsed.cannot_be_a_base() || parsed.host_str().map(str::is_empty).unwrap_or(true) {
        return Err("https URL must include a host".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("https URL must not carry embedded credentials".into());
    }
    Ok(parsed.as_str().to_string())
}

struct ExternalUrlOpener<'a> {
    program: &'static str,
    args: Vec<&'a str>,
}

fn external_url_opener(url: &str) -> ExternalUrlOpener<'_> {
    #[cfg(target_os = "macos")]
    {
        ExternalUrlOpener {
            program: "open",
            args: vec![url],
        }
    }
    #[cfg(target_os = "windows")]
    {
        ExternalUrlOpener {
            program: "rundll32",
            args: vec!["url.dll,FileProtocolHandler", url],
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        ExternalUrlOpener {
            program: "xdg-open",
            args: vec![url],
        }
    }
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let url = validate_external_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        let opener = external_url_opener(url.as_str());

        let out = pickforge_core::run(opener.program, &opener.args, None, None)
            .map_err(|e| e.to_string())?;
        if out.success() {
            Ok(())
        } else {
            Err(format!("{} exited with {:?}", opener.program, out.code))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod open_external_url_tests {
    use super::*;

    #[test]
    fn allows_https_urls() {
        assert_eq!(
            validate_external_url("https://example.com/oauth?code=abc&state=one%20two").unwrap(),
            "https://example.com/oauth?code=abc&state=one%20two"
        );
    }

    #[test]
    fn rejects_non_https_urls() {
        for url in [
            "http://example.com",
            "file:///tmp/token",
            "javascript:alert(1)",
            "pickforge://auth/callback?code=abc",
            "https://",
            "https:///",
            "https:///callback",
        ] {
            assert!(validate_external_url(url).is_err(), "{url} should be rejected");
        }
    }

    #[test]
    fn rejects_embedded_credentials() {
        for url in [
            "https://user:pass@example.com/",
            "https://user@example.com/",
            "https://:pass@example.com/",
        ] {
            assert!(validate_external_url(url).is_err(), "{url} should be rejected");
        }
    }

    #[test]
    fn rejects_control_characters() {
        assert!(validate_external_url("https://example.com/\u{0001}x").is_err());
        assert!(validate_external_url("https://example.com/\0x").is_err());
    }

    #[test]
    fn opener_receives_the_normalized_url() {
        let normalized =
            validate_external_url("https://example.com/a/../oauth?code=abc&state=one%20two")
                .unwrap();
        let opener = external_url_opener(&normalized);

        assert_eq!(opener.args.last().copied(), Some(normalized.as_str()));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_opener_is_shell_free() {
        let normalized =
            validate_external_url("https://example.com/oauth?code=abc&state=one%20two").unwrap();
        let opener = external_url_opener(&normalized);

        assert_eq!(opener.program, "rundll32");
        assert_eq!(
            opener.args,
            vec!["url.dll,FileProtocolHandler", normalized.as_str()]
        );
    }
}

#[cfg(test)]
#[cfg(test)]
mod read_text_bounded_tests {
    use super::*;

    fn temp_root(tag: &str) -> (ApprovedRoots, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("pf-fsroot-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let roots = ApprovedRoots::default();
        roots.insert(&dir);
        (roots, std::fs::canonicalize(&dir).unwrap())
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
        let out = read_text_bounded(&f, MAX_TEXT_PREVIEW_BYTES).expect("read");
        assert_eq!(out.len(), MAX_TEXT_PREVIEW_BYTES);
    }
}

#[cfg(test)]
mod display_path_tests {
    use super::*;

    fn make_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("pf-fsdisplay-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(&dir).unwrap()
    }

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

#[cfg(test)]
mod resolve_chat_citation_tests {
    use super::*;

    fn temp_root(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("pf-citation-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(&dir).unwrap()
    }

    fn approved(root: &Path) -> ApprovedRoots {
        let roots = ApprovedRoots::default();
        roots.insert(root);
        roots
    }

    #[test]
    fn resolves_an_existing_relative_file_under_the_project_root() {
        let root = temp_root("relative");
        std::fs::write(root.join("a.ts"), "x").unwrap();
        let roots = approved(&root);

        let resolved = resolve_chat_citation_path(&roots, &root.to_string_lossy(), "a.ts").unwrap();
        assert_eq!(resolved, root.join("a.ts"));
    }

    #[test]
    fn resolves_an_existing_absolute_file_inside_the_project_root() {
        let root = temp_root("absolute");
        std::fs::create_dir_all(root.join("src")).unwrap();
        let file = root.join("src").join("a.ts");
        std::fs::write(&file, "x").unwrap();
        let roots = approved(&root);

        let resolved =
            resolve_chat_citation_path(&roots, &root.to_string_lossy(), &file.to_string_lossy())
                .unwrap();
        assert_eq!(resolved, file);
    }

    #[test]
    fn rejects_a_project_root_that_is_not_itself_approved() {
        let root = temp_root("unapproved");
        std::fs::write(root.join("a.ts"), "x").unwrap();
        let roots = ApprovedRoots::default(); // never registered

        assert!(resolve_chat_citation_path(&roots, &root.to_string_lossy(), "a.ts").is_err());
    }

    #[test]
    fn rejects_dotdot_traversal_out_of_the_project_root() {
        let root = temp_root("traversal");
        let secret = std::env::temp_dir()
            .join(format!("pf-citation-secret-{}.txt", std::process::id()));
        std::fs::write(&secret, "top secret").unwrap();
        let roots = approved(&root);

        let candidate = format!("../{}", secret.file_name().unwrap().to_string_lossy());
        let err = resolve_chat_citation_path(&roots, &root.to_string_lossy(), &candidate)
            .unwrap_err();
        assert!(err.contains("not an existing file"));
        let _ = std::fs::remove_file(&secret);
    }

    #[test]
    fn rejects_a_sibling_approved_project_even_though_both_are_registered() {
        let a = temp_root("sibling-a");
        let b = temp_root("sibling-b");
        std::fs::write(b.join("secret.ts"), "shh").unwrap();
        let roots = ApprovedRoots::default();
        roots.insert(&a);
        roots.insert(&b); // b is approved too, but NOT the chat's own root

        // An absolute path into b, resolved against a's project root: b is a
        // legitimate approved root, but not THIS chat's root, so it must be
        // rejected — the general `approved_canonical` check would wrongly
        // allow this since it only asks "is this under ANY approved root".
        let err = resolve_chat_citation_path(
            &roots,
            &a.to_string_lossy(),
            &b.join("secret.ts").to_string_lossy(),
        )
        .unwrap_err();
        assert!(err.contains("not an existing file"));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_escaping_the_project_root() {
        use std::os::unix::fs::symlink;
        let root = temp_root("symlink-out");
        let outside = temp_root("symlink-out-target");
        std::fs::write(outside.join("secret.ts"), "shh").unwrap();
        let link = root.join("escape");
        let _ = std::fs::remove_file(&link);
        symlink(&outside, &link).unwrap();
        let roots = approved(&root);

        let err = resolve_chat_citation_path(&roots, &root.to_string_lossy(), "escape/secret.ts")
            .unwrap_err();
        assert!(err.contains("not an existing file"));
    }

    #[cfg(unix)]
    #[test]
    fn allows_a_symlink_resolving_inside_the_project_root() {
        use std::os::unix::fs::symlink;
        let root = temp_root("symlink-in");
        std::fs::write(root.join("real.ts"), "x").unwrap();
        let link = root.join("alias.ts");
        let _ = std::fs::remove_file(&link);
        symlink(root.join("real.ts"), &link).unwrap();
        let roots = approved(&root);

        let resolved =
            resolve_chat_citation_path(&roots, &root.to_string_lossy(), "alias.ts").unwrap();
        assert_eq!(resolved, root.join("real.ts"));
    }

    #[test]
    fn rejects_a_directory() {
        let root = temp_root("directory");
        std::fs::create_dir_all(root.join("src")).unwrap();
        let roots = approved(&root);

        let err = resolve_chat_citation_path(&roots, &root.to_string_lossy(), "src").unwrap_err();
        assert!(err.contains("not an existing file"));
    }

    #[test]
    fn rejects_a_missing_file_without_disclosing_off_root_existence() {
        let root = temp_root("missing");
        let roots = approved(&root);

        let missing_err =
            resolve_chat_citation_path(&roots, &root.to_string_lossy(), "nope.ts").unwrap_err();
        let outside = temp_root("missing-outside");
        std::fs::write(outside.join("secret.ts"), "shh").unwrap();
        let escape_err = resolve_chat_citation_path(
            &roots,
            &root.to_string_lossy(),
            &outside.join("secret.ts").to_string_lossy(),
        )
        .unwrap_err();

        // The same generic message either way — a caller can't tell "doesn't
        // exist anywhere" from "exists, but outside my project".
        assert_eq!(missing_err, escape_err);
    }

    #[test]
    fn rejects_a_nul_byte_in_the_candidate() {
        let root = temp_root("nul-byte");
        std::fs::write(root.join("a.ts"), "x").unwrap();
        let roots = approved(&root);

        assert!(
            resolve_chat_citation_path(&roots, &root.to_string_lossy(), "a.ts\0../../etc/passwd")
                .is_err()
        );
    }

    #[test]
    fn a_stale_resolved_path_revalidates_rather_than_trusting_a_cached_result() {
        // Calling the resolver twice after the file is removed between calls
        // must fail closed the second time, not return a stale canonical path
        // from some cache — there is no cache here, but this pins that
        // property against a future one being added carelessly.
        let root = temp_root("revalidate");
        let file = root.join("a.ts");
        std::fs::write(&file, "x").unwrap();
        let roots = approved(&root);

        assert!(resolve_chat_citation_path(&roots, &root.to_string_lossy(), "a.ts").is_ok());
        std::fs::remove_file(&file).unwrap();
        assert!(resolve_chat_citation_path(&roots, &root.to_string_lossy(), "a.ts").is_err());
    }
}
