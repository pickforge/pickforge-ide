//! Context-directory resolution + the `PICKFORGE_*` env builder. Ports
//! `lib/core/storage/*`. The per-project settings override (Drift) lands with
//! SQLite in Phase 3; for now resolution is explicit-or-auto-detect.

mod home;
mod linux_graphics;
mod project_id;
mod service;
mod telemetry;

use std::collections::HashMap;
use std::path::Path;

pub use home::{pickforge_home, PickforgeHomeError};
pub use linux_graphics::{
    amd_gpu_present, boot_linux_graphics_mode, kde_wayland_session_detected,
    load_linux_graphics_config, record_boot_linux_graphics_mode, resolve_graphics_backend_plan,
    save_linux_graphics_config, should_recommend_compatibility, DmabufAction, GraphicsBackendPlan,
    LinuxGraphicsConfig, LinuxGraphicsMode, LINUX_DMABUF_SYNTHESIZED_MARKER_ENV,
    WEBKIT_DISABLE_DMABUF_ENV,
};
pub use project_id::project_id;
pub use service::{ContextStorageService, StorageError};
pub use telemetry::{load_telemetry_config, save_telemetry_config, TelemetryConfig};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextStorageMode {
    PickforgeHome,
    ProjectLocal,
    CustomPath,
}

/// Where a project's context artifacts live.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextStorageLocation {
    pub mode: ContextStorageMode,
    pub custom_path: Option<String>,
}

impl ContextStorageLocation {
    pub fn pickforge_home() -> Self {
        Self { mode: ContextStorageMode::PickforgeHome, custom_path: None }
    }
    pub fn project_local() -> Self {
        Self { mode: ContextStorageMode::ProjectLocal, custom_path: None }
    }
    pub fn custom(path: impl Into<String>) -> Self {
        Self { mode: ContextStorageMode::CustomPath, custom_path: Some(path.into()) }
    }

    /// Value written to `PICKFORGE_STORAGE_MODE`.
    pub fn wire_name(&self) -> &'static str {
        match self.mode {
            ContextStorageMode::PickforgeHome => "home",
            ContextStorageMode::ProjectLocal => "project-local",
            ContextStorageMode::CustomPath => "custom",
        }
    }

    pub fn from_wire(wire: &str, custom_path: Option<String>) -> Option<Self> {
        match wire {
            "home" => Some(Self::pickforge_home()),
            "project-local" => Some(Self::project_local()),
            "custom" => custom_path.map(Self::custom),
            _ => None,
        }
    }
}

/// A fully resolved set of paths for a project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedContextDirectory {
    pub project_root: String,
    pub project_id: String,
    pub storage_location: ContextStorageLocation,
    pub context_dir: String,
    pub runs_dir: String,
    pub chats_dir: String,
    pub is_project_local: bool,
}

impl ResolvedContextDirectory {
    pub fn ipc_sock_path(&self) -> String {
        join(&self.context_dir, "ipc.sock-path")
    }

    /// Per-chat directory holding the transcript files.
    pub fn chat_dir(&self, chat_id: &str) -> String {
        join(&self.chats_dir, chat_id)
    }

    pub fn pastes_dir(&self) -> String {
        self.sibling("pastes")
    }
    pub fn skills_dir(&self) -> String {
        self.sibling("skills")
    }
    pub fn prompt_templates_dir(&self) -> String {
        self.sibling("prompt-templates")
    }

    /// Project-local keeps `<root>/.pickforge/<name>`; home/custom put `<name>`
    /// as a sibling of runs/chats.
    fn sibling(&self, name: &str) -> String {
        if self.is_project_local {
            join(&self.context_dir, name)
        } else {
            join(&parent(&self.runs_dir), name)
        }
    }
}

