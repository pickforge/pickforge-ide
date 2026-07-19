//! VM Service commands (async — the client speaks WebSocket JSON-RPC). Includes
//! the Flutter widget-inspector RPCs and an event bridge that forwards device
//! tap-to-select / navigate stream events to the UI.

use base64::Engine;
use pickforge_core::{
    decode_semantic_widget_tree, decode_widget_tree, pickforge_home, SemanticWidgetNode,
    VmServiceClient, WidgetNode,
};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

const ROOT_WIDGET_TREE_METHOD: &str = "ext.flutter.inspector.getRootWidgetTree";
const ROOT_WIDGET_SUMMARY_TREE_METHOD: &str =
    "ext.flutter.inspector.getRootWidgetSummaryTreeWithPreviews";

fn widget_tree_params(isolate_id: &str, group_name: &str) -> Value {
    json!({
        "isolateId": isolate_id,
        "groupName": group_name,
        "isSummaryTree": "true",
        "withPreviews": "true",
    })
}

fn semantic_widget_tree_params(isolate_id: &str, group_name: &str) -> Value {
    json!({
        "isolateId": isolate_id,
        "groupName": group_name,
        "isSummaryTree": "true",
        "withPreviews": "true",
        "fullDetails": "false",
    })
}

fn root_widget_summary_tree_params(isolate_id: &str, group_name: &str) -> Value {
    json!({ "isolateId": isolate_id, "objectGroup": group_name })
}

use crate::project_roots::{approved_canonical, ApprovedRoots};

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
/// `getRootWidgetSummaryTreeWithPreviews`.
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
            ROOT_WIDGET_TREE_METHOD,
            widget_tree_params(&isolate_id, &group_name),
        )
        .await;
    let result = match modern {
        Ok(v) => v,
        Err(_) => client
            .call(
                ROOT_WIDGET_SUMMARY_TREE_METHOD,
                root_widget_summary_tree_params(&isolate_id, &group_name),
            )
            .await
            .map_err(|e| e.to_string())?,
    };
    let tree = result.get("result").unwrap_or(&result);
    Ok(decode_widget_tree(tree))
}

