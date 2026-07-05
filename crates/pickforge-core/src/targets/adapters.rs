//! Target detection — ports the adapter registry in `lib/core/targets/`.
//! Each adapter detects from project files; the highest-priority match wins,
//! falling back to `generic`.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::ios::find_container;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Capability {
    Detect,
    Launch,
    Stop,
    HotReload,
    HotRestart,
    CaptureScreenshot,
    StreamLogs,
    InspectSelection,
    MapSelectionToSource,
    ExposeMcpTools,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Exact,
    Likely,
    Fallback,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetDetection {
    pub target_id: String,
    pub display_name: String,
    pub confidence: Confidence,
    pub priority: i32,
    pub capabilities: Vec<Capability>,
}

/// Detect the best target for `project_root` (always returns at least generic).
pub fn detect_target(project_root: &str) -> TargetDetection {
    let root = Path::new(project_root);
    detect_flutter(root)
        .or_else(|| detect_react_native(root))
        .or_else(|| detect_native_android(root))
        .or_else(|| detect_native_ios(root))
        .or_else(|| detect_web(root))
        .unwrap_or_else(generic)
}

fn detect_flutter(root: &Path) -> Option<TargetDetection> {
    let content = std::fs::read_to_string(root.join("pubspec.yaml")).ok()?;
    // Require a `sdk: flutter` dependency, not merely a pubspec, so plain Dart
    // packages don't false-positive.
    let declares = content.lines().any(|line| {
        let t = line.trim();
        t.strip_prefix("sdk:").map(str::trim) == Some("flutter")
    });
    if !declares {
        return None;
    }
    Some(TargetDetection {
        target_id: "flutter".into(),
        display_name: "Flutter".into(),
        confidence: Confidence::Exact,
        priority: 100,
        capabilities: vec![
            Capability::Detect,
            Capability::Launch,
            Capability::Stop,
            Capability::HotReload,
            Capability::HotRestart,
            Capability::CaptureScreenshot,
            Capability::StreamLogs,
            Capability::InspectSelection,
            Capability::MapSelectionToSource,
            Capability::ExposeMcpTools,
        ],
    })
}

fn detect_react_native(root: &Path) -> Option<TargetDetection> {
    let pkg = std::fs::read_to_string(root.join("package.json")).ok()?;
    let value: Value = serde_json::from_str(&pkg).ok()?;
    let has_rn = ["dependencies", "devDependencies"].iter().any(|key| {
        value
            .get(key)
            .and_then(Value::as_object)
            .map(|o| o.contains_key("react-native"))
            .unwrap_or(false)
    });
    if !has_rn || !root.join("android").is_dir() {
        return None;
    }
    Some(TargetDetection {
        target_id: "react-native".into(),
        display_name: "React Native (Android)".into(),
        confidence: Confidence::Likely,
        priority: 80,
        capabilities: vec![
            Capability::Detect,
            Capability::Launch,
            Capability::Stop,
            Capability::CaptureScreenshot,
            Capability::StreamLogs,
            Capability::InspectSelection,
        ],
    })
}

fn detect_native_android(root: &Path) -> Option<TargetDetection> {
    let has_settings =
        root.join("settings.gradle").exists() || root.join("settings.gradle.kts").exists();
    let has_build = root.join("build.gradle").exists() || root.join("build.gradle.kts").exists();
    if !has_settings || !has_build {
        return None;
    }
    Some(TargetDetection {
        target_id: "native-android".into(),
        display_name: "Native Android".into(),
        confidence: Confidence::Likely,
        priority: 60,
        capabilities: vec![
            Capability::Detect,
            Capability::Launch,
            Capability::CaptureScreenshot,
            Capability::StreamLogs,
            Capability::InspectSelection,
        ],
    })
}

fn detect_native_ios(root: &Path) -> Option<TargetDetection> {
    if find_container(root).is_none() && !has_ios_package(root) {
        return None;
    }
    Some(TargetDetection {
        target_id: "native-ios".into(),
        display_name: "Native iOS".into(),
        confidence: Confidence::Likely,
        priority: 55,
        capabilities: vec![
            Capability::Detect,
            Capability::Launch,
            Capability::CaptureScreenshot,
            Capability::StreamLogs,
            Capability::InspectSelection,
        ],
    })
}

fn has_ios_package(root: &Path) -> bool {
    std::fs::read_to_string(root.join("Package.swift"))
        .map(|content| content.contains(".iOS"))
        .unwrap_or(false)
}

fn detect_web(root: &Path) -> Option<TargetDetection> {
    if !root.join("package.json").exists() {
        return None;
    }
    let has_web = [
        "index.html",
        "vite.config.ts",
        "vite.config.js",
        "next.config.js",
        "next.config.mjs",
    ]
    .iter()
    .any(|f| root.join(f).exists());
    if !has_web {
        return None;
    }
    Some(TargetDetection {
        target_id: "web".into(),
        display_name: "Web".into(),
        confidence: Confidence::Likely,
        priority: 40,
        capabilities: vec![
            Capability::Detect,
            Capability::CaptureScreenshot,
            Capability::InspectSelection,
            Capability::MapSelectionToSource,
        ],
    })
}

fn generic() -> TargetDetection {
    TargetDetection {
        target_id: "generic".into(),
        display_name: "Generic project".into(),
        confidence: Confidence::Fallback,
        priority: 0,
        capabilities: vec![Capability::Detect],
    }
}

