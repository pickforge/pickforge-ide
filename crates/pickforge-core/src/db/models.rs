//! Row models for the SQLite store. Timestamps are Unix-millis integers; bools
//! are SQLite integers. Serialized camelCase for the JS side. Ports the Drift
//! tables in `lib/core/drift/tables/`.

use serde::{Deserialize, Serialize};

fn default_chat_kind() -> String {
    "terminal".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub project_root: String,
    pub display_name: String,
    pub created_at: i64,
    pub last_opened_at: i64,
    #[serde(default)]
    pub sort_order: i64,
    pub archived_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    pub chat_id: String,
    pub project_root: String,
    pub title: String,
    pub agent_id: String,
    #[serde(default = "default_chat_kind")]
    pub kind: String,
    pub skill_id: Option<String>,
    pub session_id: Option<String>,
    pub labels_json: Option<String>,
    pub status: Option<String>,
    pub task_brief_text: Option<String>,
    pub created_at: i64,
    pub last_activity_at: i64,
    #[serde(default)]
    pub sort_order: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    pub project_root: String,
    pub vm_service_url: Option<String>,
    pub default_agent_id: Option<String>,
    pub last_chat_id: Option<String>,
    pub pane_sizes: Option<String>,
    pub last_used_at: Option<i64>,
    pub avd_id: Option<String>,
    pub avd_name: Option<String>,
    pub connection_mode: String,
    pub flutter_run_args: Option<String>,
    pub target_file: Option<String>,
    pub validator_command: Option<String>,
    pub emulator_launch_options: Option<String>,
    pub emulator_idle_shutdown: Option<String>,
    pub auto_boot_on_select: bool,
    pub first_run_celebrated: bool,
    pub context_storage_mode: Option<String>,
    pub context_storage_custom_path: Option<String>,
}

impl ProjectSettings {
    /// Defaults for a project with no persisted settings row yet.
    pub fn defaults(project_root: impl Into<String>) -> Self {
        Self {
            project_root: project_root.into(),
            vm_service_url: None,
            default_agent_id: None,
            last_chat_id: None,
            pane_sizes: None,
            last_used_at: None,
            avd_id: None,
            avd_name: None,
            connection_mode: "auto".to_string(),
            flutter_run_args: None,
            target_file: None,
            validator_command: None,
            emulator_launch_options: None,
            emulator_idle_shutdown: None,
            auto_boot_on_select: true,
            first_run_celebrated: false,
            context_storage_mode: None,
            context_storage_custom_path: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PickHistory {
    #[serde(default)]
    pub id: i64,
    pub project_root: String,
    pub widget_class: String,
    pub creation_file: Option<String>,
    pub creation_line: Option<i64>,
    pub skill_id: String,
    pub agent_id: String,
    pub terminal_id: String,
    pub chat_id: Option<String>,
    pub picked_at: i64,
    pub widget_context_json: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunSessionLog {
    pub session_id: String,
    pub project_root: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub avd_id: Option<String>,
    pub avd_name: Option<String>,
    pub serial: Option<String>,
    pub vm_service_url: Option<String>,
    pub target_file: Option<String>,
    pub connection_mode: String,
    pub exit_reason: Option<String>,
    pub exit_code: Option<i64>,
    #[serde(default)]
    pub hot_reload_count: i64,
    #[serde(default)]
    pub hot_restart_count: i64,
    #[serde(default)]
    pub error_count: i64,
    pub last_error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunLog {
    #[serde(default)]
    pub id: i64,
    pub pick_id: i64,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub exit_code: Option<i64>,
    #[serde(default)]
    pub hot_reload_count: i64,
    pub wrapper_script_path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRow {
    pub id: String,
    pub chat_id: String,
    pub provider: String,
    pub provider_session_id: Option<String>,
    pub model: Option<String>,
    pub status: String,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrchestraTask {
    pub id: String,
    pub project_root: String,
    pub title: String,
    pub status: String,
    pub builder_chat_id: Option<String>,
    pub reviewer_chat_id: Option<String>,
    pub note: Option<String>,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OperatorAuditRow {
    pub id: String,
    pub created_at: i64,
    pub project_root: Option<String>,
    pub input_text: String,
    pub intent_json: String,
    pub risk_tier: i64,
    pub status: String,
    pub result: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsageSummary {
    pub provider: String,
    pub model: Option<String>,
    pub chats: i64,
    pub turns: Option<i64>,
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "entryType", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AgentTimelineEntry {
    #[serde(rename = "message")]
    Message {
        seq: i64,
        role: String,
        content: String,
        created_at: i64,
    },
    #[serde(rename = "item")]
    Item {
        seq: i64,
        kind: String,
        payload: String,
        created_at: i64,
    },
}
