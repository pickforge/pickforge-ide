//! Persistent Linux graphics compatibility mode (#238).
//!
//! WebKitGTK's DMA-BUF renderer and GTK's default backend order can be
//! noticeably slower than X11/XWayland with DMA-BUF disabled on some Linux
//! graphics stacks (observed: KDE Plasma Wayland + AMD `amdgpu`/Mesa). Both
//! knobs (`GDK_BACKEND` selection and `WEBKIT_DISABLE_DMABUF_RENDERER`) must
//! be applied before GTK/WebKitGTK initialize, so the mode is persisted here
//! — a small startup-readable file under `$PICKFORGE_HOME`, read before the
//! rest of the app stack exists — rather than in SQLite/localStorage.
//!
//! This module is cross-platform-buildable (the type and persistence compile
//! everywhere) but is only ever read or applied on Linux; the Tauri command
//! layer and frontend both gate on the host OS so non-Linux builds neither
//! show nor apply this setting.

use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::Result;
use serde::{Deserialize, Serialize};

use super::pickforge_home;

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

const GDK_BACKEND_ENV: &str = "GDK_BACKEND";
/// WebKitGTK reads this directly from the process environment before it
/// initializes; there is no in-process API substitute (unlike the GDK
/// backend preference, which never touches the environment).
pub const WEBKIT_DISABLE_DMABUF_ENV: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
/// Real process env var PickForge sets alongside `WEBKIT_DISABLE_DMABUF_RENDERER`
/// whenever *it* (not the user) synthesized that value. Tauri's
/// `process::restart` re-execs the same binary and inherits the full
/// environment, so a synthesized DMA-BUF value survives a Settings-triggered
/// relaunch — without this marker, [`resolve_graphics_backend_plan`] cannot
/// tell that apart from a genuine user override, and a stale Compatibility
/// value would silently survive switching back to Auto/Native Wayland (#238).
pub const LINUX_DMABUF_SYNTHESIZED_MARKER_ENV: &str = "PICKFORGE_DMABUF_SYNTHESIZED";
const PICKFORGE_WAYLAND_ENV: &str = "PICKFORGE_WAYLAND";
const XDG_SESSION_TYPE_ENV: &str = "XDG_SESSION_TYPE";
const XDG_CURRENT_DESKTOP_ENV: &str = "XDG_CURRENT_DESKTOP";
const XDG_SESSION_DESKTOP_ENV: &str = "XDG_SESSION_DESKTOP";

/// The persisted Linux graphics mode. `Auto` is the pre-#238 default
/// behavior: prefer X11/XWayland in a mixed session, keep WebKitGTK's
/// DMA-BUF renderer enabled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LinuxGraphicsMode {
    Auto,
    Compatibility,
    NativeWayland,
}

impl Default for LinuxGraphicsMode {
    fn default() -> Self {
        LinuxGraphicsMode::Auto
    }
}

/// Small startup-readable config: the selected mode, plus whether the
/// one-time KDE Wayland + AMD recommendation has been dismissed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct LinuxGraphicsConfig {
    pub mode: LinuxGraphicsMode,
    pub recommendation_dismissed: bool,
}

impl Default for LinuxGraphicsConfig {
    fn default() -> Self {
        Self {
            mode: LinuxGraphicsMode::default(),
            recommendation_dismissed: false,
        }
    }
}

/// What to do with `WEBKIT_DISABLE_DMABUF_RENDERER` (and its
/// [`LINUX_DMABUF_SYNTHESIZED_MARKER_ENV`] marker) in the process
/// environment, decided by [`resolve_graphics_backend_plan`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DmabufAction {
    /// Leave the environment exactly as-is. Either nothing is set, or a
    /// genuine user-set value (no PickForge marker present) is already
    /// there — an explicit override always wins.
    Leave,
    /// Remove both `WEBKIT_DISABLE_DMABUF_RENDERER` and the synthesized
    /// marker: a PickForge-owned value survived a Settings-triggered
    /// relaunch (#238), but the persisted mode no longer wants DMA-BUF
    /// disabled.
    Clear,
    /// Set `WEBKIT_DISABLE_DMABUF_RENDERER=1` and the synthesized marker —
    /// either freshly (Compatibility chosen this process) or to re-affirm an
    /// owned value that survived relaunch.
    Set,
}

