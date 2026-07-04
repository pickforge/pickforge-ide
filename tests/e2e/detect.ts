// File-based target detection for the e2e harness — a faithful mirror of the
// Rust core's `detect_target` (crates/pickforge-core/src/targets/adapters.rs),
// so the harness can detect a fixture's target from real files on disk without a
// running Tauri/IPC layer. The device-pixel assertions (screenshot, UIAutomator,
// logcat) live in the Rust integration tests; this only resolves the target id
// that feeds the pure run-command builders in src/lib/runTargets.ts.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface DetectedTarget {
  targetId: "flutter" | "react-native" | "native-android" | "native-ios" | "web" | "generic";
  displayName: string;
}

function detectFlutter(root: string): DetectedTarget | null {
  const pubspec = join(root, "pubspec.yaml");
  if (!existsSync(pubspec)) return null;
  // Require a `sdk: flutter` dependency, not merely a pubspec (matches the core:
  // the line, with its `sdk:` prefix stripped and trimmed, must equal `flutter`).
  const declares = readFileSync(pubspec, "utf8")
    .split("\n")
    .some((line) => {
      const t = line.trim();
      return t.startsWith("sdk:") && t.slice("sdk:".length).trim() === "flutter";
    });
  return declares ? { targetId: "flutter", displayName: "Flutter" } : null;
}

function detectReactNative(root: string): DetectedTarget | null {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return null;
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return null;
  }
  const hasRn = Boolean(pkg.dependencies?.["react-native"] || pkg.devDependencies?.["react-native"]);
  if (!hasRn || !existsSync(join(root, "android"))) return null;
  return { targetId: "react-native", displayName: "React Native (Android)" };
}

function detectNativeAndroid(root: string): DetectedTarget | null {
  const hasSettings = existsSync(join(root, "settings.gradle")) || existsSync(join(root, "settings.gradle.kts"));
  const hasBuild = existsSync(join(root, "build.gradle")) || existsSync(join(root, "build.gradle.kts"));
  return hasSettings && hasBuild ? { targetId: "native-android", displayName: "Native Android" } : null;
}

function detectNativeIos(root: string): DetectedTarget | null {
  try {
    const hasContainer = readdirSync(root, { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && (entry.name.endsWith(".xcworkspace") || entry.name.endsWith(".xcodeproj")),
    );
    if (hasContainer) return { targetId: "native-ios", displayName: "Native iOS" };
  } catch {
    return null;
  }

  try {
    return readFileSync(join(root, "Package.swift"), "utf8").includes(".iOS")
      ? { targetId: "native-ios", displayName: "Native iOS" }
      : null;
  } catch {
    return null;
  }
}

function detectWeb(root: string): DetectedTarget | null {
  if (!existsSync(join(root, "package.json"))) return null;
  const webFiles = ["index.html", "vite.config.ts", "vite.config.js", "next.config.js", "next.config.mjs"];
  return webFiles.some((f) => existsSync(join(root, f))) ? { targetId: "web", displayName: "Web" } : null;
}

/** Detect the best target for `root` (always returns at least `generic`), in the
 *  same priority order as the Rust core. */
export function detectTarget(root: string): DetectedTarget {
  return (
    detectFlutter(root) ??
    detectReactNative(root) ??
    detectNativeAndroid(root) ??
    detectNativeIos(root) ??
    detectWeb(root) ?? { targetId: "generic", displayName: "Generic project" }
  );
}
