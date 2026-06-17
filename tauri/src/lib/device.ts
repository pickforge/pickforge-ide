import { invoke } from "@tauri-apps/api/core";

export interface TargetDetection {
  targetId: string;
  displayName: string;
  confidence: "exact" | "likely" | "fallback";
  priority: number;
  capabilities: string[];
}

export interface AdbDevice {
  serial: string;
  state: string;
  model: string | null;
}

export const targetDetect = (projectRoot: string) =>
  invoke<TargetDetection>("target_detect", { projectRoot });

export const adbListDevices = () => invoke<AdbDevice[]>("adb_list_devices");