/// What main() should do before GTK/WebKitGTK initialize, given the
/// persisted mode and the raw process environment. Pure and deterministic —
/// no filesystem or GTK access — so it's fully unit-testable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GraphicsBackendPlan {
    /// Whether to prefer the X11/XWayland GDK backend order. The caller must
    /// still gate this on a mixed session actually being available
    /// (`WAYLAND_DISPLAY` and `DISPLAY` both set) — forcing X11 when no
    /// XWayland is running would leave GDK without a working backend.
    pub prefer_x11: bool,
    pub dmabuf_action: DmabufAction,
}

/// Resolve what to apply for `mode`, honoring explicit process-environment
/// overrides ahead of the persisted mode:
/// - An explicit `GDK_BACKEND` always wins (GDK itself gives it precedence).
/// - `PICKFORGE_WAYLAND` is the existing troubleshooting override that opts
///   back into native Wayland; preserved as-is.
/// - A genuine user-set `WEBKIT_DISABLE_DMABUF_RENDERER` (no PickForge
///   marker present) always wins for DMA-BUF.
/// - A PickForge-owned `WEBKIT_DISABLE_DMABUF_RENDERER` (marker present —
///   i.e. it survived a Settings-triggered relaunch, #238) is never treated
///   as an explicit override: it tracks the persisted mode instead, so
///   switching away from Compatibility and restarting actually clears it.
pub fn resolve_graphics_backend_plan(
    mode: LinuxGraphicsMode,
    env: &HashMap<String, String>,
) -> GraphicsBackendPlan {
    let gdk_backend_explicit = env
        .get(GDK_BACKEND_ENV)
        .is_some_and(|value| !value.trim().is_empty());
    let wants_wayland_override = env
        .get(PICKFORGE_WAYLAND_ENV)
        .map(|value| !matches!(value.trim(), "" | "0" | "false"))
        .unwrap_or(false);

    let prefer_x11 = !gdk_backend_explicit
        && !wants_wayland_override
        && matches!(mode, LinuxGraphicsMode::Auto | LinuxGraphicsMode::Compatibility);

    let owned_by_pickforge = env
        .get(LINUX_DMABUF_SYNTHESIZED_MARKER_ENV)
        .is_some_and(|value| !value.trim().is_empty());
    let dmabuf_explicit = !owned_by_pickforge
        && env
            .get(WEBKIT_DISABLE_DMABUF_ENV)
            .is_some_and(|value| !value.trim().is_empty());

    let dmabuf_action = if dmabuf_explicit {
        DmabufAction::Leave
    } else if matches!(mode, LinuxGraphicsMode::Compatibility) {
        DmabufAction::Set
    } else if owned_by_pickforge {
        DmabufAction::Clear
    } else {
        DmabufAction::Leave
    };

    GraphicsBackendPlan {
        prefer_x11,
        dmabuf_action,
    }
}

static BOOT_MODE: std::sync::OnceLock<LinuxGraphicsMode> = std::sync::OnceLock::new();

/// Records the Linux graphics mode actually applied at process boot (#238),
/// before GTK/WebKitGTK initialized — independent of any persisted-config
/// edits made since. Idempotent: only the first call (there is exactly one
/// boot per process) has any effect.
pub fn record_boot_linux_graphics_mode(mode: LinuxGraphicsMode) {
    let _ = BOOT_MODE.set(mode);
}

/// The Linux graphics mode active for the running process, i.e. what startup
/// actually applied. Settings compares the live-selected mode against this
/// (not the freshly-reloaded persisted config, which a Settings edit changes
/// immediately) to know whether a restart is actually still required — this
/// is what survives Settings remounts and clears correctly on A→B→A. Falls
/// back to Auto if boot never recorded a mode (non-Linux, or a call made
/// before `main()`'s early application, which should not happen).
pub fn boot_linux_graphics_mode() -> LinuxGraphicsMode {
    BOOT_MODE.get().copied().unwrap_or_default()
}

