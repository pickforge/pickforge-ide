import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => {
  const channels: { onmessage?: (event: unknown) => void }[] = [];
  const invoke = vi.fn();
  class Channel {
    onmessage?: (event: unknown) => void;
    constructor() {
      channels.push(this);
    }
  }
  return { channels, invoke, Channel };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  Channel: tauri.Channel,
}));

const activity = vi.hoisted(() => ({
  agentTurnStarted: vi.fn(),
  agentTurnDone: vi.fn(),
  agentTurnCleared: vi.fn(),
}));
const workspace = vi.hoisted(() => ({
  findChat: vi.fn(),
  isChatArchived: vi.fn(),
}));

vi.mock("../../src/stores/chatActivity", () => activity);
vi.mock("../../src/stores/workspace", () => ({ findChat: workspace.findChat }));
vi.mock("../../src/stores/chatArchive", () => ({ isChatArchived: workspace.isChatArchived }));

import {
  agentChat,
  approveAgentRequest,
  disposeAgentChat,
  ensureAgentChat,
  interruptAgentChat,
  sendAgentMessage,
  type AgentTimelineItem,
} from "../../src/stores/agentChat";
import type { AgentEvent, AgentTimelineEntry } from "../../src/lib/agentChat";

let counter = 0;

function nextChatId() {
  counter += 1;
  return `agent-chat-test-${counter}`;
}

function mockInvoke(history: AgentTimelineEntry[] = []) {
  tauri.invoke.mockImplementation((cmd: string) => {
    if (cmd === "agent_chat_history") return Promise.resolve(history);
    if (cmd === "agent_chat_start") return Promise.resolve("session-1");
    if (cmd === "agent_chat_send") return Promise.resolve();
    if (cmd === "agent_chat_interrupt") return Promise.resolve();
    if (cmd === "agent_chat_approve") return Promise.resolve();
    if (cmd === "agent_chat_steer") return Promise.resolve();
    return Promise.resolve(null);
  });
}

async function startChat(history: AgentTimelineEntry[] = [], model: string | null = null) {
  const chatId = nextChatId();
  mockInvoke(history);
  await ensureAgentChat(chatId, "/project", "codex", model);
  const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");
  return {
    chatId,
    emit: (event: AgentEvent) => startCall?.[1].onEvent.onmessage(event),
  };
}

function timeline(chatId: string): AgentTimelineItem[] {
  return agentChat(chatId)?.timeline ?? [];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function cumulativeUsageEvents(): AgentEvent[] {
  return [
    {
      kind: "usage",
      inputTokens: 100,
      cachedInputTokens: 10,
      outputTokens: 20,
      costUsd: 0.01,
      contextUsed: 1_000,
      contextWindow: 100_000,
    },
    {
      kind: "usage",
      inputTokens: 300,
      cachedInputTokens: 30,
      outputTokens: 60,
      costUsd: 0.03,
      contextUsed: 3_000,
      contextWindow: 100_000,
    },
    {
      kind: "usage",
      inputTokens: 600,
      cachedInputTokens: 60,
      outputTokens: 120,
      costUsd: 0.06,
      contextUsed: 6_000,
      contextWindow: 100_000,
    },
  ];
}

function historyFromEvents(events: AgentEvent[]): AgentTimelineEntry[] {
  return events.map((event, index) => ({
    entryType: "item",
    seq: index + 1,
    kind: event.kind,
    payload: JSON.stringify(event),
    createdAt: index + 1,
  }));
}

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.channels.splice(0);
  activity.agentTurnStarted.mockClear();
  activity.agentTurnDone.mockClear();
  activity.agentTurnCleared.mockClear();
  workspace.findChat.mockReset().mockImplementation((id: string) => ({ chatId: id }));
  workspace.isChatArchived.mockReset().mockReturnValue(false);
});

