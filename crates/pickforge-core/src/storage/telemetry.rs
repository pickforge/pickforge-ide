use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::Result;
use serde::{Deserialize, Serialize};

use super::pickforge_home;

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct TelemetryConfig {
    pub crash_reports: bool,
}

impl Default for TelemetryConfig {
    fn default() -> Self {
        Self {
            crash_reports: true,
        }
    }
}

pub fn load_telemetry_config() -> TelemetryConfig {
    let Ok(path) = telemetry_path() else {
        return TelemetryConfig {
            crash_reports: false,
        };
    };
    load_telemetry_config_at(&path)
}

pub fn save_telemetry_config(config: &TelemetryConfig) -> Result<()> {
    save_telemetry_config_at(&telemetry_path()?, config)
}

fn telemetry_path() -> Result<PathBuf> {
    Ok(PathBuf::from(pickforge_home(None)?).join("telemetry.json"))
}

fn load_telemetry_config_at(path: &Path) -> TelemetryConfig {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(error) if error.kind() == ErrorKind::NotFound => TelemetryConfig::default(),
        Err(_) => TelemetryConfig {
            crash_reports: false,
        },
    }
}

fn save_telemetry_config_at(path: &Path, config: &TelemetryConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let suffix = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_file_name(format!(
        ".telemetry.json.{}.{suffix}.tmp",
        std::process::id()
    ));
    fs::write(&tmp, serde_json::to_vec(config)?)?;
    match replace_file(&tmp, path) {
        Ok(()) => Ok(()),
        Err(err) => {
            let _ = fs::remove_file(&tmp);
            Err(err.into())
        }
    }
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

    let src = tmp
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let dst = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let ok = unsafe {
        MoveFileExW(
            src.as_ptr(),
            dst.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pf-telemetry-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("telemetry.json")
    }

    #[test]
    fn defaults_when_missing() {
        let path = temp_file("missing");
        fs::remove_file(&path).ok();

        assert_eq!(load_telemetry_config_at(&path), TelemetryConfig::default());

        fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn round_trips() {
        let path = temp_file("round-trip");
        let config = TelemetryConfig {
            crash_reports: false,
        };

        save_telemetry_config_at(&path, &config).unwrap();

        assert_eq!(load_telemetry_config_at(&path), config);

        fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn malformed_json_defaults() {
        let path = temp_file("malformed");
        fs::write(&path, b"{").unwrap();

        assert_eq!(load_telemetry_config_at(&path), TelemetryConfig::default());

        fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn read_error_disables_crash_reports() {
        let path = temp_file("read-error");
        let dir = path.parent().unwrap().to_path_buf();

        assert_eq!(
            load_telemetry_config_at(&dir),
            TelemetryConfig {
                crash_reports: false,
            }
        );

        fs::remove_dir_all(dir).ok();
    }
}
