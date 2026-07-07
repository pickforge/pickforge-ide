use std::collections::HashMap;

use serde::de;
use serde::{Deserialize, Deserializer, Serialize};

use crate::storage::{pickforge_home, PickforgeHomeError};

use super::protocol::{RemoteCapability, REMOTE_PROTOCOL_NAME, REMOTE_PROTOCOL_VERSION};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DaemonConfigError {
    #[error("remote daemon listener must bind to loopback, got '{0}'")]
    NonLoopbackBind(String),
    #[error("remote daemon port must be non-zero")]
    InvalidPort,
    #[error("remote daemon listener is invalid: {0}")]
    InvalidListener(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DaemonListener {
    Disabled,
    Loopback { host: String, port: u16 },
}

impl DaemonListener {
    pub fn loopback(host: impl Into<String>, port: u16) -> Result<Self, DaemonConfigError> {
        let host = host.into();
        validate_loopback(&host, port)?;
        Ok(Self::Loopback { host, port })
    }

    pub fn validate(&self) -> Result<(), DaemonConfigError> {
        match self {
            DaemonListener::Disabled => Ok(()),
            DaemonListener::Loopback { host, port } => validate_loopback(host, *port),
        }
    }

    pub fn bind_target(&self) -> Result<Option<String>, DaemonConfigError> {
        self.validate()?;
        match self {
            DaemonListener::Disabled => Ok(None),
            DaemonListener::Loopback { host, port } => Ok(Some(format_host_port(host, *port))),
        }
    }
}

impl<'de> Deserialize<'de> for DaemonListener {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(tag = "kind", rename_all = "camelCase")]
        enum ListenerWire {
            Disabled,
            Loopback { host: String, port: u16 },
        }

        match ListenerWire::deserialize(deserializer)? {
            ListenerWire::Disabled => Ok(DaemonListener::Disabled),
            ListenerWire::Loopback { host, port } => DaemonListener::loopback(host, port)
                .map_err(|err| de::Error::custom(err.to_string())),
        }
    }
}