/// True when the session looks like KDE Plasma on Wayland, from session env
/// vars alone (no filesystem access — testable with plain fixtures).
pub fn kde_wayland_session_detected(env: &HashMap<String, String>) -> bool {
    let is_wayland = env
        .get(XDG_SESSION_TYPE_ENV)
        .map(|value| value.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false);
    let is_kde = [XDG_CURRENT_DESKTOP_ENV, XDG_SESSION_DESKTOP_ENV]
        .iter()
        .filter_map(|key| env.get(*key))
        .any(|value| value.to_ascii_uppercase().contains("KDE"));
    is_wayland && is_kde
}

/// Scans `drm_root` (normally `/sys/class/drm`) for a card whose PCI vendor
/// ID is AMD's (`0x1002`). Takes the root as a parameter so tests can point
/// it at a fixture directory instead of the real `/sys`.
pub fn amd_gpu_present(drm_root: &Path) -> bool {
    let Ok(entries) = fs::read_dir(drm_root) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let vendor_path = entry.path().join("device").join("vendor");
        fs::read_to_string(&vendor_path)
            .map(|contents| contents.trim().eq_ignore_ascii_case("0x1002"))
            .unwrap_or(false)
    })
}

/// Whether Settings should show the one-time, dismissible nudge toward
/// Compatibility mode. Never true once dismissed, and never true once the
/// owner has already picked a mode other than Auto — the recommendation is a
/// one-time suggestion, not a recurring nag, and detection must never
/// silently switch the renderer itself.
pub fn should_recommend_compatibility(
    mode: LinuxGraphicsMode,
    recommendation_dismissed: bool,
    kde_wayland_session: bool,
    amd_gpu: bool,
) -> bool {
    matches!(mode, LinuxGraphicsMode::Auto)
        && !recommendation_dismissed
        && kde_wayland_session
        && amd_gpu
}

pub fn load_linux_graphics_config() -> LinuxGraphicsConfig {
    let Ok(path) = linux_graphics_path() else {
        return LinuxGraphicsConfig::default();
    };
    load_linux_graphics_config_at(&path)
}

pub fn save_linux_graphics_config(config: &LinuxGraphicsConfig) -> Result<()> {
    save_linux_graphics_config_at(&linux_graphics_path()?, config)
}

fn linux_graphics_path() -> Result<PathBuf> {
    Ok(PathBuf::from(pickforge_home(None)?).join("linux-graphics.json"))
}

fn load_linux_graphics_config_at(path: &Path) -> LinuxGraphicsConfig {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(error) if error.kind() == ErrorKind::NotFound => LinuxGraphicsConfig::default(),
        Err(_) => LinuxGraphicsConfig::default(),
    }
}

fn save_linux_graphics_config_at(path: &Path, config: &LinuxGraphicsConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let suffix = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_file_name(format!(
        ".linux-graphics.json.{}.{suffix}.tmp",
        std::process::id()
    ));
    fs::write(&tmp, serde_json::to_vec(config)?)?;
    match replace_file(&tmp, path) {
        Ok(()) => Ok(()),
        Err(err) => {
            let _ = fs::remove_file(&tmp);
            Err(err.into())
        }
    }
}

#[cfg(not(windows))]
fn replace_file(tmp: &Path, path: &Path) -> std::io::Result<()> {
    fs::rename(tmp, path)
}

