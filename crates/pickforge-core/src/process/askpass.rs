//! Linux graphical `sudo` (askpass) capability detection —
//! pickforge/pickforge#215.
//!
//! Implements the *detection* half of the "Shared graphical sudo (askpass)
//! security contract — locked v1" pinned on that issue (shared with
//! pickforge/picklab#27): Linux graphical sessions only, a fixed probe list
//! (no dynamic discovery, no bundled helper), and fail-closed when nothing
//! resolves. The *injection* half — propagating `SUDO_ASKPASS`, and only
//! that variable, into spawned shells — lives in [`crate::pty::session`].
//!
//! Scope: macOS/Windows are out of scope for this release. [`detect`] is a
//! pure function so its branches are fully testable on any host; only the
//! process-wide [`askpass_capability`] singleton and its filesystem probe are
//! gated to `cfg(target_os = "linux")`, matching where the feature actually
//! activates.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Fixed, documented askpass helper probe list per the locked v1 contract —
/// checked in this order after a user-set `SUDO_ASKPASS`. No dynamic
/// discovery beyond this list; PickForge never ships, generates, or installs
/// its own helper.
const ASKPASS_PROBE_PATHS: &[&str] = &[
    "/usr/bin/ksshaskpass",
    "/usr/bin/ssh-askpass",
    "/usr/bin/lxqt-openssh-askpass",
    "/usr/bin/ssh-askpass-gnome",
    "/usr/lib/ssh/ssh-askpass",
    "/usr/lib/openssh/gnome-ssh-askpass",
    "/usr/lib/seahorse/ssh-askpass",
];

/// The result of the pre-flight capability check, run before any agent shell
/// spawns. Every branch is a distinct, observable state per the contract's
/// failure semantics — callers must not collapse `NoHelper` and `Headless`
/// into a single generic "unavailable".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AskpassCapability {
    /// A graphical session and a resolvable helper were both found.
    /// `helper` is the absolute path to hand to `SUDO_ASKPASS`.
    Available { helper: PathBuf },
    /// A graphical session was detected but no helper resolved: the user's
    /// `SUDO_ASKPASS` (if set) doesn't point at an executable file, and
    /// nothing on the fixed probe list exists either.
    NoHelper,
    /// No graphical session (`WAYLAND_DISPLAY`/`DISPLAY` both unset or
    /// empty in the resolved user environment) — SSH, a bare TTY, or
    /// headless CI.
    Headless,
    /// This platform is out of scope for the locked v1 contract
    /// (macOS/Windows). Never `Available` here — the feature is a documented
    /// no-op, not a half-implementation.
    UnsupportedPlatform,
}

impl AskpassCapability {
    /// The helper path to inject as `SUDO_ASKPASS`, or `None` in every other
    /// state. The single choke point callers should use for injection so a
    /// new variant can never accidentally leak a value.
    pub fn helper(&self) -> Option<&Path> {
        match self {
            AskpassCapability::Available { helper } => Some(helper),
            _ => None,
        }
    }
}

/// Resolve capability from an already-resolved environment (the caller must
/// pass the *resolved user shell environment*, per the contract — not the
/// raw ambient process env). Pure aside from the injected `is_executable`
/// probe, so every branch — including the user-set-vs-probe-list priority
/// order — is directly testable without a real graphical session or real
/// helper binaries on disk.
pub fn detect(
    env: &HashMap<String, String>,
    is_executable: impl Fn(&Path) -> bool,
) -> AskpassCapability {
    let graphical = env.get("WAYLAND_DISPLAY").is_some_and(|v| !v.is_empty())
        || env.get("DISPLAY").is_some_and(|v| !v.is_empty());
    if !graphical {
        return AskpassCapability::Headless;
    }

    // (1) user-set SUDO_ASKPASS, only if it points to an executable file.
    if let Some(user_set) = env.get("SUDO_ASKPASS").filter(|v| !v.is_empty()) {
        let path = PathBuf::from(user_set);
        if is_executable(&path) {
            return AskpassCapability::Available { helper: path };
        }
    }

    // (2) first existing helper from the fixed probe list.
    for candidate in ASKPASS_PROBE_PATHS {
        let path = PathBuf::from(candidate);
        if is_executable(&path) {
            return AskpassCapability::Available { helper: path };
        }
    }

    AskpassCapability::NoHelper
}

