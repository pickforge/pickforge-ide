//! ADB device support — ported from `android_adb_service.dart`. One-shot ops
//! (device list, screenshot, UIAutomator dump) run via the process runner;
//! `run()` already returns raw bytes, so PNG `screencap` output isn't corrupted.
//! (Long-lived `adb logcat` streaming lands with the streaming process spawn.)

use std::path::Path;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::process::{is_on_user_path, run};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdbDevice {
    pub serial: String,
    /// `device`, `offline`, `unauthorized`, …
    pub state: String,
    pub model: Option<String>,
}

impl AdbDevice {
    pub fn is_online(&self) -> bool {
        self.state == "device"
    }
}

const KNOWN_STATES: &[&str] = &[
    "device",
    "offline",
    "unauthorized",
    "bootloader",
    "recovery",
    "sideload",
    "authorizing",
    "connecting",
    "host",
    "disconnected",
];

/// `adb devices -l`, parsed. Empty when adb is missing or errors.
pub fn list_devices() -> Vec<AdbDevice> {
    if !is_on_user_path("adb") {
        return Vec::new();
    }
    match run("adb", &["devices", "-l"], None, None) {
        Ok(out) if out.success() => parse_devices(&out.stdout_utf8()),
        _ => Vec::new(),
    }
}

/// The AVD id of a running emulator `serial`, via `adb -s <serial> emu avd
/// name`. `None` for physical/offline devices. The emulator console appends an
/// `OK` line, so take the first non-empty line that isn't `OK`.
pub fn running_avd_id(serial: &str) -> Option<String> {
    if !is_on_user_path("adb") {
        return None;
    }
    let out = run("adb", &["-s", serial, "emu", "avd", "name"], None, None).ok()?;
    if !out.success() {
        return None;
    }
    out.stdout_utf8()
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && *l != "OK")
        .map(str::to_string)
}

/// Poll until `serial` reports an online (`device`) state, or `timeout` elapses.
/// Returns whether it came online.
pub fn wait_for_online(serial: &str, timeout: Duration, poll: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if list_devices()
            .iter()
            .any(|d| d.serial == serial && d.is_online())
        {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(poll);
    }
}

/// Capture a PNG screenshot of `serial` into `output_dir/output_name`. Returns
/// the path, or `None`. `output_name` must be a bare file name.
pub fn capture_screenshot(serial: &str, output_dir: &str, output_name: &str) -> Option<String> {
    if output_name.is_empty() || output_name.contains('/') || output_name.contains('\\') {
        return None;
    }
    if !is_on_user_path("adb") {
        return None;
    }
    let out = run(
        "adb",
        &["-s", serial, "exec-out", "screencap", "-p"],
        None,
        None,
    )
    .ok()?;
    if !out.success() || out.stdout.is_empty() {
        return None;
    }
    std::fs::create_dir_all(output_dir).ok()?;
    let path = Path::new(output_dir).join(output_name);
    std::fs::write(&path, &out.stdout).ok()?;
    Some(path.to_string_lossy().into_owned())
}

/// Dump the device-side UIAutomator hierarchy XML for `serial`, or `None`.
pub fn dump_uiautomator_xml(serial: &str) -> Option<String> {
    if !is_on_user_path("adb") {
        return None;
    }
    let out = run(
        "adb",
        &["-s", serial, "exec-out", "uiautomator", "dump", "/dev/tty"],
        None,
        None,
    )
    .ok()?;
    if !out.success() {
        return None;
    }
    let xml = out.stdout_utf8().into_owned();
    if xml.contains('<') {
        Some(xml)
    } else {
        None
    }
}

fn parse_devices(output: &str) -> Vec<AdbDevice> {
    let mut devices = Vec::new();
    for raw in output.lines() {
        let line = raw.trim();
        // Skip the header and the "* daemon not running …" startup noise.
        if line.is_empty() || line.starts_with("List of devices") || line.starts_with('*') {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 || !KNOWN_STATES.contains(&parts[1]) {
            continue;
        }
        let model = parts
            .iter()
            .skip(2)
            .find_map(|t| t.strip_prefix("model:").map(str::to_string));
        devices.push(AdbDevice {
            serial: parts[0].to_string(),
            state: parts[1].to_string(),
            model,
        });
    }
    devices
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_device_list_skipping_noise() {
        let output = "* daemon not running; starting now at tcp:5037\n\
                      List of devices attached\n\
                      emulator-5554          device product:sdk model:Pixel_10 device:emu\n\
                      ZY223          unauthorized\n\
                      junkline\n";
        let devices = parse_devices(output);
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].serial, "emulator-5554");
        assert!(devices[0].is_online());
        assert_eq!(devices[0].model.as_deref(), Some("Pixel_10"));
        assert_eq!(devices[1].state, "unauthorized");
        assert!(!devices[1].is_online());
        assert!(devices[1].model.is_none());
    }

    #[test]
    fn screenshot_rejects_non_bare_names() {
        assert!(capture_screenshot("x", "/tmp", "a/b.png").is_none());
        assert!(capture_screenshot("x", "/tmp", "").is_none());
    }
}
