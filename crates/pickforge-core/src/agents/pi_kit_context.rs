//! Writer for PickForge's context file — the reverse direction of
//! `pi_kit_runs`'s status-file reader: PickForge writes
//! `<dataDir>/context.json` atomically (tmp + rename), pi-kit reads it on
//! demand (`readForgeContext` in pi-kit's `src/forge-context-core.ts`). See
//! pi-kit's README, "PickForge context file", for the full locked contract.
//!
//! Path/identity only — the project root, the last file the user opened, and
//! the project's display name. NEVER file contents or secrets. Best-effort
//! and non-authoritative, same as every other file in this external-contract
//! family (`pi_kit_runs`, `storage::telemetry`).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

const CONTEXT_FILE_NAME: &str = "context.json";

/// Schema version this writer emits. Matches `CONTEXT_SCHEMA_VERSION` in
/// pi-kit's `forge-context-core.ts` — bump both sides together.
const SCHEMA_VERSION: u64 = 1;

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// The contract body (schemaVersion 1). Field names must match pi-kit's
/// `ForgeContext` interface exactly: `schemaVersion`, `updatedAtMs`,
/// `projectRoot`, `lastOpenedFile`, `displayName`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ForgeContext<'a> {
    schema_version: u64,
    updated_at_ms: i64,
    project_root: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_opened_file: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<&'a str>,
}

/// Atomically writes `<dir>/context.json` (tmp file + rename, mirroring
/// `storage::telemetry`'s idiom exactly: a per-process, per-write tmp name so
/// concurrent writers from the same or different processes never collide,
/// then a platform-appropriate atomic replace). `dir` is created if it
/// doesn't exist yet (pi-kit may not have run first).
pub fn write_forge_context(
    dir: &Path,
    project_root: &str,
    last_opened_file: Option<&str>,
    display_name: Option<&str>,
) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let context = ForgeContext {
        schema_version: SCHEMA_VERSION,
        updated_at_ms: now_ms(),
        project_root,
        last_opened_file,
        display_name,
    };
    let body = serde_json::to_vec(&context)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    let final_path = dir.join(CONTEXT_FILE_NAME);
    let tmp_path = tmp_path(dir);
    fs::write(&tmp_path, body)?;
    match replace_file(&tmp_path, &final_path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&tmp_path);
            Err(error)
        }
    }
}

/// Removes `<dir>/context.json` if present — called when the writer's flag
/// turns off or no PickForge project is active. A missing file is not an
/// error: pi-kit's reader already treats absence as a normal, honest degrade.
pub fn clear_forge_context(dir: &Path) -> std::io::Result<()> {
    match fs::remove_file(dir.join(CONTEXT_FILE_NAME)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn tmp_path(dir: &Path) -> PathBuf {
    let suffix = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    dir.join(format!(".{CONTEXT_FILE_NAME}.{}.{suffix}.tmp", std::process::id()))
}

#[cfg(not(windows))]
fn replace_file(tmp: &Path, path: &Path) -> std::io::Result<()> {
    fs::rename(tmp, path)
}

#[cfg(windows)]
fn replace_file(tmp: &Path, path: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    extern "system" {
        fn MoveFileExW(
            lpExistingFileName: *const u16,
            lpNewFileName: *const u16,
            dwFlags: u32,
        ) -> i32;
    }

    let src = tmp.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let dst = path.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let ok = unsafe {
        MoveFileExW(src.as_ptr(), dst.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(name: &str) -> Self {
            let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
            let path = std::env::temp_dir()
                .join(format!("pickforge-pi-kit-context-{name}-{}-{stamp}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn read_json(path: &Path) -> serde_json::Value {
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn writes_the_contract_shape_field_for_field() {
        let root = TempDir::new("shape");

        write_forge_context(&root.path, "/home/dev/acme-app", Some("lib/main.dart"), Some("acme-app"))
            .unwrap();

        let parsed = read_json(&root.path.join("context.json"));
        let obj = parsed.as_object().unwrap();
        let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["displayName", "lastOpenedFile", "projectRoot", "schemaVersion", "updatedAtMs"]);
        assert_eq!(parsed["schemaVersion"], 1);
        assert!(parsed["updatedAtMs"].as_i64().unwrap() > 0);
        assert_eq!(parsed["projectRoot"], "/home/dev/acme-app");
        assert_eq!(parsed["lastOpenedFile"], "lib/main.dart");
        assert_eq!(parsed["displayName"], "acme-app");
    }

    #[test]
    fn omits_absent_optional_fields_instead_of_writing_null() {
        let root = TempDir::new("omit-optional");

        write_forge_context(&root.path, "/home/dev/acme-app", None, None).unwrap();

        let parsed = read_json(&root.path.join("context.json"));
        let obj = parsed.as_object().unwrap();
        assert!(!obj.contains_key("lastOpenedFile"));
        assert!(!obj.contains_key("displayName"));
        assert_eq!(parsed["projectRoot"], "/home/dev/acme-app");
    }

    #[test]
    fn write_is_atomic_tmp_then_rename_and_leaves_no_tmp_behind() {
        let root = TempDir::new("atomic");

        write_forge_context(&root.path, "/home/dev/acme-app", None, None).unwrap();

        let entries: Vec<String> = std::fs::read_dir(&root.path)
            .unwrap()
            .filter_map(Result::ok)
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();
        assert_eq!(entries, vec!["context.json".to_string()]);
    }

    #[test]
    fn write_creates_a_missing_data_dir() {
        let root = TempDir::new("missing-dir");
        let dir = root.path.join("not-yet-created");

        write_forge_context(&dir, "/home/dev/acme-app", None, None).unwrap();

        assert!(dir.join("context.json").exists());
    }

    #[test]
    fn a_second_write_replaces_the_first_with_no_stale_fields() {
        let root = TempDir::new("overwrite");
        write_forge_context(&root.path, "/home/dev/acme-app", Some("a.txt"), Some("Acme")).unwrap();

        write_forge_context(&root.path, "/home/dev/other-app", None, None).unwrap();

        let parsed = read_json(&root.path.join("context.json"));
        assert_eq!(parsed["projectRoot"], "/home/dev/other-app");
        assert!(!parsed.as_object().unwrap().contains_key("lastOpenedFile"));
        assert!(!parsed.as_object().unwrap().contains_key("displayName"));
    }

    #[test]
    fn clear_removes_an_existing_file() {
        let root = TempDir::new("clear");
        write_forge_context(&root.path, "/home/dev/acme-app", None, None).unwrap();
        assert!(root.path.join("context.json").exists());

        clear_forge_context(&root.path).unwrap();

        assert!(!root.path.join("context.json").exists());
    }

    #[test]
    fn clear_on_an_absent_file_is_not_an_error() {
        let root = TempDir::new("clear-missing");

        clear_forge_context(&root.path).unwrap();
    }

    #[test]
    fn clear_on_a_missing_data_dir_is_not_an_error() {
        let root = TempDir::new("clear-missing-dir");
        let dir = root.path.join("never-created");

        clear_forge_context(&dir).unwrap();
    }
}