describe("agentChat store reducer", () => {
  it("streams and finalizes assistant text and thinking items", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "textDelta", text: "hel" });
    emit({ kind: "textDelta", text: "lo" });
    emit({ kind: "textFinal", itemId: null, text: "hello" });
    emit({ kind: "thinkingDelta", text: "rea" });
    emit({ kind: "thinkingDelta", text: "son" });
    emit({ kind: "thinkingFinal", itemId: "think-1", text: "reason" });

    expect(timeline(chatId)).toMatchObject([
      { type: "assistantText", text: "hello", streaming: false },
      { type: "thinking", text: "reason", streaming: false },
    ]);
  });

  it("ignores blank thinking final events", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "thinkingFinal", itemId: "think-1", text: "   " });

    expect(timeline(chatId)).toEqual([]);
  });

  it("keeps streamed thinking when a blank final arrives", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "thinkingDelta", text: "reason" });
    emit({ kind: "thinkingFinal", itemId: "think-1", text: "   " });

    expect(timeline(chatId)).toMatchObject([
      { type: "thinking", text: "reason", streaming: false },
    ]);
  });

  it("updates command completion by item id", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "commandStarted", itemId: "cmd-1", command: "bun test", cwd: null });
    emit({
      kind: "commandDone",
      itemId: "cmd-1",
      exitCode: 1,
      status: "failed",
      outputTail: "failed",
    });

    expect(timeline(chatId)).toMatchObject([
      {
        type: "command",
        itemId: "cmd-1",
        command: "bun test",
        status: "failed",
        exitCode: 1,
        outputTail: "failed",
      },
    ]);
  });

  it("appends command completion without a started item", async () => {
    const { chatId, emit } = await startChat();

    emit({
      kind: "commandDone",
      itemId: "cmd-orphan",
      exitCode: 0,
      status: "completed",
      outputTail: null,
    });

    expect(timeline(chatId)).toMatchObject([
      {
        type: "command",
        itemId: "cmd-orphan",
        command: "cmd-orphan",
        status: "completed",
        exitCode: 0,
        outputTail: null,
      },
    ]);
  });

  it("replaces the latest plan item", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "planUpdate", items: [{ text: "draft", completed: false }] });
    emit({ kind: "planUpdate", items: [{ text: "done", completed: true }] });

    expect(timeline(chatId)).toEqual([
      { type: "plan", seq: 1, items: [{ text: "done", completed: true }] },
    ]);
  });

  it("clears active turn and stores the error on turn failure", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "turnStarted" });
    emit({
      kind: "approvalRequest",
      approvalId: "approval-1",
      approvalKind: "command",
      detail: "Run bun test",
    });
    expect(agentChat(chatId)?.turnActive).toBe(true);
    expect(agentChat(chatId)?.approvals).toHaveLength(1);

    emit({ kind: "turnFailed", error: "boom" });

    expect(agentChat(chatId)?.turnActive).toBe(false);
    expect(agentChat(chatId)?.error).toBe("boom");
    expect(agentChat(chatId)?.approvals).toEqual([]);
  });

  it("finalizes streaming items on turn done", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "textDelta", text: "hello" });
    emit({ kind: "thinkingDelta", text: "checking" });
    emit({ kind: "turnDone", status: "completed" });

    expect(timeline(chatId)).toMatchObject([
      { type: "assistantText", text: "hello", streaming: false },
      { type: "thinking", text: "checking", streaming: false },
    ]);
  });

  it("drops blank streamed thinking on terminal turn events", async () => {
    const doneChat = await startChat();

    doneChat.emit({ kind: "thinkingDelta", text: "   " });
    doneChat.emit({ kind: "turnDone", status: "completed" });

    expect(timeline(doneChat.chatId)).toEqual([]);

    const failedChat = await startChat();

    failedChat.emit({ kind: "thinkingDelta", text: "" });
    failedChat.emit({ kind: "turnFailed", error: "boom" });

    expect(timeline(failedChat.chatId)).toEqual([]);
  });

  it("stores approval requests and clears them on turn done", async () => {
    const { chatId, emit } = await startChat();
    const detail = JSON.stringify({
      toolName: "Bash",
      input: { command: "bun test", cwd: "/project" },
      reason: "verify",
    });

    emit({
      kind: "approvalRequest",
      approvalId: "approval-1",
      approvalKind: "command",
      detail,
    });

    expect(agentChat(chatId)?.approvals).toEqual([
      {
        approvalId: "approval-1",
        kind: "command",
        detail,
        parsed: {
          command: "bun test",
          cwd: "/project",
          reason: "verify",
          toolName: "Bash",
        },
      },
    ]);
    expect(timeline(chatId)).toEqual([]);

    emit({ kind: "turnDone", status: "completed" });

    expect(agentChat(chatId)?.approvals).toEqual([]);
  });

  it("approves requests through IPC and removes pending approvals", async () => {
    const { chatId, emit } = await startChat();

    emit({
      kind: "approvalRequest",
      approvalId: "approval-1",
      approvalKind: "command",
      detail: "Run bun test",
    });

    await approveAgentRequest(chatId, "approval-1", "acceptForSession");

    expect(tauri.invoke).toHaveBeenCalledWith("agent_chat_approve", {
      sessionId: "session-1",
      approvalId: "approval-1",
      decision: "acceptForSession",
    });
    expect(agentChat(chatId)?.approvals).toEqual([]);
  });

  it("does not restore approvals when approve IPC fails", async () => {
    const { chatId, emit } = await startChat();

    emit({
      kind: "approvalRequest",
      approvalId: "approval-1",
      approvalKind: "command",
      detail: "Run bun test",
    });
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_approve") return Promise.reject(new Error("approval failed"));
      return Promise.resolve(null);
    });

    await expect(approveAgentRequest(chatId, "approval-1", "accept")).rejects.toThrow(
      "approval failed",
    );

    expect(agentChat(chatId)?.approvals).toEqual([]);
    expect(agentChat(chatId)?.error).toBe("approval failed");
  });

  it("accumulates usage totals with reported cost", async () => {
    const { chatId, emit } = await startChat();

    emit({
      kind: "usage",
      inputTokens: 100,
      cachedInputTokens: 10,
      outputTokens: 20,
      costUsd: 0.12,
    });
    emit({
      kind: "usage",
      inputTokens: 300,
      cachedInputTokens: 30,
      outputTokens: 40,
      costUsd: 0.24,
    });

    expect(agentChat(chatId)?.totals).toEqual({
      inputTokens: 400,
      cachedInputTokens: 40,
      outputTokens: 60,
      costUsd: 0.36,
      estimated: false,
    });
    expect(timeline(chatId)).toMatchObject([
      { type: "usage", costUsd: 0.12, estimatedCostUsd: null },
      { type: "usage", costUsd: 0.24, estimatedCostUsd: null },
    ]);
  });

  it("assigns cumulative usage snapshots instead of adding them", async () => {
    const { chatId, emit } = await startChat();

    for (const event of cumulativeUsageEvents()) emit(event);

    expect(agentChat(chatId)?.totals).toEqual({
      inputTokens: 600,
      cachedInputTokens: 60,
      outputTokens: 120,
      costUsd: 0.06,
      estimated: false,
    });
    expect(agentChat(chatId)?.contextUsed).toBe(6_000);
    expect(agentChat(chatId)?.contextWindow).toBe(100_000);
    expect(timeline(chatId).filter((item) => item.type === "usage")).toHaveLength(3);
  });

  it("estimates usage totals for known models when reported cost is missing", async () => {
    const { chatId, emit } = await startChat([], "gpt-5.3-codex-spark");

    emit({
      kind: "usage",
      inputTokens: 1_000,
      cachedInputTokens: 200,
      outputTokens: 300,
      costUsd: null,
    });

    expect(agentChat(chatId)?.totals.inputTokens).toBe(1_000);
    expect(agentChat(chatId)?.totals.cachedInputTokens).toBe(200);
    expect(agentChat(chatId)?.totals.outputTokens).toBe(300);
    expect(agentChat(chatId)?.totals.costUsd).toBeCloseTo(0.000805);
    expect(agentChat(chatId)?.totals.estimated).toBe(true);
    expect(timeline(chatId)).toMatchObject([
      { type: "usage", costUsd: null, estimatedCostUsd: 0.000805 },
    ]);
  });

  it("updates context usage when present on usage events", async () => {
    const { chatId, emit } = await startChat();

    emit({
      kind: "usage",
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 20,
      costUsd: null,
      contextUsed: 12_000,
      contextWindow: 200_000,
    });
    emit({
      kind: "usage",
      inputTokens: 50,
      cachedInputTokens: 0,
      outputTokens: 10,
      costUsd: null,
    });

    expect(agentChat(chatId)?.contextUsed).toBe(12_000);
    expect(agentChat(chatId)?.contextWindow).toBe(200_000);
  });

  it("stores rate limit payloads", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "rateLimits", payload: "primary 1%" });

    expect(agentChat(chatId)?.rateLimits).toBe("primary 1%");
  });
});

