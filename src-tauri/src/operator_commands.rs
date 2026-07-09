use pickforge_core::operator::router::{route_raw, RawRouteOutput};

#[tauri::command]
pub async fn operator_route_raw(
    backend: String,
    model: String,
    prompt: String,
    timeout_ms: Option<u64>,
) -> Result<RawRouteOutput, String> {
    tauri::async_runtime::spawn_blocking(move || {
        route_raw(&backend, &model, &prompt, timeout_ms).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
