//! VM Service commands (async — the client speaks WebSocket JSON-RPC). Includes
//! the Flutter widget-inspector RPCs and an event bridge that forwards device
//! tap-to-select / navigate stream events to the UI.

use base64::Engine;
use pickforge_core::{decode_widget_tree, pickforge_home, VmServiceClient, WidgetNode};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

/// One widget property (name + display value) for the inspector details panel.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetProp {
    pub name: String,
    pub value: String,
}

/// Paths written by `inspect_save`.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectPaths {
    pub md_path: String,
    pub png_path: Option<String>,
}

#[tauri::command]
pub async fn vm_connect(
    app: AppHandle,
    client: State<'_, VmServiceClient>,
    url: String,
) -> Result<(), String> {
    client.connect(&url).await.map_err(|e| e.to_string())?;
    // Subscribe to the streams the inspector needs, then bridge no-id events to
    // the UI. The broadcast receiver is 'static, so the task holds no State.
    for stream in ["Extension", "ToolEvent", "Isolate", "Debug"] {
        let _ = client.stream_listen(stream).await;
    }
    if let Some(mut rx) = client.events().await {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Ok(ev) = rx.recv().await {
                bridge_event(&app, &ev);
            }
        });
    }
    Ok(())
}

/// Forward the VM-service stream events the inspector cares about to the UI.
fn bridge_event(app: &AppHandle, ev: &Value) {
    let Some(params) = ev.get("params") else {
        return;
    };
    let stream = params.get("streamId").and_then(Value::as_str).unwrap_or("");
    let Some(event) = params.get("event") else {
        return;
    };
    let kind = event.get("extensionKind").and_then(Value::as_str).unwrap_or("");
    match (stream, kind) {
        // A device tap in select mode posts a `navigate` ToolEvent carrying the
        // source location — push it straight to the UI for jump-to-source.
        ("ToolEvent", "navigate") => {
            let _ = app.emit("vm-navigate", event.get("extensionData").cloned());
        }
        // Each rendered frame: nudge the UI to re-read the selected widget while
        // select mode is on (the UI debounces).
        ("Extension", "Flutter.Frame") => {
            let _ = app.emit("vm-frame", ());
        }
        _ => {}
    }
}

#[tauri::command]
pub async fn vm_disconnect(client: State<'_, VmServiceClient>) -> Result<(), String> {
    client.disconnect().await;
    Ok(())
}

#[tauri::command]
pub async fn vm_status(client: State<'_, VmServiceClient>) -> Result<Option<String>, String> {
    Ok(client.current_url().await)
}

#[tauri::command]
pub async fn vm_get_vm(client: State<'_, VmServiceClient>) -> Result<Value, String> {
    client.call("getVM", json!({})).await.map_err(|e| e.to_string())
}

/// The id of the Flutter isolate (the one exposing the inspector extension), or
/// an error if none is found yet (extensions register a beat after startup).
#[tauri::command]
pub async fn vm_find_isolate(client: State<'_, VmServiceClient>) -> Result<String, String> {
    let vm = client.call("getVM", json!({})).await.map_err(|e| e.to_string())?;
    let isolates = vm
        .get("isolates")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for iso in isolates {
        let Some(id) = iso.get("id").and_then(Value::as_str) else {
            continue;
        };
        let detail = client
            .call("getIsolate", json!({ "isolateId": id }))
            .await
            .map_err(|e| e.to_string())?;
        let has_inspector = detail
            .get("extensionRPCs")
            .and_then(Value::as_array)
            .map(|rpcs| {
                rpcs.iter()
                    .any(|r| r.as_str().is_some_and(|s| s.starts_with("ext.flutter.inspector.")))
            })
            .unwrap_or(false);
        if has_inspector {
            return Ok(id.to_string());
        }
    }
    Err("no Flutter isolate with the inspector extension yet".into())
}

/// The widget tree (summary). Disposes the prior object group first, then tries
/// the modern `getRootWidgetTree` (Flutter 3.24+) and falls back to the legacy
/// `getRootWidgetSummaryTree`.
#[tauri::command]
pub async fn vm_widget_tree(
    client: State<'_, VmServiceClient>,
    isolate_id: String,
    group_name: String,
) -> Result<WidgetNode, String> {
    let _ = client
        .call(
            "ext.flutter.inspector.disposeGroup",
            json!({ "isolateId": isolate_id, "objectGroup": group_name }),
        )
        .await;
    let modern = client
        .call(
            "ext.flutter.inspector.getRootWidgetTree",
            json!({
                "isolateId": isolate_id,
                "groupName": group_name,
                "isSummaryTree": "true",
                "withPreviews": "true",
            }),
        )
        .await;
    let result = match modern {
        Ok(v) => v,
        Err(_) => client
            .call(
                "ext.flutter.inspector.getRootWidgetSummaryTree",
                json!({ "isolateId": isolate_id, "objectGroup": group_name }),
            )
            .await
            .map_err(|e| e.to_string())?,
    };
    let tree = result.get("result").unwrap_or(&result);
    Ok(decode_widget_tree(tree))
}

