import { invoke } from "@tauri-apps/api/core";

export interface TargetDetection {
  targetId: string;
  displayName: string;
  confidence: "exact" | "likely" | "fallback";
  priority: number;
  capabilities: string[];
}

/** A device row for the UI: a running adb device or an installed-but-stopped
 *  AVD. `serial` is null until a stopped AVD boots; `displayName` is the
 *  friendly name only (the serial is appended in the UI). `offline` = present to
 *  adb but unusable (offline / unauthorized / booting). */
export interface DeviceEntry {
  serial: string | null;
  avdId: string | null;
  displayName: string;
  state: "running" | "offline" | "stopped";
  kind: "emulator" | "physical";
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

/** The nearest enclosing pubspec.yaml dir at/above `program`, or null. */
export const findNearestPubspec = (program: string, root: string) =>
  invoke<string | null>("find_nearest_pubspec", { program, root });
