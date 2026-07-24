import { Channel, invoke } from "@tauri-apps/api/core";
import {
  nativeChatUnavailableReason,
  normalizeAgentProvider,
  type AgentEngine,
  type AgentProvider,
} from "./agentBackends";
import { flagEnabled } from "../stores/flags";
import {
  ensureOmpNativeCompatibility,
  ensurePiNativeCompatibility,
  ompNativeChatAvailable,
  piNativeChatAvailable,
} from "./agentModels";
import { ensureMcpRunning, mcpEnv } from "../stores/mcp";
import type { RemotePty } from "./pty";

export type { AgentEngine, AgentProvider } from "./agentBackends";
export type AgentApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface AgentSkill {
  trigger: "/" | "$";
  name: string;
  description: string;
}

export type AgentEvent =
  | { kind: "sessionStarted"; providerSessionId: string }
  | {
      kind: "sessionUpdated";
      providerSessionId: string | null;
      sessionFile: string | null;
      title: string | null;
      model: string | null;
      thinkingLevel: string | null;
    }
  | { kind: "providerEvent"; provider: string; payload: string }
  | { kind: "turnStarted" }
  | { kind: "textDelta"; itemId?: string | null; text: string }
  | { kind: "textFinal"; itemId: string | null; text: string }
  | { kind: "thinkingDelta"; itemId?: string | null; text: string }
  | { kind: "thinkingFinal"; itemId: string | null; text: string }
  | { kind: "commandStarted"; itemId: string; command: string; cwd: string | null }
  | {
      kind: "commandOutput";
      itemId: string;
      chunk: string;
    }
  | {
      kind: "commandDone";
      itemId: string;
      exitCode: number | null;
      status: "completed" | "failed" | "interrupted";
      outputTail: string | null;
    }
  | {
      kind: "fileChange";
      itemId: string;
      changes: {
        path: string;
        kind: "add" | "modify" | "delete" | "rename";
        diff: string | null;
      }[];
    }
  | {
      kind: "mcpToolCall";
      itemId: string;
      server: string;
      tool: string;
      status: "inProgress" | "completed" | "failed";
      detail: string | null;
    }
  | { kind: "webSearch"; itemId: string; query: string }
  | {
      kind: "toolUse";
      itemId: string;
      name: string;
      status: "inProgress" | "completed" | "failed";
      detail: string | null;
    }
  | { kind: "planUpdate"; items: { text: string; completed: boolean }[] }
  | {
      kind: "usage";
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      costUsd: number | null;
      contextUsed?: number | null;
      contextWindow?: number | null;
      /** Persisted rows carry the model that served the turn. */
      model?: string | null;
    }
  | { kind: "rateLimits"; payload: string }
  | { kind: "turnDone"; status: "completed" | "interrupted" }
  | { kind: "turnFailed"; error: string }
  | { kind: "sessionTitle"; title: string }
  | { kind: "providerPayload"; provider: string; method: string; payload: unknown }
  | { kind: "noise"; line: string }
  | {
      kind: "approvalRequest";
      approvalId: string;
      approvalKind: "command" | "fileChange" | "toolUse";
      detail: string;
    };

export type AgentTimelineEntry =
  | {
      entryType: "message";
      seq: number;
      role: "user" | "assistant";
      content: string;
      createdAt: number;
    }
  | {
      entryType: "item";
      seq: number;
      kind: string;
      payload: string;
      createdAt: number;
    };

export type AgentMcpServer =
  | {
      name: string;
      type?: "stdio";
      command: string;
      args?: string[];
      env?: { name: string; value: string }[];
    }
  | {
      name: string;
      type: "http" | "sse";
      url: string;
      headers?: { name: string; value: string }[];
    };

export interface AgentChatStartOptions {
  chatId: string;
  projectRoot: string;
  provider: string;
  model?: string | null;
  effort?: string | null;
  engine?: AgentEngine;
  sandbox?: string;
  approvalPolicy?: string;
  permissionMode?: string;
  allowedTools?: string[];
  remote?: RemotePty | null;
  mcpServers?: AgentMcpServer[];
  onEvent: (event: AgentEvent) => void;
}

export interface AgentChatSendOptions {
  effort?: string | null;
  model?: string | null;
  images?: string[];
}

function pickforgeMcpGrant(projectRoot: string): AgentMcpServer | null {
  const env = mcpEnv(projectRoot);
  const command = env.PICKFORGE_MCP_COMMAND?.trim();
  const endpoint = env.PICKFORGE_IPC_ENDPOINT?.trim();
  if (!command || !endpoint) return null;
  return {
    name: "pickforge",
    type: "stdio",
    command,
    args: [],
    env: Object.entries(env)
      .filter(([, value]) => value.trim().length > 0)
      .map(([name, value]) => ({ name, value })),
  };
}

