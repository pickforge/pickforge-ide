//! The PickForge tool surface and its capability gating. The handlers are
//! deliberately decoupled from the running app: live state is read through the
//! [`LiveState`] trait so the protocol logic is unit-testable with a fake. The
//! Tauri shell supplies the real implementation (VM Service / ADB / stores).

use serde::Serialize;
use serde_json::{json, Value};

use crate::targets::Capability;

/// Stable tool names exposed over MCP.
pub const GET_CURRENT_SELECTION: &str = "get_current_selection";
pub const CAPTURE_SCREENSHOT: &str = "capture_screenshot";
pub const GET_RUN_LOGS: &str = "get_run_logs";
pub const GET_PROJECT_CONTEXT: &str = "get_project_context";
pub const PICKFORGE_CAPABILITIES: &str = "pickforge_capabilities";
pub const PICKFORGE_START_SWARM: &str = "pickforge_start_swarm";
pub const PICKFORGE_SWARM_STATUS: &str = "pickforge_swarm_status";
pub const PICKFORGE_CANCEL_SWARM: &str = "pickforge_cancel_swarm";

pub const ALL_TOOL_NAMES: [&str; 8] = [
    GET_CURRENT_SELECTION,
    CAPTURE_SCREENSHOT,
    GET_RUN_LOGS,
    GET_PROJECT_CONTEXT,
    PICKFORGE_CAPABILITIES,
    PICKFORGE_START_SWARM,
    PICKFORGE_SWARM_STATUS,
    PICKFORGE_CANCEL_SWARM,
];

/// Which inspector a target drives. Mirrors the frontend `InspectorKind`
/// (`src/lib/runTargets.ts`) so `get_current_selection` picks the right adapter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InspectorKind {
    VmService,
    UiAutomator,
    IosAccessibility,
    Cdp,
    None,
}

impl InspectorKind {
    /// Parse the wire string the frontend publishes (`"vmService"` etc.).
    pub fn from_wire(s: &str) -> Self {
        match s {
            "vmService" => Self::VmService,
            "uiAutomator" => Self::UiAutomator,
            "iosAccessibility" => Self::IosAccessibility,
            "cdp" => Self::Cdp,
            _ => Self::None,
        }
    }
}

/// A snapshot of the active target the tools gate against. The Tauri shell keeps
/// this current from the frontend stores (active target id/label, capabilities,
/// inspector kind).
#[derive(Debug, Clone)]
pub struct ActiveTarget {
    pub id: String,
    pub label: String,
    pub capabilities: Vec<Capability>,
    pub inspector_kind: InspectorKind,
}

impl ActiveTarget {
    pub fn has(&self, cap: Capability) -> bool {
        self.capabilities.contains(&cap)
    }
}

/// Project + storage context surfaced by `get_project_context`.
#[derive(Debug, Clone)]
pub struct ProjectContext {
    pub project_root: Option<String>,
    pub context_dir: Option<String>,
    pub runs_dir: Option<String>,
    pub chats_dir: Option<String>,
    pub support_tier: String,
}

/// Outcome of a tool handler: the JSON payload plus whether it represents an
/// error (so the MCP layer can flag `isError`). Honest "not available" answers
/// are NOT errors — they are successful results with `available: false`.
#[derive(Debug, Clone)]
pub struct ToolOutput {
    pub value: Value,
    pub is_error: bool,
}

impl ToolOutput {
    pub fn data(value: Value) -> Self {
        Self { value, is_error: false }
    }

    /// A capability-gated or no-data answer: a *successful* result the agent can
    /// read, carrying a machine-readable reason.
    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self { value: json!({ "available": false, "reason": reason.into() }), is_error: false }
    }

    /// A genuine failure (the live call errored).
    pub fn failure(reason: impl Into<String>) -> Self {
        Self { value: json!({ "available": false, "error": reason.into() }), is_error: true }
    }
}

/// Live application state the tools read. Implemented by the Tauri shell against
/// the running VM Service client / ADB / app stores; faked in unit tests.
///
/// Methods return `Result<Option<_>, String>`: `Ok(None)` = "nothing selected /
/// no run yet" (honest unavailable), `Err` = the live call failed.
pub trait LiveState {
    fn active_target(&self) -> Option<ActiveTarget>;
    fn project_context(&self) -> ProjectContext;

