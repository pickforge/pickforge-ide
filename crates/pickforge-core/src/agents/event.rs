#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentEvent {
    SessionStarted {
        provider_session_id: String,
    },
    TurnStarted,
    TextDelta {
        text: String,
    },
    TextFinal {
        item_id: Option<String>,
        text: String,
    },
    ThinkingDelta {
        text: String,
    },
    ThinkingFinal {
        item_id: Option<String>,
        text: String,
    },
    CommandStarted {
        item_id: String,
        command: String,
        cwd: Option<String>,
    },
    CommandOutput {
        item_id: String,
        chunk: String,
    },
    CommandDone {
        item_id: String,
        exit_code: Option<i32>,
        status: CommandStatus,
        output_tail: Option<String>,
    },
    FileChange {
        item_id: String,
        changes: Vec<FileChangeEntry>,
    },
    McpToolCall {
        item_id: String,
        server: String,
        tool: String,
        status: ToolCallStatus,
        detail: Option<String>,
    },
    WebSearch {
        item_id: String,
        query: String,
    },
    ToolUse {
        item_id: String,
        name: String,
        status: ToolCallStatus,
        detail: Option<String>,
    },
    PlanUpdate {
        items: Vec<PlanItem>,
    },
    ApprovalRequest {
        approval_id: String,
        #[serde(rename = "approvalKind")]
        kind: ApprovalKind,
        detail: String,
    },
    Usage {
        input_tokens: u64,
        cached_input_tokens: u64,
        output_tokens: u64,
        cost_usd: Option<f64>,
        context_used: Option<u64>,
        context_window: Option<u64>,
    },
    RateLimits {
        payload: String,
    },
    TurnDone {
        status: TurnStatus,
    },
    TurnFailed {
        error: String,
    },
    Noise {
        line: String,
    },
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CommandStatus {
    Completed,
    Failed,
    Interrupted,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolCallStatus {
    InProgress,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileChangeKind {
    Add,
    Modify,
    Delete,
    Rename,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeEntry {
    pub path: String,
    pub kind: FileChangeKind,
    pub diff: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub text: String,
    pub completed: bool,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalKind {
    Command,
    FileChange,
    ToolUse,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnStatus {
    Completed,
    Interrupted,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_all_event_variants() {
        let events = vec![
            AgentEvent::SessionStarted {
                provider_session_id: "provider-session-1".to_string(),
            },
            AgentEvent::TurnStarted,
            AgentEvent::TextDelta {
                text: "hello".to_string(),
            },
            AgentEvent::TextFinal {
                item_id: Some("text-1".to_string()),
                text: "final text".to_string(),
            },
            AgentEvent::ThinkingDelta {
                text: "thinking".to_string(),
            },
            AgentEvent::ThinkingFinal {
                item_id: None,
                text: "final thinking".to_string(),
            },
            AgentEvent::CommandStarted {
                item_id: "cmd-1".to_string(),
                command: "cargo check".to_string(),
                cwd: Some("/repo".to_string()),
            },
            AgentEvent::CommandOutput {
                item_id: "cmd-1".to_string(),
                chunk: "output\n".to_string(),
            },
            AgentEvent::CommandDone {
                item_id: "cmd-1".to_string(),
                exit_code: Some(0),
                status: CommandStatus::Completed,
                output_tail: Some("done".to_string()),
            },
            AgentEvent::FileChange {
                item_id: "file-1".to_string(),
                changes: vec![
                    FileChangeEntry {
                        path: "src/new.rs".to_string(),
                        kind: FileChangeKind::Add,
                        diff: Some("+new".to_string()),
                    },
                    FileChangeEntry {
                        path: "src/lib.rs".to_string(),
                        kind: FileChangeKind::Modify,
                        diff: Some("@@ diff".to_string()),
                    },
                    FileChangeEntry {
                        path: "src/old.rs".to_string(),
                        kind: FileChangeKind::Delete,
                        diff: None,
                    },
                    FileChangeEntry {
                        path: "src/renamed.rs".to_string(),
                        kind: FileChangeKind::Rename,
                        diff: None,
                    },
                ],
            },
            AgentEvent::McpToolCall {
                item_id: "tool-1".to_string(),
                server: "server".to_string(),
                tool: "tool".to_string(),
                status: ToolCallStatus::InProgress,
                detail: Some("detail".to_string()),
            },
            AgentEvent::WebSearch {
                item_id: "search-1".to_string(),
                query: "query".to_string(),
            },
            AgentEvent::ToolUse {
                item_id: "tool-use-1".to_string(),
                name: "read_file".to_string(),
                status: ToolCallStatus::Completed,
                detail: Some("read src/lib.rs".to_string()),
            },
            AgentEvent::PlanUpdate {
                items: vec![PlanItem {
                    text: "step".to_string(),
                    completed: true,
                }],
            },
            AgentEvent::ApprovalRequest {
                approval_id: "approval-1".to_string(),
                kind: ApprovalKind::ToolUse,
                detail: "detail".to_string(),
            },
            AgentEvent::Usage {
                input_tokens: 10,
                cached_input_tokens: 2,
                output_tokens: 5,
                cost_usd: Some(0.25),
                context_used: Some(15),
                context_window: Some(100),
            },
            AgentEvent::RateLimits {
                payload: r#"{"primary":{"usedPercent":1}}"#.to_string(),
            },
            AgentEvent::TurnDone {
                status: TurnStatus::Completed,
            },
            AgentEvent::TurnFailed {
                error: "failed".to_string(),
            },
            AgentEvent::Noise {
                line: "raw line".to_string(),
            },
        ];

        for event in events {
            let json = serde_json::to_string(&event).unwrap();
            let decoded: AgentEvent = serde_json::from_str(&json).unwrap();

            assert_eq!(decoded, event);
        }
    }

    #[test]
    fn serializes_exact_json_contract_samples() {
        assert_eq!(
            serde_json::to_string(&AgentEvent::TextDelta {
                text: "hello".to_string(),
            })
            .unwrap(),
            r#"{"kind":"textDelta","text":"hello"}"#
        );

        assert_eq!(
            serde_json::to_string(&AgentEvent::SessionStarted {
                provider_session_id: "provider-session-1".to_string(),
            })
            .unwrap(),
            r#"{"kind":"sessionStarted","providerSessionId":"provider-session-1"}"#
        );

        assert_eq!(
            serde_json::to_string(&AgentEvent::CommandDone {
                item_id: "cmd-1".to_string(),
                exit_code: Some(0),
                status: CommandStatus::Completed,
                output_tail: Some("done".to_string()),
            })
            .unwrap(),
            r#"{"kind":"commandDone","itemId":"cmd-1","exitCode":0,"status":"completed","outputTail":"done"}"#
        );

        assert_eq!(
            serde_json::to_string(&AgentEvent::ToolUse {
                item_id: "tool-use-1".to_string(),
                name: "read_file".to_string(),
                status: ToolCallStatus::Completed,
                detail: Some("read src/lib.rs".to_string()),
            })
            .unwrap(),
            r#"{"kind":"toolUse","itemId":"tool-use-1","name":"read_file","status":"completed","detail":"read src/lib.rs"}"#
        );

        assert_eq!(
            serde_json::to_string(&AgentEvent::Usage {
                input_tokens: 10,
                cached_input_tokens: 2,
                output_tokens: 5,
                cost_usd: Some(0.25),
                context_used: Some(15),
                context_window: Some(100),
            })
            .unwrap(),
            r#"{"kind":"usage","inputTokens":10,"cachedInputTokens":2,"outputTokens":5,"costUsd":0.25,"contextUsed":15,"contextWindow":100}"#
        );

        assert_eq!(
            serde_json::to_string(&AgentEvent::RateLimits {
                payload: r#"{"primary":{"usedPercent":1}}"#.to_string(),
            })
            .unwrap(),
            r#"{"kind":"rateLimits","payload":"{\"primary\":{\"usedPercent\":1}}"}"#
        );

        assert_eq!(
            serde_json::to_string(&AgentEvent::TurnDone {
                status: TurnStatus::Completed,
            })
            .unwrap(),
            r#"{"kind":"turnDone","status":"completed"}"#
        );

        assert_eq!(
            serde_json::to_string(&AgentEvent::Noise {
                line: "raw line".to_string(),
            })
            .unwrap(),
            r#"{"kind":"noise","line":"raw line"}"#
        );
    }
}
