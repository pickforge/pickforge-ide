//! Minimal JSON-RPC 2.0 framing for the MCP server. Hand-rolled (no framework):
//! the surface is three methods (`initialize`, `tools/list`, `tools/call`) plus
//! the `notifications/initialized` notification, so a few small types beat a
//! heavy dependency. Frames are newline-delimited JSON objects on the wire.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The MCP protocol revision this server implements. Clients echo their own in
/// `initialize`; we answer with ours (the spec lets the two differ).
pub const PROTOCOL_VERSION: &str = "2024-11-05";

/// JSON-RPC error codes we emit (subset of the spec).
pub mod error_code {
    pub const PARSE_ERROR: i64 = -32700;
    pub const INVALID_REQUEST: i64 = -32600;
    pub const METHOD_NOT_FOUND: i64 = -32601;
    pub const INVALID_PARAMS: i64 = -32602;
    pub const INTERNAL_ERROR: i64 = -32603;
}

/// An incoming JSON-RPC request (or notification, when `id` is absent).
#[derive(Debug, Clone, Deserialize)]
pub struct Request {
    #[allow(dead_code)]
    #[serde(default)]
    pub jsonrpc: String,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

impl Request {
    /// A notification has no `id` and expects no response (e.g.
    /// `notifications/initialized`).
    pub fn is_notification(&self) -> bool {
        self.id.is_none()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

/// A JSON-RPC response — exactly one of `result` / `error` is set.
#[derive(Debug, Clone, Serialize)]
pub struct Response {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl Response {
    pub fn ok(id: Value, result: Value) -> Self {
        Self { jsonrpc: "2.0", id, result: Some(result), error: None }
    }

    pub fn err(id: Value, code: i64, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(RpcError { code, message: message.into() }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_a_request_with_id_and_params() {
        let req: Request =
            serde_json::from_str(r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"x"}}"#)
                .unwrap();
        assert_eq!(req.method, "tools/call");
        assert_eq!(req.id, Some(json!(7)));
        assert!(!req.is_notification());
        assert_eq!(req.params, json!({"name":"x"}));
    }

    #[test]
    fn an_idless_request_is_a_notification() {
        let req: Request =
            serde_json::from_str(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).unwrap();
        assert!(req.is_notification());
        assert_eq!(req.params, Value::Null);
    }

    #[test]
    fn ok_response_omits_error_field() {
        let r = Response::ok(json!(1), json!({"a":1}));
        let s = serde_json::to_string(&r).unwrap();
        assert!(s.contains("\"result\""));
        assert!(!s.contains("\"error\""));
    }

    #[test]
    fn err_response_omits_result_field() {
        let r = Response::err(json!(1), error_code::METHOD_NOT_FOUND, "nope");
        let s = serde_json::to_string(&r).unwrap();
        assert!(s.contains("\"error\""));
        assert!(s.contains("-32601"));
        assert!(!s.contains("\"result\""));
    }
}
