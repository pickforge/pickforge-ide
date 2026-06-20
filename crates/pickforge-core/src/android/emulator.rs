//! Android emulator (AVD) support: discover installed AVDs with friendly names,
//! launch a stopped AVD as a detached process, and merge running devices with
//! stopped AVDs into one list for the UI. The `emulator` binary is usually NOT
//! on PATH, so it's resolved against the SDK location.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

use crate::process::{user_shell_environment, which_in};

use super::adb;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvdInfo {
    pub avd_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceState {
    /// adb-online (`device` state) — runnable.
    Running,
    /// Present to adb but not usable (offline / unauthorized / booting) — listed
    /// but not auto-selected or launched against.
    Offline,
    /// An installed AVD that isn't currently running.
    Stopped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceKind {
    Emulator,
    Physical,
}

/// A device row for the UI: a running adb device or an installed-but-stopped AVD.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEntry {
    /// adb serial — `None` for a stopped AVD (no serial until it boots).
    pub serial: Option<String>,
    /// AVD id (emulators only); `None` for physical devices.
    pub avd_id: Option<String>,
    /// Friendly name only (e.g. "Pixel 10"); the serial is appended in the UI.
    pub display_name: String,
    pub state: DeviceState,
    pub kind: DeviceKind,
}

/// The user's home dir from the login-shell env: HOME (unix/macOS), else
/// USERPROFILE or HOMEDRIVE+HOMEPATH (Windows GUI apps don't get HOME).
fn home_dir(env: &std::collections::HashMap<String, String>) -> Option<String> {
    if let Some(h) = env.get("HOME").filter(|s| !s.is_empty()) {
        return Some(h.clone());
    }
    if let Some(h) = env.get("USERPROFILE").filter(|s| !s.is_empty()) {
        return Some(h.clone());
    }
    match (
        env.get("HOMEDRIVE").filter(|s| !s.is_empty()),
        env.get("HOMEPATH").filter(|s| !s.is_empty()),
    ) {
        (Some(d), Some(p)) => Some(format!("{d}{p}")),
        _ => None,
    }
}

/// Resolve the Android `emulator` binary. It's rarely on PATH, so fall back to
/// the standard SDK locations, reading env from the cached login-shell env (no
/// `std::env`, no `dirs` crate — mirror how the process runner resolves things).
pub fn resolve_emulator_binary() -> Option<PathBuf> {
    let env = user_shell_environment();
    if let Some(p) = which_in("emulator", env) {
        return Some(p);
    }
    let exe = if cfg!(windows) { "emulator.exe" } else { "emulator" };
    let mut candidates: Vec<PathBuf> = Vec::new();
    for key in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(sdk) = env.get(key).filter(|s| !s.is_empty()) {
            candidates.push(Path::new(sdk).join("emulator").join(exe));
        }
    }
    if let Some(home) = home_dir(env) {
        candidates.push(Path::new(&home).join("Android/Sdk/emulator").join(exe));
        candidates.push(Path::new(&home).join("Library/Android/sdk/emulator").join(exe));
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// Installed AVDs with friendly names, from `~/.android/avd/*.avd/config.ini`.
/// Empty on any failure (missing dir, no perms).
pub fn list_avds() -> Vec<AvdInfo> {
    let env = user_shell_environment();
    let home = match home_dir(env) {
        Some(h) => h,
        None => return Vec::new(),
    };
    let avd_root = Path::new(&home).join(".android").join("avd");
    let entries = match std::fs::read_dir(&avd_root) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        // Only `<name>.avd/` directories carry a config.ini.
        let stem = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) if name.ends_with(".avd") => name.trim_end_matches(".avd"),
            _ => continue,
        };
        let text = match std::fs::read_to_string(path.join("config.ini")) {
            Ok(t) => t,
            Err(_) => continue,
        };
        out.push(parse_avd_config(&text, stem));
    }
    out.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));
    out
}

/// Parse one AVD `config.ini`. `display_name` comes from the EXACT
/// `avd.ini.displayname=` key (the file also has `tag.displaynames=`, which must
/// not leak in); falls back to the AvdId, then the directory stem.
fn parse_avd_config(text: &str, stem: &str) -> AvdInfo {
    let mut avd_id: Option<String> = None;
    let mut display_name: Option<String> = None;
    for line in text.lines() {
        if let Some(v) = line.strip_prefix("AvdId=") {
            let v = v.trim();
            if !v.is_empty() {
                avd_id = Some(v.to_string());
            }
        } else if let Some(v) = line.strip_prefix("avd.ini.displayname=") {
            let v = v.trim();
            if !v.is_empty() {
                display_name = Some(v.to_string());
            }
        }
    }
    let avd_id = avd_id.unwrap_or_else(|| stem.to_string());
    let display_name = display_name.unwrap_or_else(|| avd_id.clone());
    AvdInfo { avd_id, display_name }
}