    /// The live Flutter widget selection (VM Service), already JSON-encoded.
    fn flutter_selection(&self) -> Result<Option<Value>, String>;
    /// The live UIAutomator selected node, already JSON-encoded.
    fn uiautomator_selection(&self) -> Result<Option<Value>, String>;

    /// Capture the current device/app screenshot; returns the absolute file path.
    fn capture_screenshot(&self) -> Result<Option<String>, String>;

    /// Recent run/logcat lines, newest last, capped by the caller.
    fn run_logs(&self, limit: usize) -> Vec<String>;

    fn pickforge_capabilities(&self) -> Value;
    fn request_swarm(&self, args: &Value) -> Result<Value, String>;
    fn swarm_status(&self, args: &Value) -> Result<Value, String>;
    fn cancel_swarm(&self, args: &Value) -> Result<Value, String>;
}

/// The static `tools/list` descriptors (name + description + input schema).
pub fn tool_descriptors() -> Value {
    let empty = json!({ "type": "object", "properties": {}, "additionalProperties": false });
    json!([
        {
            "name": GET_CURRENT_SELECTION,
            "description": "The live selected UI element for the active target: the Flutter \
                            widget (VM Service) or accessibility node. Returns { available:false } \
                            when nothing is selected or the target lacks selection inspection.",
            "inputSchema": empty,
        },
        {
            "name": CAPTURE_SCREENSHOT,
            "description": "Capture the current device/app screenshot. Returns the absolute \
                            path to a PNG written under the project context dir.",
            "inputSchema": empty,
        },
        {
            "name": GET_RUN_LOGS,
            "description": "Recent run console / logcat output lines for the active run.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Max lines to return (newest last). Default 200, max 1000.",
                        "minimum": 1,
                        "maximum": 1000,
                    }
                },
                "additionalProperties": false,
            },
        },
        {
            "name": GET_PROJECT_CONTEXT,
            "description": "Active project root, target id + label, support tier, capability \
                            summary, and the storage directories PickForge writes to.",
            "inputSchema": empty,
        },
        {
            "name": PICKFORGE_CAPABILITIES,
            "description": "Pickforge-owned orchestration capabilities available in this launched \
                            session, including swarm limits and companion tool status.",
            "inputSchema": empty,
        },
        {
            "name": PICKFORGE_START_SWARM,
            "description": "Ask Pickforge to dispatch a read-only swarm for this project. Use this \
                            when the user asks for a Pickforge swarm or multiple Pickforge \
                            sub-agents; do not also start native subagents or model-orchestration \
                            skill lanes for the same request.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "goal": { "type": "string", "description": "The task the swarm should scout or review." },
                    "count": { "type": "integer", "minimum": 1, "maximum": 5, "description": "Number of worker agents. Default 3, max 5." },
                    "model": { "type": "string", "description": "Requested model label or id, if the user specified one." },
                    "providerPreference": {
                        "type": "string",
                        "enum": ["auto", "mixed", "claudeCode", "codex"],
                        "description": "Preferred provider pool. Default mixed."
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["scout", "review"],
                        "description": "Read-only swarm mode. Default scout."
                    }
                },
                "required": ["goal"],
                "additionalProperties": false,
            },
        },
        {
            "name": PICKFORGE_SWARM_STATUS,
            "description": "Return Pickforge swarm run status. Pass runId for one run, or omit it \
                            to list recent runs for this session project.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "runId": { "type": "string" }
                },
                "additionalProperties": false,
            },
        },
        {
            "name": PICKFORGE_CANCEL_SWARM,
            "description": "Mark a Pickforge swarm run cancelled. This prevents pending UI dispatch \
                            and records cancellation for status checks.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "runId": { "type": "string" }
                },
                "required": ["runId"],
                "additionalProperties": false,
            },
        },
    ])
}

/// `serde_json` is happy to serialize `Capability` (it derives `Serialize`).
#[derive(Serialize)]
struct CapabilitiesView<'a>(&'a [Capability]);

