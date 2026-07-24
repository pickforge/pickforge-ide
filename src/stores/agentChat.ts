import { createStore, produce } from "solid-js/store";
import {
  agentChatApprove,
  agentChatHistory,
  agentChatDispose,
  agentChatInterrupt,
  agentChatSend,
  agentChatSetMode,
  agentChatSetModel,
  agentChatStart,
  agentChatSteer,
  normalizePlanItems,
  type AgentApprovalDecision,
  type AgentEngine,
  type AgentEvent,
  type AgentProvider,
  type AgentTimelineEntry,
  type PlanItem,
} from "../lib/agentChat";
import {
  agentBackendDescriptor,
  backendCapabilityReason,
  supportsBackendCapability,
} from "../lib/agentBackends";
import { modeOverrides } from "../lib/agentModes";
import { nativeChatModel } from "../lib/agentModels";
import { agentSessionLatestForChat } from "../lib/db";
import { isSwarmWorkerChat } from "../lib/chatLabels";
import {
  canAutoOwn,
  chatTitleSourceForPolicy,
  selectDynamicAgentTitle,
} from "../lib/chatAutoName";
import { estimateCostUsd } from "../lib/agentPricing";
import { loadAgentEngine } from "../lib/chatDefaults";
import { isInternalSwarmSynthesisPrompt } from "../lib/swarmSynthesis";
import { errorText } from "../lib/errors";
import { agentTurnCleared, agentTurnDone, agentTurnStarted } from "./chatActivity";
import { notifyChangesReviewTurnCompleted } from "./changes";
import { flagEnabled, subscribeToFlagChanges } from "./flags";
import { isChatArchived } from "./chatArchive";
import { findChat, setChatAgent, setChatTitle } from "./workspace";
import { remotePtyFor } from "../lib/remoteContext";
import type { RemotePty } from "../lib/pty";

export type AgentTimelineItem =
  | {
      type: "userMessage";
      seq: number;
      text: string;
      images?: string[];
      optimistic?: boolean;
      hidden?: boolean;
    }
  | { type: "assistantText"; seq: number; itemId?: string | null; text: string; streaming: boolean }
  | { type: "thinking"; seq: number; itemId?: string | null; text: string; streaming: boolean }
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
      /** 0-based count of prior turns-with-file-changes closed earlier in
       *  this chat (#231 PR3). Every `FileChange` event within one turn folds
       *  into the SAME item (itemId stays the turn-opening event's id, seq
       *  stays fixed too — virtualization keys off it), so this ordinal lines
       *  up 1:1, in the same chronological order, with the entries
       *  `changes_list_turn_change_sets` (#231 PR2) returns for this chat —
       *  that RPC only emits one `ChangeSet` per turn that had a file change,
       *  in turn-completion order, exactly mirroring this grouping rule. */
      ordinal: number;
      /** True once the enclosing turn's `turnDone`/`turnFailed` has closed
       *  this group. The chat receipt (#231 PR3) renders only for
       *  turnComplete items; an in-progress turn's raw events keep rendering
       *  through the existing `FileChangeCard` until it closes. */
      turnComplete: boolean;
    }
  | { type: "toolUse"; seq: number; itemId: string; name: string; detail: string | null }
  | { type: "mcpToolCall"; seq: number; itemId: string; server: string; tool: string }
  | { type: "webSearch"; seq: number; itemId: string; query: string }
  | { type: "plan"; seq: number; items: PlanItem[] }
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
  engine: AgentEngine;
  model: string | null;
  effort: string | null;
  mode: string | null;
  providerSwitched: boolean;
  turnActive: boolean;
  error: string | null;
  timeline: AgentTimelineItem[];
  approvals: AgentApproval[];
  contextUsed: number | null;
  contextWindow: number | null;
  rateLimits: string | null;
  remoteHost: string | null;
  totals: AgentChatTotals;
  cumulativeUsage: CumulativeUsageSnapshot | null;
  historyLoaded: boolean;
  /** itemId of the currently-open turn's grouped `fileChange` timeline item
   *  (#231 PR3), or null when no turn with file changes is open right now.
   *  Closed (set back to null, ordinal bumped) on `turnDone`/`turnFailed`. */
  openChangesReceiptItemId: string | null;
  /** Next ordinal a newly-opened change-receipt group will receive. Seeded to
   *  0 and only ever incremented when a turn WITH file changes closes — a
   *  turn with none never opens a group, so it never consumes an ordinal
   *  either, keeping this in lockstep with `changes_list_turn_change_sets`.
   *  This alignment is only valid while the fold that produced these ordinals
   *  matches the CURRENT `changesReview` flag value — `reflowChangesReceiptFold`
   *  re-derives it (and every ordinal) from scratch on every flag flip, so
   *  fold-vs-flag agreement holds by construction, not by luck. Caveat: this
   *  also assumes `TurnStarted` is never persisted server-side (see
   *  `crates/.../changes/turn.rs`'s `decode_timeline_events` doc comment,
   *  ~lines 12-13) — if that ever changes, the backend fold could emit an
   *  empty turn slot this ordinal scheme doesn't currently account for. */
  nextChangesReceiptOrdinal: number;
}

const [chats, setChats] = createStore<Record<string, AgentChatState>>({});
const nextSeqByChat = new Map<string, number>();
const ensurePromises = new Map<string, Promise<void>>();
const hydratePromises = new Map<string, Promise<void>>();
const pendingSetModelByChat = new Map<string, { promise: Promise<void>; sequence: number }>();
const setModelRequestSeqByChat = new Map<string, number>();
// Bumped by disposeAgentChat to invalidate in-flight ensures for a chat.
const ensureGenerations = new Map<string, number>();
// Bumped on every explicit user model pick (setAgentChatModel), including a
// re-pick of the same value — a plain `model === safeModel` check cannot
// tell "untouched" from "user re-picked the placeholder value" apart. The
// resumed-model DB lookup captures this before awaiting and skips its write
// if it changed underneath it.
const modelTouchByChat = new Map<string, number>();
const pendingProviderTitleByChat = new Map<string, string>();
// Successful, visible user turns only. Timeline messages include failed turns,
// so title cadence must use this completion ledger rather than recounting them.
const completedTitleTurnsByChat = new Map<string, { seq: number; text: string }[]>();
// The visible prompt that started the active backend turn. Steering messages
// are timeline entries too, but must not replace the turn's title milestone.
const activeTitleTurnByChat = new Map<
  string,
  { seq: number; text: string; hidden: boolean }
>();
const DELTA_FLUSH_INTERVAL_MS = 16;

export interface SendAgentMessageOptions {
  hidden?: boolean;
}

type AgentDeltaEvent =
  | Extract<AgentEvent, { kind: "textDelta" }>
  | Extract<AgentEvent, { kind: "thinkingDelta" }>;

type PendingDelta = {
  kind: AgentDeltaEvent["kind"];
  itemId: string | null;
  text: string;
};

type PendingDeltaBuffer = {
  deltas: PendingDelta[];
  generation: number;
  animationFrame: number | null;
  timeout: ReturnType<typeof setTimeout> | null;
};

const pendingDeltasByChat = new Map<string, PendingDeltaBuffer>();

// Chats whose active turn the user just interrupted: the backend still emits
// the terminal turnDone/turnFailed, which must clear the busy glow WITHOUT
// chiming — the user was right here when they stopped it. Consumed by the next
// terminal event; a fresh turnStarted drops a stale flag.
const interruptedByUser = new Set<string>();

// Mirror of the pty invariant: an archived chat renders no busy/attention
// state anywhere, and a deleted chat must never have activity resurrected by a
// late event.
function activityEligible(chatId: string): boolean {
  const chat = findChat(chatId);
  return !!chat && !isChatArchived(chatId) && !isSwarmWorkerChat(chat);
}

export function agentChat(chatId: string): AgentChatState | undefined {
  return chats[chatId];
}

export function latestPlanForChat(
  chatId: string,
): Extract<AgentTimelineItem, { type: "plan" }> | null {
  const timeline = chats[chatId]?.timeline;
  if (!timeline) return null;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i];
    if (item.type === "plan") return item;
  }
  return null;
}

