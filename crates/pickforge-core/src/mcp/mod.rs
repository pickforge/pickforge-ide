//! Local MCP endpoint for the embedded agent.
//!
//! PickForge exposes a tiny, capability-gated MCP server so an agent running in
//! the embedded terminal (Claude / Codex) can re-query live context mid-task —
//! the current selection, a device screenshot, recent run logs, and the project
//! context. It is **local-only**: the protocol is served over a Unix socket /
//! stdio (see `src-tauri/src/mcp_commands.rs` and `crates/pickforge-mcp/`); this
//! module owns only the wire-format and tool logic, with no transport or network.
//!
//! Surface (MCP JSON-RPC 2.0): `initialize`, `notifications/initialized`,
//! `tools/list`, `tools/call`. A hand-rolled dispatcher — the surface is too
//! small to justify a framework, and the core stays dependency-light.

mod protocol;
mod tools;

pub use protocol::{error_code, Request, Response, PROTOCOL_VERSION};
pub use tools::{
    tool_descriptors, ActiveTarget, InspectorKind, LiveState, ProjectContext, ToolOutput,
    ALL_TOOL_NAMES, CAPTURE_SCREENSHOT, GET_CURRENT_SELECTION, GET_PROJECT_CONTEXT, GET_RUN_LOGS,
};

use serde_json::{json, Value};

/// The server's advertised identity (returned by `initialize`).
pub const SERVER_NAME: &str = "pickforge";
pub const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Handle one parsed JSON-RPC [`Request`] against `state`, returning the response
/// to write back — or `None` for a notification (which gets no reply).
pub fn handle_request(state: &dyn LiveState, req: &Request) -> Option<Response> {
    // Notifications (no `id`) are acknowledged by silence per JSON-RPC.
    if req.is_notification() {
        return None;
    }
    let id = req.id.clone().unwrap_or(Value::Null);

    let resp = match req.method.as_str() {
        "initialize" => Response::ok(id, initialize_result()),
        "tools/list" => Response::ok(id, json!({ "tools": tool_descriptors() })),
        "tools/call" => match call(state, &req.params) {
            Ok(value) => Response::ok(id, value),
            Err((code, msg)) => Response::err(id, code, msg),
        },
        "ping" => Response::ok(id, json!({})),
        other => Response::err(
            id,
            error_code::METHOD_NOT_FOUND,
            format!("unknown method '{other}'"),
        ),
    };
    Some(resp)
}

/// Parse a raw line and handle it. A malformed line yields a parse-error
/// response with a null id (best effort). Returns the serialized response line,
/// or `None` for notifications / blank lines.
pub fn handle_line(state: &dyn LiveState, line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let resp = match serde_json::from_str::<Request>(line) {
        Ok(req) => handle_request(state, &req)?,
        Err(e) => Response::err(
            Value::Null,
            error_code::PARSE_ERROR,
            format!("invalid JSON-RPC request: {e}"),
        ),
    };
    Some(serde_json::to_string(&resp).unwrap_or_else(|_| {
        // Serializing a Response can't realistically fail; degrade gracefully.
        r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"serialize error"}}"#
            .to_string()
    }))
}

fn initialize_result() -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION },
    })
}

