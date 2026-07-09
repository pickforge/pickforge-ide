use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::process::CommandOutcome;

use super::ssh::{ssh_run, SshTarget};
use super::tailscale::tailscale_status_json;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostHealth {
    pub checked_at_ms: i64,
    pub tailnet: ProbeState,
    pub ssh: ProbeState,
    pub daemon: ProbeState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", content = "reason", rename_all = "lowercase")]
pub enum ProbeState {
    Ok,
    Failed(String),
    Skipped,
}

pub fn probe_host(host: &str, timeout_per_step: Duration) -> RemoteHostHealth {
    let checked_at_ms = now_ms();
    let tailnet = probe_tailnet_peer(host, timeout_per_step);
    if !matches!(tailnet, ProbeState::Ok) {
        return RemoteHostHealth {
            checked_at_ms,
            tailnet,
            ssh: ProbeState::Skipped,
            daemon: ProbeState::Skipped,
        };
    }

    let target = match SshTarget::new(host) {
        Ok(target) => target,
        Err(err) => {
            return RemoteHostHealth {
                checked_at_ms,
                tailnet,
                ssh: ProbeState::Failed(err.to_string()),
                daemon: ProbeState::Skipped,
            };
        }
    };

    let ssh = match ssh_run(&target, &["true"], timeout_per_step) {
        Ok(outcome) if outcome.success() => ProbeState::Ok,
        Ok(outcome) => ProbeState::Failed(command_summary(&outcome)),
        Err(err) => ProbeState::Failed(err.to_string()),
    };
    if !matches!(ssh, ProbeState::Ok) {
        return RemoteHostHealth {
            checked_at_ms,
            tailnet,
            ssh,
            daemon: ProbeState::Skipped,
        };
    }

    let daemon = match ssh_run(&target, &["pickforged", "status"], timeout_per_step) {
        Ok(outcome) if outcome.success() => daemon_state_from_status_output(&outcome.stdout),
        Ok(_) | Err(_) => ProbeState::Failed("pickforged not reachable".into()),
    };
    RemoteHostHealth {
        checked_at_ms,
        tailnet,
        ssh,
        daemon,
    }
}

pub fn probe_tailnet_peer(host: &str, timeout: Duration) -> ProbeState {
    match tailscale_status_json(timeout) {
        Ok(json) => tailnet_state_from_status(host, &json),
        Err(err) => ProbeState::Failed(format!("tailscale status failed: {err}")),
    }
}

fn daemon_state_from_status_output(stdout: &[u8]) -> ProbeState {
    let Ok(json) = serde_json::from_slice::<Value>(stdout) else {
        return ProbeState::Failed("daemon not listening".into());
    };
    let enabled = json
        .get("listenerEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let running = json
        .get("listenerRunning")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if enabled && running {
        ProbeState::Ok
    } else {
        ProbeState::Failed("daemon not listening".into())
    }
}

fn tailnet_state_from_status(host: &str, json: &Value) -> ProbeState {
    if json
        .get("Self")
        .and_then(|self_node| self_node.get("Online"))
        .and_then(Value::as_bool)
        == Some(false)
    {
        return ProbeState::Failed("tailscale is offline".into());
    }

    if let Some(state) = json.get("BackendState").and_then(Value::as_str) {
        if !state.eq_ignore_ascii_case("Running") {
            return ProbeState::Failed(format!("tailscale backend is {state}"));
        }
    }

    let Some(peers) = json.get("Peer").and_then(Value::as_object) else {
        return ProbeState::Failed("host not found in tailnet".into());
    };

    for peer in peers.values() {
        if peer_matches(host, peer) {
            return if peer.get("Online").and_then(Value::as_bool) == Some(true) {
                ProbeState::Ok
            } else {
                ProbeState::Failed("host is offline".into())
            };
        }
    }
    ProbeState::Failed("host not found in tailnet".into())
}

fn peer_matches(host: &str, peer: &Value) -> bool {
    let normalized_host = normalize_name(host);
    peer.get("HostName")
        .and_then(Value::as_str)
        .map(normalize_name)
        .is_some_and(|name| name == normalized_host)
        || peer
            .get("DNSName")
            .and_then(Value::as_str)
            .map(normalize_name)
            .is_some_and(|dns| {
                dns == normalized_host || dns.starts_with(&format!("{normalized_host}."))
            })
        || peer
            .get("TailscaleIPs")
            .and_then(Value::as_array)
            .is_some_and(|ips| ips.iter().any(|ip| ip.as_str() == Some(host)))
}

fn normalize_name(value: &str) -> String {
    value.trim_end_matches('.').to_ascii_lowercase()
}

fn command_summary(outcome: &CommandOutcome) -> String {
    let stderr = String::from_utf8_lossy(&outcome.stderr).trim().to_string();
    if !stderr.is_empty() {
        return truncate_summary(&stderr);
    }
    let stdout = String::from_utf8_lossy(&outcome.stdout).trim().to_string();
    if !stdout.is_empty() {
        return truncate_summary(&stdout);
    }
    format!("ssh exited with {:?}", outcome.code)
}

fn truncate_summary(value: &str) -> String {
    const MAX: usize = 240;
    if value.chars().count() <= MAX {
        value.to_string()
    } else {
        format!("{}...", value.chars().take(MAX).collect::<String>())
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TAILSCALE_STATUS_FIXTURE: &str = r#"{
      "BackendState": "Running",
      "Self": {
        "HostName": "workstation",
        "DNSName": "workstation.tailnet.ts.net.",
        "Online": true
      },
      "Peer": {
        "nodekey:mac": {
          "HostName": "Mac-Mini",
          "DNSName": "mac-mini.tailnet.ts.net.",
          "TailscaleIPs": ["100.64.0.10"],
          "Online": true
        },
        "nodekey:linux": {
          "HostName": "linux-box",
          "DNSName": "linux-box.tailnet.ts.net.",
          "TailscaleIPs": ["100.64.0.11"],
          "Online": false
        }
      }
    }"#;

    #[test]
    fn peer_matching_accepts_hostname_and_dns_prefix_case_insensitively() {
        let json: Value = serde_json::from_str(TAILSCALE_STATUS_FIXTURE).unwrap();
        assert_eq!(tailnet_state_from_status("mac-mini", &json), ProbeState::Ok);
        assert_eq!(tailnet_state_from_status("MAC-MINI", &json), ProbeState::Ok);
        assert_eq!(
            tailnet_state_from_status("mac-mini.tailnet.ts.net", &json),
            ProbeState::Ok
        );
        assert_eq!(
            tailnet_state_from_status("100.64.0.10", &json),
            ProbeState::Ok
        );
    }

    #[test]
    fn peer_matching_reports_offline_and_missing_hosts() {
        let json: Value = serde_json::from_str(TAILSCALE_STATUS_FIXTURE).unwrap();
        assert_eq!(
            tailnet_state_from_status("linux-box", &json),
            ProbeState::Failed("host is offline".into())
        );
        assert_eq!(
            tailnet_state_from_status("missing", &json),
            ProbeState::Failed("host not found in tailnet".into())
        );
    }

    #[test]
    fn daemon_status_output_requires_enabled_and_running_listener() {
        assert_eq!(
            daemon_state_from_status_output(
                br#"{"listenerEnabled":true,"listenerRunning":true}"#
            ),
            ProbeState::Ok
        );
        for raw in [
            br#"{"listenerEnabled":true,"listenerRunning":false}"#.as_slice(),
            br#"{"listenerEnabled":false,"listenerRunning":true}"#.as_slice(),
            br#"{"listenerEnabled":true}"#.as_slice(),
            b"not json".as_slice(),
        ] {
            assert_eq!(
                daemon_state_from_status_output(raw),
                ProbeState::Failed("daemon not listening".into())
            );
        }
    }
}
