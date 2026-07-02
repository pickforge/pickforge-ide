import { createStore, produce } from "solid-js/store";
import {
  agentChatHistory,
  agentChatInterrupt,
  agentChatSend,
  agentChatStart,
  type AgentEvent,
  type AgentProvider,
  type AgentTimelineEntry,
} from "../lib/agentChat";
import { agentTurnCleared, agentTurnDone, agentTurnStarted } from "./chatActivity";
import { isChatArchived } from "./chatArchive";
import { findChat } from "./workspace";

export type AgentTimelineItem =
  | { type: "userMessage"; seq: number; text: string }
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
    };

export interface AgentChatState {
  sessionId: string | null;
  provider: AgentProvider;
  model: string | null;
  turnActive: boolean;
  error: string | null;
  timeline: AgentTimelineItem[];
  historyLoaded: boolean;
}

const [chats, setChats] = createStore<Record<string, AgentChatState>>({});
const nextSeqByChat = new Map<string, number>();
const ensurePromises = new Map<string, Promise<void>>();

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

function emptyState(provider: AgentProvider, model: string | null): AgentChatState {
  return {
    sessionId: null,
    provider,
    model,
    turnActive: false,
    error: null,
    timeline: [],
    historyLoaded: false,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function takeSeq(chatId: string): number {
  const seq = nextSeqByChat.get(chatId) ?? 1;
  nextSeqByChat.set(chatId, seq + 1);
  return seq;
}

function withTimeline(chat: AgentChatState, timeline: AgentTimelineItem[]): AgentChatState {
  return { ...chat, timeline };
}

function lastPlanIndex(timeline: AgentTimelineItem[]): number {
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i].type === "plan") return i;
  }
  return -1;
}

function finalizeStreaming(chat: AgentChatState): AgentChatState {
  let changed = false;
  const timeline = chat.timeline.map((item) => {
    if ((item.type === "assistantText" || item.type === "thinking") && item.streaming) {
      changed = true;
      return { ...item, streaming: false };
    }
    return item;
  });
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
  const last = chat.timeline[chat.timeline.length - 1];
  if (last?.type === "thinking" && last.streaming) {
    const timeline = chat.timeline.slice();
    timeline[timeline.length - 1] = { ...last, text, streaming: false };
    return withTimeline(chat, timeline);
  }
  return withTimeline(chat, [
    ...chat.timeline,
    { type: "thinking", seq: nextSeq(), text, streaming: false },
  ]);
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
      return { ...chat, turnActive: true, error: null };
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
      return withTimeline(chat, [
        ...chat.timeline,
        {
          type: "usage",
          seq: nextSeq(),
          inputTokens: event.inputTokens,
          cachedInputTokens: event.cachedInputTokens,
          outputTokens: event.outputTokens,
          costUsd: event.costUsd,
        },
      ]);
    case "turnDone":
      return { ...finalizeStreaming(chat), turnActive: false };
    case "turnFailed":
      return { ...finalizeStreaming(chat), turnActive: false, error: event.error };
    case "approvalRequest":
      return withTimeline(chat, [
        ...chat.timeline,
        {
          type: "toolUse",
          seq: nextSeq(),
          itemId: event.approvalId,
          name: "approval required",
          detail: event.detail,
        },
      ]);
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
    const wasInterrupted = interruptedByUser.delete(chatId);
    if (!activityEligible(chatId)) return;
    if (wasInterrupted) agentTurnCleared(chatId);
    else agentTurnDone(chatId);
  }
}

function parseAgentEvent(payload: string): AgentEvent | null {
  try {
    return JSON.parse(payload) as AgentEvent;
  } catch {
    return null;
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
        chat = withTimeline(chat, [
          ...chat.timeline,
          { type: "userMessage", seq: entry.seq, text: entry.content },
        ]);
      } else if (entry.role === "assistant") {
        chat = withTimeline(chat, [
          ...chat.timeline,
          { type: "assistantText", seq: entry.seq, text: entry.content, streaming: false },
        ]);
      }
      continue;
    }
    const event = parseAgentEvent(entry.payload);
    if (event) chat = reduceAgentEvent(chat, event, () => entry.seq);
  }
  nextSeqByChat.set(chatId, maxSeq + 1);
  return chat;
}

export async function ensureAgentChat(
  chatId: string,
  projectRoot: string,
  provider: AgentProvider,
  model: string | null,
): Promise<void> {
  if (chats[chatId]?.sessionId) return;
  const existing = ensurePromises.get(chatId);
  if (existing) return existing;
  if (!chats[chatId]) setChats(chatId, emptyState(provider, model));

  const promise = (async () => {
    try {
      if (!chats[chatId].historyLoaded) {
        const history = await agentChatHistory(chatId);
        const loaded = stateFromHistory(chatId, provider, model, history);
        setChats(chatId, loaded);
      }
      if (chats[chatId].sessionId) return;
      const sessionId = await agentChatStart({
        chatId,
        projectRoot,
        provider,
        model,
        onEvent: (event) => receiveAgentEvent(chatId, event),
      });
      setChats(chatId, { sessionId, provider, model, error: null });
    } catch (error) {
      if (chats[chatId]) setChats(chatId, { error: errorText(error) });
      throw error;
    } finally {
      ensurePromises.delete(chatId);
    }
  })();

  ensurePromises.set(chatId, promise);
  return promise;
}

export async function sendAgentMessage(chatId: string, text: string): Promise<void> {
  const sessionId = chats[chatId]?.sessionId;
  if (!sessionId) throw new Error("Agent chat is not started");
  const optimisticSeq = takeSeq(chatId);
  setChats(chatId, {
    turnActive: true,
    error: null,
    timeline: [
      ...chats[chatId].timeline,
      { type: "userMessage", seq: optimisticSeq, text },
    ],
  });
  if (activityEligible(chatId)) agentTurnStarted(chatId);
  try {
    await agentChatSend(sessionId, text);
  } catch (error) {
    if ((nextSeqByChat.get(chatId) ?? 1) === optimisticSeq + 1) {
      nextSeqByChat.set(chatId, optimisticSeq);
    }
    setChats(chatId, {
      turnActive: false,
      error: errorText(error),
      timeline: (chats[chatId]?.timeline ?? []).filter(
        (item) => item.type !== "userMessage" || item.seq !== optimisticSeq,
      ),
    });
    if (activityEligible(chatId)) agentTurnCleared(chatId);
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

/** The chat was deleted: best-effort stop the backend turn (there is no stop
 *  command — interrupt is the closest), then drop the store entry so any late
 *  events for this chat are ignored instead of resurrecting activity state. */
export function disposeAgentChat(chatId: string) {
  const sessionId = chats[chatId]?.sessionId;
  if (sessionId) void agentChatInterrupt(sessionId).catch(() => undefined);
  interruptedByUser.delete(chatId);
  nextSeqByChat.delete(chatId);
  ensurePromises.delete(chatId);
  if (chats[chatId]) setChats(produce((all) => { delete all[chatId]; }));
}