/// Run a `tools/call`. Returns the MCP tool result wrapper, or a JSON-RPC error
/// `(code, message)` for a malformed call / unknown tool name.
fn call(state: &dyn LiveState, params: &Value) -> Result<Value, (i64, String)> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or((error_code::INVALID_PARAMS, "missing tool name".to_string()))?;
    let args = params.get("arguments").cloned().unwrap_or(Value::Null);

    let out = tools::call_tool(state, name, &args)
        .ok_or((error_code::METHOD_NOT_FOUND, format!("unknown tool '{name}'")))?;

    // MCP tool results carry text content; we return pretty JSON so the agent
    // gets a structured, readable payload. `isError` flags a genuine failure.
    let text = serde_json::to_string_pretty(&out.value).unwrap_or_else(|_| out.value.to_string());
    Ok(json!({
        "content": [ { "type": "text", "text": text } ],
        "isError": out.is_error,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::targets::Capability;

    struct TestState;

    impl LiveState for TestState {
        fn active_target(&self) -> Option<ActiveTarget> {
            Some(ActiveTarget {
                id: "flutter".into(),
                label: "Flutter".into(),
                capabilities: vec![
                    Capability::InspectSelection,
                    Capability::CaptureScreenshot,
                    Capability::StreamLogs,
                ],
                inspector_kind: InspectorKind::VmService,
            })
        }
        fn project_context(&self) -> ProjectContext {
            ProjectContext {
                project_root: Some("/p".into()),
                context_dir: Some("/c".into()),
                runs_dir: Some("/r".into()),
                chats_dir: Some("/h".into()),
                support_tier: "deep".into(),
            }
        }
        fn flutter_selection(&self) -> Result<Option<Value>, String> {
            Ok(Some(json!({ "className": "Text" })))
        }
        fn uiautomator_selection(&self) -> Result<Option<Value>, String> {
            Ok(None)
        }
        fn capture_screenshot(&self) -> Result<Option<String>, String> {
            Ok(Some("/c/shot.png".into()))
        }
        fn run_logs(&self, _limit: usize) -> Vec<String> {
            vec!["boot".into(), "ready".into()]
        }
    }

    fn req(line: &str) -> Option<Value> {
        handle_line(&TestState, line).map(|s| serde_json::from_str(&s).unwrap())
    }

    #[test]
    fn initialize_advertises_protocol_and_server_info() {
        let r = req(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#).unwrap();
        assert_eq!(r["id"], json!(1));
        assert_eq!(r["result"]["protocolVersion"], json!(PROTOCOL_VERSION));
        assert_eq!(r["result"]["serverInfo"]["name"], json!("pickforge"));
        assert!(r["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn tools_list_returns_the_four_tools_with_schemas() {
        let r = req(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#).unwrap();
        let tools = r["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 4);
        for t in tools {
            assert!(t["name"].is_string());
            assert!(t["inputSchema"]["type"] == json!("object"));
        }
    }

    #[test]
    fn tools_call_runs_a_tool_and_wraps_text_content() {
        let r = req(
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_current_selection","arguments":{}}}"#,
        )
        .unwrap();
        assert_eq!(r["result"]["isError"], json!(false));
        let text = r["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("flutterWidget"));
        assert!(text.contains("Text"));
    }

    #[test]
    fn tools_call_for_unknown_tool_is_a_jsonrpc_error() {
        let r = req(
            r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"nope"}}"#,
        )
        .unwrap();
        assert_eq!(r["error"]["code"], json!(error_code::METHOD_NOT_FOUND));
    }

    #[test]
    fn tools_call_without_a_name_is_invalid_params() {
        let r = req(r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{}}"#).unwrap();
        assert_eq!(r["error"]["code"], json!(error_code::INVALID_PARAMS));
    }

    #[test]
    fn unknown_method_is_method_not_found() {
        let r = req(r#"{"jsonrpc":"2.0","id":6,"method":"frobnicate"}"#).unwrap();
        assert_eq!(r["error"]["code"], json!(error_code::METHOD_NOT_FOUND));
    }

    #[test]
    fn notifications_get_no_response() {
        assert!(handle_line(&TestState, r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_none());
    }

    #[test]
    fn malformed_json_yields_a_parse_error() {
        let r = req("not json at all {").unwrap();
        assert_eq!(r["error"]["code"], json!(error_code::PARSE_ERROR));
        assert_eq!(r["id"], Value::Null);
    }

    #[test]
    fn blank_lines_are_ignored() {
        assert!(handle_line(&TestState, "   ").is_none());
    }

    #[test]
    fn ping_is_answered() {
        let r = req(r#"{"jsonrpc":"2.0","id":9,"method":"ping"}"#).unwrap();
        assert!(r["result"].is_object());
    }
}
