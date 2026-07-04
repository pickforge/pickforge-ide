use std::path::{Path, PathBuf};

use serde::Serialize;

use super::{command_failed, run_ios_command, IosError, IOS_TIMEOUT};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum XcodeContainerKind {
    Workspace,
    Project,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XcodeContainer {
    pub path: PathBuf,
    pub kind: XcodeContainerKind,
    pub name: String,
}

pub fn find_container(root: &Path) -> Option<XcodeContainer> {
    let entries = std::fs::read_dir(root).ok()?;
    let mut workspaces = Vec::new();
    let mut projects = Vec::new();
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.ends_with(".xcworkspace") {
            workspaces.push((name.to_string(), path));
        } else if name.ends_with(".xcodeproj") {
            projects.push((name.to_string(), path));
        }
    }

    workspaces.sort_by(|a, b| a.0.cmp(&b.0));
    projects.sort_by(|a, b| a.0.cmp(&b.0));

    workspaces
        .into_iter()
        .next()
        .map(|(_, path)| to_container(path, XcodeContainerKind::Workspace))
        .or_else(|| {
            projects
                .into_iter()
                .next()
                .map(|(_, path)| to_container(path, XcodeContainerKind::Project))
        })
}

pub fn built_app_path(derived_data: &Path, scheme: &str) -> PathBuf {
    derived_data
        .join("Build")
        .join("Products")
        .join("Debug-iphonesimulator")
        .join(format!("{scheme}.app"))
}

pub fn bundle_id_of_app(app_path: &Path) -> Result<String, IosError> {
    let plist = app_path.join("Info.plist");
    let plist = plist.to_string_lossy();
    let out = run_ios_command(
        "plutil",
        &["-extract", "CFBundleIdentifier", "raw", &plist],
        IOS_TIMEOUT,
    )?;
    if !out.success() {
        return Err(command_failed("plutil", &out));
    }
    let bundle_id = out.stdout_utf8().trim().to_string();
    if bundle_id.is_empty() {
        return Err(IosError::Parse("CFBundleIdentifier was empty".to_string()));
    }
    Ok(bundle_id)
}

fn to_container(path: PathBuf, kind: XcodeContainerKind) -> XcodeContainer {
    let name = path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    XcodeContainer { path, kind, name }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pf-ios-xcode-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_workspace_before_project() {
        let dir = temp("workspace");
        std::fs::create_dir_all(dir.join("B.xcodeproj")).unwrap();
        std::fs::create_dir_all(dir.join("A.xcworkspace")).unwrap();
        let container = find_container(&dir).unwrap();
        assert_eq!(container.kind, XcodeContainerKind::Workspace);
        assert_eq!(container.name, "A");
        assert_eq!(container.path, dir.join("A.xcworkspace"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn returns_none_without_container() {
        let dir = temp("none");
        assert!(find_container(&dir).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn builds_debug_simulator_app_path() {
        let path = built_app_path(Path::new("/tmp/Derived"), "PickForge");
        assert_eq!(
            path,
            Path::new("/tmp/Derived")
                .join("Build")
                .join("Products")
                .join("Debug-iphonesimulator")
                .join("PickForge.app")
        );
    }
}