/// Launch a stopped AVD as a detached background process. `Ok(())` means it was
/// spawned, not that it finished booting.
pub fn launch_avd(avd_id: &str) -> Result<(), String> {
    let bin = resolve_emulator_binary().ok_or_else(|| "emulator binary not found".to_string())?;
    let mut cmd = Command::new(&bin);
    cmd.arg("-avd").arg(avd_id);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // Same enriched login-shell env the process runner uses, so the emulator
    // finds the JDK / SDK side-tools it needs.
    cmd.env_clear();
    for (k, v) in user_shell_environment() {
        cmd.env(k, v);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Own process group so the emulator survives PickForge exit / Ctrl-C.
        cmd.process_group(0);
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    // Reap on exit so an emulator that quits mid-session doesn't linger as a
    // zombie until PickForge itself exits (Drop on Child doesn't wait).
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// The merged, deduped device list: running adb devices first, then any
/// installed AVD that isn't currently running. A running emulator's AvdId
/// dedupes it against its stopped-AVD entry.
pub fn device_list() -> Vec<DeviceEntry> {
    let running = adb::list_devices();
    let avds = list_avds();

    let mut out: Vec<DeviceEntry> = Vec::new();
    let mut running_avd_ids: HashSet<String> = HashSet::new();

    for d in &running {
        // adb lists offline/unauthorized/booting devices too — only `device`
        // state is runnable; anything else is shown but not selectable.
        let state = if d.is_online() {
            DeviceState::Running
        } else {
            DeviceState::Offline
        };
        if d.serial.starts_with("emulator-") {
            // Only an online emulator answers the console `avd name` query.
            let avd_id = if d.is_online() {
                adb::running_avd_id(&d.serial)
            } else {
                None
            };
            if let Some(id) = &avd_id {
                running_avd_ids.insert(id.clone());
            }
            let display_name = avd_id
                .as_deref()
                .and_then(|id| {
                    avds.iter()
                        .find(|a| a.avd_id == id)
                        .map(|a| a.display_name.clone())
                })
                .or_else(|| avd_id.clone())
                .or_else(|| d.model.clone())
                .unwrap_or_else(|| d.serial.clone());
            out.push(DeviceEntry {
                serial: Some(d.serial.clone()),
                avd_id,
                display_name,
                state,
                kind: DeviceKind::Emulator,
            });
        } else {
            out.push(DeviceEntry {
                serial: Some(d.serial.clone()),
                avd_id: None,
                display_name: d.model.clone().unwrap_or_else(|| d.serial.clone()),
                state,
                kind: DeviceKind::Physical,
            });
        }
    }

    for a in &avds {
        if running_avd_ids.contains(&a.avd_id) {
            continue;
        }
        out.push(DeviceEntry {
            serial: None,
            avd_id: Some(a.avd_id.clone()),
            display_name: a.display_name.clone(),
            state: DeviceState::Stopped,
            kind: DeviceKind::Emulator,
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_displayname_from_exact_key() {
        let cfg = "AvdId=Pixel_10\n\
                   avd.ini.displayname=Pixel 10\n\
                   tag.displaynames=Google APIs PlayStore\n\
                   abi.type=x86_64\n";
        let info = parse_avd_config(cfg, "Pixel_10");
        assert_eq!(info.avd_id, "Pixel_10");
        assert_eq!(info.display_name, "Pixel 10");
    }

    #[test]
    fn falls_back_to_avd_id_then_stem() {
        // No displayname: must NOT pick up tag.displaynames; falls back to AvdId.
        let info = parse_avd_config("AvdId=Foo\ntag.displaynames=Bar,Baz\n", "Foo");
        assert_eq!(info.display_name, "Foo");
        // No AvdId either: falls back to the directory stem.
        let info2 = parse_avd_config("abi.type=x86\n", "Legacy_AVD");
        assert_eq!(info2.avd_id, "Legacy_AVD");
        assert_eq!(info2.display_name, "Legacy_AVD");
    }
}