describe("agentChat history", () => {
  it("maps message and item entries into timeline items", async () => {
    const history: AgentTimelineEntry[] = [
      {
        entryType: "message",
        seq: 1,
        role: "user",
        content: "hello",
        createdAt: 1,
      },
      {
        entryType: "message",
        seq: 2,
        role: "assistant",
        content: "hi",
        createdAt: 2,
      },
      {
        entryType: "item",
        seq: 3,
        kind: "thinkingFinal",
        payload: JSON.stringify({ kind: "thinkingFinal", itemId: "t1", text: "checked" }),
        createdAt: 3,
      },
    ];

    const { chatId } = await startChat(history);

    expect(timeline(chatId)).toMatchObject([
      { type: "userMessage", seq: 1, text: "hello" },
      { type: "assistantText", seq: 2, text: "hi", streaming: false },
      { type: "thinking", seq: 3, text: "checked", streaming: false },
    ]);
  });

  it("skips blank persisted thinking items", async () => {
    const history: AgentTimelineEntry[] = [
      {
        entryType: "item",
        seq: 1,
        kind: "thinkingFinal",
        payload: JSON.stringify({ kind: "thinkingFinal", itemId: "t1", text: "" }),
        createdAt: 1,
      },
      {
        entryType: "item",
        seq: 2,
        kind: "thinkingFinal",
        payload: JSON.stringify({ kind: "thinkingFinal", itemId: "t2", text: "   " }),
        createdAt: 2,
      },
      {
        entryType: "message",
        seq: 3,
        role: "assistant",
        content: "still loads",
        createdAt: 3,
      },
    ];

    const { chatId } = await startChat(history);

    expect(timeline(chatId)).toMatchObject([
      { type: "assistantText", seq: 3, text: "still loads", streaming: false },
    ]);
  });

  it("skips malformed item payloads", async () => {
    const history: AgentTimelineEntry[] = [
      {
        entryType: "item",
        seq: 1,
        kind: "bad",
        payload: "{",
        createdAt: 1,
      },
      {
        entryType: "message",
        seq: 2,
        role: "assistant",
        content: "still loads",
        createdAt: 2,
      },
    ];

    const { chatId } = await startChat(history);

    expect(timeline(chatId)).toMatchObject([
      { type: "assistantText", seq: 2, text: "still loads", streaming: false },
    ]);
  });

  it("continues live item seqs after loaded history", async () => {
    const history: AgentTimelineEntry[] = [
      {
        entryType: "message",
        seq: 4,
        role: "user",
        content: "before",
        createdAt: 4,
      },
      {
        entryType: "item",
        seq: 9,
        kind: "thinkingFinal",
        payload: JSON.stringify({ kind: "thinkingFinal", itemId: null, text: "old" }),
        createdAt: 9,
      },
    ];
    const { chatId, emit } = await startChat(history);

    emit({ kind: "webSearch", itemId: "search-1", query: "pickforge" });

    expect(timeline(chatId).map((item) => item.seq)).toEqual([4, 9, 10]);
  });

  it("seeds usage totals from history items", async () => {
    const history: AgentTimelineEntry[] = [
      {
        entryType: "item",
        seq: 1,
        kind: "usage",
        payload: JSON.stringify({
          kind: "usage",
          inputTokens: 1_000,
          cachedInputTokens: 200,
          outputTokens: 300,
          costUsd: null,
          contextUsed: 9_000,
          contextWindow: 100_000,
        }),
        createdAt: 1,
      },
    ];

    const { chatId } = await startChat(history, "gpt-5.3-codex-spark");

    expect(agentChat(chatId)?.totals.inputTokens).toBe(1_000);
    expect(agentChat(chatId)?.totals.cachedInputTokens).toBe(200);
    expect(agentChat(chatId)?.totals.outputTokens).toBe(300);
    expect(agentChat(chatId)?.totals.costUsd).toBeCloseTo(0.000805);
    expect(agentChat(chatId)?.totals.estimated).toBe(true);
    expect(agentChat(chatId)?.contextUsed).toBe(9_000);
    expect(agentChat(chatId)?.contextWindow).toBe(100_000);
  });

  it("assigns cumulative usage snapshots from history to the latest totals", async () => {
    const { chatId } = await startChat(historyFromEvents(cumulativeUsageEvents()));

    expect(agentChat(chatId)?.totals).toEqual({
      inputTokens: 600,
      cachedInputTokens: 60,
      outputTokens: 120,
      costUsd: 0.06,
      estimated: false,
    });
    expect(agentChat(chatId)?.contextUsed).toBe(6_000);
    expect(agentChat(chatId)?.contextWindow).toBe(100_000);
  });
});

