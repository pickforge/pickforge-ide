import { createInterface } from "node:readline";
import { resolve, delimiter, extname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
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
  scopeKey: string;
  input: Record<string, unknown>;
  resolve: (result: PermissionResult) => void;
};

export type PermissionGate = {
  pendingApprovals: Map<string, PendingApproval>;
  alwaysAllow: Set<string>;
};

/**
 * "Allow for session" must grant exactly what the prompt showed — the same
 * command or file, not the whole tool. Tools without a command/path scope
 * fall back to tool-level granting.
 */
export function approvalScopeKey(toolName: string, input: Record<string, unknown>): string {
  const scope =
    typeof input.command === "string"
      ? input.command
      : typeof input.file_path === "string"
        ? input.file_path
        : typeof input.notebook_path === "string"
          ? input.notebook_path
          : typeof input.path === "string"
            ? input.path
            : "";
  return `${toolName}\u0000${scope}`;
}

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
/** The chat's query ended (error or close) — the chat id is gone bridge-side. */
export type ChatClosedEvent = { ev: "chatClosed"; chatId: string };
export type FatalEvent = { ev: "fatal"; chatId?: string; error: string };
export type ResponseEvent = { ev: "response"; reqId: string; data: unknown };
export type BridgeEvent =
  | StartedEvent
  | RawEvent
  | ApprovalRequestEvent
  | TurnClosedEvent
  | ChatClosedEvent
  | FatalEvent
  | ResponseEvent;

type StartCommand = {
  op: "start";
  chatId: string;
  cwd: string;
  model?: string | null;
  effort?: string | null;
  resumeSessionId?: string | null;
  permissionMode?: string;
  allowedTools?: string[];
};

type SendCommand = { op: "send"; chatId: string; text: string; images?: string[] };
type ApproveCommand = {
  op: "approve";
  chatId: string;
  requestId: string;
  decision: ApprovalDecision;
};
type InterruptCommand = { op: "interrupt"; chatId: string };
type CloseCommand = { op: "close"; chatId: string };
type SetModelCommand = { op: "setModel"; chatId: string; model?: string | null };
type SetPermissionModeCommand = { op: "setPermissionMode"; chatId: string; mode: string };
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
  | CloseCommand
  | SetModelCommand
  | SetPermissionModeCommand
  | ListSessionsCommand
  | SessionMessagesCommand
  | ShutdownCommand;

type ChatSession = {
  chatId: string;
  queue: PushableAsyncQueue<SDKUserMessage>;
  query: Query;
  gate: PermissionGate;
  mutationChain: Promise<void>;
  mutationFailure: { error: unknown } | null;
  /** The model the live query currently runs (null = CLI default). */
  model: string | null;
  /** The permission mode the live query currently runs. */
  permissionMode: PermissionMode;
};

const chats = new Map<string, ChatSession>();
const inFlightCommands = new Set<Promise<void>>();

export function createPermissionGate(): PermissionGate {
  return {
    pendingApprovals: new Map(),
    alwaysAllow: new Set(),
  };
}

type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
type ImageBlock = Extract<SDKUserMessage["message"]["content"], unknown[]>[number];

const IMAGE_MARKER_PATTERN = /\[Image #(\d+)\]/g;

function imageMediaType(path: string): ImageMediaType {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      throw new Error(`unsupported image type: ${path}`);
  }
}

function loadImageBlock(path: string): ImageBlock | null {
  if (path.trim().length === 0) return null;
  try {
    return {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: imageMediaType(path),
        data: readFileSync(path, "base64"),
      },
    };
  } catch (error) {
    writeStderr(`skipping image ${path}: ${errorMessage(error)}`);
    return null;
  }
}

function appendTextBlock(content: ImageBlock[], pendingText: { value: string }): void {
  if (pendingText.value.trim().length > 0) {
    content.push({ type: "text" as const, text: pendingText.value });
  }
  pendingText.value = "";
}

