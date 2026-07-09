use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperatorIntent {
    pub v: u8,
    pub id: String,
    pub provenance: IntentProvenance,
    pub confidence: f64,
    pub project_ref: Option<String>,
    pub action: OperatorAction,
}

impl OperatorIntent {
    /// Validates a locally composed or stored intent, never raw router output.
    /// Routers may only propose `{action, confidence}`; the composer stamps the
    /// full envelope before this parser is used.
    pub fn from_json(json: &str) -> Result<OperatorIntent, IntentParseError> {
        let value = serde_json::from_str::<serde_json::Value>(json)
            .map_err(|e| IntentParseError::Malformed(e.to_string()))?;
        let version = serde_json::from_value::<VersionProbe>(value.clone())
            .map_err(|e| IntentParseError::Malformed(e.to_string()))?;
        let intent = match version.v {
            1 => {
                let legacy = serde_json::from_value::<LegacyOperatorIntent>(value)
                    .map_err(|e| IntentParseError::Malformed(e.to_string()))?;
                legacy.upgrade()
            }
            2 => serde_json::from_value::<OperatorIntent>(value)
                .map_err(|e| IntentParseError::Malformed(e.to_string()))?,
            v => return Err(IntentParseError::UnsupportedVersion { v }),
        };
        intent.validate()?;
        Ok(intent)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("OperatorIntent serialization should not fail")
    }