describe("ensureAgentChat", () => {
  it("starts once per chat id", async () => {
    const chatId = nextChatId();
    mockInvoke();

    await ensureAgentChat(chatId, "/project", "codex", null);
    await ensureAgentChat(chatId, "/project", "codex", null);

    expect(tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_start")).toHaveLength(1);
  });

  it("deduplicates in-flight starts per chat id", async () => {
    const chatId = nextChatId();
    const history = deferred<AgentTimelineEntry[]>();
    const start = deferred<string>();
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_history") return history.promise;
      if (cmd === "agent_chat_start") return start.promise;
      return Promise.resolve(null);
    });

    const first = ensureAgentChat(chatId, "/project", "codex", null);
    const second = ensureAgentChat(chatId, "/project", "codex", null);
    history.resolve([]);
    await Promise.resolve();
    await Promise.resolve();

    expect(tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_start")).toHaveLength(1);

    start.resolve("session-1");
    await Promise.all([first, second]);
  });

  it("passes v2 engine and permission overrides to start", async () => {
    const chatId = nextChatId();
    mockInvoke();

    await ensureAgentChat(chatId, "/project", "codex", "gpt-5.3-codex-spark", {
      engine: "v2",
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      permissionMode: "default",
      allowedTools: ["shell", "edit"],
    });

    expect(tauri.invoke).toHaveBeenCalledWith(
      "agent_chat_start",
      expect.objectContaining({
        chatId,
        projectRoot: "/project",
        provider: "codex",
        model: "gpt-5.3-codex-spark",
        engine: "v2",
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        permissionMode: "default",
        allowedTools: ["shell", "edit"],
      }),
    );
  });
});