export function createUserTextMessage(
  text: string,
  images: string[] = [],
): SDKUserMessage | null {
  const imageBlocks = images.map(loadImageBlock);
  const referencedImageIndexes = new Set<number>();
  for (const match of text.matchAll(IMAGE_MARKER_PATTERN)) {
    const imageIndex = Number(match[1]) - 1;
    if (imageIndex >= 0 && imageBlocks[imageIndex]) {
      referencedImageIndexes.add(imageIndex);
    }
  }

  const content: ImageBlock[] = [];
  for (const [index, block] of imageBlocks.entries()) {
    if (block && !referencedImageIndexes.has(index)) {
      content.push(block);
    }
  }

  const pendingText = { value: "" };
  let lastIndex = 0;
  IMAGE_MARKER_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(IMAGE_MARKER_PATTERN)) {
    pendingText.value += text.slice(lastIndex, match.index);
    const imageIndex = Number(match[1]) - 1;
    const block = imageIndex >= 0 ? imageBlocks[imageIndex] : null;
    if (block) {
      appendTextBlock(content, pendingText);
      content.push(block);
    } else {
      pendingText.value += match[0];
    }
    lastIndex = match.index + match[0].length;
  }
  pendingText.value += text.slice(lastIndex);
  appendTextBlock(content, pendingText);

  if (content.length === 0) return null;

  return {
    type: "user",
    message: {
      role: "user",
      content,
    },
    parent_tool_use_id: null,
    session_id: "",
  };
}

