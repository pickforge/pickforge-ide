import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getSessionMessages,
  listSessions,
  query,
  type CanUseTool,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

export class PushableAsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) throw new Error("queue is closed");
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ done: false, value: item });
      return;
    }
    this.items.push(item);
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
    };
  }

  private next(): Promise<IteratorResult<T>> {
    if (this.items.length > 0) return Promise.resolve({ done: false, value: this.items.shift()! });
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolveNext) => this.waiters.push(resolveNext));
  }
}

export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type PendingApproval = {
  toolName: string;
  resolve: (result: PermissionResult) => void;
};

export type PermissionGate = {
  pendingApprovals: Map<string, PendingApproval>;
  alwaysAllow: Set<string>;
};

export type StartedEvent = { ev: "started"; chatId: string };
export type RawEvent = { ev: "raw"; chatId: string; message: SDKMessage };
export type ApprovalRequestEvent = {
  ev: "approvalRequest";
  chatId: string;
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
};
export type TurnClosedEvent = { ev: "turnClosed"; chatId: string };
export type FatalEvent = { ev: "fatal"; chatId?: string; error: string };
export type ResponseEvent = { ev: "response"; reqId: string; data: unknown };
export type BridgeEvent =
  | StartedEvent
  | RawEvent
  | ApprovalRequestEvent
  | TurnClosedEvent
  | FatalEvent
  | ResponseEvent;

type StartCommand = {
  op: "start";
  chatId: string;
  cwd: string;
  model?: string | null;
  resumeSessionId?: string | null;
  permissionMode?: string;
  allowedTools?: string[];
};

type SendCommand = { op: "send"; chatId: string; text: string };
type ApproveCommand = {
  op: "approve";
  chatId: string;
  requestId: string;
  decision: ApprovalDecision;
};
type InterruptCommand = { op: "interrupt"; chatId: string };
type ListSessionsCommand = { op: "listSessions"; reqId: string; cwd: string };
type SessionMessagesCommand = {
  op: "sessionMessages";
  reqId: string;
  sessionId: string;
  cwd: string;
};
type ShutdownCommand = { op: "shutdown" };
export type ParentCommand =
  | StartCommand
  | SendCommand
  | ApproveCommand
  | InterruptCommand
  | ListSessionsCommand
  | SessionMessagesCommand
  | ShutdownCommand;

type ChatSession = {
  chatId: string;
  queue: PushableAsyncQueue<SDKUserMessage>;
  query: Query;
  gate: PermissionGate;
};

const chats = new Map<string, ChatSession>();
const inFlightCommands = new Set<Promise<void>>();

export function createPermissionGate(): PermissionGate {
  return {
    pendingApprovals: new Map(),
    alwaysAllow: new Set(),
  };
}

export function createUserTextMessage(text: string): SDKUserMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
    parent_tool_use_id: null,
    session_id: "",
  };
}

export function permissionResultForDecision(decision: ApprovalDecision): PermissionResult {
  if (decision === "accept" || decision === "acceptForSession") {
    return { behavior: "allow" };
  }
  if (decision === "decline") {
    return { behavior: "deny", message: "denied by user" };
  }
  return { behavior: "deny", message: "cancelled", interrupt: true };
}

export function resolveApprovalDecision(
  gate: PermissionGate,
  requestId: string,
  decision: ApprovalDecision,
): boolean {
  const pending = gate.pendingApprovals.get(requestId);
  if (!pending) return false;
  if (decision === "acceptForSession") gate.alwaysAllow.add(pending.toolName);
  pending.resolve(permissionResultForDecision(decision));
  return true;
}

export function createPermissionHandler(
  chatId: string,
  gate: PermissionGate,
  emit: (event: BridgeEvent) => void,
): CanUseTool {
  return async (toolName, input, { toolUseID, signal }) => {
    if (gate.alwaysAllow.has(toolName)) return { behavior: "allow" };
    if (signal.aborted) return { behavior: "deny", message: "cancelled", interrupt: true };

    return await new Promise<PermissionResult>((resolveResult) => {
      const abort = () => finish({ behavior: "deny", message: "cancelled", interrupt: true });
      const finish = (result: PermissionResult) => {
        signal.removeEventListener("abort", abort);
        gate.pendingApprovals.delete(toolUseID);
        resolveResult(result);
      };

      signal.addEventListener("abort", abort, { once: true });
      gate.pendingApprovals.set(toolUseID, { toolName, resolve: finish });
      emit({ ev: "approvalRequest", chatId, requestId: toolUseID, toolName, input });
    });
  };
}

export function resetBridgeStateForTests(): void {
  for (const chat of [...chats.values()]) {
    closeChat(chat);
  }
  chats.clear();
  inFlightCommands.clear();
}

export function serializeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

export function writeEvent(event: BridgeEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(`[claude-bridge] ${message}\n`);
}

