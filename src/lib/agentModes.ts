// Per-agent permission/sandbox mode. Claude Code maps a mode straight to a
// permissionMode; Codex maps it to a sandbox + approval policy. Selection
// persists in localStorage, mirroring agentModels.ts. The defaults ("default",
// "auto") reproduce the currently shipped behavior.
import type { AgentProvider } from "./agentChat";

export type AgentMode = string;

export interface AgentModeOption {
  id: string;
  label: string;
}

export interface ModeOverrides {
  sandbox?: string;
  approvalPolicy?: string;
  permissionMode?: string;
}

const MODE_OPTIONS: Record<AgentProvider, AgentModeOption[]> = {
  claudeCode: [
    { id: "default", label: "Default" },
    { id: "plan", label: "Plan" },
    { id: "acceptEdits", label: "Accept edits" },
    { id: "bypassPermissions", label: "Bypass permissions" },
  ],
  codex: [
    { id: "auto", label: "Agent" },
    { id: "read-only", label: "Plan / read-only" },
    { id: "full-access", label: "Full access" },
  ],
};

const DEFAULT_MODE: Record<AgentProvider, string> = {
  claudeCode: "default",
  codex: "auto",
};

const DANGER_MODES: Record<AgentProvider, string> = {
  claudeCode: "bypassPermissions",
  codex: "full-access",
};

export function modeOptions(provider: AgentProvider): AgentModeOption[] {
  return MODE_OPTIONS[provider] ?? [];
}

export function defaultMode(provider: AgentProvider): string {
  return DEFAULT_MODE[provider] ?? "";
}

function resolveMode(provider: AgentProvider, mode: string | null): string {
  const fallback = defaultMode(provider);
  if (!mode) return fallback;
  return modeOptions(provider).some((option) => option.id === mode) ? mode : fallback;
}

export function isDangerMode(provider: AgentProvider, mode: string | null): boolean {
  return resolveMode(provider, mode) === DANGER_MODES[provider];
}

export function modeOverrides(provider: AgentProvider, mode: string | null): ModeOverrides {
  const resolved = resolveMode(provider, mode);
  if (provider === "claudeCode") return { permissionMode: resolved };
  switch (resolved) {
    case "read-only":
      return { sandbox: "read-only", approvalPolicy: "on-request" };
    case "full-access":
      return { sandbox: "danger-full-access", approvalPolicy: "never" };
    default:
      return { sandbox: "workspace-write", approvalPolicy: "on-request" };
  }
}

const STORE_KEY = "pickforge.agentModes";

function defaults(): Record<AgentProvider, string> {
  return { ...DEFAULT_MODE };
}

export function loadAgentModes(): Record<AgentProvider, string> {
  const result = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
    for (const provider of Object.keys(result) as AgentProvider[]) {
      const value = saved?.[provider];
      if (typeof value === "string" && modeOptions(provider).some((o) => o.id === value)) {
        result[provider] = value;
      }
    }
  } catch {
    return defaults();
  }
  return result;
}

export function setAgentMode(provider: AgentProvider, mode: string) {
  const current = loadAgentModes();
  current[provider] = mode;
  localStorage.setItem(STORE_KEY, JSON.stringify(current));
}
