import { invoke } from "@tauri-apps/api/core";

export interface TelemetryConfig {
  crash_reports: boolean;
}

export const telemetryGet = () => invoke<TelemetryConfig>("telemetry_get");

export const telemetrySet = (crashReports: boolean) =>
  invoke<void>("telemetry_set", { crashReports });
