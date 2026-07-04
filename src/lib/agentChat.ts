import { Channel, invoke } from "@tauri-apps/api/core";

export type AgentProvider = "claudeCode" | "codex";
export type AgentEngine = "v1" | "v2";
export type AgentApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface AgentSkill {
  trigger: "/" | "$";
  name: string;
  description: string;
}

export type AgentEvent =
  | { kind: "sessionStarted"; providerSessionId: string }
  | { kind: "turnStarted" }
  | { kind: "textDelta"; text: string }
  | { kind: "textFinal"; itemId: string | null; text: string }
  | { kind: "thinkingDelta"; text: string }
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

export interface AgentChatStartOptions {
  chatId: string;
  projectRoot: string;
  provider: AgentProvider;
  model?: string | null;
  effort?: string | null;
  engine?: AgentEngine;
  sandbox?: string;
  approvalPolicy?: string;
  permissionMode?: string;
  allowedTools?: string[];
  onEvent: (event: AgentEvent) => void;
}

export interface AgentChatSendOptions {
  effort?: string | null;
  model?: string | null;
  images?: string[];
}

export async function agentChatStart(opts: AgentChatStartOptions): Promise<string> {
  const onEvent = new Channel<AgentEvent>();
  onEvent.onmessage = opts.onEvent;

  return invoke<string>("agent_chat_start", {
    chatId: opts.chatId,
    projectRoot: opts.projectRoot,
    provider: opts.provider,
    model: opts.model ?? null,
    effort: opts.effort ?? null,
    engine: opts.engine ?? null,
    sandbox: opts.sandbox ?? null,
    approvalPolicy: opts.approvalPolicy ?? null,
    permissionMode: opts.permissionMode ?? null,
    allowedTools: opts.allowedTools ?? null,
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

export function agentChatHistory(chatId: string): Promise<AgentTimelineEntry[]> {
  return invoke("agent_chat_history", { chatId });
}

export function agentSkillsList(provider: AgentProvider): Promise<AgentSkill[]> {
  return invoke("agent_skills_list", { provider });
}