#[tauri::command]
pub async fn vm_widget_tree_semantic(
    client: State<'_, VmServiceClient>,
    isolate_id: String,
    group_name: String,
) -> Result<SemanticWidgetNode, String> {
    let _ = client
        .call(
            "ext.flutter.inspector.disposeGroup",
            json!({ "isolateId": isolate_id, "objectGroup": group_name }),
        )
        .await;
    let modern = client
        .call(
            ROOT_WIDGET_TREE_METHOD,
            semantic_widget_tree_params(&isolate_id, &group_name),
        )
        .await;
    let result = match modern {
        Ok(v) => v,
        Err(_) => client
            .call(
                ROOT_WIDGET_SUMMARY_TREE_METHOD,
                root_widget_summary_tree_params(&isolate_id, &group_name),
            )
            .await
            .map_err(|e| e.to_string())?,
    };
    let tree = result.get("result").unwrap_or(&result);
    Ok(decode_semantic_widget_tree(tree))
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
pub fn inspect_dir(
    roots: State<'_, ApprovedRoots>,
    repo_local: bool,
    project_root: String,
) -> Result<String, String> {
    let dir = if repo_local {
        // The renderer supplies `project_root`; require it to resolve under an
        // approved root before composing the capture dir inside it, so a
        // compromised renderer can't create/write `.pickforge/inspect` under an
        // arbitrary directory.
        approved_canonical(&project_root, &roots)?;
        std::path::Path::new(&project_root).join(".pickforge").join("inspect")
    } else {
        // PickForge home is a fixed, approved location — no renderer input here.
        let home = pickforge_home(None).map_err(|e| e.to_string())?;
        std::path::Path::new(&home).join("inspect")
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

const MAX_MARKDOWN: usize = 8 * 1024 * 1024; // 8 MiB of context markdown
const MAX_PNG_BYTES: usize = 32 * 1024 * 1024; // 32 MiB decoded screenshot

/// A capture folder name must be a SINGLE safe path component — never a
/// separator, `..`, or a control char — so `<dir>/<base_name>` can't escape the
/// inspector directory.
fn safe_base_name(name: &str) -> Result<&str, String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains(['/', '\\', '\0'])
        || name.chars().any(char::is_control)
    {
        return Err("invalid capture name".into());
    }
    Ok(name)
}

/// True only for the inspector's own storage: PickForge home `<home>/inspect`,
/// or a project's `<root>/.pickforge/inspect`. Stops a renderer from passing an
/// arbitrary `dir` to write outside the capture area.
fn is_inspect_root(dir: &std::path::Path) -> bool {
    if let Ok(home) = pickforge_home(None) {
        if dir == std::path::Path::new(&home).join("inspect") {
            return true;
        }
    }
    dir.file_name().and_then(|n| n.to_str()) == Some("inspect")
        && dir.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()) == Some(".pickforge")
}

/// Write the inspector capture into its own per-capture sub-folder
/// `<dir>/<base_name>/` (from [`inspect_dir`]) as `context.md` + `screenshot.png`,
/// so each capture is grouped and removable as a unit. Returns absolute paths so
/// the launched agent can read them regardless of cwd. The `base_name` is
/// sanitized and the final path is re-checked to stay under the inspector dir.
#[tauri::command]
pub fn inspect_save(
    roots: State<'_, ApprovedRoots>,
    dir: String,
    base_name: String,
    markdown: String,
    png_base64: Option<String>,
) -> Result<InspectPaths, String> {
    inspect_save_inner(&roots, dir, base_name, markdown, png_base64)
}

fn inspect_save_inner(
    roots: &ApprovedRoots,
    dir: String,
    base_name: String,
    markdown: String,
    png_base64: Option<String>,
) -> Result<InspectPaths, String> {
    let base = safe_base_name(&base_name)?;
    if markdown.len() > MAX_MARKDOWN {
        return Err("capture markdown too large".into());
    }
    let root = std::path::Path::new(&dir);
    if !is_inspect_root(root) {
        return Err("capture dir is not an inspector directory".into());
    }
    // Beyond the structural `.pickforge/inspect` shape, the inspector dir must sit
    // under an approved root (a project root or PickForge home) — so a renderer
    // can't write a capture into an inspect-shaped dir outside any known project.
    approved_canonical(&dir, roots)?;
    let dir = root.join(base);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Re-check containment after canonicalization (defends against symlinks).
    let canon_root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let canon_dir = std::fs::canonicalize(&dir).map_err(|e| e.to_string())?;
    if !canon_dir.starts_with(&canon_root) {
        return Err("capture path escaped the inspector directory".into());
    }
    // Create files with O_EXCL (create_new) so a pre-existing symlink at a
    // capture path can't redirect the write outside the inspector directory.
    let write_new = |path: &std::path::Path, bytes: &[u8]| -> Result<(), String> {
        use std::io::Write;
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .and_then(|mut f| f.write_all(bytes))
            .map_err(|e| e.to_string())
    };
    let md_path = dir.join("context.md");
    write_new(&md_path, markdown.as_bytes())?;
    let png_path = match png_base64 {
        Some(b64) if !b64.is_empty() => {
            // Bound the decoded size before allocating (base64 ≈ 4/3 of bytes).
            if b64.len() / 4 * 3 > MAX_PNG_BYTES {
                return Err("capture screenshot too large".into());
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64.as_bytes())
                .map_err(|e| e.to_string())?;
            let p = dir.join("screenshot.png");
            write_new(&p, &bytes)?;
            Some(p.to_string_lossy().into_owned())
        }
        _ => None,
    };
    Ok(InspectPaths {
        md_path: md_path.to_string_lossy().into_owned(),
        png_path,
    })
}

#[cfg(test)]
mod inspect_save_tests {
    use super::*;

    fn temp_inspect_root(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("pf-inspect-{}-{tag}", std::process::id()))
            .join(".pickforge")
            .join("inspect");
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// An `ApprovedRoots` that approves the project root owning
    /// `<root>/.pickforge/inspect`, so the new approved-root gate passes.
    fn approved_for(inspect_dir: &std::path::Path) -> ApprovedRoots {
        let project_root = inspect_dir
            .parent() // .pickforge
            .and_then(std::path::Path::parent) // project root
            .expect("inspect dir has a project root");
        let roots = ApprovedRoots::default();
        roots.insert(project_root);
        roots
    }

    #[test]
    fn rejects_unsafe_base_names() {
        for bad in ["", ".", "..", "a/b", "a\\b", "../escape"] {
            assert!(safe_base_name(bad).is_err(), "{bad:?} should be rejected");
        }
        assert!(safe_base_name("20260621-AppBar").is_ok());
    }

    #[test]
    fn rejects_traversal_in_inspect_save() {
        let root = temp_inspect_root("traversal");
        let roots = approved_for(&root);
        let res = inspect_save_inner(
            &roots,
            root.to_string_lossy().into_owned(),
            "../escape".into(),
            "x".into(),
            None,
        );
        assert!(res.is_err());
    }

    #[test]
    fn rejects_a_non_inspector_dir() {
        let dir = std::env::temp_dir().join(format!("pf-not-inspect-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let res = inspect_save_inner(
            &ApprovedRoots::default(),
            dir.to_string_lossy().into_owned(),
            "cap".into(),
            "x".into(),
            None,
        );
        assert!(res.is_err());
    }

    #[test]
    fn rejects_an_inspect_dir_outside_an_approved_root() {
        // An inspect-shaped dir (`<x>/.pickforge/inspect`) that belongs to no
        // approved project root must be rejected even though `is_inspect_root`
        // accepts its shape.
        let root = temp_inspect_root("unapproved");
        let res = inspect_save_inner(
            &ApprovedRoots::default(),
            root.to_string_lossy().into_owned(),
            "cap".into(),
            "x".into(),
            None,
        );
        assert!(res.is_err(), "an unapproved inspect dir must be rejected");
    }

    #[test]
    fn writes_a_capture_under_the_inspect_root() {
        let root = temp_inspect_root("write");
        let roots = approved_for(&root);
        let res = inspect_save_inner(
            &roots,
            root.to_string_lossy().into_owned(),
            "cap-1".into(),
            "# hello".into(),
            None,
        )
        .expect("write capture");
        assert!(std::path::Path::new(&res.md_path).exists());
        assert!(res.md_path.contains("cap-1"));
    }

    #[test]
    fn rejects_oversized_markdown() {
        let root = temp_inspect_root("big");
        let roots = approved_for(&root);
        let big = "a".repeat(MAX_MARKDOWN + 1);
        assert!(inspect_save_inner(
            &roots,
            root.to_string_lossy().into_owned(),
            "cap".into(),
            big,
            None,
        )
        .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_a_symlinked_capture_file() {
        use std::os::unix::fs::symlink;
        let root = temp_inspect_root("symlink");
        let roots = approved_for(&root);
        let cap = root.join("cap-sym");
        std::fs::create_dir_all(&cap).unwrap();
        let evil = std::env::temp_dir().join(format!("pf-evil-{}", std::process::id()));
        let _ = std::fs::remove_file(&evil);
        symlink(&evil, cap.join("context.md")).unwrap();
        let res = inspect_save_inner(
            &roots,
            root.to_string_lossy().into_owned(),
            "cap-sym".into(),
            "x".into(),
            None,
        );
        assert!(res.is_err(), "writing through a symlinked capture file must fail");
        assert!(!evil.exists(), "the write must not follow the symlink");
    }
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

#[cfg(test)]
mod widget_tree_request_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn widget_tree_requests_keep_full_details_for_the_workbench() {
        assert_eq!(ROOT_WIDGET_TREE_METHOD, "ext.flutter.inspector.getRootWidgetTree");
        assert_eq!(
            widget_tree_params("isolates/1", "pickforge"),
            json!({
                "isolateId": "isolates/1",
                "groupName": "pickforge",
                "isSummaryTree": "true",
                "withPreviews": "true",
            }),
        );
        let tree = decode_widget_tree(&json!({
            "valueId": "root",
            "description": "MaterialApp",
            "creationLocation": { "file": "lib/main.dart", "line": 12, "column": 4 },
        }));
        assert_eq!(tree.creation_location.unwrap().file, "lib/main.dart");
    }

    #[test]
    fn semantic_widget_tree_requests_are_compact_and_include_previews() {
        assert_eq!(
            semantic_widget_tree_params("isolates/1", "pickforge"),
            json!({
                "isolateId": "isolates/1",
                "groupName": "pickforge",
                "isSummaryTree": "true",
                "withPreviews": "true",
                "fullDetails": "false",
            }),
        );
        assert_eq!(
            ROOT_WIDGET_SUMMARY_TREE_METHOD,
            "ext.flutter.inspector.getRootWidgetSummaryTreeWithPreviews",
        );
        assert_eq!(
            root_widget_summary_tree_params("isolates/1", "pickforge"),
            json!({ "isolateId": "isolates/1", "objectGroup": "pickforge" }),
        );
    }
}