#[cfg(windows)]
fn replace_file(tmp: &Path, path: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    extern "system" {
        fn MoveFileExW(
            lpExistingFileName: *const u16,
            lpNewFileName: *const u16,
            dwFlags: u32,
        ) -> i32;
    }

    let src = tmp
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let dst = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let ok = unsafe {
        MoveFileExW(
            src.as_ptr(),
            dst.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("pf-linux-graphics-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("linux-graphics.json")
    }

    fn env_of(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    // -- persistence --------------------------------------------------

    #[test]
    fn defaults_to_auto_when_missing() {
        let path = temp_file("missing");
        fs::remove_file(&path).ok();

        assert_eq!(
            load_linux_graphics_config_at(&path),
            LinuxGraphicsConfig::default()
        );
        assert_eq!(load_linux_graphics_config_at(&path).mode, LinuxGraphicsMode::Auto);

        fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn round_trips_every_mode() {
        for mode in [
            LinuxGraphicsMode::Auto,
            LinuxGraphicsMode::Compatibility,
            LinuxGraphicsMode::NativeWayland,
        ] {
            let path = temp_file(&format!("round-trip-{mode:?}"));
            let config = LinuxGraphicsConfig {
                mode,
                recommendation_dismissed: true,
            };

            save_linux_graphics_config_at(&path, &config).unwrap();

            assert_eq!(load_linux_graphics_config_at(&path), config);

            fs::remove_dir_all(path.parent().unwrap()).ok();
        }
    }

    #[test]
    fn mode_serializes_to_kebab_case_wire_values() {
        assert_eq!(
            serde_json::to_string(&LinuxGraphicsMode::Auto).unwrap(),
            "\"auto\""
        );
        assert_eq!(
            serde_json::to_string(&LinuxGraphicsMode::Compatibility).unwrap(),
            "\"compatibility\""
        );
        assert_eq!(
            serde_json::to_string(&LinuxGraphicsMode::NativeWayland).unwrap(),
            "\"native-wayland\""
        );
    }

    #[test]
    fn malformed_json_falls_back_to_auto() {
        let path = temp_file("malformed");
        fs::write(&path, b"{not json").unwrap();

        assert_eq!(
            load_linux_graphics_config_at(&path),
            LinuxGraphicsConfig::default()
        );

        fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn unreadable_path_falls_back_to_auto() {
        let path = temp_file("read-error");
        let dir = path.parent().unwrap().to_path_buf();

        // Pointing "at" a directory instead of a file makes the read fail
        // with something other than NotFound.
        assert_eq!(load_linux_graphics_config_at(&dir), LinuxGraphicsConfig::default());

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn partial_json_fills_defaults() {
        let path = temp_file("partial");
        fs::write(&path, br#"{"mode":"compatibility"}"#).unwrap();

        let config = load_linux_graphics_config_at(&path);
        assert_eq!(config.mode, LinuxGraphicsMode::Compatibility);
        assert!(!config.recommendation_dismissed);

        fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    // -- mode -> env resolution mapping --------------------------------

    #[test]
    fn auto_prefers_x11_and_keeps_dmabuf_enabled() {
        let plan = resolve_graphics_backend_plan(LinuxGraphicsMode::Auto, &HashMap::new());
        assert!(plan.prefer_x11);
        assert_eq!(plan.dmabuf_action, DmabufAction::Leave);
    }

    #[test]
    fn compatibility_prefers_x11_and_disables_dmabuf() {
        let plan = resolve_graphics_backend_plan(LinuxGraphicsMode::Compatibility, &HashMap::new());
        assert!(plan.prefer_x11);
        assert_eq!(plan.dmabuf_action, DmabufAction::Set);
    }

    #[test]
    fn native_wayland_does_not_prefer_x11_and_keeps_dmabuf_enabled() {
        let plan = resolve_graphics_backend_plan(LinuxGraphicsMode::NativeWayland, &HashMap::new());
        assert!(!plan.prefer_x11);
        assert_eq!(plan.dmabuf_action, DmabufAction::Leave);
    }

    #[test]
    fn explicit_gdk_backend_overrides_every_mode() {
        let env = env_of(&[("GDK_BACKEND", "wayland")]);
        for mode in [
            LinuxGraphicsMode::Auto,
            LinuxGraphicsMode::Compatibility,
            LinuxGraphicsMode::NativeWayland,
        ] {
            let plan = resolve_graphics_backend_plan(mode, &env);
            assert!(!plan.prefer_x11, "{mode:?} should defer to explicit GDK_BACKEND");
        }
    }

    #[test]
    fn explicit_webkit_dmabuf_override_wins_over_compatibility() {
        // No PICKFORGE_DMABUF_SYNTHESIZED marker: this is a genuine user-set
        // value, so it must be left untouched and propagated (#238 P0).
        let env = env_of(&[("WEBKIT_DISABLE_DMABUF_RENDERER", "0")]);
        let plan = resolve_graphics_backend_plan(LinuxGraphicsMode::Compatibility, &env);
        assert_eq!(plan.dmabuf_action, DmabufAction::Leave);
    }

    #[test]
    fn pickforge_wayland_troubleshooting_override_still_skips_x11_preference() {
        let env = env_of(&[("PICKFORGE_WAYLAND", "1")]);
        for mode in [LinuxGraphicsMode::Auto, LinuxGraphicsMode::Compatibility] {
            let plan = resolve_graphics_backend_plan(mode, &env);
            assert!(!plan.prefer_x11);
        }
    }

    #[test]
    fn pickforge_wayland_false_like_values_do_not_opt_into_wayland() {
        for value in ["0", "false", ""] {
            let env = env_of(&[("PICKFORGE_WAYLAND", value)]);
            let plan = resolve_graphics_backend_plan(LinuxGraphicsMode::Auto, &env);
            assert!(plan.prefer_x11, "PICKFORGE_WAYLAND={value:?} should not opt into wayland");
        }
    }

    #[test]
    fn blank_explicit_overrides_do_not_count_as_set() {
        let env = env_of(&[
            ("GDK_BACKEND", "  "),
            ("WEBKIT_DISABLE_DMABUF_RENDERER", "  "),
        ]);
        let plan = resolve_graphics_backend_plan(LinuxGraphicsMode::Compatibility, &env);
        assert!(plan.prefer_x11);
        assert_eq!(plan.dmabuf_action, DmabufAction::Set);
    }

    // -- relaunch env poisoning (#238 P0) --------------------------------
    //
    // Settings' "Restart now" relaunches via Tauri's process::restart, which
    // re-execs the same binary and inherits the full environment. A prior
    // process's synthesized WEBKIT_DISABLE_DMABUF_RENDERER must not be
    // mistaken for a user override on the next boot.

    #[test]
    fn inherited_owned_var_is_cleared_when_mode_is_no_longer_compatibility() {
        let env = env_of(&[
            ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
            ("PICKFORGE_DMABUF_SYNTHESIZED", "1"),
        ]);
        for mode in [LinuxGraphicsMode::Auto, LinuxGraphicsMode::NativeWayland] {
            let plan = resolve_graphics_backend_plan(mode, &env);
            assert_eq!(
                plan.dmabuf_action,
                DmabufAction::Clear,
                "{mode:?} should clear a stale PickForge-owned DMA-BUF value",
            );
        }
    }

    #[test]
    fn inherited_owned_var_is_re_set_when_mode_is_still_compatibility() {
        let env = env_of(&[
            ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
            ("PICKFORGE_DMABUF_SYNTHESIZED", "1"),
        ]);
        let plan = resolve_graphics_backend_plan(LinuxGraphicsMode::Compatibility, &env);
        assert_eq!(plan.dmabuf_action, DmabufAction::Set);
    }

    #[test]
    fn genuinely_user_set_var_without_the_marker_is_left_alone_in_every_mode() {
        let env = env_of(&[("WEBKIT_DISABLE_DMABUF_RENDERER", "1")]);
        for mode in [
            LinuxGraphicsMode::Auto,
            LinuxGraphicsMode::Compatibility,
            LinuxGraphicsMode::NativeWayland,
        ] {
            let plan = resolve_graphics_backend_plan(mode, &env);
            assert_eq!(
                plan.dmabuf_action,
                DmabufAction::Leave,
                "{mode:?} must not touch a value it never marked as its own",
            );
        }
    }

    #[test]
    fn blank_marker_does_not_count_as_owned() {
        let env = env_of(&[
            ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
            ("PICKFORGE_DMABUF_SYNTHESIZED", "  "),
        ]);
        let plan = resolve_graphics_backend_plan(LinuxGraphicsMode::Auto, &env);
        assert_eq!(plan.dmabuf_action, DmabufAction::Leave);
    }

    #[test]
    fn stray_marker_without_the_webkit_var_is_still_cleared() {
        // A `remove_var` on an already-absent key is a harmless no-op, so
        // Clear is the defensively-correct action for a stray marker (e.g.
        // left behind by a partial failure) — it always leaves both real env
        // vars absent rather than leaving PICKFORGE_DMABUF_SYNTHESIZED set
        // with nothing backing it.
        let env = env_of(&[("PICKFORGE_DMABUF_SYNTHESIZED", "1")]);
        let plan = resolve_graphics_backend_plan(LinuxGraphicsMode::Auto, &env);
        assert_eq!(plan.dmabuf_action, DmabufAction::Clear);
    }

    // -- boot-active mode (#238 P2: restart-required durability) --------

    #[test]
    fn boot_linux_graphics_mode_records_once_and_is_idempotent() {
        // BOOT_MODE is a real process-global OnceLock (deliberately: it must
        // reflect exactly what main() applied at boot, for the process's
        // whole lifetime), so this is the *only* test in this binary allowed
        // to call record_boot_linux_graphics_mode — every assertion here
        // depends on running before anything else could set it.
        assert_eq!(boot_linux_graphics_mode(), LinuxGraphicsMode::Auto);

        record_boot_linux_graphics_mode(LinuxGraphicsMode::Compatibility);
        assert_eq!(boot_linux_graphics_mode(), LinuxGraphicsMode::Compatibility);

        // A later call (there should never be one in production — one boot,
        // one record — but prove it's harmless) must not override it.
        record_boot_linux_graphics_mode(LinuxGraphicsMode::NativeWayland);
        assert_eq!(boot_linux_graphics_mode(), LinuxGraphicsMode::Compatibility);
    }

    // -- KDE Wayland + AMD recommendation -------------------------------

    #[test]
    fn kde_wayland_detected_via_current_desktop() {
        let env = env_of(&[
            ("XDG_SESSION_TYPE", "wayland"),
            ("XDG_CURRENT_DESKTOP", "KDE"),
        ]);
        assert!(kde_wayland_session_detected(&env));
    }

    #[test]
    fn kde_wayland_detected_via_session_desktop_fallback() {
        let env = env_of(&[
            ("XDG_SESSION_TYPE", "wayland"),
            ("XDG_SESSION_DESKTOP", "KDE"),
        ]);
        assert!(kde_wayland_session_detected(&env));
    }

    #[test]
    fn non_kde_or_non_wayland_sessions_are_not_flagged() {
        assert!(!kde_wayland_session_detected(&env_of(&[
            ("XDG_SESSION_TYPE", "x11"),
            ("XDG_CURRENT_DESKTOP", "KDE"),
        ])));
        assert!(!kde_wayland_session_detected(&env_of(&[
            ("XDG_SESSION_TYPE", "wayland"),
            ("XDG_CURRENT_DESKTOP", "GNOME"),
        ])));
        assert!(!kde_wayland_session_detected(&HashMap::new()));
    }

    #[test]
    fn amd_gpu_present_reads_vendor_fixture() {
        let dir = std::env::temp_dir().join(format!("pf-drm-amd-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let card_device = dir.join("card0").join("device");
        fs::create_dir_all(&card_device).unwrap();
        fs::write(card_device.join("vendor"), "0x1002\n").unwrap();

        assert!(amd_gpu_present(&dir));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn amd_gpu_present_is_false_for_other_vendors_and_missing_root() {
        let dir = std::env::temp_dir().join(format!("pf-drm-nvidia-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let card_device = dir.join("card0").join("device");
        fs::create_dir_all(&card_device).unwrap();
        fs::write(card_device.join("vendor"), "0x10de\n").unwrap();

        assert!(!amd_gpu_present(&dir));
        assert!(!amd_gpu_present(&dir.join("does-not-exist")));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn recommendation_only_fires_on_auto_kde_wayland_amd_and_not_dismissed() {
        assert!(should_recommend_compatibility(
            LinuxGraphicsMode::Auto,
            false,
            true,
            true
        ));
        assert!(!should_recommend_compatibility(
            LinuxGraphicsMode::Auto,
            true, // dismissed
            true,
            true
        ));
        assert!(!should_recommend_compatibility(
            LinuxGraphicsMode::Compatibility, // already acted on
            false,
            true,
            true
        ));
        assert!(!should_recommend_compatibility(
            LinuxGraphicsMode::NativeWayland, // deliberate choice, don't nag
            false,
            true,
            true
        ));
        assert!(!should_recommend_compatibility(
            LinuxGraphicsMode::Auto,
            false,
            false, // not KDE Wayland
            true
        ));
        assert!(!should_recommend_compatibility(
            LinuxGraphicsMode::Auto,
            false,
            true,
            false // no AMD GPU detected
        ));
    }
}