/// Dispatch a single tool call by name. Unknown names return `None` so the
/// caller can answer with a JSON-RPC "method not found"-style tool error.
pub fn call_tool(state: &dyn LiveState, name: &str, args: &Value) -> Option<ToolOutput> {
    let out = match name {
        GET_CURRENT_SELECTION => get_current_selection(state),
        CAPTURE_SCREENSHOT => capture_screenshot(state),
        GET_RUN_LOGS => get_run_logs(state, args),
        GET_PROJECT_CONTEXT => get_project_context(state),
        PICKFORGE_CAPABILITIES => ToolOutput::data(state.pickforge_capabilities()),
        PICKFORGE_START_SWARM => match state.request_swarm(args) {
            Ok(value) => ToolOutput::data(value),
            Err(e) => ToolOutput::failure(e),
        },
        PICKFORGE_SWARM_STATUS => match state.swarm_status(args) {
            Ok(value) => ToolOutput::data(value),
            Err(e) => ToolOutput::failure(e),
        },
        PICKFORGE_CANCEL_SWARM => match state.cancel_swarm(args) {
            Ok(value) => ToolOutput::data(value),
            Err(e) => ToolOutput::failure(e),
        },
        _ => return None,
    };
    Some(out)
}

fn get_current_selection(state: &dyn LiveState) -> ToolOutput {
    let Some(target) = state.active_target() else {
        return ToolOutput::unavailable("no active target");
    };
    if !target.has(Capability::InspectSelection) {
        return ToolOutput::unavailable(format!(
            "target '{}' does not support selection inspection",
            target.id
        ));
    }
    // Route to the adapter the active target drives.
    let (kind, fetched) = match target.inspector_kind {
        InspectorKind::VmService => ("flutterWidget", state.flutter_selection()),
        InspectorKind::UiAutomator => ("a11yNode", state.uiautomator_selection()),
        InspectorKind::IosAccessibility => ("a11yNode", state.uiautomator_selection()),
        InspectorKind::Cdp | InspectorKind::None => {
            return ToolOutput::unavailable(format!(
                "no live selection adapter for target '{}'",
                target.id
            ));
        }
    };
    match fetched {
        Ok(Some(node)) => ToolOutput::data(json!({
            "available": true,
            "kind": kind,
            "targetId": target.id,
            "selection": node,
        })),
        Ok(None) => ToolOutput::unavailable("no element is currently selected"),
        Err(e) => ToolOutput::failure(e),
    }
}

fn capture_screenshot(state: &dyn LiveState) -> ToolOutput {
    let Some(target) = state.active_target() else {
        return ToolOutput::unavailable("no active target");
    };
    if !target.has(Capability::CaptureScreenshot) {
        return ToolOutput::unavailable(format!(
            "target '{}' does not support screenshots",
            target.id
        ));
    }
    match state.capture_screenshot() {
        Ok(Some(path)) => ToolOutput::data(json!({ "available": true, "path": path })),
        Ok(None) => ToolOutput::unavailable("screenshot capture returned no image (no device?)"),
        Err(e) => ToolOutput::failure(e),
    }
}

fn get_run_logs(state: &dyn LiveState, args: &Value) -> ToolOutput {
    // Require an active target that streams logs. With NO active target we must
    // NOT fall through to the shared ring buffer — that would leak the previous
    // project's run output across a project switch.
    let Some(target) = state.active_target() else {
        return ToolOutput::unavailable("no active target");
    };
    if !target.has(Capability::StreamLogs) {
        return ToolOutput::unavailable(format!(
            "target '{}' does not stream logs",
            target.id
        ));
    }
    let limit = args
        .get("limit")
        .and_then(Value::as_u64)
        .map(|n| n.clamp(1, 1000) as usize)
        .unwrap_or(200);
    let lines = state.run_logs(limit);
    ToolOutput::data(json!({ "available": true, "lineCount": lines.len(), "lines": lines }))
}