export interface EnsureAgentChatOptions {
  engine?: AgentEngine;
  /** Seeds the chat's effort; claude bridge sessions apply it at start. */
  effort?: string | null;
  /** Seeds the chat's mode; its overrides compose into the session start. */
  mode?: string | null;
  sandbox?: string;
  approvalPolicy?: string;
  permissionMode?: string;
  allowedTools?: string[];
}

function emptyState(
  provider: AgentProvider,
  model: string | null,
  engine: AgentEngine = loadAgentEngine(),
): AgentChatState {
  return {
    sessionId: null,
    projectRoot: null,
    provider,
    engine,
    model,
    effort: null,
    mode: null,
    providerSwitched: false,
    turnActive: false,
    error: null,
    timeline: [],
    approvals: [],
    contextUsed: null,
    contextWindow: null,
    rateLimits: null,
    remoteHost: null,
    totals: emptyTotals(),
    cumulativeUsage: null,
    historyLoaded: false,
    openChangesReceiptItemId: null,
    nextChangesReceiptOrdinal: 0,
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

function appendOptimisticUserMessage(
  chatId: string,
  seq: number,
  text: string,
  images: string[] = [],
  options: SendAgentMessageOptions = {},
) {
  const chat = chats[chatId];
  if (!chat) return;
  const message: AgentTimelineItem = {
    type: "userMessage",
    seq,
    text,
    optimistic: true,
    ...(images.length > 0 ? { images: [...images] } : {}),
    ...(options.hidden ? { hidden: true } : {}),
  };
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

/** Closes the currently-open change-receipt group (#231 PR3), if any — the
 *  `turnDone`/`turnFailed` half of the fold `case "fileChange"` opens.
 *  A no-op when the turn had no file changes (nothing was ever opened),
 *  mirroring `group_turn_change_sets`'s rule that only a turn with at least
 *  one `FileChange` event produces a `ChangeSet` at all. */
function closeOpenChangesReceipt(chat: AgentChatState): AgentChatState {
  const openId = chat.openChangesReceiptItemId;
  if (!openId) return chat;
  const timeline = chat.timeline.map((item) =>
    item.type === "fileChange" && item.itemId === openId ? { ...item, turnComplete: true } : item,
  );
  return {
    ...withTimeline(chat, timeline),
    openChangesReceiptItemId: null,
    nextChangesReceiptOrdinal: chat.nextChangesReceiptOrdinal + 1,
  };
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

function findLastTimelineIndex(
  timeline: readonly AgentTimelineItem[],
  predicate: (item: AgentTimelineItem) => boolean,
): number {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    if (predicate(timeline[index])) return index;
  }
  return -1;
}

function reduceTextDelta(
  chat: AgentChatState,
  itemId: string | null,
  text: string,
  nextSeq: () => number,
): AgentChatState {
  const index =
    itemId !== null
      ? findLastTimelineIndex(
          chat.timeline,
          (item) =>
            item.type === "assistantText" && item.streaming && item.itemId === itemId,
        )
      : chat.timeline.length - 1;
  const current = chat.timeline[index];
  if (
    current?.type === "assistantText" &&
    current.streaming &&
    (itemId !== null || index === chat.timeline.length - 1)
  ) {
    const timeline = chat.timeline.slice();
    timeline[index] = { ...current, text: `${current.text}${text}` };
    return withTimeline(chat, timeline);
  }
  return withTimeline(chat, [
    ...chat.timeline,
    { type: "assistantText", seq: nextSeq(), itemId, text, streaming: true },
  ]);
}

function reduceTextFinal(
  chat: AgentChatState,
  itemId: string | null,
  text: string,
  nextSeq: () => number,
): AgentChatState {
  const identifiedIndex =
    itemId !== null
      ? findLastTimelineIndex(
          chat.timeline,
          (item) => item.type === "assistantText" && item.itemId === itemId,
        )
      : -1;
  const index =
    identifiedIndex >= 0
      ? identifiedIndex
      : findLastTimelineIndex(
          chat.timeline,
          (item) => item.type === "assistantText" && item.streaming,
        );
  const current = chat.timeline[index];
  if (
    current?.type === "assistantText" &&
    (itemId !== null || current.streaming)
  ) {
    const timeline = chat.timeline.slice();
    timeline[index] = { ...current, itemId, text, streaming: false };
    return withTimeline(chat, timeline);
  }
  return withTimeline(chat, [
    ...chat.timeline,
    { type: "assistantText", seq: nextSeq(), itemId, text, streaming: false },
  ]);
}

function reduceThinkingDelta(
  chat: AgentChatState,
  itemId: string | null,
  text: string,
  nextSeq: () => number,
): AgentChatState {
  const index =
    itemId !== null
      ? findLastTimelineIndex(
          chat.timeline,
          (item) => item.type === "thinking" && item.streaming && item.itemId === itemId,
        )
      : chat.timeline.length - 1;
  const current = chat.timeline[index];
  if (
    current?.type === "thinking" &&
    current.streaming &&
    (itemId !== null || index === chat.timeline.length - 1)
  ) {
    const timeline = chat.timeline.slice();
    timeline[index] = { ...current, text: `${current.text}${text}` };
    return withTimeline(chat, timeline);
  }
  return withTimeline(chat, [
    ...chat.timeline,
    { type: "thinking", seq: nextSeq(), itemId, text, streaming: true },
  ]);
}

function reduceThinkingFinal(
  chat: AgentChatState,
  itemId: string | null,
  text: string,
  nextSeq: () => number,
): AgentChatState {
  const blank = isBlankText(text);
  const identifiedIndex =
    itemId !== null
      ? findLastTimelineIndex(
          chat.timeline,
          (item) => item.type === "thinking" && item.itemId === itemId,
        )
      : -1;
  const index =
    identifiedIndex >= 0
      ? identifiedIndex
      : findLastTimelineIndex(
          chat.timeline,
          (item) => item.type === "thinking" && item.streaming,
        );
  const current = chat.timeline[index];
  if (
    current?.type === "thinking" &&
    (itemId !== null || current.streaming)
  ) {
    const timeline = chat.timeline.slice();
    if (blank) {
      if (isBlankText(current.text)) timeline.splice(index, 1);
      else timeline[index] = { ...current, itemId, streaming: false };
    } else {
      timeline[index] = { ...current, itemId, text, streaming: false };
    }
    return withTimeline(chat, timeline);
  }
  if (blank) return chat;
  return withTimeline(chat, [
    ...chat.timeline,
    { type: "thinking", seq: nextSeq(), itemId, text, streaming: false },
  ]);
}

function isDeltaEvent(event: AgentEvent): event is AgentDeltaEvent {
  return event.kind === "textDelta" || event.kind === "thinkingDelta";
}

function cancelPendingDeltaFlush(buffer: PendingDeltaBuffer) {
  if (buffer.animationFrame !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(buffer.animationFrame);
  }
  if (buffer.timeout !== null) clearTimeout(buffer.timeout);
  buffer.animationFrame = null;
  buffer.timeout = null;
}

function dropPendingDeltas(chatId: string) {
  const buffer = pendingDeltasByChat.get(chatId);
  if (!buffer) return;
  cancelPendingDeltaFlush(buffer);
  pendingDeltasByChat.delete(chatId);
}

function flushPendingDeltas(chatId: string) {
  const buffer = pendingDeltasByChat.get(chatId);
  if (!buffer) return;
  cancelPendingDeltaFlush(buffer);
  pendingDeltasByChat.delete(chatId);
  if ((ensureGenerations.get(chatId) ?? 0) !== buffer.generation) return;
  const chat = chats[chatId];
  if (!chat || buffer.deltas.length === 0) return;
  setChats(
    chatId,
    buffer.deltas.reduce((next, delta) => {
      if (delta.kind === "textDelta") {
        return reduceTextDelta(next, delta.itemId, delta.text, () => takeSeq(chatId));
      }
      return reduceThinkingDelta(next, delta.itemId, delta.text, () => takeSeq(chatId));
    }, chat),
  );
}

function schedulePendingDeltaFlush(chatId: string, buffer: PendingDeltaBuffer) {
  if (buffer.animationFrame !== null || buffer.timeout !== null) return;
  const flush = () => {
    buffer.animationFrame = null;
    buffer.timeout = null;
    flushPendingDeltas(chatId);
  };
  if (typeof document !== "undefined" && document.hidden) {
    buffer.timeout = setTimeout(flush, DELTA_FLUSH_INTERVAL_MS);
    return;
  }
  if (typeof requestAnimationFrame === "function") {
    buffer.animationFrame = requestAnimationFrame(flush);
    return;
  }
  buffer.timeout = setTimeout(flush, DELTA_FLUSH_INTERVAL_MS);
}

function queuePendingDelta(chatId: string, event: AgentDeltaEvent) {
  const generation = ensureGenerations.get(chatId) ?? 0;
  let buffer = pendingDeltasByChat.get(chatId);
  if (!buffer || buffer.generation !== generation) {
    if (buffer) cancelPendingDeltaFlush(buffer);
    buffer = { deltas: [], generation, animationFrame: null, timeout: null };
    pendingDeltasByChat.set(chatId, buffer);
  }
  const itemId = event.itemId ?? null;
  const last = buffer.deltas[buffer.deltas.length - 1];
  if (last?.kind === event.kind && last.itemId === itemId) last.text += event.text;
  else buffer.deltas.push({ kind: event.kind, itemId, text: event.text });
  schedulePendingDeltaFlush(chatId, buffer);
}

type UsageEvent = Extract<AgentEvent, { kind: "usage" }>;

/// Positive-delta semantics: each field grows by what the running counter
// gained since the last snapshot. A counter that DECREASED means the
// provider thread restarted — count the new value as a fresh run's start.
function usageDeltaTotals(
  chat: AgentChatState,
  event: UsageEvent,
  costUsd: number,
): { totals: AgentChatTotals; cumulativeUsage: CumulativeUsageSnapshot } {
  const snapshot: CumulativeUsageSnapshot = {
    inputTokens: event.inputTokens,
    cachedInputTokens: event.cachedInputTokens,
    outputTokens: event.outputTokens,
    costUsd,
  };
  const previous = chat.cumulativeUsage;
  const gained = (current: number, before: number) =>
    current >= before ? current - before : current;
  const totals: AgentChatTotals = {
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
  return { totals, cumulativeUsage: snapshot };
}

function usageRunningTotals(
  chat: AgentChatState,
  event: UsageEvent,
  costUsd: number,
  estimatedCostUsd: number | null,
): AgentChatTotals {
  return {
    inputTokens: chat.totals.inputTokens + event.inputTokens,
    cachedInputTokens: chat.totals.cachedInputTokens + event.cachedInputTokens,
    outputTokens: chat.totals.outputTokens + event.outputTokens,
    costUsd: chat.totals.costUsd + costUsd,
    estimated: chat.totals.estimated || estimatedCostUsd !== null,
  };
}

function reduceUsageEvent(
  chat: AgentChatState,
  event: UsageEvent,
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
  // The backend sends an explicit `null` (not an omitted field) whenever a
  // turn's usage payload carries no context data (e.g. a subagent-only turn,
  // or a provider's own per-turn usage row that only ever reports deltas —
  // see OMP's prompt-response usage event). Treat that the same as
  // "unreported": keep the last known reading rather than blanking the meter
  // every time a usage event without context data arrives.
  const contextUsed = event.contextUsed == null ? chat.contextUsed : event.contextUsed;
  const contextWindow = event.contextWindow == null ? chat.contextWindow : event.contextWindow;
  const cumulative = event.contextUsed != null;
  const { totals, cumulativeUsage } = cumulative
    ? usageDeltaTotals(chat, event, costUsd)
    : {
        totals: usageRunningTotals(chat, event, costUsd, estimatedCostUsd),
        cumulativeUsage: chat.cumulativeUsage,
      };

  return withTimeline(
    {
      ...chat,
      // Persisted usage rows carry the model that actually served the turn —
      // the only per-chat record of a model that was never explicitly
      // changed via the picker (no "sessionUpdated" event exists for it).
      model: event.model ?? chat.model,
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

function reduceCommandDone(
  chat: AgentChatState,
  event: Extract<AgentEvent, { kind: "commandDone" }>,
  nextSeq: () => number,
): AgentChatState {
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

function reduceToolUse(
  chat: AgentChatState,
  event: Extract<AgentEvent, { kind: "toolUse" }>,
  nextSeq: () => number,
): AgentChatState {
  let matched = false;
  const timeline = chat.timeline.map((item) => {
    if (item.type !== "toolUse" || item.itemId !== event.itemId) return item;
    matched = true;
    return {
      ...item,
      name: event.name,
      detail: event.detail,
    };
  });
  if (matched) return withTimeline(chat, timeline);
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
}

function reducePlanUpdate(
  chat: AgentChatState,
  event: Extract<AgentEvent, { kind: "planUpdate" }>,
  nextSeq: () => number,
): AgentChatState {
  // This is the single decode boundary both the live Channel path and
  // history replay funnel through (reduceAgentEvent), so legacy rows and
  // malformed siblings normalize identically regardless of source.
  const items = normalizePlanItems(event.items);
  const index = lastPlanIndex(chat.timeline);
  // An empty plan update clears the current plan card and pinned
  // projection instead of leaving stale steps around.
  if (items.length === 0) {
    if (index < 0) return chat;
    const timeline = chat.timeline.slice();
    timeline.splice(index, 1);
    return withTimeline(chat, timeline);
  }
  const plan = {
    type: "plan" as const,
    seq: index >= 0 ? chat.timeline[index].seq : nextSeq(),
    items,
  };
  if (index < 0) return withTimeline(chat, [...chat.timeline, plan]);
  const timeline = chat.timeline.slice();
  timeline[index] = plan;
  return withTimeline(chat, timeline);
}

function reduceSessionUpdated(
  chat: AgentChatState,
  event: Extract<AgentEvent, { kind: "sessionUpdated" }>,
): AgentChatState {
  return {
    ...chat,
    model: event.model ?? chat.model,
    effort: supportsBackendCapability(chat.provider, "effortSelection", "nativeChat", chat.engine)
      ? (event.thinkingLevel ?? chat.effort)
      : chat.effort,
  };
}

function reduceApprovalRequest(
  chat: AgentChatState,
  event: Extract<AgentEvent, { kind: "approvalRequest" }>,
): AgentChatState {
  if (!supportsBackendCapability(chat.provider, "approvalEvents", "nativeChat", chat.engine)) {
    return chat;
  }
  return { ...chat, approvals: [...chat.approvals, approvalFromEvent(event)] };
}

// AgentEvent's discriminated union has 24 "kind" variants; a switch is the standard
// exhaustiveness-checked way to dispatch one in TypeScript (each case adds +1 to ESLint's
// cyclomatic count regardless of body size), and every case body with real branching is already
// extracted into its own reducer above/below. Replacing this with a lookup-table dispatch would
// trade compiler-enforced exhaustiveness for a runtime lookup plus an unsafe cast — a real design
// tradeoff, not just more extraction effort.
// eslint-disable-next-line complexity -- TODO(#263): see comment above.
function reduceAgentEvent(
  chat: AgentChatState,
  event: AgentEvent,
  nextSeq: () => number,
): AgentChatState {
  switch (event.kind) {
    case "sessionStarted":
      return chat;
    case "sessionUpdated":
      return reduceSessionUpdated(chat, event);
    case "sessionTitle":
    case "providerPayload":
    case "providerEvent":
      return chat;
    case "turnStarted":
      return { ...chat, turnActive: true, error: null, providerSwitched: false };
    case "textDelta":
      return reduceTextDelta(chat, event.itemId ?? null, event.text, nextSeq);
    case "textFinal":
      return reduceTextFinal(chat, event.itemId, event.text, nextSeq);
    case "thinkingDelta":
      return reduceThinkingDelta(chat, event.itemId ?? null, event.text, nextSeq);
    case "thinkingFinal":
      return reduceThinkingFinal(chat, event.itemId, event.text, nextSeq);
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
    case "commandDone":
      return reduceCommandDone(chat, event, nextSeq);
    case "fileChange": {
      // Flag off (#231 `changesReview`, default off): keep pushing one raw
      // item per event, exactly the pre-#231-PR3 behavior — no folding, no
      // ordinal/turnComplete tracking, so `ChatTimeline` keeps rendering the
      // legacy per-event `FileChangeCard` unchanged.
      if (!flagEnabled("changesReview")) {
        return withTimeline(chat, [
          ...chat.timeline,
          {
            type: "fileChange",
            seq: nextSeq(),
            itemId: event.itemId,
            changes: event.changes.map((change) => ({ ...change })),
            ordinal: chat.nextChangesReceiptOrdinal,
            turnComplete: false,
          },
        ]);
      }
      // Fold every FileChange event within one open turn into a SINGLE
      // timeline item (#231 PR3) — the chat receipt is one card per completed
      // turn, not one per event. Matches `group_turn_change_sets`'s implicit
      // turn-open rule (opens on the first FileChange since the last close);
      // `seq`/`itemId` stay pinned to the opening event so the virtualized
      // row key never drifts while the group keeps accumulating.
      const openId = chat.openChangesReceiptItemId;
      if (openId) {
        const timeline = chat.timeline.map((item) =>
          item.type === "fileChange" && item.itemId === openId
            ? { ...item, changes: [...item.changes, ...event.changes.map((change) => ({ ...change }))] }
            : item,
        );
        return withTimeline(chat, timeline);
      }
      return {
        ...withTimeline(chat, [
          ...chat.timeline,
          {
            type: "fileChange",
            seq: nextSeq(),
            itemId: event.itemId,
            changes: event.changes.map((change) => ({ ...change })),
            ordinal: chat.nextChangesReceiptOrdinal,
            turnComplete: false,
          },
        ]),
        openChangesReceiptItemId: event.itemId,
      };
    }
    case "toolUse":
      return reduceToolUse(chat, event, nextSeq);
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
    case "planUpdate":
      return reducePlanUpdate(chat, event, nextSeq);
    case "usage":
      return reduceUsageEvent(chat, event, nextSeq);
    case "rateLimits":
      return { ...chat, rateLimits: event.payload };
    case "turnDone":
      return { ...finalizeStreaming(closeOpenChangesReceipt(chat)), turnActive: false, approvals: [] };
    case "turnFailed":
      return {
        ...finalizeStreaming(closeOpenChangesReceipt(chat)),
        turnActive: false,
        error: event.error,
        approvals: [],
      };
    case "approvalRequest":
      return reduceApprovalRequest(chat, event);
    case "commandOutput":
    case "noise":
      return chat;
  }
}

type ActiveTitleTurn = { seq: number; text: string; hidden: boolean };

/** Provider titles (and plan-derived candidates) are only candidates. Commit
 * at the completed-turn boundary through canAutoOwn/setChatTitle so a
 * durable manual owner wins. */
function trackPendingProviderTitle(
  chatId: string,
  event: AgentEvent,
  activeTitleTurn: ActiveTitleTurn | undefined,
) {
  if (event.kind === "sessionTitle" && activeTitleTurn && !activeTitleTurn.hidden && event.title.trim()) {
    pendingProviderTitleByChat.set(chatId, event.title);
  }
  if (event.kind === "planUpdate") {
    const items = normalizePlanItems(event.items);
    const candidate = items.find((item) => item.status !== "completed")?.text ?? items[0]?.text ?? "";
    if (activeTitleTurn && !activeTitleTurn.hidden && candidate) {
      pendingProviderTitleByChat.set(chatId, candidate);
    }
  }
}

function trackTurnLifecycle(
  chatId: string,
  event: AgentEvent,
  activeTitleTurn: ActiveTitleTurn | undefined,
) {
  if (event.kind === "turnStarted") {
    interruptedByUser.delete(chatId);
    if (activityEligible(chatId)) agentTurnStarted(chatId);
    return;
  }
  if (event.kind !== "turnDone" && event.kind !== "turnFailed") return;
  activeTitleTurnByChat.delete(chatId);
  // #231 review fix: a `changesReview` flip while this turn was active
  // deferred its reflow (replacing the whole timeline from persisted
  // history mid-stream would wipe live-only rows/buffered deltas). The
  // terminal event above already closed the receipt group and set
  // `turnActive: false`, so it's now safe to run the deferred re-fold.
  if (pendingChangesReceiptReflow.delete(chatId)) void reflowChangesReceiptFold(chatId);
  // #231 PR3: a live turn just closed — if this chat's changes-review store
  // target is already pointed at it, refresh it. Live-only (not called from
  // `stateFromHistory`'s replay), same as the activity-glow calls below.
  // Gated: with `changesReview` off nothing ever sets a review target, so
  // this would be a guaranteed no-op — skip it rather than call it anyway.
  if (flagEnabled("changesReview")) notifyChangesReviewTurnCompleted(chatId);
  const titleEligible = event.kind === "turnDone" && event.status === "completed";
  if (titleEligible) {
    if (activeTitleTurn && !activeTitleTurn.hidden) {
      const completed = completedTitleTurnsByChat.get(chatId) ?? [];
      if (!completed.some((turn) => turn.seq === activeTitleTurn.seq)) {
        completedTitleTurnsByChat.set(chatId, [
          ...completed,
          { seq: activeTitleTurn.seq, text: activeTitleTurn.text },
        ]);
      }
    }
    maybeRefreshDynamicTitle(chatId);
  } else {
    pendingProviderTitleByChat.delete(chatId);
  }
  const wasInterrupted = interruptedByUser.delete(chatId);
  if (!activityEligible(chatId)) return;
  if (wasInterrupted) agentTurnCleared(chatId);
  else agentTurnDone(chatId);
}

function receiveAgentEvent(chatId: string, event: AgentEvent) {
  if (!chats[chatId]) return;
  if (isDeltaEvent(event)) {
    queuePendingDelta(chatId, event);
    return;
  }
  flushPendingDeltas(chatId);
  const chat = chats[chatId];
  if (!chat) return;
  setChats(chatId, reduceAgentEvent(chat, event, () => takeSeq(chatId)));
  const activeTitleTurn = activeTitleTurnByChat.get(chatId);
  trackPendingProviderTitle(chatId, event, activeTitleTurn);
  trackTurnLifecycle(chatId, event, activeTitleTurn);
}

// `previousModel` is the last model the backend session is known to be
// running under (the session-start model, or the last successfully applied
// selection) — what a failed live switch reverts to.
function queueAgentChatSetModel(
  chatId: string,
  sessionId: string,
  model: string | null,
  previousModel: string | null,
) {
  const generation = ensureGenerations.get(chatId) ?? 0;
  const sequence = (setModelRequestSeqByChat.get(chatId) ?? 0) + 1;
  setModelRequestSeqByChat.set(chatId, sequence);
  const touch = modelTouchByChat.get(chatId) ?? 0;
  const previous = pendingSetModelByChat.get(chatId)?.promise ?? Promise.resolve();
  const promise = previous
    .catch(() => undefined)
    .then(async () => {
      const current = chats[chatId];
      if ((ensureGenerations.get(chatId) ?? 0) !== generation) return;
      if (
        !current ||
        agentBackendDescriptor(current.provider).nativePayload.model !== "sessionState" ||
        current.sessionId !== sessionId
      ) return;
      await agentChatSetModel(sessionId, model);
    })
    .catch((error) => {
      if ((ensureGenerations.get(chatId) ?? 0) !== generation || !chats[chatId]) return;
      // A newer user selection landed while this request was in flight —
      // reverting now would clobber it, so only the error surfaces.
      if ((modelTouchByChat.get(chatId) ?? 0) === touch) {
        setChats(chatId, { model: previousModel, error: errorText(error) });
      } else {
        setChats(chatId, { error: errorText(error) });
      }
    });
  pendingSetModelByChat.set(chatId, { promise, sequence });
  void promise.then(() => {
    const pending = pendingSetModelByChat.get(chatId);
    if (pending?.promise === promise && pending.sequence === sequence) {
      pendingSetModelByChat.delete(chatId);
      setModelRequestSeqByChat.delete(chatId);
    }
  });
}

function maybeRefreshDynamicTitle(chatId: string) {
  const row = findChat(chatId);
  const chat = chats[chatId];
  const providerTitle = pendingProviderTitleByChat.get(chatId);
  pendingProviderTitleByChat.delete(chatId);
  if (!row || !chat || !canAutoOwn(chatId)) return;

  const completedUserTexts = (completedTitleTurnsByChat.get(chatId) ?? []).map(
    (turn) => turn.text,
  );
  const title = selectDynamicAgentTitle({
    currentTitle: row.title,
    titleSource: chatTitleSourceForPolicy(row),
    completedUserTexts,
    providerTitle,
  });
  if (title) void setChatTitle(chatId, title).catch(() => undefined);
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

function applyMessageHistoryEntry(
  chat: AgentChatState,
  entry: Extract<AgentTimelineEntry, { entryType: "message" }>,
): AgentChatState {
  if (entry.role === "user") {
    return {
      ...withTimeline(chat, [
        ...chat.timeline,
        {
          type: "userMessage",
          seq: entry.seq,
          text: entry.content,
          ...(isInternalSwarmSynthesisPrompt(entry.content) ? { hidden: true } : {}),
        },
      ]),
      error: null,
    };
  }
  if (entry.role === "assistant") {
    return withTimeline(chat, [
      ...chat.timeline,
      { type: "assistantText", seq: entry.seq, text: entry.content, streaming: false },
    ]);
  }
  return chat;
}

/** Attaches a persisted "attachments" item's image paths to the most recent
 * user message in the timeline (the prompt they shipped with). */
function applyAttachmentsHistoryEntry(
  chat: AgentChatState,
  payload: string,
): AgentChatState {
  const paths = parseAttachmentPaths(payload);
  if (paths.length === 0) return chat;
  const timeline = chat.timeline.slice();
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const item = timeline[i];
    if (item.type === "userMessage") {
      timeline[i] = { ...item, images: paths };
      break;
    }
  }
  return withTimeline(chat, timeline);
}

/** Records a completed turn's latest (non-hidden) user prompt as a title
 * candidate, deduped by seq. */
function trackCompletedTitleTurn(chatId: string, chat: AgentChatState) {
  const latestUser = [...chat.timeline].reverse().find((item) => item.type === "userMessage");
  if (!latestUser || latestUser.type !== "userMessage" || latestUser.hidden) return;
  const completed = completedTitleTurnsByChat.get(chatId) ?? [];
  if (completed.some((turn) => turn.seq === latestUser.seq)) return;
  completedTitleTurnsByChat.set(chatId, [
    ...completed,
    { seq: latestUser.seq, text: latestUser.text },
  ]);
}

function stateFromHistory(
  chatId: string,
  provider: AgentProvider,
  model: string | null,
  engine: AgentEngine,
  entries: AgentTimelineEntry[],
): AgentChatState {
  let chat = { ...emptyState(provider, model, engine), historyLoaded: true };
  let maxSeq = 0;
  completedTitleTurnsByChat.delete(chatId);
  for (const entry of [...entries].sort((a, b) => a.seq - b.seq)) {
    maxSeq = Math.max(maxSeq, entry.seq);
    if (entry.entryType === "message") {
      chat = applyMessageHistoryEntry(chat, entry);
      continue;
    }
    if (entry.kind === "attachments") {
      chat = applyAttachmentsHistoryEntry(chat, entry.payload);
      continue;
    }
    const event = parseAgentEvent(entry.payload);
    if (!event) continue;
    if (event.kind === "thinkingFinal" && isBlankText(event.text)) continue;
    chat = reduceAgentEvent(chat, event, () => entry.seq);
    if (event.kind === "turnDone" && event.status === "completed") {
      trackCompletedTitleTurn(chatId, chat);
    }
    if (event.kind === "turnDone") chat = { ...chat, error: null };
  }
  nextSeqByChat.set(chatId, maxSeq + 1);
  return chat;
}

/** Re-derives `timeline` (and the change-receipt fold state riding on it —
 *  `openChangesReceiptItemId`/`nextChangesReceiptOrdinal`) from persisted
 *  history for an already-hydrated chat, WITHOUT touching live session
 *  identity (`sessionId`/`turnActive`/`approvals`/...). Used when the
 *  `changesReview` flag flips (#231 PR3 review fix): the fold's shape
 *  (grouped-by-turn vs raw-per-event) depends on that flag, so a flip must
 *  re-fold every already-loaded chat immediately — otherwise a chat hydrated
 *  before the flip keeps stale ordinals (mis-indexing `changes_list_turn_change_sets`
 *  once the flag is on) or a stale grouped shape (once the flag is off).
 *
 * Deliberately NOT `hydrateAgentChatHistory`: that function early-returns
 * once a session is live (`sessionId` set), which is exactly the common case
 * here (a chat already mid-conversation when the flag flips). This reuses
 * the same underlying fetch-and-fold primitives (`agentChatHistory` +
 * `stateFromHistory`) `hydrateAgentChatHistory`/`ensureAgentChat` are built
 * from, guarded the same way (bump `ensureGenerations`, drop any pending
 * `hydratePromises` entry) so a stale in-flight ensure/hydrate/retry for this
 * chat recognizes it's superseded and a rapid double-flip only ever commits
 * its LAST re-fold. */
async function reflowChangesReceiptFold(chatId: string): Promise<void> {
  const chat = chats[chatId];
  if (!chat || !chat.historyLoaded) return;

  const generation = (ensureGenerations.get(chatId) ?? 0) + 1;
  ensureGenerations.set(chatId, generation);
  hydratePromises.delete(chatId);
  const stale = () => (ensureGenerations.get(chatId) ?? 0) !== generation || !chats[chatId];

  let history: AgentTimelineEntry[];
  try {
    history = await agentChatHistory(chatId);
  } catch {
    return; // best-effort — a failed re-fold just leaves the previous fold in place
  }
  if (stale()) return;

  const current = chats[chatId];
  const loaded = stateFromHistory(chatId, current.provider, current.model, current.engine, history);
  setChats(chatId, {
    timeline: loaded.timeline,
    openChangesReceiptItemId: loaded.openChangesReceiptItemId,
    nextChangesReceiptOrdinal: loaded.nextChangesReceiptOrdinal,
  });
}

// Chats whose reflow was deferred because a turn was active when
// `changesReview` flipped (below) — `reduceOnTurnClose` (the turnDone/
// turnFailed live-event branch) drains this once the turn's terminal event
// has been applied. `disposeAgentChat` also drops entries here so a disposed
// chat's stale chatId never triggers a reflow for a gone/reused slot.
const pendingChangesReceiptReflow = new Set<string>();

/** Re-derives one chat's fold immediately if idle, or defers it to the next
 *  `turnDone`/`turnFailed` if a turn is active. `reflowChangesReceiptFold`
 *  replaces the WHOLE timeline from persisted history — mid-stream rows
 *  (`textDelta`/`thinkingDelta`/`commandOutput`/buffered deltas) are
 *  live-only and never persisted, so running it against an active turn would
 *  wipe that turn's in-progress chrome out from under the user. */
function reflowOrDeferChangesReceiptFold(chatId: string): void {
  if (chats[chatId]?.turnActive) {
    pendingChangesReceiptReflow.add(chatId);
    return;
  }
  void reflowChangesReceiptFold(chatId);
}

// Re-fold every already-hydrated chat whenever `changesReview` actually
// CHANGES value (either edge) — `subscribeToFlagChanges` fires on any flag
// flip, so this snapshot-compares just the one flag it cares about rather
// than reflowing on unrelated Settings changes.
let lastChangesReviewFlagValue = flagEnabled("changesReview");
subscribeToFlagChanges(() => {
  const next = flagEnabled("changesReview");
  if (next === lastChangesReviewFlagValue) return;
  lastChangesReviewFlagValue = next;
  for (const chatId of Object.keys(chats)) {
    reflowOrDeferChangesReceiptFold(chatId);
  }
});

/**
 * A chatId with no live entry in `chats` yet may still be a chat that
 * already ran in a previous app session (resumed after quit/relaunch), not
 * a genuinely new one — `chats` is purely in-memory and starts empty on
 * every launch. Its actual starting model lives in the `agent_sessions`
 * table, keyed by chatId, independent of the global per-provider "last
 * selected model" preference the caller's fallback carries. A chat that
 * never had a session yet (truly new) has no row, so this is a no-op and
 * the caller's fallback (the global preference) is used, matching intent.
 */
async function resolveResumedModel(
  chatId: string,
  provider: AgentProvider,
  fallbackModel: string | null,
): Promise<string | null> {
  try {
    const session = await agentSessionLatestForChat(chatId);
    const resumedModel = session?.model ? nativeChatModel(provider, session.model) : null;
    return resumedModel ?? fallbackModel;
  } catch {
    return fallbackModel;
  }
}

/** The body of `ensureAgentChat`'s in-flight session-establishment promise:
 * resolves the resumed model (new chat only), loads history if not already
 * loaded, and starts the provider session if one isn't already live.
 * `disposeAgentChat` bumps the generation; a stale run (per `stale()`) must
 * stop writing — its awaited continuations would otherwise resurrect the old
 * provider's session into a disposed or re-created chat entry. */
/** For a brand-new chat, resolves its resumed model (from a previous app
 * session's `agent_sessions` row) and applies it if a newer user selection
 * hasn't since touched the model. Returns `false` if a stale check fired
 * mid-await, telling the caller to stop without starting a session. */
async function resolveEnsuredModel(
  chatId: string,
  provider: AgentProvider,
  safeModel: string | null,
  created: boolean,
  stale: () => boolean,
): Promise<boolean> {
  if (!created) return true;
  const touch = modelTouchByChat.get(chatId) ?? 0;
  const resumedModel = await resolveResumedModel(chatId, provider, safeModel);
  if (stale()) return false;
  if (resumedModel !== safeModel && (modelTouchByChat.get(chatId) ?? 0) === touch) {
    setChats(chatId, { model: resumedModel });
  }
  return true;
}

/** Loads the chat's persisted timeline if it hasn't been loaded yet. Returns
 * `false` if a stale check fired mid-await, telling the caller to stop
 * without starting a session. */
async function loadEnsuredHistory(
  chatId: string,
  projectRoot: string,
  provider: AgentProvider,
  safeModel: string | null,
  engine: AgentEngine,
  remote: RemotePty | null,
  stale: () => boolean,
): Promise<boolean> {
  if (chats[chatId].historyLoaded) return true;
  const previous = chats[chatId];
  const history = await agentChatHistory(chatId);
  if (stale()) return false;
  const loadedModel = chats[chatId]?.model ?? safeModel;
  const loaded = stateFromHistory(chatId, provider, loadedModel, engine, history);
  setChats(chatId, {
    ...loaded,
    projectRoot,
    remoteHost: remote?.host ?? null,
    effort: previous?.effort ?? loaded.effort,
    mode: previous?.mode ?? loaded.mode,
    providerSwitched: previous?.providerSwitched ?? loaded.providerSwitched,
  });
  return true;
}

/** Resolves the resumed model (new chat only) and loads history if not
 * already loaded. Returns `false` if a stale check fired mid-await, telling
 * the caller to stop without starting a session. */
async function resolveEnsuredModelAndHistory(
  chatId: string,
  projectRoot: string,
  provider: AgentProvider,
  safeModel: string | null,
  engine: AgentEngine,
  remote: RemotePty | null,
  created: boolean,
  stale: () => boolean,
): Promise<boolean> {
  if (!(await resolveEnsuredModel(chatId, provider, safeModel, created, stale))) return false;
  return loadEnsuredHistory(chatId, projectRoot, provider, safeModel, engine, remote, stale);
}

/** Starts the provider session if one isn't already live, then reconciles
 * any model/mode picked by the caller while the start was in flight. */
async function startEnsuredSession(
  chatId: string,
  projectRoot: string,
  provider: AgentProvider,
  safeModel: string | null,
  engine: AgentEngine,
  options: EnsureAgentChatOptions,
  remote: RemotePty | null,
  stale: () => boolean,
): Promise<void> {
  if (stale() || chats[chatId].sessionId) return;
  const startModel = chats[chatId]?.model ?? safeModel;
  const startMode = chats[chatId].mode;
  const overrides = modeOverrides(provider, startMode);
  const sessionId = await agentChatStart({
    chatId,
    projectRoot,
    provider,
    model: startModel,
    sandbox: overrides.sandbox,
    approvalPolicy: overrides.approvalPolicy,
    permissionMode: overrides.permissionMode,
    ...options,
    engine,
    effort: chats[chatId].effort,
    remote,
    onEvent: (event) => receiveAgentEvent(chatId, event),
  });
  if (stale()) {
    // Started for a chat that was disposed mid-flight — release it.
    void agentChatDispose(sessionId).catch(() => undefined);
    return;
  }
  const currentModel = chats[chatId]?.model ?? startModel;
  setChats(chatId, {
    sessionId,
    projectRoot,
    provider,
    engine,
    model: currentModel,
    error: null,
    remoteHost: remote?.host ?? null,
  });
  if (
    agentBackendDescriptor(provider).nativePayload.model === "sessionState" &&
    currentModel !== startModel
  ) {
    queueAgentChatSetModel(chatId, sessionId, currentModel, startModel);
  }
  // A mode picked while the start was in flight never reached the backend
  // (the start captured the old overrides) — reconcile it now.
  const currentMode = chats[chatId]?.mode ?? null;
  if (currentMode !== startMode) {
    queueAgentChatSetMode(chatId, sessionId, provider, currentMode);
  }
}

async function runEnsureAgentChatSession(
  chatId: string,
  projectRoot: string,
  provider: AgentProvider,
  safeModel: string | null,
  engine: AgentEngine,
  options: EnsureAgentChatOptions,
  remote: RemotePty | null,
  created: boolean,
  stale: () => boolean,
  isCurrentPromise: () => boolean,
): Promise<void> {
  try {
    const shouldContinue = await resolveEnsuredModelAndHistory(
      chatId,
      projectRoot,
      provider,
      safeModel,
      engine,
      remote,
      created,
      stale,
    );
    if (!shouldContinue) return;
    await startEnsuredSession(chatId, projectRoot, provider, safeModel, engine, options, remote, stale);
  } catch (error) {
    if (!stale() && chats[chatId]) setChats(chatId, { error: errorText(error) });
    throw error;
  } finally {
    if (isCurrentPromise()) ensurePromises.delete(chatId);
  }
}

/** Applies caller-supplied effort/mode overrides on top of a freshly
 * (re)ensured chat: always for a brand-new chat, otherwise only when the
 * live session hasn't started yet and the field is still unset (a live
 * session's effort/mode must go through the explicit set* actions instead). */
function applyEnsureOverrides(
  chatId: string,
  options: Pick<EnsureAgentChatOptions, "effort" | "mode">,
  created: boolean,
) {
  if (
    options.effort !== undefined &&
    (created || (!chats[chatId].sessionId && chats[chatId].effort === null))
  ) {
    setChats(chatId, { effort: options.effort?.trim() || null });
  }
  if (
    options.mode !== undefined &&
    (created || (!chats[chatId].sessionId && chats[chatId].mode === null))
  ) {
    setChats(chatId, { mode: options.mode || null });
  }
}

export async function ensureAgentChat(
  chatId: string,
  projectRoot: string,
  provider: AgentProvider,
  model: string | null,
  options: EnsureAgentChatOptions = {},
): Promise<void> {
  const live = chats[chatId];
  if (live?.sessionId) return;
  const existing = ensurePromises.get(chatId);
  if (existing) return existing;
  const safeModel = nativeChatModel(provider, model);
  const remote = remotePtyFor(projectRoot);
  const engine: AgentEngine = remote ? "v1" : (options.engine ?? loadAgentEngine());
  const created = !live;
  if (created) setChats(chatId, emptyState(provider, safeModel, engine));
  setChats(chatId, {
    projectRoot,
    provider,
    engine,
    model: safeModel,
    remoteHost: remote?.host ?? null,
  });
  applyEnsureOverrides(chatId, options, created);

  // disposeAgentChat bumps the generation; a stale ensure must stop writing —
  // its awaited continuations would otherwise resurrect the old provider's
  // session into a disposed or re-created chat entry.
  const generation = ensureGenerations.get(chatId) ?? 0;
  const stale = () => (ensureGenerations.get(chatId) ?? 0) !== generation || !chats[chatId];

  let promise: Promise<void> | undefined;
  promise = runEnsureAgentChatSession(
    chatId,
    projectRoot,
    provider,
    safeModel,
    engine,
    options,
    remote,
    created,
    stale,
    () => ensurePromises.get(chatId) === promise,
  );

  ensurePromises.set(chatId, promise);
  return promise;
}

/** The body of `hydrateAgentChatHistory`'s in-flight promise: resolves the
 * resumed model (new chat only), then loads history unless something else
 * already loaded it or a stale check fired mid-await. */
async function runHydrateAgentChatHistorySession(
  chatId: string,
  projectRoot: string,
  provider: AgentProvider,
  safeModel: string | null,
  engine: AgentEngine,
  remote: RemotePty | null,
  created: boolean,
  stale: () => boolean,
  isCurrentPromise: () => boolean,
): Promise<void> {
  try {
    if (!(await resolveEnsuredModel(chatId, provider, safeModel, created, stale))) return;
    const previous = chats[chatId];
    const history = await agentChatHistory(chatId);
    if (stale() || chats[chatId].historyLoaded) return;
    const loadedModel = chats[chatId]?.model ?? safeModel;
    const loaded = stateFromHistory(chatId, provider, loadedModel, engine, history);
    setChats(chatId, {
      ...loaded,
      projectRoot,
      remoteHost: remote?.host ?? null,
      effort: previous?.effort ?? loaded.effort,
      mode: previous?.mode ?? loaded.mode,
      providerSwitched: previous?.providerSwitched ?? loaded.providerSwitched,
    });
  } finally {
    if (isCurrentPromise()) hydratePromises.delete(chatId);
  }
}

/** A remote project always runs v1; otherwise the caller's override, then
 * the chat's own engine if it's already live, then the configured default. */
function resolveHydrateEngine(
  remote: RemotePty | null,
  options: Pick<EnsureAgentChatOptions, "engine">,
  live: AgentChatState | undefined,
): AgentEngine {
  if (remote) return "v1";
  return options.engine ?? live?.engine ?? loadAgentEngine();
}

export async function hydrateAgentChatHistory(
  chatId: string,
  projectRoot: string,
  provider: AgentProvider,
  model: string | null,
  options: Pick<EnsureAgentChatOptions, "engine" | "effort" | "mode"> = {},
): Promise<void> {
  const live = chats[chatId];
  if (live?.sessionId) return;
  const safeModel = nativeChatModel(provider, model);
  const remote = remotePtyFor(projectRoot);
  const engine = resolveHydrateEngine(remote, options, live);
  const created = !live;
  if (created) setChats(chatId, emptyState(provider, safeModel, engine));
  setChats(chatId, {
    projectRoot,
    provider,
    engine,
    model: chats[chatId]?.model ?? safeModel,
    remoteHost: remote?.host ?? null,
  });
  applyEnsureOverrides(chatId, options, created);
  if (chats[chatId].historyLoaded) return;
  const existing = hydratePromises.get(chatId);
  if (existing) return existing;

  const generation = ensureGenerations.get(chatId) ?? 0;
  const stale = () => (ensureGenerations.get(chatId) ?? 0) !== generation || !chats[chatId];

  let promise: Promise<void> | undefined;
  promise = runHydrateAgentChatHistorySession(
    chatId,
    projectRoot,
    provider,
    safeModel,
    engine,
    remote,
    created,
    stale,
    () => hydratePromises.get(chatId) === promise,
  );

  hydratePromises.set(chatId, promise);
  return promise;
}

export function setAgentChatModel(chatId: string, model: string | null) {
  const chat = chats[chatId];
  if (!chat) return;
  // `chat` is a reactive store proxy — snapshot the pre-update model now, or
  // reading it after setChats below would return the just-written value.
  const previousModel = chat.model;
  modelTouchByChat.set(chatId, (modelTouchByChat.get(chatId) ?? 0) + 1);
  const safeModel = nativeChatModel(chat.provider, model);
  setChats(chatId, { model: safeModel });
  // Session-state model backends need an explicit update; turn-payload
  // backends read this store value when the next message is sent.
  if (
    agentBackendDescriptor(chat.provider).nativePayload.model === "sessionState" &&
    chat.sessionId
  ) {
    queueAgentChatSetModel(chatId, chat.sessionId, safeModel, previousModel);
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

export function setAgentChatMode(chatId: string, mode: string | null) {
  const chat = chats[chatId];
  if (!chat) return;
  setChats(chatId, { mode });
  // A live session pins its mode at start — push the change into the running
  // session (codex applies it next turn, claude via setPermissionMode).
  if (!chat.sessionId) return;
  queueAgentChatSetMode(chatId, chat.sessionId, chat.provider, mode);
}

// Sends read SessionState on the backend, so a send racing ahead of an
// in-flight set-mode would run the turn under the OLD sandbox/permissions
// while the picker shows the new one. sendAgentMessage awaits this chain.
const pendingSetModeByChat = new Map<string, Promise<void>>();

function queueAgentChatSetMode(
  chatId: string,
  sessionId: string,
  provider: AgentProvider,
  mode: string | null,
) {
  const previous = pendingSetModeByChat.get(chatId) ?? Promise.resolve();
  const promise = previous
    .catch(() => undefined)
    .then(async () => {
      const current = chats[chatId];
      if (!current || current.sessionId !== sessionId) return;
      await agentChatSetMode(sessionId, modeOverrides(provider, mode));
    })
    .catch((error) => {
      if (chats[chatId]) setChats(chatId, { error: errorText(error) });
    });
  pendingSetModeByChat.set(chatId, promise);
  void promise.then(() => {
    if (pendingSetModeByChat.get(chatId) === promise) pendingSetModeByChat.delete(chatId);
  });
}

function sendOptions(chat: AgentChatState, images: string[]) {
  const payload = agentBackendDescriptor(chat.provider).nativePayload;
  return {
    effort: payload.effort === "turn" ? chat.effort : null,
    model: payload.model === "turn" ? chat.model : null,
    images: [...images],
  };
}

function assertImageInputSupported(chat: AgentChatState, images: string[]) {
  if (
    images.some((image) => image.trim().length > 0) &&
    !supportsBackendCapability(chat.provider, "imageInput", "nativeChat", chat.engine)
  ) {
    throw new Error(
      backendCapabilityReason(chat.provider, "imageInput", "nativeChat", chat.engine) ??
        "This backend cannot accept image input",
    );
  }
}

export async function switchAgentChatProvider(
  chatId: string,
  provider: AgentProvider,
  model: string | null,
  effort: string | null = null,
  mode: string | null = null,
  engine: AgentEngine = loadAgentEngine(),
): Promise<boolean> {
  const current = chats[chatId];
  if (current?.turnActive) throw new Error("Cannot switch provider while a turn is active");

  const row = findChat(chatId);
  const projectRoot = current?.projectRoot ?? row?.projectRoot ?? null;
  if (!projectRoot) throw new Error("Agent chat is not started");

  await disposeAgentChat(chatId);
  await setChatAgent(chatId, provider, "agent");
  await ensureAgentChat(chatId, projectRoot, provider, nativeChatModel(provider, model), {
    engine,
    effort,
    mode,
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

/** Starts the session for a not-yet-started chat's first send, replaying the
 * optimistic user message under the resolved seq if history-load raced it
 * away. Returns `null` if a stale check fired mid-await, telling the caller
 * to stop silently. */
async function ensureSendableSession(
  chatId: string,
  chat: AgentChatState,
  projectRoot: string | null,
  text: string,
  imageList: string[],
  optimisticSeq: number,
  options: SendAgentMessageOptions,
  stale: () => boolean,
): Promise<{ sessionId: string; optimisticSeq: number } | null> {
  if (!projectRoot) throw new Error("Agent chat is not started");
  await ensureAgentChat(chatId, projectRoot, chat.provider, chat.model, {
    engine: chat.engine,
    effort: chat.effort,
  });
  if (stale()) return null;
  const sessionId = chats[chatId]?.sessionId ?? null;
  if (!sessionId) throw new Error("Agent chat is not started");
  const hasOptimisticMessage = chats[chatId]?.timeline.some(
    (item) => item.type === "userMessage" && item.optimistic && item.seq === optimisticSeq,
  );
  if (!hasOptimisticMessage) {
    optimisticSeq = takeSeq(chatId);
    appendOptimisticUserMessage(chatId, optimisticSeq, text, imageList, options);
    activeTitleTurnByChat.set(chatId, { seq: optimisticSeq, text, hidden: options.hidden === true });
  } else {
    setChats(chatId, { error: null });
  }
  return { sessionId, optimisticSeq };
}

/** Resolves the live chat/session to send into, waiting out any in-flight
 * model or mode change first — the backend reads session-state model/mode at
 * send time, so a send racing ahead of one would run the turn under the old
 * value. Returns `null` if the session moved out from under it (stale check,
 * or the session id changed) at any point, telling the caller to stop
 * silently. */
async function resolveSendTarget(
  chatId: string,
  sessionId: string,
  stale: () => boolean,
): Promise<{ chat: AgentChatState; sessionId: string } | null> {
  const sendTarget = () => {
    const current = chats[chatId];
    const currentSessionId = current?.sessionId ?? null;
    if (!current || !currentSessionId || currentSessionId !== sessionId) return null;
    return { chat: current, sessionId: currentSessionId };
  };

  let target = sendTarget();
  if (!target) return null;
  if (agentBackendDescriptor(target.chat.provider).nativePayload.model === "sessionState") {
    await pendingSetModelByChat.get(chatId)?.promise;
    if (stale()) return null;
    target = sendTarget();
    if (!target) return null;
  }
  const pendingMode = pendingSetModeByChat.get(chatId);
  if (pendingMode) {
    await pendingMode;
    if (stale()) return null;
    target = sendTarget();
    if (!target) return null;
  }
  return target;
}

/** Rolls an optimistic send back out of the timeline/seq counter/active
 * title turn on failure, and (for OMP/Pi, whose transports can die between
 * turns) forgets the dead native session handle so the next send re-enters
 * `ensureAgentChat`, which resumes the persisted provider session instead of
 * dispatching into a dead one. */
function rollbackFailedSend(
  chatId: string,
  chat: AgentChatState,
  optimisticSeq: number,
  error: unknown,
) {
  if ((nextSeqByChat.get(chatId) ?? 1) === optimisticSeq + 1) {
    nextSeqByChat.set(chatId, optimisticSeq);
  }
  if (activeTitleTurnByChat.get(chatId)?.seq === optimisticSeq) {
    activeTitleTurnByChat.delete(chatId);
  }
  setChats(chatId, {
    ...((chat.provider === "omp" || chat.provider === "pi") ? { sessionId: null } : {}),
    turnActive: false,
    error: errorText(error),
    timeline: (chats[chatId]?.timeline ?? []).filter(
      (item) => item.type !== "userMessage" || !item.optimistic || item.seq !== optimisticSeq,
    ),
  });
  if (activityEligible(chatId)) agentTurnCleared(chatId);
}

export async function sendAgentMessage(
  chatId: string,
  text: string,
  images: string[] = [],
  options: SendAgentMessageOptions = {},
): Promise<void> {
  const generation = ensureGenerations.get(chatId) ?? 0;
  const stale = () => (ensureGenerations.get(chatId) ?? 0) !== generation || !chats[chatId];
  const chat = chats[chatId];
  if (!chat) throw new Error("Agent chat is not started");
  let sessionId = chat.sessionId;
  const projectRoot = chat.projectRoot;
  if (!sessionId && !projectRoot) throw new Error("Agent chat is not started");
  assertImageInputSupported(chat, images);
  flushPendingDeltas(chatId);
  let optimisticSeq = takeSeq(chatId);
  const imageList = [...images];
  appendOptimisticUserMessage(chatId, optimisticSeq, text, imageList, options);
  activeTitleTurnByChat.set(chatId, {
    seq: optimisticSeq,
    text,
    hidden: options.hidden === true,
  });
  if (activityEligible(chatId)) agentTurnStarted(chatId);
  try {
    if (!sessionId) {
      const resolved = await ensureSendableSession(
        chatId,
        chat,
        projectRoot,
        text,
        imageList,
        optimisticSeq,
        options,
        stale,
      );
      if (!resolved) return;
      sessionId = resolved.sessionId;
      optimisticSeq = resolved.optimisticSeq;
    }

    const target = await resolveSendTarget(chatId, sessionId, stale);
    if (!target) return;
    // ensureAgentChat can force a remote session onto v1 after the first
    // capability check. Gate the live state that will actually dispatch.
    assertImageInputSupported(target.chat, imageList);
    await agentChatSend(target.sessionId, text, sendOptions(target.chat, imageList));
  } catch (error) {
    if (stale()) throw error;
    rollbackFailedSend(chatId, chat, optimisticSeq, error);
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
  if (!supportsBackendCapability(chat.provider, "approvalEvents", "nativeChat", chat.engine)) {
    throw new Error(
      backendCapabilityReason(chat.provider, "approvalEvents", "nativeChat", chat.engine) ??
        "This backend cannot resolve approval requests",
    );
  }

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
  const generation = ensureGenerations.get(chatId) ?? 0;
  const stale = () => (ensureGenerations.get(chatId) ?? 0) !== generation || !chats[chatId];
  const chat = chats[chatId];
  const sessionId = chat?.sessionId;
  if (!sessionId || !chat) throw new Error("Agent chat is not started");
  if (!supportsBackendCapability(chat.provider, "steerTurn", "nativeChat", chat.engine)) {
    throw new Error(
      backendCapabilityReason(chat.provider, "steerTurn", "nativeChat", chat.engine) ??
        "This backend cannot steer a running turn",
    );
  }
  flushPendingDeltas(chatId);
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
    if (stale()) throw error;
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
}

export async function retryAgentChatConnection(chatId: string): Promise<void> {
  const chat = chats[chatId];
  if (!chat || (chat.provider !== "omp" && chat.provider !== "pi")) {
    throw new Error("This chat does not support connection retry");
  }
  if (!chat.projectRoot) throw new Error("Agent chat is not started");

  const generation = (ensureGenerations.get(chatId) ?? 0) + 1;
  ensureGenerations.set(chatId, generation);
  const sessionId = chat.sessionId;
  ensurePromises.delete(chatId);
  hydratePromises.delete(chatId);
  pendingSetModelByChat.delete(chatId);
  pendingSetModeByChat.delete(chatId);
  setModelRequestSeqByChat.delete(chatId);
  dropPendingDeltas(chatId);
  setChats(chatId, {
    sessionId: null,
    turnActive: false,
    approvals: [],
  });

  if (sessionId) await agentChatDispose(sessionId).catch(() => undefined);
  const current = chats[chatId];
  if (
    (ensureGenerations.get(chatId) ?? 0) !== generation
    || !current
    || current.provider !== chat.provider
  ) return;

  await ensureAgentChat(chatId, chat.projectRoot, chat.provider, chat.model, {
    engine: chat.engine,
    effort: chat.effort,
    mode: chat.mode,
  });
}

/** The chat was deleted or is switching provider: release the backend session
 *  (kills any running turn, closes the bridge chat / thread subscription),
 *  then drop the store entry so any late events for this chat are ignored
 *  instead of resurrecting activity state. */
export async function disposeAgentChat(chatId: string): Promise<void> {
  const sessionId = chats[chatId]?.sessionId;
  const dispose = sessionId ? agentChatDispose(sessionId).catch(() => undefined) : Promise.resolve();
  // Invalidate any in-flight ensure: its awaited continuations must not write
  // stale session state into a disposed (or re-created) chat entry.
  ensureGenerations.set(chatId, (ensureGenerations.get(chatId) ?? 0) + 1);
  interruptedByUser.delete(chatId);
  pendingProviderTitleByChat.delete(chatId);
  completedTitleTurnsByChat.delete(chatId);
  activeTitleTurnByChat.delete(chatId);
  nextSeqByChat.delete(chatId);
  ensurePromises.delete(chatId);
  hydratePromises.delete(chatId);
  pendingSetModelByChat.delete(chatId);
  pendingSetModeByChat.delete(chatId);
  setModelRequestSeqByChat.delete(chatId);
  modelTouchByChat.delete(chatId);
  pendingChangesReceiptReflow.delete(chatId);
  dropPendingDeltas(chatId);
  if (chats[chatId]) setChats(produce((all) => { delete all[chatId]; }));
  await dispose;
}
