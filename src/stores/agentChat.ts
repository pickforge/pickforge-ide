import { createStore, produce } from "solid-js/store";
import {
  agentChatApprove,
  agentChatHistory,
  agentChatDispose,
  agentChatInterrupt,
  agentChatSend,
  agentChatSetModel,
  agentChatStart,
  agentChatSteer,
  type AgentApprovalDecision,
  type AgentEngine,
  type AgentEvent,
  type AgentProvider,
  type AgentTimelineEntry,
} from "../lib/agentChat";
import { deriveAgentChatTitle, isDefaultChatTitle } from "../lib/chatAutoName";
import { estimateCostUsd } from "../lib/agentPricing";
import { loadAgentEngine } from "../lib/chatDefaults";
import { agentTurnCleared, agentTurnDone, agentTurnStarted } from "./chatActivity";
import { isChatArchived } from "./chatArchive";
import { findChat, setChatAgent, setChatTitle } from "./workspace";

export type AgentTimelineItem =
  | { type: "userMessage"; seq: number; text: string; images?: string[]; optimistic?: boolean }
  | { type: "assistantText"; seq: number; text: string; streaming: boolean }
  | { type: "thinking"; seq: number; text: string; streaming: boolean }
  | {
      type: "command";
      seq: number;
      itemId: string;
      command: string;
      status: "running" | "completed" | "failed" | "interrupted";
      exitCode: number | null;
      outputTail: string | null;
    }
  | {
      type: "fileChange";
      seq: number;
      itemId: string;
      changes: { path: string; kind: string; diff: string | null }[];
    }
  | { type: "toolUse"; seq: number; itemId: string; name: string; detail: string | null }
  | { type: "mcpToolCall"; seq: number; itemId: string; server: string; tool: string }
  | { type: "webSearch"; seq: number; itemId: string; query: string }
  | { type: "plan"; seq: number; items: { text: string; completed: boolean }[] }
  | {
      type: "usage";
      seq: number;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      costUsd: number | null;
      estimatedCostUsd: number | null;
    };

export type AgentApproval = {
  approvalId: string;
  kind: "command" | "fileChange" | "toolUse";
  detail: string;
  parsed?: {
    command?: string;
    cwd?: string;
    reason?: string;
    toolName?: string;
  };
};

export type AgentChatTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
  estimated: boolean;
};

// Last cumulative usage snapshot (providers that report contextUsed send
// running totals, not per-turn deltas). Kept on the chat so totals accumulate
// positive deltas across provider-side thread restarts, which RESET the running
// counters — assign-semantics would silently drop everything before the reset.
type CumulativeUsageSnapshot = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export interface AgentChatState {
  sessionId: string | null;
  projectRoot: string | null;
  provider: AgentProvider;
  model: string | null;
  effort: string | null;
  providerSwitched: boolean;
  turnActive: boolean;
  error: string | null;
  timeline: AgentTimelineItem[];
  approvals: AgentApproval[];
  contextUsed: number | null;
  contextWindow: number | null;
  rateLimits: string | null;
  totals: AgentChatTotals;
  cumulativeUsage: CumulativeUsageSnapshot | null;
  historyLoaded: boolean;
}

const [chats, setChats] = createStore<Record<string, AgentChatState>>({});
const nextSeqByChat = new Map<string, number>();
const ensurePromises = new Map<string, Promise<void>>();
const pendingSetModelByChat = new Map<string, Promise<void>>();
// Bumped by disposeAgentChat to invalidate in-flight ensures for a chat.
const ensureGenerations = new Map<string, number>();
const autoRenameChecked = new Set<string>();

// Chats whose active turn the user just interrupted: the backend still emits
// the terminal turnDone/turnFailed, which must clear the busy glow WITHOUT
// chiming — the user was right here when they stopped it. Consumed by the next
// terminal event; a fresh turnStarted drops a stale flag.
const interruptedByUser = new Set<string>();

