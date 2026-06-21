// Orchestrates the local MCP endpoint: starts the in-app socket server, keeps
// the live-state snapshot the tools gate against published from the existing
// stores, and exposes the `PICKFORGE_*` env embedded terminals inject so an
// agent can discover it. Opt-in: nothing starts until `ensureMcpRunning` runs
// (on the first run launch for a project); see `runLaunch.ts`.
import { createEffect, createSignal } from "solid-js";
import * as mcp from "../lib/mcp";
import { activeTarget } from "./runTargets";
import { selectedDevice } from "./runDevice";
import { supportTier } from "../lib/runTargets";

/** The resolved endpoint + storage dirs for the project the server is bound to. */
interface McpBinding {
  endpoint: string;
  projectRoot: string;
  contextDir: string;
  runsDir: string;
  chatsDir: string;
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

/** Push the current active-target + context snapshot to the Rust side. */
export async function publishSnapshot(): Promise<void> {
  const b = binding();
  if (!b) return;
  const t = activeTarget();
  await mcp
    .mcpPublishState({
      targetId: t?.id ?? "",
      targetLabel: t?.label ?? "",
      capabilities: t?.capabilities ?? [],
      inspectorKind: t?.inspectorKind ?? "none",
      supportTier: supportTier(t),
      deviceSerial: selectedDevice(b.projectRoot) || null,
      projectRoot: b.projectRoot,
      contextDir: b.contextDir,
      runsDir: b.runsDir,
      chatsDir: b.chatsDir,
      selection: selection(),
    })
    .catch(() => {});
}

// Re-publish whenever the active target, selection, or binding changes, so the
// MCP tools always gate against current state.
createEffect(() => {
  // Track the reactive inputs.
  activeTarget();
  selection();
  binding();
  void publishSnapshot();
});

/** The `PICKFORGE_*` env an embedded terminal injects so an agent (via the
 *  `pickforge-mcp` stdio adapter) discovers the live MCP endpoint. Empty until a
 *  run has started the server for this project. */
export function mcpEnv(projectRoot: string | null): Record<string, string> {
  const b = binding();
  if (!b || !projectRoot || b.projectRoot !== projectRoot) return {};
  return {
    PICKFORGE_IPC_ENDPOINT: b.endpoint,
    PICKFORGE_PROJECT_ROOT: b.projectRoot,
    PICKFORGE_CONTEXT_DIR: b.contextDir,
  };
}
