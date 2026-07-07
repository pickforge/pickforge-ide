// Orchestrates the local MCP endpoint: starts the in-app socket server, keeps
// the live-state snapshot the tools gate against published from the existing
// stores, and exposes the `PICKFORGE_*` env embedded terminals inject so an
// agent can discover it. Opt-in: nothing starts until `ensureMcpRunning` runs
// (on the first run launch for a project); see `runLaunch.ts`.
import { createEffect, createSignal } from "solid-js";
import * as mcp from "../lib/mcp";
import { activeTarget } from "./runTargets";
import { selectedDevice } from "./runDevice";
import { deviceList } from "./deviceList";
import { runConsole } from "./runConsole";
import { workspace } from "./workspace";
import { supportTier } from "../lib/runTargets";

/** The resolved endpoint + storage dirs for the project the server is bound to. */
interface McpBinding {
  endpoint: string;
  projectRoot: string;
  contextDir: string;
  runsDir: string;
  chatsDir: string;
  mcpConfigPath: string;
  mcpCommand: string;
}

const [binding, setBinding] = createSignal<McpBinding | null>(null);
// The live selection (Flutter WidgetNode / UIAutomator A11yNode), set by the
// inspector panels as the selection changes; null when nothing is selected.
const [selection, setSelectionInternal] = createSignal<unknown | null>(null);

export const mcpBinding = binding;

/** Set the current inspector selection so `get_current_selection` can serve it.
 *  Called by the WidgetTree / A11yTree panels. */
export function publishMcpSelection(node: unknown | null): void {
  setSelectionInternal(node);
}

/** Start the MCP server for `projectRoot` (idempotent across projects: a second
 *  project rebinds the discovery file but reuses the one socket). Best-effort —
 *  a failure must never block a run. */
export async function ensureMcpRunning(projectRoot: string | null): Promise<void> {
  if (!projectRoot) return;
  if (binding()?.projectRoot === projectRoot) return;
  try {
    const r = await mcp.mcpStart(projectRoot);
    setBinding({
      endpoint: r.endpoint,
      projectRoot,
      contextDir: r.contextDir,
      runsDir: r.runsDir,
      chatsDir: r.chatsDir,
      mcpConfigPath: r.mcpConfigPath,
      mcpCommand: r.mcpCommand,
    });
    void publishSnapshot();
  } catch (e) {
    console.warn("[pickforge] MCP endpoint failed to start", e);
  }
}

/** Append run-console / logcat lines to the MCP run-log buffer (best effort). */
export function pushMcpLogs(lines: string[]): void {
  if (!binding() || lines.length === 0) return;
  void mcp.mcpPushLog(lines).catch(() => {});
}

/** Reset the MCP run-log ring for a new run, so `get_run_logs` never returns a
 *  previous run's lines (the stop/fix/run-again loop). Best effort. */
export function mcpRunStarted(): void {
  if (!binding()) return;
  void mcp.mcpRunStarted().catch(() => {});
}

/** The target the MCP tools should report. While a run is live, that is the
 *  *running* target (what's actually on the device) — not a launcher-dropdown
 *  change the user made mid-run. Otherwise it's the selected launcher target. */
function mcpTarget() {
  return runConsole.status() === "running" ? runConsole.target() : activeTarget();
}

/** The active run device's platform, so the Rust screenshot path picks simctl
 *  (iOS) vs adb (Android). "ios" when the selected device is a simulator, else
 *  "android" (the honest default for adb-backed and no-device runs). */
function activeDevicePlatform(projectRoot: string): "android" | "ios" {
  const key = selectedDevice(projectRoot);
  if (!key) return "android";
  const d = deviceList().find(
    (d) => d.serial === key || d.avdId === key || d.displayName === key,
  );
  return d?.kind === "simulator" ? "ios" : "android";
}

/** Push the current active-target + context snapshot to the Rust side. */
export async function publishSnapshot(): Promise<void> {
  const b = binding();
  if (!b) return;
  const t = mcpTarget();
  const activeChatId = workspace.activeRoot === b.projectRoot ? workspace.activeChatId : null;
  await mcp
    .mcpPublishState({
      targetId: t?.id ?? "",
      targetLabel: t?.label ?? "",
      capabilities: t?.capabilities ?? [],
      inspectorKind: t?.inspectorKind ?? "none",
      supportTier: supportTier(t),
      deviceSerial: selectedDevice(b.projectRoot) || null,
      devicePlatform: activeDevicePlatform(b.projectRoot),
      projectRoot: b.projectRoot,
      activeChatId,
      contextDir: b.contextDir,
      runsDir: b.runsDir,
      chatsDir: b.chatsDir,
      selection: selection(),
    })
    .catch(() => {});
}

// Re-publish whenever the reported target, run status, selection, or binding
// changes, so the MCP tools always gate against current state. Tracking the run
// status + running target keeps the snapshot on the LIVE target for a run's
// duration, then back to the launcher selection once it stops.
createEffect(() => {
  // Track the reactive inputs.
  activeTarget();
  runConsole.status();
  runConsole.target();
  selection();
  workspace.activeRoot;
  workspace.activeChatId;
  binding();
  void publishSnapshot();
});

/** The `PICKFORGE_*` env an embedded terminal injects so an agent (via the
 *  `pickforge-mcp` stdio adapter) discovers the live MCP endpoint. Empty until a
 *  run has started the server for this project. */
export function mcpEnv(projectRoot: string | null): Record<string, string> {
  const b = binding();
  if (!b || !projectRoot || b.projectRoot !== projectRoot) return {};
  const env = {
    PICKFORGE_PROJECT_ROOT: b.projectRoot,
    PICKFORGE_CONTEXT_DIR: b.contextDir,
    PICKFORGE_MCP_CONFIG: b.mcpConfigPath,
    PICKFORGE_MCP_COMMAND: b.mcpCommand,
    PICKFORGE_AGENT_BRIEF:
      "Pickforge tools are available through the pickforge MCP server. When the user asks to create, spawn, spin up, or run a swarm/sub-agents, call pickforge_start_swarm, poll pickforge_swarm_status for that run, and synthesize the completed lane results back to the user. Do not use model-orchestration skills or provider-native subagents for the same swarm unless the user explicitly asks for that fallback.",
  };
  return b.endpoint ? { PICKFORGE_IPC_ENDPOINT: b.endpoint, ...env } : env;
}
