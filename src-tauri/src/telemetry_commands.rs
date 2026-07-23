use pickforge_core::{load_telemetry_config, save_telemetry_config, TelemetryConfig};

#[tauri::command]
pub fn telemetry_get() -> Result<TelemetryConfig, String> {
    Ok(load_telemetry_config())
}

#[tauri::command]
pub fn telemetry_set(crash_reports: bool) -> Result<(), String> {
    save_telemetry_config(&TelemetryConfig { crash_reports }).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::*;
    use crate::test_support::{EnvRestore, PICKFORGE_HOME_ENV_LOCK};

    fn temp_home() -> PathBuf {
        std::env::temp_dir().join(format!("pf-telemetry-command-{}", std::process::id()))
    }

    #[test]
    fn get_set_round_trips_with_pickforge_home() {
        let _lock = PICKFORGE_HOME_ENV_LOCK.lock().unwrap();
        let _restore = EnvRestore::capture();
        let home = temp_home();
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();
        std::env::set_var("PICKFORGE_HOME", &home);

        assert_eq!(telemetry_get().unwrap(), TelemetryConfig::default());

        telemetry_set(false).unwrap();

        assert_eq!(
            telemetry_get().unwrap(),
            TelemetryConfig {
                crash_reports: false,
            }
        );

        fs::remove_dir_all(home).ok();
    }
}
