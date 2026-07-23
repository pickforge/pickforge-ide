//! Linux-only persistent graphics compatibility mode (#238). Cfg-gated to
//! Linux end to end: the commands only exist in Linux builds, so non-Linux
//! builds cannot show or apply this setting even if the frontend tried to
//! invoke them.
#![cfg(target_os = "linux")]

use std::path::Path;

use pickforge_core::{
    amd_gpu_present, boot_linux_graphics_mode, kde_wayland_session_detected,
    load_linux_graphics_config, save_linux_graphics_config, should_recommend_compatibility,
    LinuxGraphicsConfig, LinuxGraphicsMode,
};

const DRM_ROOT: &str = "/sys/class/drm";

#[tauri::command]
pub fn linux_graphics_get() -> Result<LinuxGraphicsConfig, String> {
    Ok(load_linux_graphics_config())
}

#[tauri::command]
pub fn linux_graphics_set(mode: LinuxGraphicsMode) -> Result<(), String> {
    let mut config = load_linux_graphics_config();
    config.mode = mode;
    save_linux_graphics_config(&config).map_err(|e| e.to_string())
}

/// The mode actually applied at process boot (#238 P2) — independent of any
/// persisted-config edits made since. Settings compares its live selection
/// against this, not the freshly-reloaded persisted config, to know whether
/// a restart is still actually required; that survives Settings remounts
/// and clears correctly on A→B→A without needing a component-lifetime flag.
#[tauri::command]
pub fn linux_graphics_boot_mode_get() -> Result<LinuxGraphicsMode, String> {
    Ok(boot_linux_graphics_mode())
}

/// Whether Settings should show the one-time, dismissible nudge toward
/// Compatibility mode. Detection never changes the persisted mode itself —
/// only the owner's explicit `linux_graphics_set` call does that.
#[tauri::command]
pub fn linux_graphics_recommendation_get() -> Result<bool, String> {
    let config = load_linux_graphics_config();
    let env: std::collections::HashMap<String, String> = std::env::vars().collect();
    Ok(should_recommend_compatibility(
        config.mode,
        config.recommendation_dismissed,
        kde_wayland_session_detected(&env),
        amd_gpu_present(Path::new(DRM_ROOT)),
    ))
}

#[tauri::command]
pub fn linux_graphics_recommendation_dismiss() -> Result<(), String> {
    let mut config = load_linux_graphics_config();
    config.recommendation_dismissed = true;
    save_linux_graphics_config(&config).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::*;
    use crate::test_support::{EnvRestore, PICKFORGE_HOME_ENV_LOCK};

    fn temp_home(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("pf-linux-graphics-command-{tag}-{}", std::process::id()))
    }

    #[test]
    fn get_set_round_trips_with_pickforge_home() {
        let _lock = PICKFORGE_HOME_ENV_LOCK.lock().unwrap();
        let _restore = EnvRestore::capture();
        let home = temp_home("roundtrip");
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();
        std::env::set_var("PICKFORGE_HOME", &home);

        assert_eq!(linux_graphics_get().unwrap(), LinuxGraphicsConfig::default());

        linux_graphics_set(LinuxGraphicsMode::Compatibility).unwrap();

        assert_eq!(linux_graphics_get().unwrap().mode, LinuxGraphicsMode::Compatibility);

        fs::remove_dir_all(home).ok();
    }

    #[test]
    fn set_preserves_the_dismissed_flag() {
        let _lock = PICKFORGE_HOME_ENV_LOCK.lock().unwrap();
        let _restore = EnvRestore::capture();
        let home = temp_home("preserve-dismissed");
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();
        std::env::set_var("PICKFORGE_HOME", &home);

        linux_graphics_recommendation_dismiss().unwrap();
        linux_graphics_set(LinuxGraphicsMode::NativeWayland).unwrap();

        let config = linux_graphics_get().unwrap();
        assert_eq!(config.mode, LinuxGraphicsMode::NativeWayland);
        assert!(config.recommendation_dismissed);

        fs::remove_dir_all(home).ok();
    }

    #[test]
    fn missing_pickforge_home_falls_back_to_auto() {
        let _lock = PICKFORGE_HOME_ENV_LOCK.lock().unwrap();
        // Removes HOME too (to exercise the no-override fallback), so both
        // vars must be captured — a bare `EnvRestore::capture()` only ever
        // restores PICKFORGE_HOME, leaving HOME removed for every test that
        // runs after this one.
        let _restore = EnvRestore::capture_many(["PICKFORGE_HOME", "HOME"]);
        std::env::remove_var("PICKFORGE_HOME");
        std::env::remove_var("HOME");

        assert_eq!(linux_graphics_get().unwrap(), LinuxGraphicsConfig::default());
    }

    #[test]
    fn boot_mode_get_reflects_what_startup_recorded_not_the_persisted_config() {
        // pickforge_core::BOOT_MODE is a real process-global OnceLock (one
        // boot, one record — by design), so this is the only test in this
        // binary allowed to call record_boot_linux_graphics_mode.
        let _lock = PICKFORGE_HOME_ENV_LOCK.lock().unwrap();
        let _restore = EnvRestore::capture();
        let home = temp_home("boot-mode");
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();
        std::env::set_var("PICKFORGE_HOME", &home);

        assert_eq!(linux_graphics_boot_mode_get().unwrap(), LinuxGraphicsMode::Auto);

        pickforge_core::record_boot_linux_graphics_mode(LinuxGraphicsMode::Compatibility);
        // A Settings edit made after boot must not retroactively change what
        // boot actually applied.
        linux_graphics_set(LinuxGraphicsMode::NativeWayland).unwrap();

        assert_eq!(
            linux_graphics_boot_mode_get().unwrap(),
            LinuxGraphicsMode::Compatibility,
        );
        assert_eq!(linux_graphics_get().unwrap().mode, LinuxGraphicsMode::NativeWayland);

        fs::remove_dir_all(home).ok();
    }
}
