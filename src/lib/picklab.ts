import { invoke } from "@tauri-apps/api/core";

export interface PickLabStatus {
  cliAvailable: boolean;
  mcpAvailable: boolean;
  cliPath: string | null;
  mcpPath: string | null;
  version: string | null;
  doctor: unknown | null;
  agents: unknown | null;
  error: string | null;
}

export function pickLabStatus(): Promise<PickLabStatus> {
  return invoke<PickLabStatus>("picklab_status");
}