/// Build the `PICKFORGE_*` env vars injected into every embedded PTY. Mirrors
/// `pickforge_env_vars.dart`; `PICKFORGE_IPC_ENDPOINT` is omitted when no run
/// session is active.
pub fn pickforge_env_vars(
    resolved: &ResolvedContextDirectory,
    active_ipc_endpoint: Option<&str>,
    env: Option<&HashMap<String, String>>,
) -> Result<HashMap<String, String>, PickforgeHomeError> {
    let mut out = HashMap::new();
    // PICKFORGE_HOME is part of the contract — fail rather than emit a partial
    // env that a shell/agent would silently mis-resolve against.
    out.insert("PICKFORGE_HOME".to_string(), pickforge_home(env)?);
    out.insert("PICKFORGE_PROJECT_ROOT".to_string(), resolved.project_root.clone());
    out.insert("PICKFORGE_CONTEXT_DIR".to_string(), resolved.context_dir.clone());
    out.insert(
        "PICKFORGE_STORAGE_MODE".to_string(),
        resolved.storage_location.wire_name().to_string(),
    );
    if let Some(endpoint) = active_ipc_endpoint.map(str::trim).filter(|s| !s.is_empty()) {
        out.insert("PICKFORGE_IPC_ENDPOINT".to_string(), endpoint.to_string());
    }
    Ok(out)
}

// ---- shared path helpers ----

pub(crate) fn join(a: &str, b: &str) -> String {
    Path::new(a).join(b).to_string_lossy().into_owned()
}

pub(crate) fn join3(a: &str, b: &str, c: &str) -> String {
    join(&join(a, b), c)
}

pub(crate) fn parent(path: &str) -> String {
    Path::new(path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Make a path absolute without resolving symlinks or normalising `..` — mirrors
/// Dart's `Directory(path).absolute.path`.
pub(crate) fn absolutize(path: &str) -> String {
    let p = Path::new(path);
    if p.is_absolute() {
        p.to_string_lossy().into_owned()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(p).to_string_lossy().into_owned())
            .unwrap_or_else(|_| path.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolved(mode: ContextStorageMode) -> ResolvedContextDirectory {
        ResolvedContextDirectory {
            project_root: "/abs/proj".into(),
            project_id: "proj-deadbeef".into(),
            storage_location: ContextStorageLocation {
                mode,
                custom_path: None,
            },
            context_dir: "/base/context".into(),
            runs_dir: "/base/runs".into(),
            chats_dir: "/base/chats".into(),
            is_project_local: mode == ContextStorageMode::ProjectLocal,
        }
    }

    #[test]
    fn env_vars_carry_the_core_keys_and_omit_ipc_when_absent() {
        let env =
            pickforge_env_vars(&resolved(ContextStorageMode::PickforgeHome), None, None).unwrap();
        assert_eq!(env.get("PICKFORGE_PROJECT_ROOT").unwrap(), "/abs/proj");
        assert_eq!(env.get("PICKFORGE_CONTEXT_DIR").unwrap(), "/base/context");
        assert_eq!(env.get("PICKFORGE_STORAGE_MODE").unwrap(), "home");
        assert!(!env.contains_key("PICKFORGE_IPC_ENDPOINT"));
    }

    #[test]
    fn env_vars_include_ipc_when_present() {
        let env = pickforge_env_vars(
            &resolved(ContextStorageMode::ProjectLocal),
            Some("  /run/ipc.sock  "),
            None,
        )
        .unwrap();
        assert_eq!(env.get("PICKFORGE_IPC_ENDPOINT").unwrap(), "/run/ipc.sock");
        assert_eq!(env.get("PICKFORGE_STORAGE_MODE").unwrap(), "project-local");
    }

    #[test]
    fn home_mode_puts_pastes_as_a_sibling_of_runs() {
        let r = resolved(ContextStorageMode::PickforgeHome);
        assert_eq!(r.pastes_dir(), join("/base", "pastes"));
        assert_eq!(r.chat_dir("c1"), join("/base/chats", "c1"));
    }

    #[test]
    fn project_local_nests_pastes_under_context() {
        let r = resolved(ContextStorageMode::ProjectLocal);
        assert_eq!(r.pastes_dir(), join("/base/context", "pastes"));
    }

    #[test]
    fn wire_round_trips() {
        for loc in [
            ContextStorageLocation::pickforge_home(),
            ContextStorageLocation::project_local(),
            ContextStorageLocation::custom("/x"),
        ] {
            let back = ContextStorageLocation::from_wire(loc.wire_name(), loc.custom_path.clone());
            assert_eq!(back.as_ref(), Some(&loc));
        }
        assert!(ContextStorageLocation::from_wire("custom", None).is_none());
        assert!(ContextStorageLocation::from_wire("bogus", None).is_none());
    }
}
