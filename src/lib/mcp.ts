// Typed client for the local MCP endpoint commands (see
// `src-tauri/src/mcp_commands.rs`). The endpoint is a Unix socket the embedded
// agent reaches through the `pickforge-mcp` stdio adapter; these calls start it,
// publish the live-state snapshot the tools gate against, and feed run logs.
import { invoke } from "@tauri-apps/api/core";

/** The active-target + context snapshot the MCP tools read. camelCase to match
 *  the Rust `PublishedState` deserializer. */
export interface McpPublishedState {
  targetId: string;
  targetLabel: string;
  capabilities: string[];
  inspectorKind: string;
  supportTier: string;
  deviceSerial?: string | null;
  /** The active run device's platform, so screenshot capture picks simctl vs
   *  adb. Defaults to "android" on the Rust side when omitted. */
  devicePlatform?: "android" | "ios";
  projectRoot?: string | null;
  activeChatId?: string | null;
  contextDir?: string | null;
  runsDir?: string | null;
  chatsDir?: string | null;
  /** The live selection (Flutter WidgetNode or UIAutomator A11yNode), or null. */
  selection?: unknown | null;
}

/** The live endpoint + resolved storage dirs returned by `mcp_start`. */
export interface McpStartResult {
  endpoint: string;
  contextDir: string;
  runsDir: string;
  chatsDir: string;
  mcpConfigPath: string;
  mcpCommand: string;
}

export interface SwarmRequest {
  runId: string;
  projectRoot: string;
  goal: string;
  count: number;
  model: string | null;
  providerPreference: "auto" | "mixed" | "claudeCode" | "codex";
  mode: "scout" | "review";
  source: string;
  originChatId: string | null;
  createdAt: number;
}

export interface SwarmLaneSnapshot {
  id: string;
  chatId: string | null;
  provider: string;
  model: string | null;
  title: string;
  status: "queued" | "starting" | "running" | "completed" | "failed" | "cancelled";
  summary: string | null;
  error: string | null;
  updatedAt: number;
}

export interface SwarmRunSnapshot {
  runId: string;
  projectRoot: string;
  goal: string;
  requestedCount: number;
  model: string | null;
  providerPreference: string;
  mode: "scout" | "review";
  source: string;
  originChatId: string | null;
  status: "queued" | "starting" | "running" | "completed" | "failed" | "cancelled";
  synthesisStatus: "idle" | "pending" | "sent" | "failed";
  synthesisError: string | null;
  synthesizedAt: number | null;
  lanes: SwarmLaneSnapshot[];
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Start the MCP socket server for `projectRoot` (idempotent). Resolves storage,
 *  writes the discovery file, and returns the endpoint + storage dirs. */
export function mcpStart(projectRoot: string): Promise<McpStartResult> {
  return invoke<McpStartResult>("mcp_start", { projectRoot });
}

/** Stop the MCP server and remove its socket. */
export function mcpStop(): Promise<void> {
  return invoke("mcp_stop");
}

/** Publish the active-target / context snapshot the tools gate against. */
export function mcpPublishState(snapshot: McpPublishedState): Promise<void> {
  return invoke("mcp_publish_state", { snapshot });
}

/** Append run-console / logcat lines to the MCP run-log ring buffer. */
export function mcpPushLog(lines: string[]): Promise<void> {
  return invoke("mcp_push_log", { lines });
}

/** Reset the run-log ring at the start of a new run so `get_run_logs` never
 *  mixes a previous run's lines into the fresh one. */
export function mcpRunStarted(): Promise<void> {
  return invoke("mcp_run_started");
}

export function mcpTakeSwarmRequests(): Promise<SwarmRequest[]> {
  return invoke<SwarmRequest[]>("mcp_take_swarm_requests");
}

export function mcpUpdateSwarmRun(run: SwarmRunSnapshot): Promise<void> {
  return invoke("mcp_update_swarm_run", { run });
}

export function mcpSwarmStatus(
  projectRoot: string | null,
  runId: string | null = null,
): Promise<SwarmRunSnapshot | { runs: SwarmRunSnapshot[] }> {
  return invoke("mcp_swarm_status", { projectRoot, runId });
}
