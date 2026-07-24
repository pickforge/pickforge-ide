//! Probe-only detection for the pi-kit extension pack. Never reads Pi auth
//! files or credentials; only scans the extensions directory it is given and,
//! when a pi-kit shim is found, the resolved checkout's `package.json`.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

/// The exact path segment that marks an extension shim as belonging to
/// pi-kit, e.g. `export { default } from "../../../pi-kit/extensions/x.ts"`.
/// Matched as a whole `/`-delimited segment, not a substring, so sibling
/// directories like `not-pi-kit/` or `somepi-kit/` never qualify.
const PI_KIT_SEGMENT: &str = "pi-kit";

/// Shim files are tiny hand-written re-exports; anything past this is not a
/// shim we care to parse. Mirrors the read-size discipline in
/// `process_commands::PROBE_CAPTURE_LIMIT_BYTES`.
const SHIM_READ_LIMIT_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiKitDetection {
    pub detected: bool,
    /// `None` when no shim was found, or the resolved checkout's
    /// `package.json` was missing, unreadable, malformed, or not named
    /// "pi-kit".
    pub version: Option<String>,
    pub linked_extension_count: usize,
    /// Internal to the probe (tests, future slices); not part of the IPC
    /// payload — the UI has no consumer for it yet.
    #[serde(skip_serializing)]
    pub checkout_path: Option<PathBuf>,
}

impl PiKitDetection {
    fn absent() -> Self {
        Self {
            detected: false,
            version: None,
            linked_extension_count: 0,
            checkout_path: None,
        }
    }
}

/// Scan `extensions_dir` (normally `~/.pi/agent/extensions`) for thin
/// re-export shims pointing into a pi-kit checkout. A missing directory or no
/// matching shims is the neutral "not detected" result, never an error.
pub fn detect_pi_kit(extensions_dir: &Path) -> PiKitDetection {
    let Ok(entries) = std::fs::read_dir(extensions_dir) else {
        return PiKitDetection::absent();
    };

    let mut shim_paths: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("ts"))
        .collect();
    shim_paths.sort();

    let mut linked_extension_count = 0usize;
    let mut checkout_path: Option<PathBuf> = None;
    for path in shim_paths {
        let Some(contents) = read_shim_capped(&path) else {
            continue;
        };
        let Some(export_target) = pi_kit_shim_target(&contents) else {
            continue;
        };
        linked_extension_count += 1;
        if checkout_path.is_none() {
            checkout_path = resolve_pi_kit_checkout(extensions_dir, &export_target);
        }
    }

    if linked_extension_count == 0 {
        return PiKitDetection::absent();
    }

    let version = checkout_path.as_deref().and_then(read_pi_kit_version);
    PiKitDetection {
        detected: true,
        version,
        linked_extension_count,
        checkout_path,
    }
}

/// Reads a shim candidate, refusing anything past `SHIM_READ_LIMIT_BYTES` so
/// a mislabeled large `.ts` file can't be fully buffered into memory.
fn read_shim_capped(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > SHIM_READ_LIMIT_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

/// Finds a bare `export { default } from "<path>"` re-export whose target
/// contains the `pi-kit` marker as a whole `/`-delimited path segment, and
/// returns that target path.
fn pi_kit_shim_target(contents: &str) -> Option<String> {
    for line in contents.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("export") {
            continue;
        }
        let after_from = trimmed.split_once("from")?.1.trim_start();
        let quote = after_from.chars().next()?;
        if quote != '"' && quote != '\'' {
            continue;
        }
        let rest = &after_from[quote.len_utf8()..];
        let end = rest.find(quote)?;
        let target = &rest[..end];
        if target.split('/').any(|segment| segment == PI_KIT_SEGMENT) {
            return Some(target.to_string());
        }
    }
    None
}

/// Resolves a shim's relative import target to the pi-kit checkout root
/// (the directory named `pi-kit` in its resolved, lexically-normalized path).
fn resolve_pi_kit_checkout(extensions_dir: &Path, export_target: &str) -> Option<PathBuf> {
    let normalized = normalize_path(&extensions_dir.join(export_target));
    let mut root = PathBuf::new();
    for component in normalized.components() {
        root.push(component.as_os_str());
        if component.as_os_str() == "pi-kit" {
            return Some(root);
        }
    }
    None
}

/// Lexically collapses `.`/`..` components without touching the filesystem
/// (the target need not exist yet when this runs).
fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