/// Highlight a widget on the device by its valueId (object group must be alive).
#[tauri::command]
pub async fn vm_set_selection(
    client: State<'_, VmServiceClient>,
    isolate_id: String,
    value_id: String,
    group_name: String,
) -> Result<bool, String> {
    let r = client
        .call(
            "ext.flutter.inspector.setSelectionById",
            json!({ "isolateId": isolate_id, "arg": value_id, "objectGroup": group_name }),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(r.get("result").and_then(Value::as_bool).unwrap_or(false))
}

/// Toggle on-device select mode (tap a widget to select it).
#[tauri::command]
pub async fn vm_show_select_mode(
    client: State<'_, VmServiceClient>,
    isolate_id: String,
    enabled: bool,
) -> Result<(), String> {
    client
        .call(
            "ext.flutter.inspector.show",
            json!({ "isolateId": isolate_id, "enabled": if enabled { "true" } else { "false" } }),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// The currently selected widget (after a device tap), or null.
#[tauri::command]
pub async fn vm_selected_widget(
    client: State<'_, VmServiceClient>,
    isolate_id: String,
    group_name: String,
) -> Result<Option<WidgetNode>, String> {
    let result = client
        .call(
            "ext.flutter.inspector.getSelectedSummaryWidget",
            // The framework asserts on `objectGroup` (not `groupName`) for this RPC.
            json!({ "isolateId": isolate_id, "objectGroup": group_name }),
        )
        .await
        .map_err(|e| e.to_string())?;
    let node = result.get("result").unwrap_or(&result);
    if node.is_null() {
        return Ok(None);
    }
    Ok(Some(decode_widget_tree(node)))
}

#[tauri::command]
pub async fn vm_dispose_group(
    client: State<'_, VmServiceClient>,
    isolate_id: String,
    group_name: String,
) -> Result<(), String> {
    let _ = client
        .call(
            "ext.flutter.inspector.disposeGroup",
            json!({ "isolateId": isolate_id, "objectGroup": group_name }),
        )
        .await;
    Ok(())
}

/// Rich properties of a widget (name + display value), for the details panel.
/// Compound props (EdgeInsets/Color/Size…) have no numeric value, so we use the
/// diagnostics `description` string as the value. Capped to 50.
#[tauri::command]
pub async fn vm_widget_properties(
    client: State<'_, VmServiceClient>,
    isolate_id: String,
    value_id: String,
    group_name: String,
) -> Result<Vec<WidgetProp>, String> {
    let result = client
        .call(
            "ext.flutter.inspector.getDetailsSubtree",
            // Service-extension args arrive as strings — stringify the depth.
            json!({ "isolateId": isolate_id, "arg": value_id, "objectGroup": group_name, "subtreeDepth": "1" }),
        )
        .await
        .map_err(|e| e.to_string())?;
    let node = result.get("result").unwrap_or(&result);
    let props = node.get("properties").and_then(Value::as_array);
    let out = props
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let name = p.get("name").and_then(Value::as_str)?;
            if name.is_empty() {
                return None;
            }
            let value = p
                .get("description")
                .and_then(Value::as_str)
                .or_else(|| p.get("value").and_then(Value::as_str))
                .unwrap_or("");
            Some(WidgetProp { name: name.to_string(), value: value.to_string() })
        })
        .take(50)
        .collect();
    Ok(out)
}

/// Resolve (and create) the inspector capture dir: PickForge home by default
/// (`~/.pickforge/inspect`), or the project repo (`<root>/.pickforge/inspect`)
/// when `repo_local`. Returns the absolute dir so the UI can compose paths.
#[tauri::command]
pub fn inspect_dir(repo_local: bool, project_root: String) -> Result<String, String> {
    let dir = if repo_local {
        std::path::Path::new(&project_root).join(".pickforge").join("inspect")
    } else {
        let home = pickforge_home(None).map_err(|e| e.to_string())?;
        std::path::Path::new(&home).join("inspect")
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Write the inspector capture (a context markdown + optional screenshot PNG)
/// into `dir` (from [`inspect_dir`]). Returns the absolute paths so the launched
/// agent can read them regardless of cwd.
#[tauri::command]
pub fn inspect_save(
    dir: String,
    base_name: String,
    markdown: String,
    png_base64: Option<String>,
) -> Result<InspectPaths, String> {
    let dir = std::path::Path::new(&dir);
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let md_path = dir.join(format!("{base_name}.md"));
    std::fs::write(&md_path, markdown).map_err(|e| e.to_string())?;
    let png_path = match png_base64 {
        Some(b64) if !b64.is_empty() => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64.as_bytes())
                .map_err(|e| e.to_string())?;
            let p = dir.join(format!("{base_name}.png"));
            std::fs::write(&p, bytes).map_err(|e| e.to_string())?;
            Some(p.to_string_lossy().into_owned())
        }
        _ => None,
    };
    Ok(InspectPaths {
        md_path: md_path.to_string_lossy().into_owned(),
        png_path,
    })
}

/// A PNG screenshot of one widget subtree (base64), or null.
#[tauri::command]
pub async fn vm_screenshot(
    client: State<'_, VmServiceClient>,
    isolate_id: String,
    value_id: String,
    width: u32,
    height: u32,
) -> Result<Option<String>, String> {
    let result = client
        .call(
            "ext.flutter.inspector.screenshot",
            json!({
                "isolateId": isolate_id,
                "id": value_id,
                "width": width.to_string(),
                "height": height.to_string(),
                "maxPixelRatio": "3.0",
            }),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(result.get("result").and_then(Value::as_str).map(str::to_string))
}