    fn validate(&self) -> Result<(), IntentParseError> {
        if self.v != 2 {
            return Err(IntentParseError::UnsupportedVersion { v: self.v });
        }
        validate_non_empty("id", &self.id)?;
        if !(0.0..=1.0).contains(&self.confidence) {
            return Err(IntentParseError::InvalidField {
                field: "confidence".to_string(),
                reason: "must be between 0.0 and 1.0".to_string(),
            });
        }
        self.action.validate()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
struct VersionProbe {
    v: u8,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyOperatorIntent {
    #[serde(rename = "v")]
    _v: u8,
    id: String,
    provenance: IntentProvenance,
    confidence: f64,
    project_ref: Option<String>,
    action: LegacyOperatorAction,
}

impl LegacyOperatorIntent {
    fn upgrade(self) -> OperatorIntent {
        OperatorIntent {
            v: 2,
            id: self.id,
            provenance: self.provenance,
            confidence: self.confidence,
            project_ref: self.project_ref,
            action: self.action.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IntentProvenance {
    Typed,
    Voice,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum OperatorAction {
    OpenProject {},
    OpenChat { chat: Option<String> },
    CreateChat { provider: AgentProvider, model: Option<String> },
    SendPrompt { prompt: String, chat: Option<String> },
    StartSwarm {
        mode: SwarmMode,
        count: u8,
        goal: String,
        provider: SwarmProvider,
    },
    SwarmStatus {},
    InterruptRun { run: Option<String> },
    SteerRun { run: Option<String>, instruction: String },
    LaunchEmulator { device: Option<String> },
    LaunchRun { target: Option<String> },
    ReloadRun {},
    StopRun {},
    HotRestart {},
    EnterSelectMode {},
    TakeScreenshot {},
    SelectWidget { description: String },
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum LegacyOperatorAction {
    OpenProject {},
    OpenChat { chat: Option<String> },
    CreateChat { provider: AgentProvider, model: Option<String> },
    SendPrompt { prompt: String, chat: Option<String> },
    StartSwarm {
        mode: SwarmMode,
        count: u8,
        goal: String,
        provider: SwarmProvider,
    },
    SwarmStatus {},
    InterruptRun { run: Option<String> },
    SteerRun { run: Option<String>, instruction: String },
    LaunchEmulator { device: Option<String> },
    LaunchRun { target: Option<String> },
    ReloadRun {},
    EnterSelectMode {},
    TakeScreenshot {},
    SelectWidget { description: String },
}

impl From<LegacyOperatorAction> for OperatorAction {
    fn from(action: LegacyOperatorAction) -> Self {
        match action {
            LegacyOperatorAction::OpenProject {} => OperatorAction::OpenProject {},
            LegacyOperatorAction::OpenChat { chat } => OperatorAction::OpenChat { chat },
            LegacyOperatorAction::CreateChat { provider, model } => {
                OperatorAction::CreateChat { provider, model }
            }
            LegacyOperatorAction::SendPrompt { prompt, chat } => {
                OperatorAction::SendPrompt { prompt, chat }
            }
            LegacyOperatorAction::StartSwarm {
                mode,
                count,
                goal,
                provider,
            } => OperatorAction::StartSwarm {
                mode,
                count,
                goal,
                provider,
            },
            LegacyOperatorAction::SwarmStatus {} => OperatorAction::SwarmStatus {},
            LegacyOperatorAction::InterruptRun { run } => OperatorAction::InterruptRun { run },
            LegacyOperatorAction::SteerRun { run, instruction } => {
                OperatorAction::SteerRun { run, instruction }
            }
            LegacyOperatorAction::LaunchEmulator { device } => {
                OperatorAction::LaunchEmulator { device }
            }
            LegacyOperatorAction::LaunchRun { target } => OperatorAction::LaunchRun { target },
            LegacyOperatorAction::ReloadRun {} => OperatorAction::ReloadRun {},
            LegacyOperatorAction::EnterSelectMode {} => OperatorAction::EnterSelectMode {},
            LegacyOperatorAction::TakeScreenshot {} => OperatorAction::TakeScreenshot {},
            LegacyOperatorAction::SelectWidget { description } => {
                OperatorAction::SelectWidget { description }
            }
        }
    }
}

impl OperatorAction {
    pub fn risk_tier(&self) -> RiskTier {
        match self {
            OperatorAction::OpenProject {}
            | OperatorAction::OpenChat { .. }
            | OperatorAction::SwarmStatus {}
            | OperatorAction::LaunchEmulator { .. }
            | OperatorAction::LaunchRun { .. }
            | OperatorAction::ReloadRun {}
            | OperatorAction::StopRun {}
            | OperatorAction::HotRestart {}
            | OperatorAction::EnterSelectMode {}
            | OperatorAction::TakeScreenshot {}
            | OperatorAction::SelectWidget { .. } => RiskTier::Read,
            OperatorAction::CreateChat { .. }
            | OperatorAction::SendPrompt { .. }
            | OperatorAction::StartSwarm { .. }
            | OperatorAction::InterruptRun { .. }
            | OperatorAction::SteerRun { .. } => RiskTier::SpendWrite,
        }
    }

    fn validate(&self) -> Result<(), IntentParseError> {
        match self {
            OperatorAction::SendPrompt { prompt, .. } => validate_non_empty("prompt", prompt),
            OperatorAction::StartSwarm { count, goal, .. } => {
                if !(1..=5).contains(count) {
                    return Err(IntentParseError::InvalidField {
                        field: "count".to_string(),
                        reason: "must be between 1 and 5".to_string(),
                    });
                }
                validate_non_empty("goal", goal)
            }
            OperatorAction::SteerRun { instruction, .. } => {
                validate_non_empty("instruction", instruction)
            }
            OperatorAction::SelectWidget { description } => {
                validate_non_empty("description", description)
            }
            _ => Ok(()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentProvider {
    Claude,
    Codex,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SwarmMode {
    Scout,
    Review,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SwarmProvider {
    Claude,
    Codex,
    Mixed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RiskTier {
    Read,
    SpendWrite,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum IntentParseError {
    #[error("unsupported OperatorIntent version {v}")]
    UnsupportedVersion { v: u8 },
    #[error("invalid field {field}: {reason}")]
    InvalidField { field: String, reason: String },
    #[error("malformed OperatorIntent: {0}")]
    Malformed(String),
}

fn validate_non_empty(field: &str, value: &str) -> Result<(), IntentParseError> {
    if value.is_empty() {
        return Err(IntentParseError::InvalidField {
            field: field.to_string(),
            reason: "must be non-empty".to_string(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn round_trip(raw: &str) {
        let intent = OperatorIntent::from_json(raw).unwrap();
        let input = serde_json::from_str::<Value>(raw).unwrap();
        let output = serde_json::from_str::<Value>(&intent.to_json()).unwrap();
        assert_eq!(output, input);
    }

    fn envelope(action: &str) -> String {
        format!(
            r#"{{"v":2,"id":"intent-test","provenance":"typed","confidence":0.9,"projectRef":null,{action}}}"#
        )
    }

    #[test]
    fn round_trips_every_action_variant() {
        let cases = [
            envelope(r#""action":{"action":"openProject"}"#),
            envelope(r#""action":{"action":"openChat","chat":null}"#),
            envelope(r#""action":{"action":"createChat","provider":"codex","model":null}"#),
            envelope(r#""action":{"action":"sendPrompt","prompt":"Fix the failing test","chat":"M0"}"#),
            envelope(r#""action":{"action":"startSwarm","mode":"scout","count":3,"goal":"Map the operator surfaces","provider":"mixed"}"#),
            envelope(r#""action":{"action":"swarmStatus"}"#),
            envelope(r#""action":{"action":"interruptRun","run":null}"#),
            envelope(r#""action":{"action":"steerRun","run":"run-1","instruction":"Focus on validation"}"#),
            envelope(r#""action":{"action":"launchEmulator","device":"Pixel 8"}"#),
            envelope(r#""action":{"action":"launchRun","target":"flutter"}"#),
            envelope(r#""action":{"action":"reloadRun"}"#),
            envelope(r#""action":{"action":"stopRun"}"#),
            envelope(r#""action":{"action":"hotRestart"}"#),
            envelope(r#""action":{"action":"enterSelectMode"}"#),
            envelope(r#""action":{"action":"takeScreenshot"}"#),
            envelope(r#""action":{"action":"selectWidget","description":"the login button"}"#),
        ];

        for case in cases {
            round_trip(&case);
        }
    }

    #[test]
    fn rejects_bad_version() {
        let err = OperatorIntent::from_json(
            r#"{"v":3,"id":"intent-test","provenance":"typed","confidence":0.9,"projectRef":null,"action":{"action":"swarmStatus"}}"#,
        )
        .unwrap_err();
        assert_eq!(err, IntentParseError::UnsupportedVersion { v: 3 });
    }

    #[test]
    fn upgrades_v1_envelopes_on_read() {
        let intent = OperatorIntent::from_json(
            r#"{"v":1,"id":"intent-test","provenance":"typed","confidence":0.9,"projectRef":null,"action":{"action":"launchRun","target":"flutter"}}"#,
        )
        .unwrap();
        assert_eq!(intent.v, 2);
        assert_eq!(
            intent.action,
            OperatorAction::LaunchRun {
                target: Some("flutter".to_string())
            }
        );
    }

    #[test]
    fn rejects_out_of_range_confidence() {
        let err = OperatorIntent::from_json(
            r#"{"v":1,"id":"intent-test","provenance":"typed","confidence":1.2,"projectRef":null,"action":{"action":"swarmStatus"}}"#,
        )
        .unwrap_err();
        assert!(matches!(err, IntentParseError::InvalidField { field, .. } if field == "confidence"));
    }

    #[test]
    fn rejects_out_of_range_swarm_counts() {
        for count in [0, 6] {
            let raw = format!(
                r#"{{"v":1,"id":"intent-test","provenance":"typed","confidence":0.9,"projectRef":null,"action":{{"action":"startSwarm","mode":"review","count":{count},"goal":"Review the plan","provider":"codex"}}}}"#
            );
            let err = OperatorIntent::from_json(&raw).unwrap_err();
            assert!(matches!(err, IntentParseError::InvalidField { field, .. } if field == "count"));
        }
    }

    #[test]
    fn rejects_empty_required_strings() {
        let err = OperatorIntent::from_json(
            r#"{"v":1,"id":"intent-test","provenance":"typed","confidence":0.9,"projectRef":null,"action":{"action":"sendPrompt","prompt":"","chat":null}}"#,
        )
        .unwrap_err();
        assert!(matches!(err, IntentParseError::InvalidField { field, .. } if field == "prompt"));
    }

    #[test]
    fn rejects_unknown_action_names() {
        let err = OperatorIntent::from_json(
            r#"{"v":1,"id":"intent-test","provenance":"typed","confidence":0.9,"projectRef":null,"action":{"action":"deleteProject"}}"#,
        )
        .unwrap_err();
        assert!(matches!(err, IntentParseError::Malformed(_)));
    }

    #[test]
    fn rejects_extra_fields() {
        let err = OperatorIntent::from_json(
            r#"{"v":1,"id":"intent-test","provenance":"typed","confidence":0.9,"projectRef":null,"action":{"action":"sendPrompt","prompt":"Fix it","chat":null,"extra":true}}"#,
        )
        .unwrap_err();
        assert!(matches!(err, IntentParseError::Malformed(_)));
    }

    #[test]
    fn maps_risk_tiers() {
        let read = [
            OperatorAction::OpenProject {},
            OperatorAction::OpenChat { chat: None },
            OperatorAction::SwarmStatus {},
            OperatorAction::LaunchEmulator { device: None },
            OperatorAction::LaunchRun { target: None },
            OperatorAction::ReloadRun {},
            OperatorAction::StopRun {},
            OperatorAction::HotRestart {},
            OperatorAction::EnterSelectMode {},
            OperatorAction::TakeScreenshot {},
            OperatorAction::SelectWidget { description: "button".to_string() },
        ];
        for action in read {
            assert_eq!(action.risk_tier(), RiskTier::Read);
        }

        let spend_write = [
            OperatorAction::CreateChat { provider: AgentProvider::Codex, model: None },
            OperatorAction::SendPrompt { prompt: "Fix it".to_string(), chat: None },
            OperatorAction::StartSwarm {
                mode: SwarmMode::Scout,
                count: 3,
                goal: "Map it".to_string(),
                provider: SwarmProvider::Mixed,
            },
            OperatorAction::InterruptRun { run: None },
            OperatorAction::SteerRun {
                run: None,
                instruction: "Stay focused".to_string(),
            },
        ];
        for action in spend_write {
            assert_eq!(action.risk_tier(), RiskTier::SpendWrite);
        }
    }
}
