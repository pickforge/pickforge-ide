use std::collections::BTreeMap;
use std::path::Path;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use super::{command_failed, run_ios_command, IosError, IOS_CAPTURE_TIMEOUT, IOS_TIMEOUT};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SimState {
    Booted,
    Shutdown,
    Other,
}

impl FromStr for SimState {
    type Err = std::convert::Infallible;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Ok(match value {
            "Booted" => SimState::Booted,
            "Shutdown" => SimState::Shutdown,
            _ => SimState::Other,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimDevice {
    pub udid: String,
    pub name: String,
    pub state: SimState,
    pub runtime: String,
    pub runtime_id: String,
    pub is_available: bool,
}

#[derive(Debug, Deserialize)]
struct SimctlDevices {
    devices: BTreeMap<String, Vec<RawSimDevice>>,
}

#[derive(Debug, Deserialize)]
struct RawSimDevice {
    udid: String,
    name: String,
    state: String,
    #[serde(rename = "isAvailable", default)]
    is_available: bool,
}

pub fn parse_simctl_devices(json: &str) -> Result<Vec<SimDevice>, IosError> {
    let parsed: SimctlDevices =
        serde_json::from_str(json).map_err(|e| IosError::Parse(e.to_string()))?;
    let mut out = Vec::new();
    for (runtime_id, devices) in parsed.devices {
        let runtime = runtime_label(&runtime_id);
        for device in devices {
            out.push(SimDevice {
                udid: device.udid,
                name: device.name,
                state: SimState::from_str(&device.state).unwrap_or(SimState::Other),
                runtime: runtime.clone(),
                runtime_id: runtime_id.clone(),
                is_available: device.is_available,
            });
        }
    }
    Ok(out)
}

pub fn list_devices() -> Result<Vec<SimDevice>, IosError> {
    let out = run_ios_command(
        "xcrun",
        &["simctl", "list", "devices", "--json"],
        IOS_TIMEOUT,
    )?;
    if !out.success() {
        return Err(command_failed("xcrun", &out));
    }
    Ok(parse_simctl_devices(&out.stdout_utf8())?
        .into_iter()
        .filter(available_ios_device)
        .collect())
}

fn available_ios_device(device: &SimDevice) -> bool {
    device.is_available && runtime_platform(&device.runtime_id) == Some("iOS")
}

pub fn boot_device(udid: &str) -> Result<(), IosError> {
    let out = run_ios_command("xcrun", &["simctl", "boot", udid], IOS_TIMEOUT)?;
    if !out.success() && out.code != Some(149) {
        return Err(command_failed("xcrun", &out));
    }
    let _ = run_ios_command("open", &["-a", "Simulator"], IOS_TIMEOUT);
    Ok(())
}

pub fn capture_screenshot(udid: &str) -> Result<Vec<u8>, IosError> {
    let path = std::env::temp_dir().join(format!(
        "pickforge-simctl-screenshot-{}-{}.png",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let path_arg = path.to_string_lossy();
    let out = run_ios_command(
        "xcrun",
        &["simctl", "io", udid, "screenshot", &path_arg],
        IOS_CAPTURE_TIMEOUT,
    )?;
    if !out.success() {
        let _ = std::fs::remove_file(&path);
        return Err(command_failed("xcrun", &out));
    }

    let bytes = std::fs::read(&path)?;
    let _ = std::fs::remove_file(&path);
    if bytes.is_empty() {
        return Err(IosError::Parse("screenshot file was empty".to_string()));
    }
    Ok(bytes)
}

pub fn install_app(udid: &str, app_path: &Path) -> Result<(), IosError> {
    let app_path = app_path.to_string_lossy();
    let out = run_ios_command(
        "xcrun",
        &["simctl", "install", udid, &app_path],
        IOS_TIMEOUT,
    )?;
    if !out.success() {
        return Err(command_failed("xcrun", &out));
    }
    Ok(())
}

pub fn launch_app(udid: &str, bundle_id: &str) -> Result<u32, IosError> {
    let out = run_ios_command("xcrun", &["simctl", "launch", udid, bundle_id], IOS_TIMEOUT)?;
    if !out.success() {
        return Err(command_failed("xcrun", &out));
    }
    parse_launch_pid(&out.stdout_utf8())
}

pub fn terminate_app(udid: &str, bundle_id: &str) -> Result<(), IosError> {
    let out = run_ios_command(
        "xcrun",
        &["simctl", "terminate", udid, bundle_id],
        IOS_TIMEOUT,
    )?;
    let stderr = String::from_utf8_lossy(&out.stderr).to_lowercase();
    if out.success() || out.code == Some(3) || stderr.contains("found nothing") {
        return Ok(());
    }
    Err(command_failed("xcrun", &out))
}

fn parse_launch_pid(output: &str) -> Result<u32, IosError> {
    for line in output
        .lines()
        .rev()
        .map(str::trim)
        .filter(|l| !l.is_empty())
    {
        if let Some((_, pid)) = line.rsplit_once(':') {
            return pid
                .trim()
                .parse::<u32>()
                .map_err(|e| IosError::Parse(format!("invalid launch pid: {e}")));
        }
    }
    Err(IosError::Parse(
        "launch output did not contain a pid".to_string(),
    ))
}

fn runtime_label(runtime_id: &str) -> String {
    let Some(suffix) = runtime_id.strip_prefix("com.apple.CoreSimulator.SimRuntime.") else {
        return runtime_id.to_string();
    };
    let mut parts = suffix.split('-');
    let Some(platform) = parts.next().filter(|p| !p.is_empty()) else {
        return runtime_id.to_string();
    };
    let version: Vec<&str> = parts.filter(|p| !p.is_empty()).collect();
    if version.is_empty() {
        return runtime_id.to_string();
    }
    format!("{platform} {}", version.join("."))
}

fn runtime_platform(runtime_id: &str) -> Option<&str> {
    let suffix = runtime_id.strip_prefix("com.apple.CoreSimulator.SimRuntime.")?;
    let (platform, version) = suffix.split_once('-')?;
    if platform.is_empty() || version.is_empty() {
        None
    } else {
        Some(platform)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sim_state() {
        assert_eq!("Booted".parse::<SimState>().unwrap(), SimState::Booted);
        assert_eq!("Shutdown".parse::<SimState>().unwrap(), SimState::Shutdown);
        assert_eq!("Creating".parse::<SimState>().unwrap(), SimState::Other);
    }

    #[test]
    fn prettifies_runtime_labels() {
        assert_eq!(
            runtime_label("com.apple.CoreSimulator.SimRuntime.iOS-26-5"),
            "iOS 26.5"
        );
        assert_eq!(runtime_label("custom-runtime"), "custom-runtime");
    }

    #[test]
    fn extracts_runtime_platforms() {
        assert_eq!(
            runtime_platform("com.apple.CoreSimulator.SimRuntime.iOS-26-5"),
            Some("iOS")
        );
        assert_eq!(
            runtime_platform("com.apple.CoreSimulator.SimRuntime.watchOS-26-5"),
            Some("watchOS")
        );
        assert_eq!(
            runtime_platform("com.apple.CoreSimulator.SimRuntime.xrOS-26-5"),
            Some("xrOS")
        );
        assert_eq!(runtime_platform("custom-runtime"), None);
    }

    #[test]
    fn parses_simctl_devices_across_runtimes() {
        let json = r#"{
          "devices": {
            "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
              {
                "udid": "11111111-1111-1111-1111-111111111111",
                "name": "iPhone 18",
                "state": "Booted",
                "isAvailable": true
              },
              {
                "udid": "22222222-2222-2222-2222-222222222222",
                "name": "iPhone 17",
                "state": "Shutdown",
                "isAvailable": false
              }
            ],
            "com.apple.CoreSimulator.SimRuntime.iOS-25-0": [
              {
                "udid": "33333333-3333-3333-3333-333333333333",
                "name": "iPad Pro",
                "state": "Creating",
                "isAvailable": true
              }
            ]
          }
        }"#;

        let devices = parse_simctl_devices(json).unwrap();
        assert_eq!(devices.len(), 3);
        assert_eq!(devices[0].state, SimState::Other);
        assert_eq!(devices[0].runtime, "iOS 25.0");
        assert_eq!(
            devices[0].runtime_id,
            "com.apple.CoreSimulator.SimRuntime.iOS-25-0"
        );
        assert!(devices[0].is_available);
        assert_eq!(devices[1].state, SimState::Booted);
        assert_eq!(devices[1].runtime, "iOS 26.5");
        assert_eq!(
            devices[1].runtime_id,
            "com.apple.CoreSimulator.SimRuntime.iOS-26-5"
        );
        assert!(devices[1].is_available);
        assert_eq!(devices[2].state, SimState::Shutdown);
        assert!(!devices[2].is_available);
    }

    #[test]
    fn filters_available_ios_devices() {
        let json = r#"{
          "devices": {
            "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
              {
                "udid": "11111111-1111-1111-1111-111111111111",
                "name": "iPhone 18",
                "state": "Booted",
                "isAvailable": true
              },
              {
                "udid": "22222222-2222-2222-2222-222222222222",
                "name": "iPad Pro",
                "state": "Shutdown",
                "isAvailable": true
              },
              {
                "udid": "33333333-3333-3333-3333-333333333333",
                "name": "iPhone 17",
                "state": "Shutdown",
                "isAvailable": false
              }
            ],
            "com.apple.CoreSimulator.SimRuntime.tvOS-26-5": [
              {
                "udid": "44444444-4444-4444-4444-444444444444",
                "name": "Apple TV",
                "state": "Shutdown",
                "isAvailable": true
              }
            ],
            "com.apple.CoreSimulator.SimRuntime.watchOS-26-5": [
              {
                "udid": "55555555-5555-5555-5555-555555555555",
                "name": "Apple Watch",
                "state": "Shutdown",
                "isAvailable": true
              }
            ],
            "com.apple.CoreSimulator.SimRuntime.xrOS-26-5": [
              {
                "udid": "66666666-6666-6666-6666-666666666666",
                "name": "Apple Vision Pro",
                "state": "Shutdown",
                "isAvailable": true
              }
            ]
          }
        }"#;

        let filtered = parse_simctl_devices(json)
            .unwrap()
            .into_iter()
            .filter(available_ios_device)
            .collect::<Vec<_>>();

        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].name, "iPhone 18");
        assert_eq!(
            filtered[0].runtime_id,
            "com.apple.CoreSimulator.SimRuntime.iOS-26-5"
        );
        assert_eq!(filtered[1].name, "iPad Pro");
        assert_eq!(
            filtered[1].runtime_id,
            "com.apple.CoreSimulator.SimRuntime.iOS-26-5"
        );
    }

    #[test]
    fn parses_launch_pid() {
        assert_eq!(parse_launch_pid("com.example.App: 12345\n").unwrap(), 12345);
    }

    #[test]
    fn launch_pid_errors_without_colon() {
        assert!(matches!(
            parse_launch_pid("com.example.App launched\n"),
            Err(IosError::Parse(_))
        ));
    }

    #[test]
    fn launch_pid_errors_for_non_numeric_pid() {
        assert!(matches!(
            parse_launch_pid("com.example.App: not-a-pid\n"),
            Err(IosError::Parse(_))
        ));
    }
}
