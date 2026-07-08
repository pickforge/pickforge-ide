use pickforge_core::{load_telemetry_config, save_telemetry_config, TelemetryConfig};

#[tauri::command]
pub fn telemetry_get() -> Result<TelemetryConfig, String> {
    Ok(load_telemetry_config())
}

#[tauri::command]
pub fn telemetry_set(crash_reports: bool) -> Result<(), String> {
    save_telemetry_config(&TelemetryConfig { crash_reports }).map_err(|e| e.to_string())
}