/// Walk up from `start` to the nearest ancestor directory containing a
/// `pubspec.yaml` — the way Dart-Code derives a Flutter project's root from a
/// launch config's `program`. `None` if no ancestor has one.
pub fn nearest_pubspec_dir(start: &Path) -> Option<PathBuf> {
    let mut dir = Some(start);
    while let Some(d) = dir {
        if d.join("pubspec.yaml").is_file() {
            return Some(d.to_path_buf());
        }
        dir = d.parent();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("pf-target-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn detects_flutter_from_sdk_dependency() {
        let dir = temp("flutter");
        std::fs::write(
            dir.join("pubspec.yaml"),
            "name: x\ndependencies:\n  flutter:\n    sdk: flutter\n",
        )
        .unwrap();
        let d = detect_target(dir.to_str().unwrap());
        assert_eq!(d.target_id, "flutter");
        assert_eq!(d.confidence, Confidence::Exact);
        assert!(d.capabilities.contains(&Capability::HotReload));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn plain_dart_is_not_flutter() {
        let dir = temp("dart");
        std::fs::write(
            dir.join("pubspec.yaml"),
            "name: x\nenvironment:\n  sdk: '>=3.0.0'\n",
        )
        .unwrap();
        assert_eq!(detect_target(dir.to_str().unwrap()).target_id, "generic");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nearest_pubspec_walks_up_to_app_dir() {
        let dir = temp("pubspec");
        let app_lib = dir.join("app").join("lib");
        std::fs::create_dir_all(&app_lib).unwrap();
        std::fs::write(dir.join("app").join("pubspec.yaml"), "name: x").unwrap();
        // From app/lib it finds app/ (the monorepo case).
        assert_eq!(nearest_pubspec_dir(&app_lib), Some(dir.join("app")));
        // No pubspec anywhere up the tree -> None.
        let bare = temp("nopubspec");
        assert_eq!(nearest_pubspec_dir(&bare), None);
        std::fs::remove_dir_all(&dir).ok();
        std::fs::remove_dir_all(&bare).ok();
    }

    #[test]
    fn detects_react_native_with_android() {
        let dir = temp("rn");
        std::fs::write(
            dir.join("package.json"),
            r#"{"dependencies":{"react-native":"0.75.0"}}"#,
        )
        .unwrap();
        std::fs::create_dir_all(dir.join("android")).unwrap();
        assert_eq!(
            detect_target(dir.to_str().unwrap()).target_id,
            "react-native"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn detects_native_android_and_generic_fallback() {
        let dir = temp("android");
        std::fs::write(dir.join("settings.gradle"), "include ':app'").unwrap();
        std::fs::write(dir.join("build.gradle"), "// root").unwrap();
        assert_eq!(
            detect_target(dir.to_str().unwrap()).target_id,
            "native-android"
        );
        std::fs::remove_dir_all(&dir).ok();

        let empty = temp("empty");
        assert_eq!(detect_target(empty.to_str().unwrap()).target_id, "generic");
        std::fs::remove_dir_all(&empty).ok();
    }

    #[test]
    fn detects_native_ios_from_xcode_project() {
        let dir = temp("ios");
        std::fs::create_dir_all(dir.join("Foo.xcodeproj")).unwrap();
        let d = detect_target(dir.to_str().unwrap());
        assert_eq!(d.target_id, "native-ios");
        assert_eq!(d.confidence, Confidence::Likely);
        assert_eq!(d.priority, 55);
        assert_eq!(
            d.capabilities,
            vec![
                Capability::Detect,
                Capability::Launch,
                Capability::CaptureScreenshot,
                Capability::StreamLogs,
                Capability::InspectSelection,
            ]
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn detects_native_ios_from_package_platform() {
        let dir = temp("ios-package");
        std::fs::write(
            dir.join("Package.swift"),
            r#"// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "App",
    platforms: [.iOS(.v18)],
    products: []
)
"#,
        )
        .unwrap();
        assert_eq!(detect_target(dir.to_str().unwrap()).target_id, "native-ios");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn package_without_ios_platform_stays_generic() {
        let dir = temp("swift-package");
        std::fs::write(
            dir.join("Package.swift"),
            r#"// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Library",
    platforms: [.macOS(.v15)],
    products: []
)
"#,
        )
        .unwrap();
        assert_eq!(detect_target(dir.to_str().unwrap()).target_id, "generic");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn flutter_wins_over_ios_workspace() {
        let dir = temp("flutter-ios");
        std::fs::write(
            dir.join("pubspec.yaml"),
            "name: x\ndependencies:\n  flutter:\n    sdk: flutter\n",
        )
        .unwrap();
        std::fs::create_dir_all(dir.join("ios.xcworkspace")).unwrap();
        assert_eq!(detect_target(dir.to_str().unwrap()).target_id, "flutter");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn native_android_wins_over_stray_xcode_project() {
        let dir = temp("android-ios");
        std::fs::write(dir.join("settings.gradle"), "include ':app'").unwrap();
        std::fs::write(dir.join("build.gradle"), "// root").unwrap();
        std::fs::create_dir_all(dir.join("Stray.xcodeproj")).unwrap();
        assert_eq!(
            detect_target(dir.to_str().unwrap()).target_id,
            "native-android"
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