function buildOptions(
  command: StartCommand,
  gate: PermissionGate,
  emit: (event: BridgeEvent) => void,
): Options {
  const options: Options = {
    cwd: command.cwd,
    permissionMode: (command.permissionMode || "acceptEdits") as PermissionMode,
    includePartialMessages: true,
    canUseTool: createPermissionHandler(command.chatId, gate, emit),
  };
  if (command.model) options.model = command.model;
  if (command.resumeSessionId) options.resume = command.resumeSessionId;
  if (command.allowedTools) options.allowedTools = command.allowedTools;
  return options;
}

function startChat(command: StartCommand, emit: (event: BridgeEvent) => void): void {
  if (chats.has(command.chatId)) {
    throw new Error(`chat already started: ${command.chatId}`);
  }

  const queue = new PushableAsyncQueue<SDKUserMessage>();
  const gate = createPermissionGate();
  const runningQuery = query({ prompt: queue, options: buildOptions(command, gate, emit) });
  const chat = { chatId: command.chatId, queue, query: runningQuery, gate };
  chats.set(command.chatId, chat);
  emit({ ev: "started", chatId: command.chatId });
  void consumeChat(chat, emit);
}

async function consumeChat(
  chat: ChatSession,
  emit: (event: BridgeEvent) => void,
): Promise<void> {
  try {
    for await (const message of chat.query) {
      emit({ ev: "raw", chatId: chat.chatId, message });
    }
    emit({ ev: "turnClosed", chatId: chat.chatId });
  } catch (error) {
    emit({ ev: "fatal", chatId: chat.chatId, error: serializeError(error) });
  } finally {
    chat.queue.end();
    closePendingApprovals(chat.gate, "query closed");
    chats.delete(chat.chatId);
  }
}

function closePendingApprovals(gate: PermissionGate, message: string): void {
  for (const pending of [...gate.pendingApprovals.values()]) {
    pending.resolve({ behavior: "deny", message, interrupt: true });
  }
}

function closeChat(chat: ChatSession): void {
  chat.queue.end();
  closePendingApprovals(chat.gate, "shutdown");
  try {
    chat.query.close();
  } catch (error) {
    writeStderr(serializeError(error));
  }
}

function chatIdFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("chatId" in value)) return undefined;
  const chatId = (value as { chatId?: unknown }).chatId;
  return typeof chatId === "string" ? chatId : undefined;
}

async function handleCommand(
  command: ParentCommand,
  emit: (event: BridgeEvent) => void,
): Promise<void> {
  switch (command.op) {
    case "start":
      startChat(command, emit);
      return;
    case "send": {
      const chat = chats.get(command.chatId);
      if (!chat) throw new Error(`unknown chat: ${command.chatId}`);
      chat.queue.push(createUserTextMessage(command.text));
      return;
    }
    case "approve": {
      const chat = chats.get(command.chatId);
      if (!chat) throw new Error(`unknown chat: ${command.chatId}`);
      if (!resolveApprovalDecision(chat.gate, command.requestId, command.decision)) {
        writeStderr(`unknown approval request ${command.requestId} for chat ${command.chatId}`);
      }
      return;
    }
    case "interrupt": {
      const chat = chats.get(command.chatId);
      if (!chat) throw new Error(`unknown chat: ${command.chatId}`);
      await chat.query.interrupt();
      return;
    }
    case "listSessions": {
      const data = await listSessions({ dir: command.cwd });
      emit({ ev: "response", reqId: command.reqId, data });
      return;
    }
    case "sessionMessages": {
      const data = await getSessionMessages(command.sessionId, { dir: command.cwd });
      emit({ ev: "response", reqId: command.reqId, data });
      return;
    }
    case "shutdown":
      shutdown();
      return;
    default:
      throw new Error(`unknown op: ${(command as { op?: unknown }).op}`);
  }
}

export function dispatchCommand(
  command: ParentCommand,
  emit: (event: BridgeEvent) => void = writeEvent,
): void {
  if (command.op === "shutdown") {
    shutdown();
  }

  const task = handleCommand(command, emit).catch((error: unknown) => {
    emit({ ev: "fatal", chatId: chatIdFrom(command), error: serializeError(error) });
  });
  inFlightCommands.add(task);
  void task.finally(() => inFlightCommands.delete(task));
}

function shutdown(): never {
  for (const chat of [...chats.values()]) {
    closeChat(chat);
  }
  process.exit(0);
}

export async function runBridge(): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
        dispatchCommand(parsed as ParentCommand);
      } catch (error) {
        writeEvent({ ev: "fatal", chatId: chatIdFrom(parsed), error: serializeError(error) });
      }
    }
  } finally {
    for (const chat of [...chats.values()]) {
      closeChat(chat);
    }
  }
}

function isMainModule(): boolean {
  const script = process.argv[1];
  return script ? resolve(script) === fileURLToPath(import.meta.url) : false;
}

if (isMainModule()) {
  runBridge().catch((error: unknown) => {
    writeEvent({ ev: "fatal", error: serializeError(error) });
    process.exitCode = 1;
  });
}
