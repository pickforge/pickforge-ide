import { invoke } from "@tauri-apps/api/core";

/** Returns, for each name, whether it resolves on the login-shell PATH. */
export function detectBinaries(names: string[]): Promise<boolean[]> {
  return invoke<boolean[]>("detect_binaries", { names });
}

export interface AgentCliProbe {
  installed: boolean;
  versionOutput: string;
  helpOutput: string;
  modelsOutput: string;
  errors: string[];
}

/** Runs a fixed, read-only diagnostic for an allowlisted terminal agent.
 * The native command accepts only `omp` or `pi`; callers cannot supply argv. */
export function probeAgentCli(agentId: "omp" | "pi"): Promise<AgentCliProbe> {
  return invoke<AgentCliProbe>("probe_agent_cli", { agentId });
}

export interface PiKitDetection {
  detected: boolean;
  version: string | null;
  linkedExtensionCount: number;
}

/** Probe-only pi-kit detection: scans `~/.pi/agent/extensions` for linked
 * pi-kit shims. Never reads Pi auth/credential files and never mutates the
 * install; absence is a neutral result, not an error. */
export function probePiKit(): Promise<PiKitDetection> {
  return invoke<PiKitDetection>("probe_pi_kit");
}
