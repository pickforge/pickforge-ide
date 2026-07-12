//! Android emulator (AVD) support: discover installed AVDs with friendly names,
//! launch a stopped AVD as an OWNED child of [`EmulatorManager`], and merge
//! running devices with stopped AVDs into one list for the UI. The `emulator`
//! binary is usually NOT on PATH, so it's resolved against the SDK location.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

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
    Simulator,
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
    // Android Studio's default Windows SDK location.
    if let Some(local) = env.get("LOCALAPPDATA").filter(|s| !s.is_empty()) {
        candidates.push(Path::new(local).join("Android/Sdk/emulator").join(exe));
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

const EXIT_POLL: Duration = Duration::from_millis(100);
#[cfg(unix)]
const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);

/// Owns emulator children launched through PickForge.
#[derive(Clone)]
pub struct EmulatorManager {
    state: Arc<EmulatorState>,
}

struct EmulatorState {
    children: Mutex<HashMap<u64, Arc<Mutex<Child>>>>,
    next_id: AtomicU64,
    shutting_down: AtomicBool,
}

impl Default for EmulatorManager {
    fn default() -> Self {
        Self {
            state: Arc::new(EmulatorState {
                children: Mutex::new(HashMap::new()),
                next_id: AtomicU64::new(1),
                shutting_down: AtomicBool::new(false),
            }),
        }
    }
}

impl EmulatorManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Launch a stopped AVD. `Ok(())` means spawned, not booted.
    pub fn launch_avd(&self, avd_id: &str) -> Result<(), String> {
        let bin =
            resolve_emulator_binary().ok_or_else(|| "emulator binary not found".to_string())?;
        let mut cmd = Command::new(&bin);
        cmd.arg("-avd").arg(avd_id);
        // Same enriched login-shell env the process runner uses, so the emulator
        // finds the JDK / SDK side-tools it needs.
        cmd.env_clear();
        for (k, v) in user_shell_environment() {
            cmd.env(k, v);
        }
        self.spawn_owned(cmd)
    }

    fn spawn_owned(&self, mut cmd: Command) -> Result<(), String> {
        if self.state.shutting_down.load(Ordering::SeqCst) {
            return Err("emulator manager is shutting down".to_string());
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // The pgid is the exact ownership boundary used at shutdown.
            cmd.process_group(0);
        }
        let child = Arc::new(Mutex::new(cmd.spawn().map_err(|e| e.to_string())?));

        let id = self.state.next_id.fetch_add(1, Ordering::Relaxed);
        {
            let mut children = self
                .state
                .children
                .lock()
                .expect("emulator registry poisoned");
            // Re-check under the lock so insertion cannot race behind the drain.
            if self.state.shutting_down.load(Ordering::SeqCst) {
                drop(children);
                kill_owned_child_now(&child);
                return Err("emulator manager is shutting down".to_string());
            }
            children.insert(id, Arc::clone(&child));
        }
        self.watch_child(id, child);
        Ok(())
    }

    pub fn len(&self) -> usize {
        self.state
            .children
            .lock()
            .expect("emulator registry poisoned")
            .len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn shutdown(&self) {
        self.state.shutting_down.store(true, Ordering::SeqCst);
        let drained = {
            let mut children = self
                .state
                .children
                .lock()
                .expect("emulator registry poisoned");
            children.drain().map(|(_, child)| child).collect::<Vec<_>>()
        };
        if drained.is_empty() {
            return;
        }
        #[cfg(unix)]
        {
            for child in &drained {
                signal_owned_group(child, libc::SIGTERM);
            }
            std::thread::sleep(SHUTDOWN_GRACE);
        }
        for child in drained {
            kill_owned_child_now(&child);
        }
    }

    fn watch_child(&self, id: u64, child: Arc<Mutex<Child>>) {
        let state = Arc::downgrade(&self.state);
        std::thread::spawn(move || loop {
            let Some(state) = Weak::upgrade(&state) else {
                return;
            };
            let mut children = state.children.lock().expect("emulator registry poisoned");
            if !children.contains_key(&id) {
                return;
            }
            let result = child.lock().expect("emulator child poisoned").try_wait();
            match result {
                Ok(Some(_)) => {
                    children.remove(&id);
                    return;
                }
                Ok(None) => {}
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => {
                    children.remove(&id);
                    drop(children);
                    kill_owned_child_now(&child);
                    return;
                }
            }
            drop(children);
            drop(state);
            std::thread::sleep(EXIT_POLL);
        });
    }
}

