use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::process::{run_timeout, which_in, RunError};

use super::daemon::{DaemonConfigError, DaemonListener};

const TAILSCALE_TIMEOUT: Duration = Duration::from_secs(10);
const TAILSCALE_SERVE_PATH: &str = "/pickforge";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleStatus {
    pub available: bool,
    pub binary_path: Option<String>,
    pub version: Option<String>,
    pub backend_state: Option<String>,
    pub online: Option<bool>,
    pub host_name: Option<String>,
    pub dns_name: Option<String>,
    pub tailscale_ips: Vec<String>,
    pub ssh_capable: bool,
    pub ssh_enabled: Option<bool>,
    pub serve_configured: bool,
    pub error: Option<String>,
}

impl TailscaleStatus {
    fn unavailable(error: Option<String>) -> Self {
        Self {
            available: false,
            binary_path: None,
            version: None,
            backend_state: None,
            online: None,
            host_name: None,
            dns_name: None,
            tailscale_ips: Vec::new(),
            ssh_capable: false,
            ssh_enabled: None,
            serve_configured: false,
            error,
        }
    }
}

pub fn tailscale_status() -> TailscaleStatus {
    let env = crate::process::user_shell_environment();
    let Some(path) = which_in("tailscale", env) else {
        return TailscaleStatus::unavailable(Some("tailscale was not found on PATH".into()));
    };
    let mut status = TailscaleStatus::unavailable(None);
    status.available = true;
    status.binary_path = Some(path.to_string_lossy().into_owned());
    status.version = tailscale_version().ok();

    match run_json(&["status", "--json"]) {
        Ok(json) => apply_status_json(&mut status, &json),
        Err(err) => status.error = Some(err),
    }
    if let Ok(json) = run_json(&["serve", "status", "--json"]) {
        status.serve_configured = !json.as_object().map(|map| map.is_empty()).unwrap_or(true);
    }
    if let Ok(json) = run_json(&["debug", "prefs"]) {
        status.ssh_enabled = json.get("RunSSH").and_then(Value::as_bool);
    }
    status
}

pub fn tailscale_serve_enable(
    listener: &DaemonListener,
    https_port: u16,
) -> Result<TailscaleStatus, String> {
    if https_port == 0 {
        return Err("Tailscale HTTPS port must be non-zero".into());
    }
    let Some(target) = listener.bind_target().map_err(|err| err.to_string())? else {
        return Err("remote listener is disabled".into());
    };
    let target = format!("http://{target}");
    let https = format!("--https={https_port}");
    run_tailscale(&[
        "serve",
        "--bg",
        &https,
        "--set-path",
        TAILSCALE_SERVE_PATH,
        &target,
    ])?;
    Ok(tailscale_status())
}

pub fn tailscale_serve_disable(https_port: u16) -> Result<TailscaleStatus, String> {
    if https_port == 0 {
        return Err("Tailscale HTTPS port must be non-zero".into());
    }
    let https = format!("--https={https_port}");
    run_tailscale(&["serve", &https, "--set-path", TAILSCALE_SERVE_PATH, "off"])?;
    Ok(tailscale_status())
}

pub fn tailscale_ssh_set(enabled: bool) -> Result<TailscaleStatus, String> {
    let flag = if enabled { "--ssh=true" } else { "--ssh=false" };
    run_tailscale(&["set", flag])?;
    Ok(tailscale_status())
}

fn tailscale_version() -> Result<String, String> {
    let outcome = run_tailscale(&["--version"])?;
    Ok(first_non_empty_line(&outcome).unwrap_or_default())
}

fn run_json(args: &[&str]) -> Result<Value, String> {
    let out = run_tailscale(args)?;
    serde_json::from_str(&out).map_err(|err| err.to_string())
}

fn run_tailscale(args: &[&str]) -> Result<String, String> {
    let outcome =
        run_timeout("tailscale", args, None, None, TAILSCALE_TIMEOUT).map_err(format_run_error)?;
    if !outcome.success() {
        return Err(String::from_utf8_lossy(&outcome.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&outcome.stdout).to_string())
}

fn format_run_error(err: RunError) -> String {
    err.to_string()
}

fn first_non_empty_line(raw: &str) -> Option<String> {
    raw.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn apply_status_json(status: &mut TailscaleStatus, json: &Value) {
    status.backend_state = json
        .get("BackendState")
        .and_then(Value::as_str)
        .map(str::to_string);
    let Some(self_node) = json.get("Self") else {
        return;
    };
    status.online = self_node.get("Online").and_then(Value::as_bool);
    status.host_name = self_node
        .get("HostName")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    status.dns_name = self_node
        .get("DNSName")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    status.tailscale_ips = self_node
        .get("TailscaleIPs")
        .and_then(Value::as_array)
        .map(|ips| {
            ips.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    status.ssh_capable = self_node
        .get("Capabilities")
        .and_then(Value::as_array)
        .map(|caps| {
            caps.iter().any(|cap| {
                cap.as_str()
                    .map(|cap| cap.eq_ignore_ascii_case("https://tailscale.com/cap/ssh"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false);
}

pub fn listener_from_parts(host: String, port: u16) -> Result<DaemonListener, DaemonConfigError> {
    DaemonListener::loopback(host, port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_json_parses_safe_fields() {
        let raw = serde_json::json!({
            "BackendState": "Running",
            "Self": {
                "HostName": "host",
                "DNSName": "host.tailnet.ts.net.",
                "Online": true,
                "TailscaleIPs": ["100.64.0.1"],
                "Capabilities": ["https://tailscale.com/cap/ssh"]
            }
        });
        let mut status = TailscaleStatus::unavailable(None);
        apply_status_json(&mut status, &raw);
        assert_eq!(status.backend_state.as_deref(), Some("Running"));
        assert_eq!(status.online, Some(true));
        assert_eq!(status.tailscale_ips, vec!["100.64.0.1"]);
        assert!(status.ssh_capable);
    }

    #[test]
    fn listener_parts_stay_loopback_only() {
        assert!(listener_from_parts("127.0.0.1".into(), 4747).is_ok());
        assert!(listener_from_parts("0.0.0.0".into(), 4747).is_err());
    }
}