fn validate_loopback(host: &str, port: u16) -> Result<(), DaemonConfigError> {
    if port == 0 {
        return Err(DaemonConfigError::InvalidPort);
    }
    if !is_loopback_host(host) {
        return Err(DaemonConfigError::NonLoopbackBind(host.into()));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonConfig {
    pub pickforge_home: String,
    pub listener: DaemonListener,
}

impl DaemonConfig {
    pub fn disabled(pickforge_home: impl Into<String>) -> Self {
        Self {
            pickforge_home: pickforge_home.into(),
            listener: DaemonListener::Disabled,
        }
    }

    pub fn validate(&self) -> Result<(), DaemonConfigError> {
        self.listener.validate()
    }

    pub fn from_env(env: Option<&HashMap<String, String>>) -> Result<Self, PickforgeHomeError> {
        let home = pickforge_home(env)?;
        let listener = listener_from_env(env).unwrap_or(DaemonListener::Disabled);
        Ok(Self {
            pickforge_home: home,
            listener,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonStatus {
    pub protocol: String,
    pub protocol_version: u16,
    pub pickforge_home: String,
    pub listener: DaemonListener,
    pub listener_enabled: bool,
    pub capabilities: Vec<RemoteCapability>,
    pub checked_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct RemoteHostDaemon {
    config: DaemonConfig,
}

impl RemoteHostDaemon {
    pub fn new(config: DaemonConfig) -> Result<Self, DaemonConfigError> {
        config.validate()?;
        Ok(Self { config })
    }

    pub fn config(&self) -> &DaemonConfig {
        &self.config
    }

    pub fn bind_target(&self) -> Option<String> {
        self.config.listener.bind_target().ok().flatten()
    }

    pub fn status(&self, checked_at_ms: i64) -> DaemonStatus {
        DaemonStatus {
            protocol: REMOTE_PROTOCOL_NAME.into(),
            protocol_version: REMOTE_PROTOCOL_VERSION,
            pickforge_home: self.config.pickforge_home.clone(),
            listener: self.config.listener.clone(),
            listener_enabled: self.bind_target().is_some(),
            capabilities: vec![RemoteCapability::HostInfo],
            checked_at_ms,
        }
    }
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "::1" | "localhost")
}

fn format_host_port(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn listener_from_env(
    env: Option<&HashMap<String, String>>,
) -> Result<DaemonListener, DaemonConfigError> {
    let get = |key: &str| -> Option<String> {
        match env {
            Some(map) => map.get(key).cloned(),
            None => std::env::var(key).ok(),
        }
    };
    let trimmed = |value: Option<String>| -> Option<String> {
        value
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };

    if let Some(raw) = trimmed(get("PICKFORGE_REMOTE_LISTENER")) {
        if raw.eq_ignore_ascii_case("disabled") || raw.eq_ignore_ascii_case("off") {
            return Ok(DaemonListener::Disabled);
        }
        return parse_listener(&raw);
    }

    let Some(port_raw) = trimmed(get("PICKFORGE_REMOTE_PORT")) else {
        return Ok(DaemonListener::Disabled);
    };
    let port = parse_port(&port_raw)?;
    let host = trimmed(get("PICKFORGE_REMOTE_HOST")).unwrap_or_else(|| "127.0.0.1".into());
    DaemonListener::loopback(host, port)
}

pub fn parse_listener(raw: &str) -> Result<DaemonListener, DaemonConfigError> {
    let raw = raw.trim();
    if raw.eq_ignore_ascii_case("disabled") || raw.eq_ignore_ascii_case("off") {
        return Ok(DaemonListener::Disabled);
    }
    let (host, port) = raw
        .rsplit_once(':')
        .ok_or_else(|| DaemonConfigError::InvalidListener(raw.into()))?;
    let host = host.trim().trim_matches(['[', ']']);
    let port = parse_port(port.trim())?;
    DaemonListener::loopback(host, port)
}

fn parse_port(raw: &str) -> Result<u16, DaemonConfigError> {
    raw.parse::<u16>()
        .map_err(|_| DaemonConfigError::InvalidListener(raw.into()))
        .and_then(|port| {
            if port == 0 {
                Err(DaemonConfigError::InvalidPort)
            } else {
                Ok(port)
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_config_has_no_bind_target() {
        let daemon = RemoteHostDaemon::new(DaemonConfig::disabled("/home/dev/.pickforge")).unwrap();
        assert_eq!(daemon.bind_target(), None);
        let status = daemon.status(42);
        assert!(!status.listener_enabled);
        assert_eq!(status.protocol, REMOTE_PROTOCOL_NAME);
    }

    #[test]
    fn loopback_listener_rejects_wildcard_binds() {
        assert_eq!(
            DaemonListener::loopback("0.0.0.0", 4747),
            Err(DaemonConfigError::NonLoopbackBind("0.0.0.0".into()))
        );
        assert_eq!(
            DaemonListener::loopback("::", 4747),
            Err(DaemonConfigError::NonLoopbackBind("::".into()))
        );
    }

    #[test]
    fn loopback_listener_accepts_only_loopback_hosts_with_ports() {
        assert_eq!(
            DaemonListener::loopback("127.0.0.1", 4747)
                .unwrap()
                .bind_target(),
            Ok(Some("127.0.0.1:4747".into()))
        );
        assert_eq!(
            DaemonListener::loopback("::1", 4747).unwrap().bind_target(),
            Ok(Some("[::1]:4747".into()))
        );
        assert_eq!(
            DaemonListener::Loopback {
                host: "0.0.0.0".into(),
                port: 4747,
            }
            .bind_target(),
            Err(DaemonConfigError::NonLoopbackBind("0.0.0.0".into()))
        );
        assert_eq!(
            serde_json::from_str::<DaemonListener>(
                r#"{"kind":"loopback","host":"0.0.0.0","port":4747}"#
            )
            .is_err(),
            true
        );
        assert_eq!(
            serde_json::from_str::<DaemonListener>(
                r#"{"kind":"loopback","host":"127.0.0.1","port":4747}"#
            )
            .unwrap()
            .bind_target(),
            Ok(Some("127.0.0.1:4747".into()))
        );
        assert_eq!(
            DaemonListener::loopback("localhost", 0),
            Err(DaemonConfigError::InvalidPort)
        );
    }

    #[test]
    fn env_config_enables_loopback_listener() {
        let mut env = HashMap::new();
        env.insert("HOME".into(), "/home/dev".into());
        env.insert("PICKFORGE_REMOTE_HOST".into(), "localhost".into());
        env.insert("PICKFORGE_REMOTE_PORT".into(), "4747".into());
        let config = DaemonConfig::from_env(Some(&env)).unwrap();
        assert_eq!(
            config.listener.bind_target().unwrap(),
            Some("localhost:4747".into())
        );
    }

    #[test]
    fn listener_string_rejects_non_loopback() {
        assert_eq!(
            parse_listener("0.0.0.0:4747"),
            Err(DaemonConfigError::NonLoopbackBind("0.0.0.0".into()))
        );
        assert_eq!(
            parse_listener("127.0.0.1:0"),
            Err(DaemonConfigError::InvalidPort)
        );
    }

    #[test]
    fn status_advertises_only_implemented_remote_capabilities() {
        let daemon = RemoteHostDaemon::new(DaemonConfig::disabled("/home/dev/.pickforge")).unwrap();
        assert_eq!(
            daemon.status(42).capabilities,
            vec![RemoteCapability::HostInfo]
        );
    }
}