fn get_project_context(state: &dyn LiveState) -> ToolOutput {
    let ctx = state.project_context();
    let target = state.active_target();
    ToolOutput::data(json!({
        "available": true,
        "projectRoot": ctx.project_root,
        "activeTargetId": target.as_ref().map(|t| t.id.clone()),
        "activeTargetLabel": target.as_ref().map(|t| t.label.clone()),
        "supportTier": ctx.support_tier,
        "capabilities": target.as_ref().map(|t| serde_json::to_value(CapabilitiesView(&t.capabilities)).unwrap_or(Value::Null)),
        "storage": {
            "contextDir": ctx.context_dir,
            "runsDir": ctx.runs_dir,
            "chatsDir": ctx.chats_dir,
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fully scriptable [`LiveState`] for the handler tests.
    struct FakeState {
        target: Option<ActiveTarget>,
        flutter: Result<Option<Value>, String>,
        uia: Result<Option<Value>, String>,
        screenshot: Result<Option<String>, String>,
        logs: Vec<String>,
    }

    impl LiveState for FakeState {
        fn active_target(&self) -> Option<ActiveTarget> {
            self.target.clone()
        }
        fn project_context(&self) -> ProjectContext {
            ProjectContext {
                project_root: Some("/abs/proj".into()),
                context_dir: Some("/base/context".into()),
                runs_dir: Some("/base/runs".into()),
                chats_dir: Some("/base/chats".into()),
                support_tier: "deep".into(),
            }
        }
        fn flutter_selection(&self) -> Result<Option<Value>, String> {
            self.flutter.clone()
        }
        fn uiautomator_selection(&self) -> Result<Option<Value>, String> {
            self.uia.clone()
        }
        fn capture_screenshot(&self) -> Result<Option<String>, String> {
            self.screenshot.clone()
        }
        fn run_logs(&self, limit: usize) -> Vec<String> {
            self.logs.iter().rev().take(limit).rev().cloned().collect()
        }
        fn pickforge_capabilities(&self) -> Value {
            json!({
                "available": true,
                "swarm": {
                    "available": true,
                    "maxAgents": 5,
                    "modes": ["scout", "review"],
                    "providers": ["claudeCode", "codex", "mixed"],
                },
                "pickLab": { "available": false },
            })
        }
        fn request_swarm(&self, _args: &Value) -> Result<Value, String> {
            Ok(json!({ "accepted": true, "runId": "swarm-test" }))
        }
        fn swarm_status(&self, _args: &Value) -> Result<Value, String> {
            Ok(json!({ "runs": [] }))
        }
        fn cancel_swarm(&self, _args: &Value) -> Result<Value, String> {
            Ok(json!({ "cancelled": true }))
        }
    }

    impl FakeState {
        fn new() -> Self {
            Self {
                target: None,
                flutter: Ok(None),
                uia: Ok(None),
                screenshot: Ok(None),
                logs: Vec::new(),
            }
        }
    }

    fn flutter_target() -> ActiveTarget {
        ActiveTarget {
            id: "flutter".into(),
            label: "Flutter".into(),
            capabilities: vec![
                Capability::InspectSelection,
                Capability::CaptureScreenshot,
                Capability::StreamLogs,
            ],
            inspector_kind: InspectorKind::VmService,
        }
    }

    fn android_target() -> ActiveTarget {
        ActiveTarget {
            id: "native-android".into(),
            label: "Native Android".into(),
            capabilities: vec![
                Capability::InspectSelection,
                Capability::CaptureScreenshot,
                Capability::StreamLogs,
            ],
            inspector_kind: InspectorKind::UiAutomator,
        }
    }

    fn ios_target() -> ActiveTarget {
        ActiveTarget {
            id: "native-ios".into(),
            label: "Native iOS".into(),
            capabilities: vec![
                Capability::InspectSelection,
                Capability::CaptureScreenshot,
                Capability::StreamLogs,
            ],
            inspector_kind: InspectorKind::IosAccessibility,
        }
    }

    fn web_target() -> ActiveTarget {
        ActiveTarget {
            id: "web".into(),
            label: "Web".into(),
            capabilities: vec![Capability::CaptureScreenshot],
            inspector_kind: InspectorKind::Cdp,
        }
    }

    #[test]
    fn tool_descriptors_list_all_tools() {
        let v = tool_descriptors();
        let arr = v.as_array().unwrap();
        assert_eq!(arr.len(), ALL_TOOL_NAMES.len());
        let names: Vec<&str> =
            arr.iter().map(|t| t["name"].as_str().unwrap()).collect();
        for n in ALL_TOOL_NAMES {
            assert!(names.contains(&n), "missing tool {n}");
        }
    }

    #[test]
    fn unknown_tool_returns_none() {
        let mut st = FakeState::new();
        st.target = Some(flutter_target());
        assert!(call_tool(&st, "does_not_exist", &Value::Null).is_none());
    }

    #[test]
    fn selection_routes_to_flutter_for_vm_service_target() {
        let mut st = FakeState::new();
        st.target = Some(flutter_target());
        st.flutter = Ok(Some(json!({ "className": "ElevatedButton" })));
        let out = call_tool(&st, GET_CURRENT_SELECTION, &Value::Null).unwrap();
        assert!(!out.is_error);
        assert_eq!(out.value["available"], json!(true));
        assert_eq!(out.value["kind"], json!("flutterWidget"));
        assert_eq!(out.value["selection"]["className"], json!("ElevatedButton"));
    }

    #[test]
    fn selection_routes_to_uiautomator_for_android_target() {
        let mut st = FakeState::new();
        st.target = Some(android_target());
        st.uia = Ok(Some(json!({ "className": "android.widget.Button" })));
        // The flutter source must NOT be consulted for an Android target.
        st.flutter = Err("should not be called".into());
        let out = call_tool(&st, GET_CURRENT_SELECTION, &Value::Null).unwrap();
        assert!(!out.is_error);
        assert_eq!(out.value["kind"], json!("a11yNode"));
        assert_eq!(out.value["selection"]["className"], json!("android.widget.Button"));
    }

    #[test]
    fn from_wire_maps_ios_accessibility() {
        assert_eq!(
            InspectorKind::from_wire("iosAccessibility"),
            InspectorKind::IosAccessibility
        );
    }

    #[test]
    fn selection_routes_to_a11y_node_for_ios_accessibility_target() {
        let mut st = FakeState::new();
        st.target = Some(ios_target());
        st.uia = Ok(Some(json!({ "className": "Button" })));
        st.flutter = Err("should not be called".into());
        let out = call_tool(&st, GET_CURRENT_SELECTION, &Value::Null).unwrap();
        assert!(!out.is_error);
        assert_eq!(out.value["kind"], json!("a11yNode"));
        assert_eq!(out.value["selection"]["className"], json!("Button"));
    }

    #[test]
    fn selection_is_unavailable_when_nothing_selected() {
        let mut st = FakeState::new();
        st.target = Some(flutter_target());
        st.flutter = Ok(None);
        let out = call_tool(&st, GET_CURRENT_SELECTION, &Value::Null).unwrap();
        assert!(!out.is_error, "no selection is not an error");
        assert_eq!(out.value["available"], json!(false));
        assert!(out.value["reason"].as_str().unwrap().contains("selected"));
    }

    #[test]
    fn selection_is_gated_when_target_lacks_inspect_capability() {
        let mut st = FakeState::new();
        // Web here lacks InspectSelection capability in our fixture.
        st.target = Some(web_target());
        let out = call_tool(&st, GET_CURRENT_SELECTION, &Value::Null).unwrap();
        assert!(!out.is_error);
        assert_eq!(out.value["available"], json!(false));
        assert!(out.value["reason"].as_str().unwrap().contains("selection inspection"));
    }

    #[test]
    fn selection_unavailable_with_no_active_target() {
        let st = FakeState::new();
        let out = call_tool(&st, GET_CURRENT_SELECTION, &Value::Null).unwrap();
        assert_eq!(out.value["reason"], json!("no active target"));
    }

    #[test]
    fn selection_surfaces_a_live_error_as_an_error_result() {
        let mut st = FakeState::new();
        st.target = Some(flutter_target());
        st.flutter = Err("vm service disconnected".into());
        let out = call_tool(&st, GET_CURRENT_SELECTION, &Value::Null).unwrap();
        assert!(out.is_error);
        assert_eq!(out.value["error"], json!("vm service disconnected"));
    }

    #[test]
    fn screenshot_returns_the_path_when_supported() {
        let mut st = FakeState::new();
        st.target = Some(flutter_target());
        st.screenshot = Ok(Some("/base/context/shot.png".into()));
        let out = call_tool(&st, CAPTURE_SCREENSHOT, &Value::Null).unwrap();
        assert!(!out.is_error);
        assert_eq!(out.value["path"], json!("/base/context/shot.png"));
    }

    #[test]
    fn screenshot_is_gated_for_a_target_without_the_capability() {
        let mut st = FakeState::new();
        st.target = Some(ActiveTarget {
            id: "generic".into(),
            label: "Generic".into(),
            capabilities: vec![Capability::Detect],
            inspector_kind: InspectorKind::None,
        });
        let out = call_tool(&st, CAPTURE_SCREENSHOT, &Value::Null).unwrap();
        assert_eq!(out.value["available"], json!(false));
        assert!(out.value["reason"].as_str().unwrap().contains("screenshots"));
    }

    #[test]
    fn run_logs_respect_the_limit_and_order() {
        let mut st = FakeState::new();
        st.target = Some(flutter_target());
        st.logs = (0..10).map(|i| format!("line {i}")).collect();
        let out = call_tool(&st, GET_RUN_LOGS, &json!({ "limit": 3 })).unwrap();
        assert_eq!(out.value["lineCount"], json!(3));
        let lines = out.value["lines"].as_array().unwrap();
        assert_eq!(lines.last().unwrap(), &json!("line 9"));
        assert_eq!(lines.first().unwrap(), &json!("line 7"));
    }

    #[test]
    fn run_logs_are_gated_when_target_cannot_stream() {
        let mut st = FakeState::new();
        st.target = Some(ActiveTarget {
            id: "web".into(),
            label: "Web".into(),
            capabilities: vec![Capability::CaptureScreenshot],
            inspector_kind: InspectorKind::Cdp,
        });
        let out = call_tool(&st, GET_RUN_LOGS, &Value::Null).unwrap();
        assert_eq!(out.value["available"], json!(false));
        assert!(out.value["reason"].as_str().unwrap().contains("logs"));
    }

    #[test]
    fn run_logs_are_gated_with_no_active_target() {
        // Regression: with no active target, logs must NOT fall through to the
        // shared ring buffer (cross-project leak). Even with lines buffered, an
        // unset target returns unavailable.
        let mut st = FakeState::new();
        st.target = None;
        st.logs = (0..5).map(|i| format!("leaked {i}")).collect();
        let out = call_tool(&st, GET_RUN_LOGS, &json!({ "limit": 5 })).unwrap();
        assert!(!out.is_error);
        assert_eq!(out.value["available"], json!(false));
        assert_eq!(out.value["reason"], json!("no active target"));
        assert!(out.value.get("lines").is_none(), "no log lines may leak");
    }

    #[test]
    fn project_context_summarizes_target_and_storage() {
        let mut st = FakeState::new();
        st.target = Some(flutter_target());
        let out = call_tool(&st, GET_PROJECT_CONTEXT, &Value::Null).unwrap();
        assert_eq!(out.value["projectRoot"], json!("/abs/proj"));
        assert_eq!(out.value["activeTargetId"], json!("flutter"));
        assert_eq!(out.value["activeTargetLabel"], json!("Flutter"));
        assert_eq!(out.value["supportTier"], json!("deep"));
        assert_eq!(out.value["storage"]["contextDir"], json!("/base/context"));
        let caps = out.value["capabilities"].as_array().unwrap();
        assert!(caps.contains(&json!("inspectSelection")));
    }

    #[test]
    fn project_context_works_with_no_active_target() {
        let st = FakeState::new();
        let out = call_tool(&st, GET_PROJECT_CONTEXT, &Value::Null).unwrap();
        assert_eq!(out.value["activeTargetId"], Value::Null);
        assert_eq!(out.value["projectRoot"], json!("/abs/proj"));
    }
}
