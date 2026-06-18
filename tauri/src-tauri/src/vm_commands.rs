//! VM Service commands (async — the client speaks WebSocket JSON-RPC).

use pickforge_core::{decode_widget_tree, VmServiceClient, WidgetNode};
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn vm_connect(client: State<'_, VmServiceClient>, url: String) -> Result<(), String> {
    client.connect(&url).await.map_err(|e| e.to_string())
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

#[tauri::command]
pub async fn vm_widget_tree(
    client: State<'_, VmServiceClient>,
    isolate_id: String,
    group_name: String,
) -> Result<WidgetNode, String> {
    let result = client
        .call(
            "ext.flutter.inspector.getRootWidgetSummaryTree",
            json!({ "isolateId": isolate_id, "objectGroup": group_name }),
        )
        .await
        .map_err(|e| e.to_string())?;
    // The inspector extension wraps the tree under "result".
    let tree = result.get("result").unwrap_or(&result);
    Ok(decode_widget_tree(tree))
}