/// Reads `<checkout_root>/package.json` and returns its version, only when
/// the package is actually named "pi-kit".
fn read_pi_kit_version(checkout_root: &Path) -> Option<String> {
    let contents = std::fs::read_to_string(checkout_root.join("package.json")).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&contents).ok()?;
    if manifest.get("name")?.as_str()? != "pi-kit" {
        return None;
    }
    manifest
        .get("version")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(name: &str) -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "pickforge-pi-kit-{name}-{}-{stamp}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn write(&self, relative: &str, text: &str) {
            let path = self.path.join(relative);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(path, text).unwrap();
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn missing_extensions_dir_is_neutral_not_detected() {
        let root = TempDir::new("missing");
        let result = detect_pi_kit(&root.path.join("nope"));
        assert_eq!(result, PiKitDetection::absent());
    }

    #[test]
    fn empty_extensions_dir_is_neutral_not_detected() {
        let root = TempDir::new("empty");
        let extensions = root.path.join(".pi/agent/extensions");
        std::fs::create_dir_all(&extensions).unwrap();
        let result = detect_pi_kit(&extensions);
        assert_eq!(result, PiKitDetection::absent());
    }

    #[test]
    fn non_pi_kit_extensions_are_ignored() {
        let root = TempDir::new("non-pi-kit");
        root.write(
            ".pi/agent/extensions/local.ts",
            "export default function (pi: any) {}\n",
        );
        root.write(
            ".pi/agent/extensions/other-shim.ts",
            "export { default } from \"../../../Projects/Personal/other-kit/extensions/x.ts\";\n",
        );
        let result = detect_pi_kit(&root.path.join(".pi/agent/extensions"));
        assert_eq!(result, PiKitDetection::absent());
    }

    #[test]
    fn lookalike_directory_names_do_not_match_the_pi_kit_segment() {
        let root = TempDir::new("lookalike");
        root.write(
            ".pi/agent/extensions/not-shim.ts",
            "export { default } from \"../../../Projects/Personal/not-pi-kit/extensions/x.ts\";\n",
        );
        root.write(
            ".pi/agent/extensions/prefixed-shim.ts",
            "export { default } from \"../../../Projects/Personal/somepi-kit/extensions/x.ts\";\n",
        );
        let result = detect_pi_kit(&root.path.join(".pi/agent/extensions"));
        assert_eq!(result, PiKitDetection::absent());
    }

    #[test]
    fn oversized_shim_candidate_is_skipped() {
        let root = TempDir::new("oversized");
        let padding = "// filler\n".repeat((SHIM_READ_LIMIT_BYTES as usize / 10) + 100);
        root.write(
            ".pi/agent/extensions/huge.ts",
            &format!(
                "{padding}export {{ default }} from \"../../../pi-kit/extensions/huge.ts\";\n"
            ),
        );
        let result = detect_pi_kit(&root.path.join(".pi/agent/extensions"));
        assert_eq!(result, PiKitDetection::absent());
    }

    #[test]
    fn parses_shim_re_export_and_reads_version() {
        let root = TempDir::new("shim");
        root.write(
            ".pi/agent/extensions/btw.ts",
            "export { default } from \"../../../Projects/Personal/pi-kit/extensions/btw.ts\";\n",
        );
        root.write(
            ".pi/agent/extensions/decision-audit-gate.ts",
            "export default function (pi: any) {}\n",
        );
        root.write(
            "Projects/Personal/pi-kit/package.json",
            r#"{"name":"pi-kit","version":"0.1.0","pi":{"extensions":["extensions/btw.ts"]}}"#,
        );

        let result = detect_pi_kit(&root.path.join(".pi/agent/extensions"));

        assert_eq!(
            result,
            PiKitDetection {
                detected: true,
                version: Some("0.1.0".to_string()),
                linked_extension_count: 1,
                checkout_path: Some(root.path.join("Projects/Personal/pi-kit")),
            }
        );
    }

    #[test]
    fn counts_multiple_linked_shims_and_keeps_first_checkout() {
        let root = TempDir::new("multi");
        root.write(
            ".pi/agent/extensions/a.ts",
            "export { default } from \"../../../pi-kit/extensions/a.ts\";\n",
        );
        root.write(
            ".pi/agent/extensions/b.ts",
            "export { default } from \"../../../pi-kit/extensions/b.ts\";\n",
        );
        root.write(
            "pi-kit/package.json",
            r#"{"name":"pi-kit","version":"0.2.0"}"#,
        );

        let result = detect_pi_kit(&root.path.join(".pi/agent/extensions"));

        assert!(result.detected);
        assert_eq!(result.linked_extension_count, 2);
        assert_eq!(result.version, Some("0.2.0".to_string()));
        assert_eq!(result.checkout_path, Some(root.path.join("pi-kit")));
    }

    #[test]
    fn missing_package_json_yields_detected_with_null_version() {
        let root = TempDir::new("missing-pkg");
        root.write(
            ".pi/agent/extensions/btw.ts",
            "export { default } from \"../../../pi-kit/extensions/btw.ts\";\n",
        );

        let result = detect_pi_kit(&root.path.join(".pi/agent/extensions"));

        assert!(result.detected);
        assert_eq!(result.linked_extension_count, 1);
        assert_eq!(result.version, None);
        assert_eq!(result.checkout_path, Some(root.path.join("pi-kit")));
    }

    #[test]
    fn malformed_package_json_yields_detected_with_null_version() {
        let root = TempDir::new("malformed-pkg");
        root.write(
            ".pi/agent/extensions/btw.ts",
            "export { default } from \"../../../pi-kit/extensions/btw.ts\";\n",
        );
        root.write("pi-kit/package.json", "{ not json ");

        let result = detect_pi_kit(&root.path.join(".pi/agent/extensions"));

        assert!(result.detected);
        assert_eq!(result.version, None);
    }

    #[test]
    fn package_json_with_wrong_name_yields_null_version() {
        let root = TempDir::new("wrong-name");
        root.write(
            ".pi/agent/extensions/btw.ts",
            "export { default } from \"../../../pi-kit/extensions/btw.ts\";\n",
        );
        root.write(
            "pi-kit/package.json",
            r#"{"name":"not-pi-kit","version":"9.9.9"}"#,
        );

        let result = detect_pi_kit(&root.path.join(".pi/agent/extensions"));

        assert!(result.detected);
        assert_eq!(result.version, None);
    }
}