describe("sendAgentMessage", () => {
  it("rolls back the optimistic user message when send fails", async () => {
    const { chatId } = await startChat();
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_send") return Promise.reject(new Error("send failed"));
      return Promise.resolve(null);
    });

    await expect(sendAgentMessage(chatId, "hello")).rejects.toThrow("send failed");

    expect(timeline(chatId)).toEqual([]);
    expect(agentChat(chatId)?.turnActive).toBe(false);
    expect(agentChat(chatId)?.error).toBe("send failed");
  });

  it("retries a failed start when sending and delivers the message", async () => {
    const chatId = nextChatId();
    let startCount = 0;
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_history") return Promise.resolve([]);
      if (cmd === "agent_chat_start") {
        startCount += 1;
        if (startCount === 1) return Promise.reject(new Error("bridge down"));
        return Promise.resolve("session-2");
      }
      if (cmd === "agent_chat_send") return Promise.resolve();
      return Promise.resolve(null);
    });

    await expect(ensureAgentChat(chatId, "/project", "codex", null)).rejects.toThrow(
      "bridge down",
    );

    expect(agentChat(chatId)?.sessionId).toBeNull();
    expect(agentChat(chatId)?.error).toBe("bridge down");

    await sendAgentMessage(chatId, "hello");

    const startCalls = tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_start");
    expect(startCalls).toHaveLength(2);
    expect(startCalls[1][1]).toEqual(
      expect.objectContaining({
        chatId,
        projectRoot: "/project",
        provider: "codex",
        model: null,
        engine: "v2",
      }),
    );
    expect(tauri.invoke).toHaveBeenCalledWith("agent_chat_send", {
      sessionId: "session-2",
      text: "hello",
    });
    expect(timeline(chatId)).toEqual([{ type: "userMessage", seq: 1, text: "hello" }]);
    expect(agentChat(chatId)?.error).toBeNull();
  });

  it("rolls back the optimistic message when the retry fails", async () => {
    const chatId = nextChatId();
    let startCount = 0;
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_history") return Promise.resolve([]);
      if (cmd === "agent_chat_start") {
        startCount += 1;
        if (startCount === 1) return Promise.reject(new Error("bridge down"));
        return Promise.reject(new Error("still down"));
      }
      if (cmd === "agent_chat_send") return Promise.resolve();
      return Promise.resolve(null);
    });

    await expect(ensureAgentChat(chatId, "/project", "codex", null)).rejects.toThrow(
      "bridge down",
    );
    await expect(sendAgentMessage(chatId, "hello")).rejects.toThrow("still down");

    expect(agentChat(chatId)?.error).toBe("still down");
    expect(agentChat(chatId)?.turnActive).toBe(false);
    expect(timeline(chatId)).toEqual([]);
    expect(activity.agentTurnCleared).toHaveBeenCalledWith(chatId);
    expect(tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_send")).toHaveLength(
      0,
    );
  });
});