async function ompMcpServers(opts: AgentChatStartOptions): Promise<AgentMcpServer[]> {
  const configured = opts.mcpServers ?? [];
  await ensureMcpRunning(opts.projectRoot);
  const grant = pickforgeMcpGrant(opts.projectRoot);
  if (!grant || configured.some((server) => server.name === grant.name)) return configured;
  return [...configured, grant];
}


// eslint-disable-next-line complexity -- TODO(#263): reduce legacy function complexity.
export async function agentChatStart(opts: AgentChatStartOptions): Promise<string> {
  const provider = normalizeAgentProvider(opts.provider);
  const engine = opts.engine ?? "v2";
  if (provider === "omp" && flagEnabled("ompAgents")) {
    await ensureOmpNativeCompatibility();
  } else if (provider === "pi") {
    await ensurePiNativeCompatibility();
  }
  if (
    !provider
    || (provider === "omp" && !ompNativeChatAvailable())
    || (provider === "pi" && !piNativeChatAvailable())
    || nativeChatUnavailableReason(provider ?? opts.provider, engine)
  ) {
    throw new Error(
      provider === "omp" && !ompNativeChatAvailable()
        ? "OMP native chat requires the ompAgents flag and compatible OMP >=17.1.1 and <18.0.0 probe"
        : provider === "pi" && !piNativeChatAvailable()
          ? "Pi native chat requires compatible Pi >=0.79.10 and <0.82.0"
          : (nativeChatUnavailableReason(provider ?? opts.provider, engine)
              ?? "Agent backend does not support native chat"),
    );
  }
  const mcpServers = provider === "omp" ? await ompMcpServers(opts) : (opts.mcpServers ?? []);
  const onEvent = new Channel<AgentEvent>();
  onEvent.onmessage = opts.onEvent;

  return invoke<string>("agent_chat_start", {
    chatId: opts.chatId,
    projectRoot: opts.projectRoot,
    provider,
    model: opts.model ?? null,
    effort: opts.effort ?? null,
    engine: opts.engine ?? null,
    sandbox: opts.sandbox ?? null,
    approvalPolicy: opts.approvalPolicy ?? null,
    permissionMode: opts.permissionMode ?? null,
    allowedTools: opts.allowedTools ?? null,
    mcpServers,
    remote: opts.remote ?? null,
    onEvent,
  });
}

export function agentChatSend(
  sessionId: string,
  text: string,
  opts: AgentChatSendOptions = {},
): Promise<void> {
  return invoke("agent_chat_send", {
    sessionId,
    text,
    effort: opts.effort ?? null,
    model: opts.model ?? null,
    images: opts.images ?? [],
  });
}

export function agentStashImage(dataBase64: string, ext: string): Promise<string> {
  return invoke<string>("agent_stash_image", { dataBase64, ext });
}

export function agentStashClipboardImage(): Promise<string> {
  return invoke<string>("agent_stash_clipboard_image");
}

export function agentStashImageFromPath(path: string): Promise<string> {
  return invoke<string>("agent_stash_image_from_path", { path });
}

export function agentClipboardText(): Promise<string> {
  return invoke<string>("agent_clipboard_text");
}

export function agentClipboardFilePaths(): Promise<string[]> {
  return invoke<string[]>("agent_clipboard_file_paths");
}

/** The `model_reasoning_effort` override from ~/.codex/config.toml, if set. */
export function codexConfigDefaultEffort(): Promise<string | null> {
  return invoke<string | null>("codex_config_default_effort");
}

export function agentChatSetModel(
  sessionId: string,
  model: string | null,
): Promise<void> {
  return invoke("agent_chat_set_model", { sessionId, model });
}

export function agentChatSetMode(
  sessionId: string,
  overrides: { sandbox?: string; approvalPolicy?: string; permissionMode?: string },
): Promise<void> {
  return invoke("agent_chat_set_mode", {
    sessionId,
    sandbox: overrides.sandbox ?? null,
    approvalPolicy: overrides.approvalPolicy ?? null,
    permissionMode: overrides.permissionMode ?? null,
  });
}

export function agentChatInterrupt(sessionId: string): Promise<void> {
  return invoke("agent_chat_interrupt", { sessionId });
}

/** Release the session's provider resources (bridge chat / thread subscription). */
export function agentChatDispose(sessionId: string): Promise<void> {
  return invoke("agent_chat_dispose", { sessionId });
}

export function agentChatApprove(
  sessionId: string,
  approvalId: string,
  decision: AgentApprovalDecision,
): Promise<void> {
  return invoke("agent_chat_approve", { sessionId, approvalId, decision });
}

export function agentChatSteer(sessionId: string, text: string): Promise<void> {
  return invoke("agent_chat_steer", { sessionId, text });
}

export function agentChatFollowUp(sessionId: string, text: string): Promise<void> {
  return invoke("agent_chat_follow_up", { sessionId, text });
}

export function agentChatHistory(chatId: string): Promise<AgentTimelineEntry[]> {
  return invoke("agent_chat_history", { chatId });
}

export function agentSkillsList(provider: AgentProvider): Promise<AgentSkill[]> {
  return invoke("agent_skills_list", { provider });
}
