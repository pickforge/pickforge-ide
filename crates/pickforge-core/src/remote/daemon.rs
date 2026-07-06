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
            DaemonListener::Loopback { host, port } => Ok(Some(format!("{host}:{port}"))),
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
        Ok(Self::disabled(pickforge_home(env)?))
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
            capabilities: vec![
                RemoteCapability::HostInfo,
                RemoteCapability::WorkspaceRead,
                RemoteCapability::TerminalSessions,
                RemoteCapability::AgentChat,
                RemoteCapability::DeviceInspection,
                RemoteCapability::RunLogs,
            ],
            checked_at_ms,
        }
    }
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "::1" | "localhost")
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
            DaemonListener::loopback("127.0.0.1", 4747).unwrap().bind_target(),
            Ok(Some("127.0.0.1:4747".into()))
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
}
