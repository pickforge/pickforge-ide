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

import {
  agentChat,
  ensureAgentChat,
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
    return Promise.resolve(null);
  });
}

async function startChat(history: AgentTimelineEntry[] = []) {
  const chatId = nextChatId();
  mockInvoke(history);
  await ensureAgentChat(chatId, "/project", "codex", null);
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

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.channels.splice(0);
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
    expect(agentChat(chatId)?.turnActive).toBe(true);

    emit({ kind: "turnFailed", error: "boom" });

    expect(agentChat(chatId)?.turnActive).toBe(false);
    expect(agentChat(chatId)?.error).toBe("boom");
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

  it("surfaces approval requests as tool use items", async () => {
    const { chatId, emit } = await startChat();

    emit({
      kind: "approvalRequest",
      approvalId: "approval-1",
      approvalKind: "command",
      detail: "Run bun test",
    });

    expect(timeline(chatId)).toMatchObject([
      {
        type: "toolUse",
        itemId: "approval-1",
        name: "approval required",
        detail: "Run bun test",
      },
    ]);
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
});