#[cfg(target_os = "linux")]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// The process-lifetime-cached capability, resolved once from
/// [`crate::process::user_shell_environment`] on first use — mirrors the
/// caching shape of `user_shell_environment()` itself. Detection is pure
/// `stat()` calls against a fixed path list (no subprocess), so unlike the
/// login-shell resolution there is no transient-miss/retry case to model.
pub fn askpass_capability() -> &'static AskpassCapability {
    static CAPABILITY: OnceLock<AskpassCapability> = OnceLock::new();
    CAPABILITY.get_or_init(|| {
        #[cfg(target_os = "linux")]
        {
            detect(crate::process::user_shell_environment(), is_executable_file)
        }
        #[cfg(not(target_os = "linux"))]
        {
            AskpassCapability::UnsupportedPlatform
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn headless_when_no_display_vars_present() {
        let e = env(&[("PATH", "/usr/bin")]);
        assert_eq!(detect(&e, |_| true), AskpassCapability::Headless);
    }

    #[test]
    fn headless_when_display_vars_are_present_but_empty() {
        let e = env(&[("WAYLAND_DISPLAY", ""), ("DISPLAY", "")]);
        assert_eq!(detect(&e, |_| true), AskpassCapability::Headless);
    }

    #[test]
    fn graphical_via_wayland_display_alone() {
        let e = env(&[("WAYLAND_DISPLAY", "wayland-0")]);
        assert_eq!(
            detect(&e, |_| true),
            AskpassCapability::Available {
                helper: PathBuf::from("/usr/bin/ksshaskpass")
            }
        );
    }

    #[test]
    fn graphical_via_x11_display_alone() {
        let e = env(&[("DISPLAY", ":0")]);
        assert_eq!(
            detect(&e, |_| true),
            AskpassCapability::Available {
                helper: PathBuf::from("/usr/bin/ksshaskpass")
            }
        );
    }

    #[test]
    fn user_set_executable_askpass_wins_over_the_probe_list() {
        let e = env(&[
            ("DISPLAY", ":0"),
            ("SUDO_ASKPASS", "/opt/custom/my-askpass"),
        ]);
        let capability = detect(&e, |p| p == Path::new("/opt/custom/my-askpass"));
        assert_eq!(
            capability,
            AskpassCapability::Available {
                helper: PathBuf::from("/opt/custom/my-askpass")
            }
        );
    }

    #[test]
    fn user_set_non_executable_askpass_falls_back_to_the_probe_list() {
        let e = env(&[
            ("DISPLAY", ":0"),
            ("SUDO_ASKPASS", "/opt/custom/not-actually-there"),
        ]);
        // Only the second probe-list entry "exists".
        let capability = detect(&e, |p| p == Path::new("/usr/bin/ssh-askpass"));
        assert_eq!(
            capability,
            AskpassCapability::Available {
                helper: PathBuf::from("/usr/bin/ssh-askpass")
            }
        );
    }

    #[test]
    fn no_helper_when_graphical_but_nothing_resolves() {
        let e = env(&[("DISPLAY", ":0"), ("SUDO_ASKPASS", "/nope")]);
        assert_eq!(detect(&e, |_| false), AskpassCapability::NoHelper);
    }

    #[test]
    fn empty_user_set_askpass_is_treated_as_unset() {
        let e = env(&[("DISPLAY", ":0"), ("SUDO_ASKPASS", "")]);
        // Probe list still gets a chance even though SUDO_ASKPASS is present
        // (but empty) in the environment.
        let capability = detect(&e, |p| p == Path::new("/usr/bin/ksshaskpass"));
        assert_eq!(
            capability,
            AskpassCapability::Available {
                helper: PathBuf::from("/usr/bin/ksshaskpass")
            }
        );
    }

    #[test]
    fn helper_accessor_returns_none_for_every_non_available_state() {
        assert_eq!(AskpassCapability::NoHelper.helper(), None);
        assert_eq!(AskpassCapability::Headless.helper(), None);
        assert_eq!(AskpassCapability::UnsupportedPlatform.helper(), None);
        assert_eq!(
            AskpassCapability::Available {
                helper: PathBuf::from("/usr/bin/ksshaskpass")
            }
            .helper(),
            Some(Path::new("/usr/bin/ksshaskpass"))
        );
    }

    #[test]
    fn detect_never_surfaces_an_unvalidated_environment_value() {
        // The capability's only escape hatch for untrusted input is
        // SUDO_ASKPASS, and it's used ONLY after `is_executable` accepts it —
        // so a value that fails validation can never reach `Available` or its
        // `helper()` accessor. This is the redaction boundary for capability
        // detection: the only thing this module ever exposes downstream is a
        // vetted file path, never raw environment/prompt text.
        let e = env(&[
            ("DISPLAY", ":0"),
            (
                "SUDO_ASKPASS",
                "rm -rf / #not-a-path-and-definitely-not-executable",
            ),
        ]);
        let capability = detect(&e, |_| false); // nothing validates as executable
        assert_eq!(capability, AskpassCapability::NoHelper);
        assert_eq!(capability.helper(), None);
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn non_linux_process_capability_is_always_unsupported_platform() {
        // The real feature scope: never Available on an out-of-scope OS,
        // regardless of what the ambient environment looks like.
        assert_eq!(askpass_capability(), &AskpassCapability::UnsupportedPlatform);
    }
}
