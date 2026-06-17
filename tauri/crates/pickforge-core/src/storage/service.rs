//! Resolve / ensure a project's context directory — ported from
//! `context_storage_service.dart` (auto-detect + explicit-location subset; the
//! persisted per-project override arrives with SQLite in Phase 3).

use std::path::Path;

use super::home::{pickforge_home, PickforgeHomeError};
use super::project_id::project_id;
use super::{
    absolutize, join, join3, ContextStorageLocation, ContextStorageMode, ResolvedContextDirectory,
};

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("project folder does not exist: {0}")]
    ProjectMissing(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Home(#[from] PickforgeHomeError),
}

#[derive(Default)]
pub struct ContextStorageService;

impl ContextStorageService {
    pub fn new() -> Self {
        Self
    }

    /// Resolve the paths for `project_root`. With no explicit `location`, an
    /// existing project-local `.pickforge/.gitignore` marker wins; otherwise the
    /// PickForge-home default.
    pub fn resolve(
        &self,
        project_root: &str,
        location: Option<ContextStorageLocation>,
    ) -> Result<ResolvedContextDirectory, StorageError> {
        let absolute_root = absolutize(project_root);
        let effective = location.unwrap_or_else(|| auto_detect(&absolute_root));
        let id = project_id(&absolute_root, None);

        let (context_dir, runs_dir, chats_dir) = match effective.mode {
            ContextStorageMode::ProjectLocal => {
                let base = join(&absolute_root, ".pickforge");
                let runs = join(&base, "runs");
                let chats = join(&base, "chats");
                (base, runs, chats)
            }
            ContextStorageMode::PickforgeHome => {
                let base = join3(&pickforge_home(None)?, "projects", &id);
                (join(&base, "context"), join(&base, "runs"), join(&base, "chats"))
            }
            ContextStorageMode::CustomPath => {
                let custom = absolutize(effective.custom_path.as_deref().unwrap_or_default());
                let base = join3(&custom, "projects", &id);
                (join(&base, "context"), join(&base, "runs"), join(&base, "chats"))
            }
        };

        let is_project_local = effective.mode == ContextStorageMode::ProjectLocal;
        Ok(ResolvedContextDirectory {
            project_root: absolute_root,
            project_id: id,
            storage_location: effective,
            context_dir,
            runs_dir,
            chats_dir,
            is_project_local,
        })
    }

    /// Resolve and create the directories. Errors if the project folder is
    /// missing.
    pub fn ensure(
        &self,
        project_root: &str,
        location: Option<ContextStorageLocation>,
    ) -> Result<ResolvedContextDirectory, StorageError> {
        if !Path::new(project_root).exists() {
            return Err(StorageError::ProjectMissing(project_root.to_string()));
        }

        let resolved = self.resolve(project_root, location)?;
        if resolved.is_project_local {
            // The `.pickforge/.gitignore` marker is what auto-detect keys on.
            std::fs::create_dir_all(&resolved.context_dir)?;
            std::fs::create_dir_all(&resolved.runs_dir)?;
            std::fs::create_dir_all(&resolved.chats_dir)?;
            let marker = join(&resolved.context_dir, ".gitignore");
            if !Path::new(&marker).exists() {
                std::fs::write(&marker, "*\n")?;
            }
        } else {
            std::fs::create_dir_all(&resolved.context_dir)?;
            std::fs::create_dir_all(&resolved.runs_dir)?;
            std::fs::create_dir_all(&resolved.chats_dir)?;
        }
        Ok(resolved)
    }
}

fn auto_detect(absolute_root: &str) -> ContextStorageLocation {
    let marker = join3(absolute_root, ".pickforge", ".gitignore");
    if let Ok(content) = std::fs::read_to_string(&marker) {
        if content == "*\n" {
            return ContextStorageLocation::project_local();
        }
    }
    ContextStorageLocation::pickforge_home()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> String {
        let dir = std::env::temp_dir().join(format!("pf-storage-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().into_owned()
    }

    #[test]
    fn project_local_layout_and_marker() {
        let root = temp_root("local");
        let svc = ContextStorageService::new();
        let resolved = svc
            .ensure(&root, Some(ContextStorageLocation::project_local()))
            .unwrap();

        assert!(resolved.is_project_local);
        assert_eq!(resolved.context_dir, join(&root, ".pickforge"));
        assert_eq!(resolved.chats_dir, join3(&root, ".pickforge", "chats"));
        assert!(Path::new(&join3(&root, ".pickforge", ".gitignore")).exists());
        assert!(Path::new(&resolved.runs_dir).is_dir());

        // Auto-detect now picks project-local from the marker.
        let auto = svc.resolve(&root, None).unwrap();
        assert!(auto.is_project_local);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn custom_path_layout_uses_projects_and_id() {
        let root = temp_root("custom-root");
        let custom = temp_root("custom-store");
        let svc = ContextStorageService::new();
        let resolved = svc
            .ensure(&root, Some(ContextStorageLocation::custom(custom.clone())))
            .unwrap();

        assert!(!resolved.is_project_local);
        let base = join3(&custom, "projects", &resolved.project_id);
        assert_eq!(resolved.context_dir, join(&base, "context"));
        assert!(Path::new(&resolved.chats_dir).is_dir());

        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&custom).ok();
    }

    #[test]
    fn ensure_rejects_missing_project() {
        let svc = ContextStorageService::new();
        let err = svc.ensure("/definitely/not/here/pf-xyz", None).unwrap_err();
        assert!(matches!(err, StorageError::ProjectMissing(_)));
    }
}
