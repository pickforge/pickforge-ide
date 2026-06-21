//! Minimal JSON-RPC 2.0 framing for the MCP server. Hand-rolled (no framework):
//! the surface is three methods (`initialize`, `tools/list`, `tools/call`) plus
//! the `notifications/initialized` notification, so a few small types beat a
//! heavy dependency. Frames are newline-delimited JSON objects on the wire.

use serde::de::{self, Deserializer};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The MCP protocol revision this server implements. Clients echo their own in
/// `initialize`; we answer with ours (the spec lets the two differ).
pub const PROTOCOL_VERSION: &str = "2024-11-05";

/// Three-state JSON-RPC request id. The spec (§4.2/§5) distinguishes an *absent*
/// `id` (a notification — no reply) from an explicit `"id": null` (a request that
/// still wants a response keyed by `null`). `Option<Value>` collapses the two, so
/// we model the field explicitly: `Missing` (key absent), `Null` (`id: null`),
/// `Present` (any other value).
#[derive(Debug, Clone, PartialEq)]
pub enum RequestId {
    Missing,
    Null,
    Present(Value),
}

impl RequestId {
    /// True only when the `id` key was absent — i.e. this frame is a notification.
    pub fn is_missing(&self) -> bool {
        matches!(self, RequestId::Missing)
    }

    /// The id to echo back on a response. A present id is returned verbatim; an
    /// explicit-null id is echoed as `null` (per §5: error responses, and here
    /// any response, to an `id: null` request carry `"id": null`).
    pub fn to_response_id(&self) -> Value {
        match self {
            RequestId::Present(v) => v.clone(),
            // `Missing` shouldn't reach a response (notifications get none), but a
            // null id is the safe, spec-compliant fallback.
            RequestId::Null | RequestId::Missing => Value::Null,
        }
    }
}

impl Default for RequestId {
    fn default() -> Self {
        RequestId::Missing
    }
}

impl<'de> Deserialize<'de> for RequestId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        // This impl is only invoked when the `id` key is *present* (absence is
        // handled by `#[serde(default)]` → `Missing`). A present value of `null`
        // becomes `Null`; anything else becomes `Present`.
        let value = Value::deserialize(deserializer)?;
        match value {
            Value::Null => Ok(RequestId::Null),
            Value::String(_) | Value::Number(_) => Ok(RequestId::Present(value)),
            // JSON-RPC ids must be a string, number, or null. Reject objects/arrays/bools.
            _ => Err(de::Error::custom("JSON-RPC id must be a string, number, or null")),
        }
    }
}

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
    pub id: RequestId,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

impl Request {
    /// A notification has no `id` and expects no response (e.g.
    /// `notifications/initialized`). An explicit `"id": null` is NOT a
    /// notification — it is a request that must still be answered (§5).
    pub fn is_notification(&self) -> bool {
        self.id.is_missing()
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
        assert_eq!(req.id, RequestId::Present(json!(7)));
        assert!(!req.is_notification());
        assert_eq!(req.id.to_response_id(), json!(7));
        assert_eq!(req.params, json!({"name":"x"}));
    }

    #[test]
    fn an_idless_request_is_a_notification() {
        let req: Request =
            serde_json::from_str(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).unwrap();
        assert_eq!(req.id, RequestId::Missing);
        assert!(req.is_notification());
        assert_eq!(req.params, Value::Null);
    }

    #[test]
    fn explicit_null_id_is_a_request_not_a_notification() {
        // JSON-RPC §5: `"id": null` is a real request id, distinct from an absent
        // id, and must receive a response keyed by `null`.
        let req: Request =
            serde_json::from_str(r#"{"jsonrpc":"2.0","id":null,"method":"ping"}"#).unwrap();
        assert_eq!(req.id, RequestId::Null);
        assert!(!req.is_notification(), "id:null must NOT be a notification");
        assert_eq!(req.id.to_response_id(), Value::Null);
    }

    #[test]
    fn string_ids_are_preserved() {
        let req: Request =
            serde_json::from_str(r#"{"jsonrpc":"2.0","id":"abc","method":"ping"}"#).unwrap();
        assert_eq!(req.id, RequestId::Present(json!("abc")));
        assert_eq!(req.id.to_response_id(), json!("abc"));
    }

    #[test]
    fn structured_ids_are_rejected() {
        // §4.2: ids should be string/number/null; objects and arrays are invalid.
        assert!(serde_json::from_str::<Request>(
            r#"{"jsonrpc":"2.0","id":{"x":1},"method":"ping"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<Request>(
            r#"{"jsonrpc":"2.0","id":[1,2],"method":"ping"}"#
        )
        .is_err());
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
