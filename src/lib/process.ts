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
