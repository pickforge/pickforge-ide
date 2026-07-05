import { invoke } from "@tauri-apps/api/core";

export interface TargetDetection {
  targetId: string;
  displayName: string;
  confidence: "exact" | "likely" | "fallback";
  priority: number;
  capabilities: string[];
}

/** A device row for the UI: a running adb device / booted simulator, or an
 *  installed-but-stopped AVD / shut-down simulator. For AVDs `serial` is null
 *  until they boot; simulators carry their udid as `serial` even when stopped.
 *  `displayName` is the friendly name only (the serial is appended in the UI).
 *  `offline` = present but unusable (offline / unauthorized / booting). */
export interface DeviceEntry {
  serial: string | null;
  avdId: string | null;
  displayName: string;
  state: "running" | "offline" | "stopped";
  kind: "emulator" | "physical" | "simulator";
}

/** Coarse role inferred from the Android class name (mirrors the Rust
 *  `A11yRole`). camelCase to match `#[serde(rename_all = "camelCase")]`. */
export type A11yRole =
  | "button"
  | "text"
  | "image"
  | "input"
  | "switchControl"
  | "checkbox"
  | "list"
  | "unknown";

/** Device-pixel rectangle `[left,top][right,bottom]`. The Rust `Rect` has no
 *  rename, so these field names stay snake-free already. */
export interface A11yRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A UIAutomator accessibility node — framework-agnostic (native Views, Compose
 *  and React Native all emit the same XML). Mirrors `A11yNode` in
 *  `crates/pickforge-core/src/android/uiautomator.rs`. */
export interface A11yNode {
  nodeId: string;
  role: A11yRole;
  className: string;
  text: string | null;
  contentDescription: string | null;
  resourceId: string | null;
  bounds: A11yRect;
  enabled: boolean;
  clickable: boolean;
  selected: boolean;
  children: A11yNode[];
}

export const targetDetect = (projectRoot: string) =>
  invoke<TargetDetection>("target_detect", { projectRoot });

/** Merged device list: running devices + stopped AVDs, friendly-named. */
export const androidDeviceList = () => invoke<DeviceEntry[]>("android_device_list");

/** Boot a stopped AVD (returns once spawned, not once booted). */
export const androidLaunchAvd = (avdId: string) =>
  invoke<void>("android_launch_avd", { avdId });

/** Wait until a serial is online (adb `device` state) or the timeout elapses. */
export const androidWaitForDevice = (serial: string, timeoutMs: number) =>
  invoke<boolean>("android_wait_for_device", { serial, timeoutMs });

/** Merged iOS simulator list: booted + shut-down simulators, friendly-named. A
 *  simulator's udid is its `serial` even while shut down (unlike an AVD). */
export const iosDeviceList = () => invoke<DeviceEntry[]>("ios_device_list");

/** Boot a stopped simulator by udid (returns once `simctl boot` is spawned, not
 *  once the simulator has finished booting). */
export const iosBootDevice = (udid: string) =>
  invoke<void>("ios_boot_device", { udid });

/** Dump the booted simulator's current accessibility tree via `idb` (native
 *  iOS). Returns the same `A11yNode` shape as `adbDumpUiautomator`; rejects
 *  with the native error string when `idb` or parsing fails. */
export const iosDumpAccessibility = (udid: string) =>
  invoke<A11yNode>("ios_dump_accessibility", { udid });

/** Capture a simulator screenshot into `outputDir/outputName`. Returns the
 *  written PNG path, or null on failure. The iOS sibling of `adbScreenshot`. */
export const iosScreenshot = (udid: string, outputDir: string, outputName: string) =>
  invoke<string | null>("ios_screenshot", { udid, outputDir, outputName });

/** The nearest enclosing pubspec.yaml dir at/above `program`, or null. */
export const findNearestPubspec = (program: string, root: string) =>
  invoke<string | null>("find_nearest_pubspec", { program, root });

/** Dump the device's current UIAutomator accessibility tree (RN / native
 *  Android). Null when nothing could be parsed (no foregrounded app / offline
 *  device). */
export const adbDumpUiautomator = (serial: string) =>
  invoke<A11yNode | null>("adb_dump_uiautomator", { serial });

/** Capture a device screenshot into `outputDir/outputName`. Returns the written
 *  PNG path, or null on failure. */
export const adbScreenshot = (serial: string, outputDir: string, outputName: string) =>
  invoke<string | null>("adb_screenshot", { serial, outputDir, outputName });

/** Read a PNG file as a `data:image/png;base64,…` URL for inline `<img>` display
 *  (the web view can't load arbitrary file paths). Null if missing/oversized. */
export const readImageDataUrl = (path: string) =>
  invoke<string | null>("read_image_data_url", { path });