describe("agentChat → chatActivity wiring", () => {
  it("marks the chat busy on send and on a turnStarted event", async () => {
    const { chatId, emit } = await startChat();

    await sendAgentMessage(chatId, "hello");
    expect(activity.agentTurnStarted).toHaveBeenCalledTimes(1);
    expect(activity.agentTurnStarted).toHaveBeenCalledWith(chatId);

    emit({ kind: "turnStarted" });
    expect(activity.agentTurnStarted).toHaveBeenCalledTimes(2);
    expect(activity.agentTurnDone).not.toHaveBeenCalled();
  });

  it("clears busy without a chime when send fails", async () => {
    const { chatId } = await startChat();
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_send") return Promise.reject(new Error("send failed"));
      return Promise.resolve(null);
    });

    await expect(sendAgentMessage(chatId, "hello")).rejects.toThrow("send failed");

    expect(activity.agentTurnCleared).toHaveBeenCalledWith(chatId);
    expect(activity.agentTurnDone).not.toHaveBeenCalled();
  });

  it("routes turnDone and turnFailed events to agentTurnDone", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "turnStarted" });
    emit({ kind: "turnDone", status: "completed" });
    expect(activity.agentTurnDone).toHaveBeenCalledTimes(1);
    expect(activity.agentTurnDone).toHaveBeenCalledWith(chatId);

    emit({ kind: "turnStarted" });
    emit({ kind: "turnFailed", error: "boom" });
    expect(activity.agentTurnDone).toHaveBeenCalledTimes(2);
    expect(activity.agentTurnCleared).not.toHaveBeenCalled();
  });

  it("makes no activity calls for an archived chat", async () => {
    const { chatId, emit } = await startChat();
    workspace.isChatArchived.mockReturnValue(true);

    await sendAgentMessage(chatId, "hello");
    emit({ kind: "turnStarted" });
    emit({ kind: "turnDone", status: "completed" });

    expect(activity.agentTurnStarted).not.toHaveBeenCalled();
    expect(activity.agentTurnDone).not.toHaveBeenCalled();
    expect(activity.agentTurnCleared).not.toHaveBeenCalled();
  });

  it("makes no activity calls when the chat row no longer exists", async () => {
    const { chatId, emit } = await startChat();
    workspace.findChat.mockReturnValue(undefined);

    emit({ kind: "turnStarted" });
    emit({ kind: "turnDone", status: "completed" });

    expect(activity.agentTurnStarted).not.toHaveBeenCalled();
    expect(activity.agentTurnDone).not.toHaveBeenCalled();
    expect(agentChat(chatId)?.turnActive).toBe(false);
  });

  it("suppresses the chime for the terminal event of a user interrupt", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "turnStarted" });
    await interruptAgentChat(chatId);
    expect(activity.agentTurnCleared).toHaveBeenCalledTimes(1);

    emit({ kind: "turnFailed", error: "interrupted" });
    expect(activity.agentTurnDone).not.toHaveBeenCalled();
    expect(activity.agentTurnCleared).toHaveBeenCalledTimes(2);

    emit({ kind: "turnStarted" });
    emit({ kind: "turnDone", status: "completed" });
    expect(activity.agentTurnDone).toHaveBeenCalledTimes(1);
  });

  it("dispose drops the store entry and ignores late events", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "turnStarted" });
    activity.agentTurnStarted.mockClear();
    disposeAgentChat(chatId);

    expect(agentChat(chatId)).toBeUndefined();
    expect(tauri.invoke.mock.calls.some((call) => call[0] === "agent_chat_interrupt")).toBe(true);

    emit({ kind: "turnDone", status: "completed" });
    expect(agentChat(chatId)).toBeUndefined();
    expect(activity.agentTurnDone).not.toHaveBeenCalled();
    expect(activity.agentTurnStarted).not.toHaveBeenCalled();
  });
});
