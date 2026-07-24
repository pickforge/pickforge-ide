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

export type AuthPresenceState = "authenticated" | "notAuthenticated" | "unknown";
export type AuthPresenceUnknownReason =
  | "notInstalled"
  | "commandFailed"
  | "timeout"
  | "unrecognizedOutput";

export interface AgentAuthProbe {
  state: AuthPresenceState;
  unknownReason?: AuthPresenceUnknownReason;
}

/** Probe-only sign-in presence for an allowlisted CLI, via its own status
 * command (`codex login status`, `claude auth status --json`). The native
 * command never reads credential files, keychain entries, tokens, or
 * cookies, and never returns raw command stdout — only the derived
 * authenticated/not-authenticated/unknown state crosses IPC. */
export function probeAgentAuth(agentId: "codex" | "claudeCode"): Promise<AgentAuthProbe> {
  return invoke<AgentAuthProbe>("probe_agent_auth", { agentId });
}

/** One lane row from a pi-kit `<run>.status.json` file (pi-kit's
 * `LaneSnapshotDto` plus `pid`). `pid` exists only for the orphan/liveness
 * heuristic — never used to signal the lane's process directly. */
export interface PiKitLaneStatus {
  lane: string;
  model: string;
  effort: string;
  mode: string;
  state: string;
  currentTool?: string | null;
  lastStatus?: string | null;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  context: number;
  answer?: string | null;
  durationMs?: number | null;
  abandonReason?: string | null;
  pid?: number | null;
}

/** Parsed `<run>.status.json` body (schemaVersion 1). A best-effort,
 * non-authoritative projection of pi-kit's journal — never replay it as a
 * second source of truth. */
export interface PiKitRunStatus {
  schemaVersion: number;
  revision: number;
  updatedAtMs: number;
  run: string;
  state: "active" | "ended";
  ok?: boolean | null;
  durationMs: number;
  totals: { cost: number; tokensIn: number; tokensOut: number };
  lanes: PiKitLaneStatus[];
}

/** One run as PickForge sees it. `supported` is false when the file's
 * `schemaVersion` isn't one this reader understands (honest degrade: listed,
 * not dropped) — `status` is then `null`. */
export interface PiKitRunEntry {
  run: string;
  supported: boolean;
  status: PiKitRunStatus | null;
  orphaned: boolean;
}

/** Lists pi-kit's external run status files — never the raw `*.jsonl`
 * journals, which carry unredacted task/cwd/rationale. No pi-kit runs dir
 * (pi-kit absent, or no runs yet) is a neutral empty list, not an error. */
export function listPiKitRuns(): Promise<PiKitRunEntry[]> {
  return invoke<PiKitRunEntry[]>("list_pi_kit_runs");
}

export interface PiKitAbandonOutcome {
  requested: boolean;
  /** Best-effort: whether the owning pi-kit runner appeared to consume the
   * request within a short bounded poll. `false` is not necessarily a
   * failure — the runner may still be mid-poll past that window. */
  consumed: boolean;
}

/** Requests that pi-kit abandon one lane (or, with `lane` omitted, every
 * active lane) of `run` by writing `<run>.abandon.json` for the owning
 * runner to consume. Never signals the lane's process directly. */
export function abandonPiKitLane(
  run: string,
  lane: string | null,
  reason: string | null,
): Promise<PiKitAbandonOutcome> {
  return invoke<PiKitAbandonOutcome>("abandon_pi_kit_lane", { run, lane, reason });
}

/** Writes PickForge's context file (`<dataDir>/context.json`, schemaVersion
 * 1) for pi-kit's `/forge` command and `forge_context` tool to read on
 * demand — the active project root plus, optionally, the last file opened in
 * it and the project's display name. Path/identity only, never file
 * contents; the caller (the `pikitContext`-gated store) is responsible for
 * debouncing. */
export function writeForgeContext(
  projectRoot: string,
  lastOpenedFile: string | null,
  displayName: string | null,
): Promise<void> {
  return invoke<void>("write_forge_context", { projectRoot, lastOpenedFile, displayName });
}

/** Removes PickForge's context file — call when the `pikitContext` flag
 * turns off or no project is active. pi-kit's reader treats absence as a
 * normal degrade. */
export function clearForgeContext(): Promise<void> {
  return invoke<void>("clear_forge_context");
}