#[cfg(unix)]
fn signal_owned_group(child: &Arc<Mutex<Child>>, signal: libc::c_int) {
    let child = child.lock().expect("emulator child poisoned");
    unsafe {
        libc::killpg(child.id() as libc::pid_t, signal);
    }
}

fn kill_owned_child_now(child: &Arc<Mutex<Child>>) {
    #[cfg(unix)]
    signal_owned_group(child, libc::SIGKILL);
    let mut child = child.lock().expect("emulator child poisoned");
    let _ = child.kill();
    let _ = child.wait();
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

    #[cfg(unix)]
    fn wait_until(mut done: impl FnMut() -> bool) {
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while !done() {
            assert!(
                std::time::Instant::now() < deadline,
                "timed out waiting for condition"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[cfg(unix)]
    fn process_alive(pid: i32) -> bool {
        unsafe { libc::kill(pid, 0) == 0 }
    }

    #[cfg(unix)]
    fn sleeper_command(marker: &Path) -> Command {
        let mut cmd = Command::new("sh");
        cmd.arg("-c")
            .arg(format!("sleep 30 & sleep 3; : > {}", marker.display()));
        cmd
    }

    #[cfg(unix)]
    fn temp_marker(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "pickforge-emulator-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ))
    }

    #[cfg(unix)]
    #[test]
    fn shutdown_kills_owned_children_and_rejects_new_launches() {
        let marker = temp_marker("shutdown");
        let _ = std::fs::remove_file(&marker);
        let manager = EmulatorManager::new();
        manager
            .spawn_owned(sleeper_command(&marker))
            .expect("spawn fake emulator");
        assert_eq!(manager.len(), 1);
        std::thread::sleep(Duration::from_millis(200)); // let the grandchild fork

        manager.shutdown();
        assert!(manager.is_empty(), "registry must drain on shutdown");
        assert!(manager.spawn_owned(sleeper_command(&marker)).is_err());
        manager.shutdown();

        std::thread::sleep(Duration::from_secs(4));
        assert!(
            !marker.exists(),
            "fake emulator survived shutdown (marker was written)"
        );
        let _ = std::fs::remove_file(&marker);
    }

    #[cfg(unix)]
    #[test]
    fn shutdown_uses_one_global_grace_for_all_children() {
        let manager = EmulatorManager::new();
        for _ in 0..2 {
            let mut cmd = Command::new("sh");
            cmd.args(["-c", "trap '' TERM; exec sleep 30"]);
            manager.spawn_owned(cmd).expect("spawn fake emulator");
        }

        let started = std::time::Instant::now();
        manager.shutdown();
        let elapsed = started.elapsed();

        assert!(elapsed >= Duration::from_millis(1800), "grace was skipped");
        assert!(
            elapsed < Duration::from_millis(3500),
            "grace was applied serially: {elapsed:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn natural_exit_is_reaped_and_leaves_no_registry_entry() {
        let manager = EmulatorManager::new();
        let mut cmd = Command::new("sleep");
        cmd.arg("0.2");
        manager.spawn_owned(cmd).expect("spawn short-lived child");

        let pid = manager
            .state
            .children
            .lock()
            .expect("emulator registry poisoned")
            .values()
            .map(|child| child.lock().expect("emulator child poisoned").id() as i32)
            .next()
            .expect("child is registered");

        wait_until(|| manager.is_empty());
        wait_until(|| !process_alive(pid));
    }

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