export function permissionResultForDecision(
  decision: ApprovalDecision,
  input: Record<string, unknown>,
): PermissionResult {
  if (decision === "accept" || decision === "acceptForSession") {
    return { behavior: "allow", updatedInput: input };
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
  if (decision === "acceptForSession") gate.alwaysAllow.add(pending.scopeKey);
  pending.resolve(permissionResultForDecision(decision, pending.input));
  return true;
}

export function createPermissionHandler(
  chatId: string,
  gate: PermissionGate,
  emit: (event: BridgeEvent) => void,
): CanUseTool {
  return async (toolName, input, { toolUseID, signal }) => {
    const scopeKey = approvalScopeKey(toolName, input);
    if (gate.alwaysAllow.has(scopeKey)) return { behavior: "allow", updatedInput: input };
    if (signal.aborted) return { behavior: "deny", message: "cancelled", interrupt: true };

    return await new Promise<PermissionResult>((resolveResult) => {
      const abort = () => finish({ behavior: "deny", message: "cancelled", interrupt: true });
      const finish = (result: PermissionResult) => {
        signal.removeEventListener("abort", abort);
        gate.pendingApprovals.delete(toolUseID);
        resolveResult(result);
      };

      signal.addEventListener("abort", abort, { once: true });
      gate.pendingApprovals.set(toolUseID, { scopeKey, input, resolve: finish });
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function writeEvent(event: BridgeEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(`[claude-bridge] ${message}\n`);
}

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
type EffortLevel = (typeof EFFORT_LEVELS)[number];

function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value);
}

function resolveClaudeCli(): string | null {
  const names =
    process.platform === "win32"
      ? ["claude.cmd", "claude.exe", "claude.bat", "claude"]
      : ["claude"];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
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
  // The user's own CLI login is the product's auth model, and the compiled
  // sidecar has no bundled fallback CLI — fail loud instead of hanging.
  const cli = resolveClaudeCli();
  if (!cli) {
    throw new Error(
      "claude CLI not found on PATH — install Claude Code to use Claude chats",
    );
  }
  options.pathToClaudeCodeExecutable = cli;
  if (command.model) options.model = command.model;
  if (command.effort && isEffortLevel(command.effort)) options.effort = command.effort;
  if (command.resumeSessionId) options.resume = command.resumeSessionId;
  if (command.allowedTools) options.allowedTools = command.allowedTools;
  return options;
}

function queueModelMutation(
  chat: ChatSession,
  model: string | null,
  emit: (event: BridgeEvent) => void,
): Promise<void> {
  const previousMutation = chat.mutationChain.catch(() => undefined);
  const nextMutation = previousMutation
    .then(async () => {
      await chat.query.setModel(model ?? undefined);
      chat.model = model;
      chat.mutationFailure = null;
    })
    .catch((error: unknown) => {
      chat.mutationFailure = { error };
      emit({ ev: "fatal", chatId: chat.chatId, error: serializeError(error) });
      throw error;
    });
  let queuedMutation: Promise<void>;
  queuedMutation = nextMutation.finally(() => {
    if (chat.mutationChain === queuedMutation && chat.mutationFailure) {
      chat.mutationChain = Promise.resolve();
    }
  });
  chat.mutationChain = queuedMutation;
  return queuedMutation;
}

function queuePermissionModeMutation(
  chat: ChatSession,
  mode: PermissionMode,
  emit: (event: BridgeEvent) => void,
): Promise<void> {
  const previousMutation = chat.mutationChain.catch(() => undefined);
  const nextMutation = previousMutation
    .then(async () => {
      await chat.query.setPermissionMode(mode);
      chat.permissionMode = mode;
      chat.mutationFailure = null;
    })
    .catch((error: unknown) => {
      chat.mutationFailure = { error };
      emit({ ev: "fatal", chatId: chat.chatId, error: serializeError(error) });
      throw error;
    });
  let queuedMutation: Promise<void>;
  queuedMutation = nextMutation.finally(() => {
    if (chat.mutationChain === queuedMutation && chat.mutationFailure) {
      chat.mutationChain = Promise.resolve();
    }
  });
  chat.mutationChain = queuedMutation;
  return queuedMutation;
}

async function awaitMutationChain(chat: ChatSession): Promise<void> {
  const mutationChain = chat.mutationChain;
  try {
    await mutationChain;
  } catch (error) {
    if (chat.mutationChain === mutationChain) {
      chat.mutationChain = Promise.resolve();
    }
    if (chat.mutationFailure?.error === error) {
      chat.mutationFailure = null;
    }
    throw error;
  }
  if (chat.mutationFailure) {
    const { error } = chat.mutationFailure;
    chat.mutationFailure = null;
    throw error;
  }
}

function startChat(command: StartCommand, emit: (event: BridgeEvent) => void): void {
  const existing = chats.get(command.chatId);
  if (existing) {
    // Re-attach, not a failure: the webview reloaded (or re-ensured) while this
    // bridge kept the session alive. The query is still live — ack so the new
    // client-side sink takes over instead of failing the whole ensure. Model
    // and permission-mode changes ride along so the re-attached picker stays
    // truthful.
    const nextModel = command.model ?? null;
    if (existing.model !== nextModel) {
      void queueModelMutation(existing, nextModel, emit).catch(() => undefined);
    }
    const nextPermissionMode = (command.permissionMode || "acceptEdits") as PermissionMode;
    if (existing.permissionMode !== nextPermissionMode) {
      void queuePermissionModeMutation(existing, nextPermissionMode, emit).catch(() => undefined);
    }
    emit({ ev: "started", chatId: command.chatId });
    return;
  }

  const queue = new PushableAsyncQueue<SDKUserMessage>();
  const gate = createPermissionGate();
  const runningQuery = query({ prompt: queue, options: buildOptions(command, gate, emit) });
  const chat = {
    chatId: command.chatId,
    queue,
    query: runningQuery,
    gate,
    mutationChain: Promise.resolve(),
    mutationFailure: null,
    model: command.model ?? null,
    permissionMode: (command.permissionMode || "acceptEdits") as PermissionMode,
  };
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
    emit({ ev: "chatClosed", chatId: chat.chatId });
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
      const message = createUserTextMessage(command.text, command.images ?? []);
      if (!message) throw new Error("no sendable content: all image attachments were unreadable");
      await awaitMutationChain(chat);
      chat.queue.push(message);
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
    case "close": {
      // Idempotent: closing a chat that already died is not an error. Frees
      // the SDK query and its resident claude CLI process.
      const chat = chats.get(command.chatId);
      if (chat) closeChat(chat);
      return;
    }
    case "setModel": {
      const chat = chats.get(command.chatId);
      if (!chat) throw new Error(`unknown chat: ${command.chatId}`);
      try {
        await queueModelMutation(chat, command.model ?? null, emit);
      } catch {
        return;
      }
      return;
    }
    case "setPermissionMode": {
      const chat = chats.get(command.chatId);
      if (!chat) throw new Error(`unknown chat: ${command.chatId}`);
      try {
        await queuePermissionModeMutation(chat, command.mode as PermissionMode, emit);
      } catch {
        return;
      }
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