// Mirror of the pty invariant: an archived chat renders no busy/attention
// state anywhere, and a deleted chat must never have activity resurrected by a
// late event.
function activityEligible(chatId: string): boolean {
  return findChat(chatId) !== undefined && !isChatArchived(chatId);
}

export function agentChat(chatId: string): AgentChatState | undefined {
  return chats[chatId];
}

export interface EnsureAgentChatOptions {
  engine?: AgentEngine;
  /** Seeds the chat's effort; claude bridge sessions apply it at start. */
  effort?: string | null;
  sandbox?: string;
  approvalPolicy?: string;
  permissionMode?: string;
  allowedTools?: string[];
}

function emptyState(provider: AgentProvider, model: string | null): AgentChatState {
  return {
    sessionId: null,
    projectRoot: null,
    provider,
    model,
    effort: null,
    providerSwitched: false,
    turnActive: false,
    error: null,
    timeline: [],
    approvals: [],
    contextUsed: null,
    contextWindow: null,
    rateLimits: null,
    totals: emptyTotals(),
    cumulativeUsage: null,
    historyLoaded: false,
  };
}

function emptyTotals(): AgentChatTotals {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    estimated: false,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendOptimisticUserMessage(
  chatId: string,
  seq: number,
  text: string,
  images: string[] = [],
) {
  const chat = chats[chatId];
  if (!chat) return;
  const message: AgentTimelineItem =
    images.length > 0
      ? { type: "userMessage", seq, text, images: [...images], optimistic: true }
      : { type: "userMessage", seq, text, optimistic: true };
  setChats(chatId, {
    turnActive: true,
    error: null,
    timeline: [...chat.timeline, message],
  });
}

function takeSeq(chatId: string): number {
  const seq = nextSeqByChat.get(chatId) ?? 1;
  nextSeqByChat.set(chatId, seq + 1);
  return seq;
}

function withTimeline(chat: AgentChatState, timeline: AgentTimelineItem[]): AgentChatState {
  return { ...chat, timeline };
}

function isBlankText(text: string): boolean {
  return text.trim().length === 0;
}

function lastPlanIndex(timeline: AgentTimelineItem[]): number {
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i].type === "plan") return i;
  }
  return -1;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringProp(record: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function parseApprovalDetail(detail: string): AgentApproval["parsed"] | undefined {
  let value: unknown;
  try {
    value = JSON.parse(detail);
  } catch {
    return undefined;
  }

  const record = asRecord(value);
  if (!record) return undefined;

  const input = asRecord(record.input);
  const parsed: AgentApproval["parsed"] = {};
  const command = stringProp(record, ["command"]) ?? stringProp(input, ["command"]);
  const cwd = stringProp(record, ["cwd"]) ?? stringProp(input, ["cwd"]);
  const reason = stringProp(record, ["reason"]) ?? stringProp(input, ["reason"]);
  const toolName =
    stringProp(record, ["toolName", "tool_name", "name"]) ??
    stringProp(input, ["toolName", "tool_name", "name"]);

  if (command) parsed.command = command;
  if (cwd) parsed.cwd = cwd;
  if (reason) parsed.reason = reason;
  if (toolName) parsed.toolName = toolName;

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function approvalFromEvent(
  event: Extract<AgentEvent, { kind: "approvalRequest" }>,
): AgentApproval {
  const parsed = parseApprovalDetail(event.detail);
  const approval: AgentApproval = {
    approvalId: event.approvalId,
    kind: event.approvalKind,
    detail: event.detail,
  };
  if (parsed) approval.parsed = parsed;
  return approval;
}

function finalizeStreaming(chat: AgentChatState): AgentChatState {
  let changed = false;
  const timeline: AgentTimelineItem[] = [];
  for (const item of chat.timeline) {
    if (item.type === "thinking" && item.streaming && isBlankText(item.text)) {
      changed = true;
      continue;
    }
    if ((item.type === "assistantText" || item.type === "thinking") && item.streaming) {
      changed = true;
      timeline.push({ ...item, streaming: false });
      continue;
    }
    timeline.push(item);
  }
  return changed ? withTimeline(chat, timeline) : chat;
}

function reduceTextDelta(
  chat: AgentChatState,
  text: string,
  nextSeq: () => number,
): AgentChatState {
  const last = chat.timeline[chat.timeline.length - 1];
  if (last?.type === "assistantText" && last.streaming) {
    const timeline = chat.timeline.slice();
    timeline[timeline.length - 1] = { ...last, text: `${last.text}${text}` };
    return withTimeline(chat, timeline);
  }
  return withTimeline(chat, [
    ...chat.timeline,
    { type: "assistantText", seq: nextSeq(), text, streaming: true },
  ]);
}

function reduceTextFinal(
  chat: AgentChatState,
  text: string,
  nextSeq: () => number,
): AgentChatState {
  const last = chat.timeline[chat.timeline.length - 1];
  if (last?.type === "assistantText" && last.streaming) {
    const timeline = chat.timeline.slice();
    timeline[timeline.length - 1] = { ...last, text, streaming: false };
    return withTimeline(chat, timeline);
  }
  return withTimeline(chat, [
    ...chat.timeline,
    { type: "assistantText", seq: nextSeq(), text, streaming: false },
  ]);
}

function reduceThinkingDelta(
  chat: AgentChatState,
  text: string,
  nextSeq: () => number,
): AgentChatState {
  const last = chat.timeline[chat.timeline.length - 1];
  if (last?.type === "thinking" && last.streaming) {
    const timeline = chat.timeline.slice();
    timeline[timeline.length - 1] = { ...last, text: `${last.text}${text}` };
    return withTimeline(chat, timeline);
  }
  return withTimeline(chat, [
    ...chat.timeline,
    { type: "thinking", seq: nextSeq(), text, streaming: true },
  ]);
}

function reduceThinkingFinal(
  chat: AgentChatState,
  text: string,
  nextSeq: () => number,
): AgentChatState {
  const blank = isBlankText(text);
  const last = chat.timeline[chat.timeline.length - 1];
  if (last?.type === "thinking" && last.streaming) {
    const timeline = chat.timeline.slice();
    if (blank) {
      if (isBlankText(last.text)) timeline.pop();
      else timeline[timeline.length - 1] = { ...last, streaming: false };
    } else {
      timeline[timeline.length - 1] = { ...last, text, streaming: false };
    }
    return withTimeline(chat, timeline);
  }
  if (blank) return chat;
  return withTimeline(chat, [
    ...chat.timeline,
    { type: "thinking", seq: nextSeq(), text, streaming: false },
  ]);
}

function reduceUsageEvent(
  chat: AgentChatState,
  event: Extract<AgentEvent, { kind: "usage" }>,
  nextSeq: () => number,
): AgentChatState {
  const estimatedCostUsd =
    event.costUsd === null
      ? estimateCostUsd(event.model ?? chat.model, {
          inputTokens: event.inputTokens,
          cachedInputTokens: event.cachedInputTokens,
          outputTokens: event.outputTokens,
        })
      : null;
  const costUsd = event.costUsd ?? estimatedCostUsd ?? 0;
  const contextUsed = event.contextUsed === undefined ? chat.contextUsed : event.contextUsed;
  const contextWindow =
    event.contextWindow === undefined ? chat.contextWindow : event.contextWindow;
  const cumulative = event.contextUsed != null;
  let totals: AgentChatTotals;
  let cumulativeUsage = chat.cumulativeUsage;
  if (cumulative) {
    // Positive-delta semantics: each field grows by what the running counter
    // gained since the last snapshot. A counter that DECREASED means the
    // provider thread restarted — count the new value as a fresh run's start.
    const snapshot: CumulativeUsageSnapshot = {
      inputTokens: event.inputTokens,
      cachedInputTokens: event.cachedInputTokens,
      outputTokens: event.outputTokens,
      costUsd,
    };
    const previous = chat.cumulativeUsage;
    const gained = (current: number, before: number) =>
      current >= before ? current - before : current;
    totals = {
      inputTokens:
        chat.totals.inputTokens + gained(snapshot.inputTokens, previous?.inputTokens ?? 0),
      cachedInputTokens:
        chat.totals.cachedInputTokens +
        gained(snapshot.cachedInputTokens, previous?.cachedInputTokens ?? 0),
      outputTokens:
        chat.totals.outputTokens + gained(snapshot.outputTokens, previous?.outputTokens ?? 0),
      costUsd: chat.totals.costUsd + gained(snapshot.costUsd, previous?.costUsd ?? 0),
      estimated: chat.totals.estimated || event.costUsd == null,
    };
    cumulativeUsage = snapshot;
  } else {
    totals = {
      inputTokens: chat.totals.inputTokens + event.inputTokens,
      cachedInputTokens: chat.totals.cachedInputTokens + event.cachedInputTokens,
      outputTokens: chat.totals.outputTokens + event.outputTokens,
      costUsd: chat.totals.costUsd + costUsd,
      estimated: chat.totals.estimated || estimatedCostUsd !== null,
    };
  }

  return withTimeline(
    {
      ...chat,
      contextUsed,
      contextWindow,
      totals,
      cumulativeUsage,
    },
    [
      ...chat.timeline,
      {
        type: "usage",
        seq: nextSeq(),
        inputTokens: event.inputTokens,
        cachedInputTokens: event.cachedInputTokens,
        outputTokens: event.outputTokens,
        costUsd: event.costUsd,
        estimatedCostUsd,
      },
    ],
  );
}

function reduceAgentEvent(
  chat: AgentChatState,
  event: AgentEvent,
  nextSeq: () => number,
): AgentChatState {
  switch (event.kind) {
    case "sessionStarted":
      return chat;
    case "turnStarted":
      return { ...chat, turnActive: true, error: null, providerSwitched: false };
    case "textDelta":
      return reduceTextDelta(chat, event.text, nextSeq);
    case "textFinal":
      return reduceTextFinal(chat, event.text, nextSeq);
    case "thinkingDelta":
      return reduceThinkingDelta(chat, event.text, nextSeq);
    case "thinkingFinal":
      return reduceThinkingFinal(chat, event.text, nextSeq);
    case "commandStarted":
      return withTimeline(chat, [
        ...chat.timeline,
        {
          type: "command",
          seq: nextSeq(),
          itemId: event.itemId,
          command: event.command,
          status: "running",
          exitCode: null,
          outputTail: null,
        },
      ]);
    case "commandDone": {
      let matched = false;
      const timeline = chat.timeline.map((item) => {
        if (item.type !== "command" || item.itemId !== event.itemId) return item;
        matched = true;
        return {
          ...item,
          status: event.status,
          exitCode: event.exitCode,
          outputTail: event.outputTail,
        };
      });
      if (matched) return withTimeline(chat, timeline);
      return withTimeline(chat, [
        ...chat.timeline,
        {
          type: "command",
          seq: nextSeq(),
          itemId: event.itemId,
          command: event.outputTail?.trim() || event.itemId,
          status: event.status,
          exitCode: event.exitCode,
          outputTail: event.outputTail,
        },
      ]);
    }
    case "fileChange":
      return withTimeline(chat, [
        ...chat.timeline,
        {
          type: "fileChange",
          seq: nextSeq(),
          itemId: event.itemId,
          changes: event.changes.map((change) => ({ ...change })),
        },
      ]);
    case "toolUse":
      return withTimeline(chat, [
        ...chat.timeline,
        {
          type: "toolUse",
          seq: nextSeq(),
          itemId: event.itemId,
          name: event.name,
          detail: event.detail,
        },
      ]);
    case "mcpToolCall":
      return withTimeline(chat, [
        ...chat.timeline,
        {
          type: "mcpToolCall",
          seq: nextSeq(),
          itemId: event.itemId,
          server: event.server,
          tool: event.tool,
        },
      ]);
    case "webSearch":
      return withTimeline(chat, [
        ...chat.timeline,
        {
          type: "webSearch",
          seq: nextSeq(),
          itemId: event.itemId,
          query: event.query,
        },
      ]);
    case "planUpdate": {
      const index = lastPlanIndex(chat.timeline);
      const plan = {
        type: "plan" as const,
        seq: index >= 0 ? chat.timeline[index].seq : nextSeq(),
        items: event.items.map((item) => ({ ...item })),
      };
      if (index < 0) return withTimeline(chat, [...chat.timeline, plan]);
      const timeline = chat.timeline.slice();
      timeline[index] = plan;
      return withTimeline(chat, timeline);
    }
    case "usage":
      return reduceUsageEvent(chat, event, nextSeq);
    case "rateLimits":
      return { ...chat, rateLimits: event.payload };
    case "turnDone":
      return { ...finalizeStreaming(chat), turnActive: false, approvals: [] };
    case "turnFailed":
      return { ...finalizeStreaming(chat), turnActive: false, error: event.error, approvals: [] };
    case "approvalRequest":
      return { ...chat, approvals: [...chat.approvals, approvalFromEvent(event)] };
    case "commandOutput":
    case "noise":
      return chat;
  }
}

function receiveAgentEvent(chatId: string, event: AgentEvent) {
  const chat = chats[chatId];
  if (!chat) return;
  setChats(chatId, reduceAgentEvent(chat, event, () => takeSeq(chatId)));
  if (event.kind === "turnStarted") {
    interruptedByUser.delete(chatId);
    if (activityEligible(chatId)) agentTurnStarted(chatId);
  } else if (event.kind === "turnDone" || event.kind === "turnFailed") {
    if (event.kind === "turnDone") maybeAutoRenameAfterFirstTurn(chatId);
    const wasInterrupted = interruptedByUser.delete(chatId);
    if (!activityEligible(chatId)) return;
    if (wasInterrupted) agentTurnCleared(chatId);
    else agentTurnDone(chatId);
  }
}

function maybeAutoRenameAfterFirstTurn(chatId: string) {
  if (autoRenameChecked.has(chatId)) return;
  autoRenameChecked.add(chatId);

  const row = findChat(chatId);
  if (!row || typeof row.title !== "string" || !isDefaultChatTitle(row.title)) return;

  const chat = chats[chatId];
  if (!chat) return;
  const userMessages = chat.timeline.filter((item) => item.type === "userMessage");
  if (userMessages.length !== 1) return;
  const firstAssistant = chat.timeline.find((item) => item.type === "assistantText");
  const title = deriveAgentChatTitle(userMessages[0].text, firstAssistant?.text);
  if (!title || isDefaultChatTitle(title)) return;
  void setChatTitle(chatId, title).catch(() => undefined);
}

function parseAgentEvent(payload: string): AgentEvent | null {
  try {
    return JSON.parse(payload) as AgentEvent;
  } catch {
    return null;
  }
}

/** Payload of a persisted "attachments" item: the image paths a prompt shipped. */
function parseAttachmentPaths(payload: string): string[] {
  try {
    const parsed = JSON.parse(payload) as { paths?: unknown };
    if (!Array.isArray(parsed.paths)) return [];
    return parsed.paths.filter((path): path is string => typeof path === "string");
  } catch {
    return [];
  }
}

function stateFromHistory(
  chatId: string,
  provider: AgentProvider,
  model: string | null,
  entries: AgentTimelineEntry[],
): AgentChatState {
  let chat = { ...emptyState(provider, model), historyLoaded: true };
  let maxSeq = 0;
  for (const entry of [...entries].sort((a, b) => a.seq - b.seq)) {
    maxSeq = Math.max(maxSeq, entry.seq);
    if (entry.entryType === "message") {
      if (entry.role === "user") {
        chat = {
          ...withTimeline(chat, [
            ...chat.timeline,
            { type: "userMessage", seq: entry.seq, text: entry.content },
          ]),
          error: null,
        };
      } else if (entry.role === "assistant") {
        chat = withTimeline(chat, [
          ...chat.timeline,
          { type: "assistantText", seq: entry.seq, text: entry.content, streaming: false },
        ]);
      }
      continue;
    }
    if (entry.kind === "attachments") {
      const paths = parseAttachmentPaths(entry.payload);
      if (paths.length > 0) {
        const timeline = chat.timeline.slice();
        for (let i = timeline.length - 1; i >= 0; i -= 1) {
          const item = timeline[i];
          if (item.type === "userMessage") {
            timeline[i] = { ...item, images: paths };
            break;
          }
        }
        chat = withTimeline(chat, timeline);
      }
      continue;
    }
    const event = parseAgentEvent(entry.payload);
    if (!event) continue;
    if (event.kind === "thinkingFinal" && isBlankText(event.text)) continue;
    chat = reduceAgentEvent(chat, event, () => entry.seq);
    if (event.kind === "turnDone") chat = { ...chat, error: null };
  }
  nextSeqByChat.set(chatId, maxSeq + 1);
  return chat;
}

export async function ensureAgentChat(
  chatId: string,
  projectRoot: string,
  provider: AgentProvider,
  model: string | null,
  options: EnsureAgentChatOptions = {},
): Promise<void> {
  const created = !chats[chatId];
  if (created) setChats(chatId, emptyState(provider, model));
  setChats(chatId, { projectRoot, provider, model });
  // Seed the effort only on a fresh entry — a remount must not clobber a
  // per-chat effort tweak with the persisted per-provider default.
  if (created && options.effort !== undefined) {
    setChats(chatId, { effort: options.effort?.trim() || null });
  }
  if (chats[chatId]?.sessionId) return;
  const existing = ensurePromises.get(chatId);
  if (existing) return existing;

  // disposeAgentChat bumps the generation; a stale ensure must stop writing —
  // its awaited continuations would otherwise resurrect the old provider's
  // session into a disposed or re-created chat entry.
  const generation = ensureGenerations.get(chatId) ?? 0;
  const stale = () => (ensureGenerations.get(chatId) ?? 0) !== generation || !chats[chatId];

  let promise: Promise<void> | undefined;
  promise = (async () => {
    try {
      if (!chats[chatId].historyLoaded) {
        const previous = chats[chatId];
        const history = await agentChatHistory(chatId);
        if (stale()) return;
        const loaded = stateFromHistory(chatId, provider, model, history);
        setChats(chatId, {
          ...loaded,
          projectRoot,
          effort: previous?.effort ?? loaded.effort,
          providerSwitched: previous?.providerSwitched ?? loaded.providerSwitched,
        });
      }
      if (stale() || chats[chatId].sessionId) return;
      const sessionId = await agentChatStart({
        chatId,
        projectRoot,
        provider,
        model,
        ...options,
        effort: chats[chatId].effort,
        onEvent: (event) => receiveAgentEvent(chatId, event),
      });
      if (stale()) {
        // Started for a chat that was disposed mid-flight — release it.
        void agentChatDispose(sessionId).catch(() => undefined);
        return;
      }
      setChats(chatId, { sessionId, projectRoot, provider, model, error: null });
    } catch (error) {
      if (!stale() && chats[chatId]) setChats(chatId, { error: errorText(error) });
      throw error;
    } finally {
      if (ensurePromises.get(chatId) === promise) ensurePromises.delete(chatId);
    }
  })();

  ensurePromises.set(chatId, promise);
  return promise;
}

export function setAgentChatModel(chatId: string, model: string | null) {
  const chat = chats[chatId];
  if (!chat) return;
  setChats(chatId, { model });
  // A live claude session pins its model at start — push the change into the
  // running query (SDK setModel) or the picker silently lies until the next
  // session. Codex reads the model per turn, so the store update suffices.
  if (chat.provider === "claudeCode" && chat.sessionId) {
    const sessionId = chat.sessionId;
    let pendingSetModel: Promise<void> | undefined;
    pendingSetModel = (async () => {
      try {
        await agentChatSetModel(sessionId, model);
      } catch {
        return;
      } finally {
        if (pendingSetModelByChat.get(chatId) === pendingSetModel) {
          pendingSetModelByChat.delete(chatId);
        }
      }
    })();
    pendingSetModelByChat.set(chatId, pendingSetModel);
  }
}

export function clearProviderSwitched(chatId: string) {
  if (!chats[chatId]) return;
  setChats(chatId, { providerSwitched: false });
}

export function setAgentChatEffort(chatId: string, effort: string | null) {
  if (!chats[chatId]) return;
  const value = effort?.trim() || null;
  setChats(chatId, { effort: value });
}

function sendOptions(chat: AgentChatState, images: string[]) {
  return {
    ...(chat.provider === "codex" ? { effort: chat.effort, model: chat.model } : {}),
    images: [...images],
  };
}

export async function switchAgentChatProvider(
  chatId: string,
  provider: AgentProvider,
  model: string | null,
  effort: string | null = null,
): Promise<boolean> {
  const current = chats[chatId];
  if (current?.turnActive) throw new Error("Cannot switch provider while a turn is active");

  const row = findChat(chatId);
  const projectRoot = current?.projectRoot ?? row?.projectRoot ?? null;
  if (!projectRoot) throw new Error("Agent chat is not started");

  disposeAgentChat(chatId);
  await setChatAgent(chatId, provider, "agent");
  await ensureAgentChat(chatId, projectRoot, provider, model, {
    engine: loadAgentEngine(),
    effort,
  });
  if (chats[chatId]) {
    setChats(chatId, {
      providerSwitched: true,
      contextUsed: null,
      contextWindow: null,
      cumulativeUsage: null,
      rateLimits: null,
      approvals: [],
    });
  }
  return true;
}

export async function sendAgentMessage(
  chatId: string,
  text: string,
  images: string[] = [],
): Promise<void> {
  const chat = chats[chatId];
  if (!chat) throw new Error("Agent chat is not started");
  let sessionId = chat.sessionId;
  const projectRoot = chat.projectRoot;
  if (!sessionId && !projectRoot) throw new Error("Agent chat is not started");
  let optimisticSeq = takeSeq(chatId);
  const imageList = [...images];
  appendOptimisticUserMessage(chatId, optimisticSeq, text, imageList);
  if (activityEligible(chatId)) agentTurnStarted(chatId);
  try {
    if (!sessionId) {
      if (!projectRoot) throw new Error("Agent chat is not started");
      await ensureAgentChat(chatId, projectRoot, chat.provider, chat.model, {
        engine: loadAgentEngine(),
        effort: chat.effort,
      });
      sessionId = chats[chatId]?.sessionId ?? null;
      if (!sessionId) throw new Error("Agent chat is not started");
      const hasOptimisticMessage = chats[chatId]?.timeline.some(
        (item) => item.type === "userMessage" && item.optimistic && item.seq === optimisticSeq,
      );
      if (!hasOptimisticMessage) {
        optimisticSeq = takeSeq(chatId);
        appendOptimisticUserMessage(chatId, optimisticSeq, text, imageList);
      } else {
        setChats(chatId, { error: null });
      }
    }
    if ((chats[chatId] ?? chat).provider === "claudeCode") {
      await pendingSetModelByChat.get(chatId);
    }
    await agentChatSend(sessionId, text, sendOptions(chats[chatId] ?? chat, imageList));
  } catch (error) {
    if ((nextSeqByChat.get(chatId) ?? 1) === optimisticSeq + 1) {
      nextSeqByChat.set(chatId, optimisticSeq);
    }
    setChats(chatId, {
      turnActive: false,
      error: errorText(error),
      timeline: (chats[chatId]?.timeline ?? []).filter(
        (item) => item.type !== "userMessage" || !item.optimistic || item.seq !== optimisticSeq,
      ),
    });
    if (activityEligible(chatId)) agentTurnCleared(chatId);
    throw error;
  }
}

export async function approveAgentRequest(
  chatId: string,
  approvalId: string,
  decision: AgentApprovalDecision,
): Promise<void> {
  const chat = chats[chatId];
  const sessionId = chat?.sessionId;
  if (!sessionId) throw new Error("Agent chat is not started");

  try {
    await agentChatApprove(sessionId, approvalId, decision);
    const approvals = chats[chatId]?.approvals;
    if (approvals?.some((approval) => approval.approvalId === approvalId)) {
      setChats(chatId, {
        approvals: approvals.filter((item) => item.approvalId !== approvalId),
      });
    }
  } catch (error) {
    if (chats[chatId]) setChats(chatId, { error: errorText(error) });
    throw error;
  }
}

export async function steerAgentChat(chatId: string, text: string): Promise<void> {
  const sessionId = chats[chatId]?.sessionId;
  if (!sessionId) throw new Error("Agent chat is not started");
  const optimisticSeq = takeSeq(chatId);
  setChats(chatId, {
    error: null,
    timeline: [
      ...chats[chatId].timeline,
      { type: "userMessage", seq: optimisticSeq, text, optimistic: true },
    ],
  });
  try {
    await agentChatSteer(sessionId, text);
  } catch (error) {
    if ((nextSeqByChat.get(chatId) ?? 1) === optimisticSeq + 1) {
      nextSeqByChat.set(chatId, optimisticSeq);
    }
    setChats(chatId, {
      error: errorText(error),
      timeline: (chats[chatId]?.timeline ?? []).filter(
        (item) => item.type !== "userMessage" || !item.optimistic || item.seq !== optimisticSeq,
      ),
    });
    throw error;
  }
}

export async function interruptAgentChat(chatId: string): Promise<void> {
  const sessionId = chats[chatId]?.sessionId;
  if (!sessionId) return;
  if (chats[chatId]?.turnActive) interruptedByUser.add(chatId);
  try {
    await agentChatInterrupt(sessionId);
  } catch (error) {
    interruptedByUser.delete(chatId);
    throw error;
  }
  if (chats[chatId]) setChats(chatId, { turnActive: false });
  if (activityEligible(chatId)) agentTurnCleared(chatId);
}

/** The chat was deleted or is switching provider: release the backend session
 *  (kills any running turn, closes the bridge chat / thread subscription),
 *  then drop the store entry so any late events for this chat are ignored
 *  instead of resurrecting activity state. */
export function disposeAgentChat(chatId: string) {
  const sessionId = chats[chatId]?.sessionId;
  if (sessionId) void agentChatDispose(sessionId).catch(() => undefined);
  // Invalidate any in-flight ensure: its awaited continuations must not write
  // stale session state into a disposed (or re-created) chat entry.
  ensureGenerations.set(chatId, (ensureGenerations.get(chatId) ?? 0) + 1);
  interruptedByUser.delete(chatId);
  nextSeqByChat.delete(chatId);
  ensurePromises.delete(chatId);
  pendingSetModelByChat.delete(chatId);
  if (chats[chatId]) setChats(produce((all) => { delete all[chatId]; }));
}
