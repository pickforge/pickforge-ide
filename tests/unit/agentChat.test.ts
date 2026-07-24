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

const settings = vi.hoisted(() => {
  const values = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return values;
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
const flags = vi.hoisted(() => ({
  remoteProjects: false,
  ompAgents: false,
}));
const workspace = vi.hoisted(() => ({
  chats: new Map<string, {
    chatId: string;
    projectRoot: string;
    title: string;
    titleSource: "default" | "auto" | "user";
    titleUpdatedAt: number;
    kind: string;
    agentId: string;
  }>(),
  makeChat: (id: string, overrides = {}) => ({
    chatId: id,
    projectRoot: "/project",
    title: "Existing chat",
    titleSource: "user" as const,
    titleUpdatedAt: 1,
    kind: "agent",
    agentId: "codex",
    skillId: null,
    sessionId: null,
    labelsJson: null,
    status: null,
    taskBriefText: null,
    createdAt: 1,
    lastActivityAt: 1,
    sortOrder: 0,
    ...overrides,
  }),
  findChat: vi.fn(),
  setChatTitle: vi.fn(async (id: string, title: string) => {
    const chat = workspace.chats.get(id);
    if (chat) {
      chat.title = title;
      chat.titleSource = "auto";
    }
  }),
  setChatAgent: vi.fn(async (id: string, agentId: string, kind = "agent") => {
    const chat = workspace.chats.get(id);
    if (chat) {
      chat.agentId = agentId;
      chat.kind = kind;
    }
  }),
  isChatArchived: vi.fn(),
  projects: [] as Array<{
    projectRoot: string;
    remoteHost: string | null;
    remoteRoot: string | null;
  }>,
}));

vi.mock("../../src/stores/chatActivity", () => activity);
vi.mock("../../src/stores/workspace", () => ({
  findChat: workspace.findChat,
  setChatTitle: workspace.setChatTitle,
  setChatAgent: workspace.setChatAgent,
  workspace: {
    get projects() {
      return workspace.projects;
    },
  },
}));
vi.mock("../../src/stores/chatArchive", () => ({ isChatArchived: workspace.isChatArchived }));
vi.mock("../../src/stores/flags", () => ({
  flagEnabled: (key: string) =>
    (key === "remoteProjects" && flags.remoteProjects) ||
    (key === "ompAgents" && flags.ompAgents),
  subscribeToFlagChanges: vi.fn(() => () => undefined),
}));

import {
  agentChat,
  approveAgentRequest,
  disposeAgentChat,
  ensureAgentChat,
  hydrateAgentChatHistory,
  interruptAgentChat,
  latestPlanForChat,
  retryAgentChatConnection,
  sendAgentMessage,
  setAgentChatEffort,
  setAgentChatMode,
  setAgentChatModel,
  switchAgentChatProvider,
  steerAgentChat,
  type AgentTimelineItem,
} from "../../src/stores/agentChat";
import {
  agentChatSend,
  agentChatStart,
  agentSkillsList,
  type AgentEvent,
  type AgentTimelineEntry,
} from "../../src/lib/agentChat";
import {
  diagnosticFromProbe,
  recordAgentCliDiagnostic,
} from "../../src/lib/agentModels";
import { markChatTitleManual } from "../../src/lib/chatAutoName";
import { setAgentEngine } from "../../src/lib/chatDefaults";

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
    if (cmd === "agent_chat_dispose") return Promise.resolve();
    if (cmd === "agent_chat_approve") return Promise.resolve();
    if (cmd === "agent_chat_steer") return Promise.resolve();
    return Promise.resolve(null);
  });
}

async function startChat(
  history: AgentTimelineEntry[] = [],
  model: string | null = null,
  provider: "codex" | "pi" = "codex",
) {
  const chatId = nextChatId();
  mockInvoke(history);
  await ensureAgentChat(chatId, "/project", provider, model);
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

async function flushPromises() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
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
    // Provider thread restart: the running counters RESET below the previous
    // snapshot — totals must keep the pre-reset history and add the new run.
    {
      kind: "usage",
      inputTokens: 100,
      cachedInputTokens: 10,
      outputTokens: 20,
      costUsd: 0.01,
      contextUsed: 1_000,
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
  workspace.chats.clear();
  workspace.setChatTitle.mockClear();
  workspace.setChatAgent.mockClear();
  workspace.findChat.mockReset().mockImplementation((id: string) => (
    workspace.chats.get(id) ?? workspace.makeChat(id)
  ));
  workspace.isChatArchived.mockReset().mockReturnValue(false);
  workspace.projects = [];
  flags.remoteProjects = false;
  flags.ompAgents = false;
  settings.clear();
  setAgentEngine("v2");
});

describe("agentChat IPC wrappers", () => {
  it("normalizes empty send options", async () => {
    tauri.invoke.mockResolvedValue(undefined);

    await agentChatSend("session-1", "hello");

    expect(tauri.invoke).toHaveBeenCalledWith("agent_chat_send", {
      sessionId: "session-1",
      text: "hello",
      effort: null,
      model: null,
      images: [],
    });
  });

  it("lists provider skills", async () => {
    const skills = [{ trigger: "/" as const, name: "init", description: "Initialize" }];
    tauri.invoke.mockResolvedValue(skills);

    await expect(agentSkillsList("codex")).resolves.toEqual(skills);

    expect(tauri.invoke).toHaveBeenCalledWith("agent_skills_list", { provider: "codex" });
  });

  it("rejects OMP before IPC while ompAgents is off", async () => {
    await expect(agentChatStart({
      chatId: "chat-omp",
      projectRoot: "/project",
      provider: "omp",
      onEvent: () => undefined,
    })).rejects.toThrow("requires the ompAgents flag and compatible");

    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(tauri.channels).toHaveLength(0);
  });

  it("creates a session-scoped PickForge MCP grant for compatible OMP", async () => {
    flags.ompAgents = true;
    recordAgentCliDiagnostic(diagnosticFromProbe("omp", {
      installed: true,
      versionOutput: "omp 17.1.1",
      helpOutput: "acp --no-extensions",
      modelsOutput: "",
      errors: [],
    }));
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "mcp_start") {
        return Promise.resolve({
          endpoint: "/tmp/pickforge.sock",
          contextDir: "/tmp/context",
          runsDir: "/tmp/runs",
          chatsDir: "/tmp/chats",
          mcpConfigPath: "/tmp/context/mcp.json",
          mcpCommand: "/tmp/pickforge-mcp",
        });
      }
      if (cmd === "agent_chat_start") return Promise.resolve("session-omp");
      return Promise.resolve(null);
    });

    await expect(agentChatStart({
      chatId: "chat-omp",
      projectRoot: "/project",
      provider: "omp",
      onEvent: () => undefined,
    })).resolves.toBe("session-omp");

    expect(tauri.invoke).toHaveBeenCalledWith(
      "agent_chat_start",
      expect.objectContaining({
        provider: "omp",
        engine: null,
        mcpServers: [expect.objectContaining({
          name: "pickforge",
          command: "/tmp/pickforge-mcp",
          env: expect.arrayContaining([
            { name: "PICKFORGE_IPC_ENDPOINT", value: "/tmp/pickforge.sock" },
            { name: "PICKFORGE_CONTEXT_DIR", value: "/tmp/context" },
          ]),
        })],
      }),
    );
    const startPayload = tauri.invoke.mock.calls.find(
      (call) => call[0] === "agent_chat_start",
    )?.[1];
    expect(startPayload).not.toHaveProperty("ompAgentsEnabled");
    expect(tauri.invoke).not.toHaveBeenCalledWith("agent_chat_set_omp_enabled", expect.anything());
  });


  it("starts Pi through the native IPC seam unconditionally", async () => {
    recordAgentCliDiagnostic(diagnosticFromProbe("pi", {
      installed: true,
      versionOutput: "pi 0.79.10",
      helpOutput: "",
      modelsOutput: "",
      errors: [],
    }));
    tauri.invoke.mockResolvedValue("session-pi");
    await expect(agentChatStart({
      chatId: "chat-pi",
      projectRoot: "/project",
      provider: "pi",
      engine: "v2",
      model: "test/model",
      onEvent: () => undefined,
    })).resolves.toBe("session-pi");

    expect(tauri.invoke).toHaveBeenCalledWith(
      "agent_chat_start",
      expect.objectContaining({ provider: "pi", engine: "v2", model: "test/model" }),
    );
  });
  it("normalizes persisted legacy Claude IDs before the native backend guard", async () => {
    tauri.invoke.mockResolvedValue("session-legacy");

    await expect(agentChatStart({
      chatId: "chat-legacy-claude",
      projectRoot: "/project",
      provider: "claude",
      onEvent: () => undefined,
    })).resolves.toBe("session-legacy");

    expect(tauri.invoke).toHaveBeenCalledWith(
      "agent_chat_start",
      expect.objectContaining({ provider: "claudeCode" }),
    );
  });
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

  it("reconciles interleaved Pi thinking and text finals by content identity", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "thinkingDelta", itemId: "pi-message-1-0", text: "think" });
    emit({ kind: "textDelta", itemId: "pi-message-1-1", text: "draft" });
    emit({ kind: "thinkingFinal", itemId: "pi-message-1-0", text: "think final" });
    emit({ kind: "textFinal", itemId: "pi-message-1-1", text: "answer final" });

    expect(timeline(chatId)).toMatchObject([
      {
        type: "thinking",
        itemId: "pi-message-1-0",
        text: "think final",
        streaming: false,
      },
      {
        type: "assistantText",
        itemId: "pi-message-1-1",
        text: "answer final",
        streaming: false,
      },
    ]);
    expect(timeline(chatId)).toHaveLength(2);
  });

  it("does not treat Pi thinking metadata as a selectable effort", async () => {
    const { chatId, emit } = await startChat([], "test/model", "pi");

    emit({
      kind: "sessionUpdated",
      providerSessionId: null,
      sessionFile: null,
      title: null,
      model: null,
      thinkingLevel: "high",
    });

    expect(agentChat(chatId)?.effort).toBeNull();
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

    emit({ kind: "planUpdate", items: [{ text: "draft", status: "pending" }] });
    emit({ kind: "planUpdate", items: [{ text: "done", status: "completed" }] });

    expect(timeline(chatId)).toEqual([
      { type: "plan", seq: 1, items: [{ text: "done", status: "completed" }] },
    ]);
  });

  it("preserves every valid in-progress item without inventing a single-active invariant", async () => {
    const { chatId, emit } = await startChat();

    emit({
      kind: "planUpdate",
      items: [
        { text: "first active", status: "inProgress" },
        { text: "second active", status: "inProgress" },
      ],
    });

    expect(timeline(chatId)).toEqual([
      {
        type: "plan",
        seq: 1,
        items: [
          { text: "first active", status: "inProgress" },
          { text: "second active", status: "inProgress" },
        ],
      },
    ]);
  });

  it("degrades an unknown or missing live plan status to pending, never completed", async () => {
    const { chatId, emit } = await startChat();

    // Runtime data can arrive shaped outside the TS contract (a future
    // provider status, or a field simply missing) — the live path must
    // normalize it the same deterministic way persisted rows do.
    emit({
      kind: "planUpdate",
      items: [
        { text: "unknown status", status: "blocked" },
        { text: "missing status" },
      ],
    } as unknown as AgentEvent);

    expect(timeline(chatId)).toEqual([
      {
        type: "plan",
        seq: 1,
        items: [
          { text: "unknown status", status: "pending" },
          { text: "missing status", status: "pending" },
        ],
      },
    ]);
  });

  it("drops blank-text plan items instead of creating blank rows", async () => {
    const { chatId, emit } = await startChat();

    emit({
      kind: "planUpdate",
      items: [
        { text: "keep me", status: "pending" },
        { text: "   ", status: "completed" },
      ],
    });

    expect(timeline(chatId)).toEqual([
      { type: "plan", seq: 1, items: [{ text: "keep me", status: "pending" }] },
    ]);
  });

  it("clears the plan card when a live update reports no items", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "planUpdate", items: [{ text: "draft", status: "inProgress" }] });
    expect(timeline(chatId)).toHaveLength(1);

    emit({ kind: "planUpdate", items: [] });

    expect(timeline(chatId)).toEqual([]);
    expect(latestPlanForChat(chatId)).toBeNull();
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

  it("replaces accumulated Pi tool updates instead of appending them", async () => {
    const { chatId, emit } = await startChat();

    emit({
      kind: "toolUse",
      itemId: "pi-tool-1",
      name: "write",
      status: "inProgress",
      detail: "a",
    });
    emit({
      kind: "toolUse",
      itemId: "pi-tool-1",
      name: "write",
      status: "inProgress",
      detail: "ab",
    });

    expect(timeline(chatId)).toMatchObject([
      { type: "toolUse", itemId: "pi-tool-1", name: "write", detail: "ab" },
    ]);
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

  it("keeps approvals when approve IPC fails", async () => {
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

    expect(agentChat(chatId)?.approvals).toEqual([
      {
        approvalId: "approval-1",
        kind: "command",
        detail: "Run bun test",
      },
    ]);
    expect(agentChat(chatId)?.error).toBe("approval failed");
  });

  it("drops replayed impossible approvals and rejects their actions before IPC", async () => {
    const chatId = nextChatId();
    mockInvoke(historyFromEvents([{
      kind: "approvalRequest",
      approvalId: "stale-v1-approval",
      approvalKind: "command",
      detail: "persisted but impossible",
    }]));

    await ensureAgentChat(chatId, "/project", "codex", null, { engine: "v1" });

    expect(agentChat(chatId)?.approvals).toEqual([]);
    await expect(
      approveAgentRequest(chatId, "stale-v1-approval", "accept"),
    ).rejects.toThrow("v2 agent engine");
    expect(tauri.invoke.mock.calls.some((call) => call[0] === "agent_chat_approve")).toBe(false);
  });

  it("rejects Pi approval actions before IPC", async () => {
    const chatId = nextChatId();
    mockInvoke(historyFromEvents([{
      kind: "approvalRequest",
      approvalId: "not-a-pi-protocol-event",
      approvalKind: "toolUse",
      detail: "must never be actionable",
    }]));

    await ensureAgentChat(chatId, "/project", "pi", "test/model", { engine: "v2" });

    expect(agentChat(chatId)?.approvals).toEqual([]);
    await expect(
      approveAgentRequest(chatId, "not-a-pi-protocol-event", "accept"),
    ).rejects.toThrow("no native approval protocol");
    expect(tauri.invoke.mock.calls.some((call) => call[0] === "agent_chat_approve")).toBe(false);
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

  it("accumulates cumulative usage by positive deltas and survives resets", async () => {
    const { chatId, emit } = await startChat();

    for (const event of cumulativeUsageEvents()) emit(event);

    expect(agentChat(chatId)?.totals).toEqual({
      inputTokens: 700,
      cachedInputTokens: 70,
      outputTokens: 140,
      costUsd: expect.closeTo(0.07, 8),
      estimated: false,
    });
    expect(agentChat(chatId)?.contextUsed).toBe(1_000);
    expect(agentChat(chatId)?.contextWindow).toBe(100_000);
    expect(timeline(chatId).filter((item) => item.type === "usage")).toHaveLength(4);
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

  it("keeps the last known context reading when a usage event reports explicit null", async () => {
    // The Rust backend serializes `Option<u64>::None` as JSON `null`, not an
    // omitted key (no #[serde(skip_serializing_if)]) — e.g. OMP emits a
    // per-turn usage row with contextUsed/contextWindow explicitly null right
    // after every turn (crates/pickforge-core/src/agents/omp_acp.rs
    // emit_prompt_usage). The reducer must treat that the same as
    // "unreported" and keep the prior reading instead of blanking the meter.
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
      contextUsed: null,
      contextWindow: null,
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

describe("latestPlanForChat", () => {
  it("returns the latest plan item, reflecting in-place plan updates", async () => {
    const { chatId, emit } = await startChat();

    expect(latestPlanForChat(chatId)).toBeNull();

    emit({ kind: "planUpdate", items: [{ text: "draft", status: "pending" }] });
    emit({ kind: "textFinal", itemId: null, text: "working" });
    emit({ kind: "planUpdate", items: [{ text: "done", status: "completed" }] });

    expect(latestPlanForChat(chatId)).toEqual({
      type: "plan",
      seq: 1,
      items: [{ text: "done", status: "completed" }],
    });
  });

  it("returns null for a chat without a plan or an unknown chat", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "textFinal", itemId: null, text: "no plan here" });

    expect(latestPlanForChat(chatId)).toBeNull();
    expect(latestPlanForChat("missing-chat")).toBeNull();
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

  it("hides persisted internal swarm synthesis prompts", async () => {
    const history: AgentTimelineEntry[] = [
      {
        entryType: "message",
        seq: 1,
        role: "user",
        content: "Pickforge swarm finished for this chat.\n\nWorker lane results:",
        createdAt: 1,
      },
      {
        entryType: "message",
        seq: 2,
        role: "assistant",
        content: "Final synthesis",
        createdAt: 2,
      },
    ];

    const { chatId } = await startChat(history);

    expect(timeline(chatId)).toMatchObject([
      {
        type: "userMessage",
        seq: 1,
        text: "Pickforge swarm finished for this chat.\n\nWorker lane results:",
        hidden: true,
      },
      { type: "assistantText", seq: 2, text: "Final synthesis" },
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

  it("maps legacy persisted { completed } plan items to pending/completed status", async () => {
    const history: AgentTimelineEntry[] = [
      {
        entryType: "item",
        seq: 1,
        kind: "planUpdate",
        payload: JSON.stringify({
          kind: "planUpdate",
          items: [
            { text: "legacy done", completed: true },
            { text: "legacy todo", completed: false },
            { text: "legacy missing flag" },
          ],
        }),
        createdAt: 1,
      },
    ];

    const { chatId } = await startChat(history);

    expect(latestPlanForChat(chatId)).toEqual({
      type: "plan",
      seq: 1,
      items: [
        { text: "legacy done", status: "completed" },
        { text: "legacy todo", status: "pending" },
        { text: "legacy missing flag", status: "pending" },
      ],
    });
  });

  it("prefers a valid persisted status over a conflicting legacy completed flag", async () => {
    const history: AgentTimelineEntry[] = [
      {
        entryType: "item",
        seq: 1,
        kind: "planUpdate",
        payload: JSON.stringify({
          kind: "planUpdate",
          items: [{ text: "conflicting", status: "inProgress", completed: true }],
        }),
        createdAt: 1,
      },
    ];

    const { chatId } = await startChat(history);

    expect(latestPlanForChat(chatId)).toEqual({
      type: "plan",
      seq: 1,
      items: [{ text: "conflicting", status: "inProgress" }],
    });
  });

  it("degrades an unrecognized persisted plan status to pending", async () => {
    const history: AgentTimelineEntry[] = [
      {
        entryType: "item",
        seq: 1,
        kind: "planUpdate",
        payload: JSON.stringify({
          kind: "planUpdate",
          items: [{ text: "future status", status: "blocked" }],
        }),
        createdAt: 1,
      },
    ];

    const { chatId } = await startChat(history);

    expect(latestPlanForChat(chatId)).toEqual({
      type: "plan",
      seq: 1,
      items: [{ text: "future status", status: "pending" }],
    });
  });

  it("hydrates valid plan siblings even when a malformed item shares the payload", async () => {
    const history: AgentTimelineEntry[] = [
      {
        entryType: "item",
        seq: 1,
        kind: "planUpdate",
        payload: JSON.stringify({
          kind: "planUpdate",
          items: [
            { text: "valid step", status: "completed" },
            { text: "   " },
            { status: "pending" },
            null,
            "not an object",
          ],
        }),
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

    expect(latestPlanForChat(chatId)).toEqual({
      type: "plan",
      seq: 1,
      items: [{ text: "valid step", status: "completed" }],
    });
    expect(timeline(chatId)).toMatchObject([
      { type: "plan" },
      { type: "assistantText", seq: 2, text: "still loads" },
    ]);
  });

  it("clears stale persisted failure errors after newer turns", async () => {
    const failedTurn = {
      entryType: "item" as const,
      seq: 1,
      kind: "turnFailed",
      payload: JSON.stringify({ kind: "turnFailed", error: "old failure" }),
      createdAt: 1,
    };
    const userMessage: AgentTimelineEntry = {
      entryType: "message",
      seq: 2,
      role: "user",
      content: "retry",
      createdAt: 2,
    };
    const doneTurn = {
      entryType: "item" as const,
      seq: 2,
      kind: "turnDone",
      payload: JSON.stringify({ kind: "turnDone", status: "completed" }),
      createdAt: 2,
    };

    const userSuperseded = await startChat([failedTurn, userMessage]);
    const doneSuperseded = await startChat([failedTurn, doneTurn]);

    expect(agentChat(userSuperseded.chatId)?.error).toBeNull();
    expect(agentChat(doneSuperseded.chatId)?.error).toBeNull();
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

  it("replays cumulative usage from history with the same delta semantics", async () => {
    const { chatId } = await startChat(historyFromEvents(cumulativeUsageEvents()));

    expect(agentChat(chatId)?.totals).toEqual({
      inputTokens: 700,
      cachedInputTokens: 70,
      outputTokens: 140,
      costUsd: expect.closeTo(0.07, 8),
      estimated: false,
    });
    expect(agentChat(chatId)?.contextUsed).toBe(1_000);
    expect(agentChat(chatId)?.contextWindow).toBe(100_000);
  });

  it("folds a persisted usage row's model into chat.model during history replay (#272)", async () => {
    const history = historyFromEvents([
      {
        kind: "usage",
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        costUsd: 0.01,
        model: "anthropic/claude-sonnet-4-6",
      },
    ]);

    // No model was passed at start, and no "sessionUpdated" event exists in
    // this history — the persisted usage row's model is the only per-chat
    // record of what actually served the turn.
    const { chatId } = await startChat(history, null, "pi");

    expect(agentChat(chatId)?.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("leaves chat.model untouched when a live usage event omits model", async () => {
    const { chatId, emit } = await startChat([], "gpt-5.5", "codex");

    emit({
      kind: "usage",
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 5,
      costUsd: 0.01,
    });

    expect(agentChat(chatId)?.model).toBe("gpt-5.5");
  });
});

describe("hydrateAgentChatHistory", () => {
  it("seeds project state before the history request resolves", async () => {
    const chatId = nextChatId();
    const history = deferred<AgentTimelineEntry[]>();
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_history") return history.promise;
      return Promise.resolve(null);
    });

    const promise = hydrateAgentChatHistory(chatId, "/project", "codex", "gpt-5.5");
    await Promise.resolve();

    expect(agentChat(chatId)).toMatchObject({
      sessionId: null,
      projectRoot: "/project",
      provider: "codex",
      model: "gpt-5.5",
    });

    history.resolve([]);
    await promise;
  });

  it("loads a persisted plan without starting a backend session", async () => {
    const chatId = nextChatId();
    mockInvoke(
      historyFromEvents([
        { kind: "planUpdate", items: [{ text: "step", status: "pending" }] },
      ]),
    );

    await hydrateAgentChatHistory(chatId, "/project", "codex", null);

    expect(latestPlanForChat(chatId)).toEqual({
      type: "plan",
      seq: 1,
      items: [{ text: "step", status: "pending" }],
    });
    expect(agentChat(chatId)?.sessionId).toBeNull();
    expect(tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_start")).toHaveLength(
      0,
    );
  });

  it("keeps saved defaults when a hydrated chat later starts a session", async () => {
    const chatId = nextChatId();
    mockInvoke([]);

    await hydrateAgentChatHistory(chatId, "/project", "codex", "gpt-5.5");
    await ensureAgentChat(chatId, "/project", "codex", "gpt-5.5", {
      effort: "high",
      mode: "full-access",
    });

    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");
    expect(startCall?.[1]).toMatchObject({
      projectRoot: "/project",
      provider: "codex",
      model: "gpt-5.5",
      effort: "high",
      sandbox: "danger-full-access",
      approvalPolicy: "never",
    });
  });
});

describe("ensureAgentChat", () => {
  it("starts a bound remote project without using its local path", async () => {
    const chatId = nextChatId();
    flags.remoteProjects = true;
    workspace.projects = [
      {
        projectRoot: "/not/present/locally",
        remoteHost: "mac-mini",
        remoteRoot: "/srv/app",
      },
    ];
    mockInvoke();

    await ensureAgentChat(chatId, "/not/present/locally", "codex", null, { engine: "v2" });

    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");
    expect(startCall?.[1]).toEqual(
      expect.objectContaining({
        projectRoot: "/not/present/locally",
        engine: "v1",
        remote: {
          host: "mac-mini",
          remoteRoot: "/srv/app",
          remoteProcessLeases: false,
        },
      }),
    );
    expect(agentChat(chatId)?.remoteHost).toBe("mac-mini");
    startCall?.[1].onEvent.onmessage({
      kind: "approvalRequest",
      approvalId: "remote-approval",
      approvalKind: "command",
      detail: "impossible on remote v1",
    });
    expect(agentChat(chatId)?.approvals).toEqual([]);
    expect(agentChat(chatId)?.engine).toBe("v1");
    await expect(
      sendAgentMessage(chatId, "inspect", ["/tmp/remote.png"]),
    ).rejects.toThrow("v2 agent engine");
    await expect(steerAgentChat(chatId, "change direction")).rejects.toThrow("v2 agent engine");
    await expect(
      approveAgentRequest(chatId, "remote-approval", "accept"),
    ).rejects.toThrow("v2 agent engine");
    for (const command of ["agent_chat_send", "agent_chat_steer", "agent_chat_approve"]) {
      expect(tauri.invoke.mock.calls.some((call) => call[0] === command)).toBe(false);
    }

    startCall?.[1].onEvent.onmessage({
      kind: "turnFailed",
      error:
        "ssh:mac-mini exited 255: transport failure or remote exit 255. Open the project's Remote panel and choose Test connection.",
    });
    expect(agentChat(chatId)?.error).toContain("ssh:mac-mini exited 255");
    expect(agentChat(chatId)?.error).toContain("Test connection");
  });

  it("keeps a live session on its effective engine after Settings changes", async () => {
    const chatId = nextChatId();
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null, { engine: "v1" });

    setAgentEngine("v2");
    await ensureAgentChat(chatId, "/project", "claudeCode", null, { engine: "v2" });

    expect(agentChat(chatId)?.provider).toBe("codex");
    expect(agentChat(chatId)?.engine).toBe("v1");
    await expect(
      sendAgentMessage(chatId, "inspect", ["/tmp/local.png"]),
    ).rejects.toThrow("v2 agent engine");
    await expect(steerAgentChat(chatId, "change direction")).rejects.toThrow("v2 agent engine");
    expect(tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_start")).toHaveLength(1);
  });

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
    await flushPromises();

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

  it("starts with the current model after async setup and keeps later changes", async () => {
    const chatId = nextChatId();
    const history = deferred<AgentTimelineEntry[]>();
    const start = deferred<string>();
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_history") return history.promise;
      if (cmd === "agent_chat_start") return start.promise;
      return Promise.resolve(null);
    });

    const ensuring = ensureAgentChat(chatId, "/project", "codex", "gpt-old");
    setAgentChatModel(chatId, "gpt-history");
    history.resolve([]);
    await flushPromises();

    const startCalls = tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_start");
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0][1]).toEqual(expect.objectContaining({ model: "gpt-history" }));

    setAgentChatModel(chatId, "gpt-start");
    start.resolve("session-1");
    await ensuring;

    expect(agentChat(chatId)?.model).toBe("gpt-start");
  });

  it("serializes live claude model updates and continues after a failure", async () => {
    const chatId = nextChatId();
    const setModels: Array<{
      promise: Promise<void>;
      resolve: (value: void) => void;
      reject: (reason?: unknown) => void;
    }> = [];
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_history") return Promise.resolve([]);
      if (cmd === "agent_chat_start") return Promise.resolve("session-1");
      if (cmd === "agent_chat_set_model") {
        const next = deferred<void>();
        setModels.push(next);
        return next.promise;
      }
      return Promise.resolve(null);
    });

    await ensureAgentChat(chatId, "/project", "claudeCode", "claude-old");
    setAgentChatModel(chatId, "claude-mid");
    setAgentChatModel(chatId, "claude-new");
    await flushPromises();

    const setModelCalls = () =>
      tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_set_model");

    expect(setModelCalls()).toHaveLength(1);
    expect(setModelCalls()[0][1]).toEqual({
      sessionId: "session-1",
      model: "claude-mid",
    });

    setModels[0].reject(new Error("set failed"));
    await flushPromises();

    expect(setModelCalls()).toHaveLength(2);
    expect(setModelCalls()[1][1]).toEqual({
      sessionId: "session-1",
      model: "claude-new",
    });

    setModels[1].resolve(undefined);
    await flushPromises();

    expect(agentChat(chatId)?.model).toBe("claude-new");
  });

  it("reverts a live model switch and surfaces the error when the backend rejects it (#285)", async () => {
    const chatId = nextChatId();
    const setModel = deferred<void>();
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_history") return Promise.resolve([]);
      if (cmd === "agent_chat_start") return Promise.resolve("session-1");
      if (cmd === "agent_chat_set_model") return setModel.promise;
      return Promise.resolve(null);
    });

    await ensureAgentChat(chatId, "/project", "claudeCode", "claude-old");
    setAgentChatModel(chatId, "claude-mid");
    expect(agentChat(chatId)?.model).toBe("claude-mid");

    setModel.reject(new Error("OMP rejected the model selector"));
    await flushPromises();

    expect(agentChat(chatId)?.model).toBe("claude-old");
    expect(agentChat(chatId)?.error).toBe("OMP rejected the model selector");
  });

  it("does not clobber a newer selection when an older live model switch fails", async () => {
    const chatId = nextChatId();
    const setModels: Array<{
      promise: Promise<void>;
      resolve: (value: void) => void;
      reject: (reason?: unknown) => void;
    }> = [];
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_history") return Promise.resolve([]);
      if (cmd === "agent_chat_start") return Promise.resolve("session-1");
      if (cmd === "agent_chat_set_model") {
        const next = deferred<void>();
        setModels.push(next);
        return next.promise;
      }
      return Promise.resolve(null);
    });

    await ensureAgentChat(chatId, "/project", "claudeCode", "claude-old");
    setAgentChatModel(chatId, "claude-mid");
    setAgentChatModel(chatId, "claude-new");
    await flushPromises();

    // Reject the in-flight request for the now-superseded "claude-mid"
    // selection — the touch guard must keep the newer "claude-new" in place.
    setModels[0].reject(new Error("stale set-model rejected"));
    await flushPromises();

    expect(agentChat(chatId)?.model).toBe("claude-new");
    expect(agentChat(chatId)?.error).toBe("stale set-model rejected");
  });

  it("updates the selected model in frontend state only", async () => {
    const { chatId } = await startChat([], "gpt-old");

    setAgentChatModel(chatId, "gpt-new");

    expect(agentChat(chatId)?.model).toBe("gpt-new");
    expect(tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_start")).toHaveLength(1);
  });
});

describe("resumed chat model resolution (#272)", () => {
  function mockInvokeWithSession(
    session: { model: string | null } | null,
    history: AgentTimelineEntry[] = [],
  ) {
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_history") return Promise.resolve(history);
      if (cmd === "agent_chat_start") return Promise.resolve("session-1");
      if (cmd === "agent_session_latest_for_chat") return Promise.resolve(session);
      return Promise.resolve(null);
    });
  }

  it("shows the resumed session's persisted model, not the global per-provider default", async () => {
    const chatId = nextChatId();
    // The global "last selected Pi model" preference (what a fresh page load
    // seeds AgentChatView's `model` prop with) has since drifted to a
    // different model than the one this chat's session actually started
    // with — the exact #272 scenario after quit/relaunch.
    mockInvokeWithSession({ model: "anthropic/claude-sonnet-4-6" });

    await ensureAgentChat(chatId, "/project", "pi", "openai-codex/gpt-5.6-sol");

    expect(agentChat(chatId)?.model).toBe("anthropic/claude-sonnet-4-6");
    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");
    expect(startCall?.[1]).toEqual(expect.objectContaining({ model: "anthropic/claude-sonnet-4-6" }));
  });

  it("still seeds a brand-new chat (no persisted session row) from the global default", async () => {
    const chatId = nextChatId();
    mockInvokeWithSession(null);

    await ensureAgentChat(chatId, "/project", "pi", "openai-codex/gpt-5.6-sol");

    expect(agentChat(chatId)?.model).toBe("openai-codex/gpt-5.6-sol");
  });

  it("ignores a persisted session model that isn't valid for the resumed provider", async () => {
    const chatId = nextChatId();
    // A session row carrying another provider's bare catalog id must not
    // bleed into this chat's displayed/started model.
    mockInvokeWithSession({ model: "gpt-5.6-sol" });

    await ensureAgentChat(chatId, "/project", "pi", "openai-codex/gpt-5.5");

    expect(agentChat(chatId)?.model).toBe("openai-codex/gpt-5.5");
  });

  it("does not clobber a model already changed while the session lookup was in flight", async () => {
    const chatId = nextChatId();
    const sessionLookup = deferred<{ model: string | null } | null>();
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_history") return Promise.resolve([]);
      if (cmd === "agent_chat_start") return Promise.resolve("session-1");
      if (cmd === "agent_session_latest_for_chat") return sessionLookup.promise;
      return Promise.resolve(null);
    });

    const ensuring = ensureAgentChat(chatId, "/project", "pi", "openai-codex/gpt-5.6-sol");
    setAgentChatModel(chatId, "openai-codex/gpt-5.5");
    sessionLookup.resolve({ model: "anthropic/claude-sonnet-4-6" });
    await ensuring;

    expect(agentChat(chatId)?.model).toBe("openai-codex/gpt-5.5");
  });

  it("does not clobber the placeholder value even when re-picked to the same id in flight", async () => {
    // A plain `model === safeModel` value-equality guard cannot tell
    // "untouched" apart from "user explicitly re-picked the placeholder
    // value" — this pins the explicit touch-counter fix for that gap.
    const chatId = nextChatId();
    const sessionLookup = deferred<{ model: string | null } | null>();
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_history") return Promise.resolve([]);
      if (cmd === "agent_chat_start") return Promise.resolve("session-1");
      if (cmd === "agent_session_latest_for_chat") return sessionLookup.promise;
      return Promise.resolve(null);
    });

    const ensuring = ensureAgentChat(chatId, "/project", "pi", "openai-codex/gpt-5.6-sol");
    setAgentChatModel(chatId, "openai-codex/gpt-5.6-sol");
    sessionLookup.resolve({ model: "anthropic/claude-sonnet-4-6" });
    await ensuring;

    expect(agentChat(chatId)?.model).toBe("openai-codex/gpt-5.6-sol");
  });

  it("resolves the same way for hydrateAgentChatHistory (no live session started)", async () => {
    const chatId = nextChatId();
    mockInvokeWithSession({ model: "anthropic/claude-sonnet-4-6" });

    await hydrateAgentChatHistory(chatId, "/project", "pi", "openai-codex/gpt-5.6-sol");

    expect(agentChat(chatId)?.model).toBe("anthropic/claude-sonnet-4-6");
    expect(agentChat(chatId)?.sessionId).toBeNull();
  });
});

describe("setAgentChatMode", () => {
  it("seeds mode overrides into the codex session start", async () => {
    const chatId = nextChatId();
    mockInvoke();

    await ensureAgentChat(chatId, "/project", "codex", "gpt-5.3-codex-spark", {
      mode: "read-only",
    });

    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");
    expect(startCall?.[1]).toEqual(
      expect.objectContaining({
        sandbox: "read-only",
        approvalPolicy: "on-request",
      }),
    );
  });

  it("pushes a codex mode change to the live session", async () => {
    const { chatId } = await startChat();

    setAgentChatMode(chatId, "full-access");
    await vi.waitFor(() =>
      expect(tauri.invoke).toHaveBeenCalledWith("agent_chat_set_mode", expect.anything()),
    );

    expect(agentChat(chatId)?.mode).toBe("full-access");
    expect(tauri.invoke).toHaveBeenCalledWith("agent_chat_set_mode", {
      sessionId: "session-1",
      sandbox: "danger-full-access",
      approvalPolicy: "never",
      permissionMode: null,
    });
  });

  it("pushes a claude mode change as a permission mode", async () => {
    const chatId = nextChatId();
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "claudeCode", "claude-model");

    setAgentChatMode(chatId, "plan");
    await vi.waitFor(() =>
      expect(tauri.invoke).toHaveBeenCalledWith("agent_chat_set_mode", expect.anything()),
    );

    expect(tauri.invoke).toHaveBeenCalledWith("agent_chat_set_mode", {
      sessionId: "session-1",
      sandbox: null,
      approvalPolicy: null,
      permissionMode: "plan",
    });
  });
});

describe("sendAgentMessage", () => {
  it("re-appends the sent message when history replay clobbers the optimistic row", async () => {
    // An existing chat's first persisted row is a user message with seq 1 —
    // sending before history loads must not mistake it for the optimistic row
    // (which also takes seq 1) and silently drop the fresh prompt.
    const chatId = nextChatId();
    mockInvoke([
      { entryType: "message", seq: 1, role: "user", content: "old prompt", createdAt: 1 },
    ]);

    const ensuring = ensureAgentChat(chatId, "/project", "codex", null);
    await sendAgentMessage(chatId, "fresh prompt");
    await ensuring;

    expect(timeline(chatId)).toEqual([
      { type: "userMessage", seq: 1, text: "old prompt" },
      { type: "userMessage", seq: 2, text: "fresh prompt", optimistic: true },
    ]);
  });

  it("passes codex effort and images through and keeps images on the optimistic item", async () => {
    const { chatId } = await startChat([], "gpt-5.3-codex-spark");
    const images = ["data:image/png;base64,abc"];

    setAgentChatEffort(chatId, "high");
    await sendAgentMessage(chatId, "inspect this", images);

    expect(tauri.invoke).toHaveBeenCalledWith("agent_chat_send", {
      sessionId: "session-1",
      text: "inspect this",
      effort: "high",
      model: "gpt-5.3-codex-spark",
      images,
    });
    expect(timeline(chatId)).toEqual([
      { type: "userMessage", seq: 1, text: "inspect this", images, optimistic: true },
    ]);
  });

  it("rejects images before dispatch when the selected engine cannot send them", async () => {
    const chatId = nextChatId();
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null, { engine: "v1" });

    await expect(
      sendAgentMessage(chatId, "inspect this", ["/tmp/image.png"]),
    ).rejects.toThrow("v2 agent engine");

    expect(timeline(chatId)).toEqual([]);
    expect(tauri.invoke.mock.calls.some((call) => call[0] === "agent_chat_send")).toBe(false);
  });

  it("rechecks images after ensure transitions a live remote chat from v2 to v1", async () => {
    const chatId = nextChatId();
    let starts = 0;
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_history") return Promise.resolve([]);
      if (cmd === "agent_chat_start") {
        starts += 1;
        return starts === 1
          ? Promise.reject(new Error("bridge down"))
          : Promise.resolve("session-remote");
      }
      if (cmd === "agent_chat_send") return Promise.resolve();
      return Promise.resolve(null);
    });
    await expect(
      ensureAgentChat(chatId, "/project", "codex", null, { engine: "v2" }),
    ).rejects.toThrow("bridge down");

    flags.remoteProjects = true;
    workspace.projects = [{
      projectRoot: "/project",
      remoteHost: "mac-mini",
      remoteRoot: "/srv/project",
    }];

    await expect(
      sendAgentMessage(chatId, "inspect this", ["/tmp/remote-image.png"]),
    ).rejects.toThrow("v2 agent engine");

    expect(agentChat(chatId)?.engine).toBe("v1");
    expect(timeline(chatId)).toEqual([]);
    expect(tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_start")).toHaveLength(2);
    expect(tauri.invoke).toHaveBeenCalledWith(
      "agent_chat_start",
      expect.objectContaining({
        chatId,
        engine: "v1",
        remote: {
          host: "mac-mini",
          remoteRoot: "/srv/project",
          remoteProcessLeases: false,
        },
      }),
    );
    expect(tauri.invoke.mock.calls.some((call) => call[0] === "agent_chat_send")).toBe(false);
  });

  it("accepts Claude v2 images and rejects them for a live Claude v1 session", async () => {
    const v2ChatId = nextChatId();
    mockInvoke();
    await ensureAgentChat(v2ChatId, "/project", "claudeCode", null, { engine: "v2" });
    await sendAgentMessage(v2ChatId, "inspect", ["/tmp/claude-v2.png"]);

    expect(tauri.invoke).toHaveBeenCalledWith("agent_chat_send", {
      sessionId: "session-1",
      text: "inspect",
      effort: null,
      model: null,
      images: ["/tmp/claude-v2.png"],
    });

    const v1ChatId = nextChatId();
    await ensureAgentChat(v1ChatId, "/project", "claudeCode", null, { engine: "v1" });
    const sendsBefore = tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_send").length;

    await expect(
      sendAgentMessage(v1ChatId, "inspect", ["/tmp/claude-v1.png"]),
    ).rejects.toThrow("v2 agent engine");
    expect(timeline(v1ChatId)).toEqual([]);
    expect(tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_send")).toHaveLength(
      sendsBefore,
    );
  });

  it("sends hidden internal messages while marking the optimistic row hidden", async () => {
    const { chatId } = await startChat([], "gpt-5.3-codex-spark");
    const text = "Pickforge swarm finished for this chat.\n\nWorker lane results:";

    await sendAgentMessage(chatId, text, [], { hidden: true });

    expect(tauri.invoke).toHaveBeenCalledWith("agent_chat_send", {
      sessionId: "session-1",
      text,
      effort: null,
      model: "gpt-5.3-codex-spark",
      images: [],
    });
    expect(timeline(chatId)).toEqual([
      { type: "userMessage", seq: 1, text, optimistic: true, hidden: true },
    ]);
  });

  it("passes updated codex model per turn without restarting", async () => {
    const { chatId } = await startChat([], "gpt-old");

    setAgentChatModel(chatId, "gpt-new");
    await sendAgentMessage(chatId, "hello");

    expect(tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_start")).toHaveLength(
      1,
    );
    expect(tauri.invoke).toHaveBeenCalledWith("agent_chat_send", {
      sessionId: "session-1",
      text: "hello",
      effort: null,
      model: "gpt-new",
      images: [],
    });
  });

  it("does not apply effort to non-codex sends", async () => {
    const chatId = nextChatId();
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "claudeCode", "claude-model");

    setAgentChatEffort(chatId, "high");
    await sendAgentMessage(chatId, "hello");

    expect(tauri.invoke).toHaveBeenCalledWith("agent_chat_send", {
      sessionId: "session-1",
      text: "hello",
      effort: null,
      model: null,
      images: [],
    });
  });

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

  it.each(["omp", "pi"] as const)(
    "clears a dead %s session and restarts before the next send",
    async (provider) => {
      flags.ompAgents = true;
      const chatId = nextChatId();
      let startCount = 0;
      let sendCount = 0;
      tauri.invoke.mockImplementation((cmd: string, args?: { sessionId?: string }) => {
        if (cmd === "agent_chat_history") return Promise.resolve([]);
        if (cmd === "agent_chat_start") {
          startCount += 1;
          return Promise.resolve(`session-${startCount}`);
        }
        if (cmd === "agent_chat_send") {
          sendCount += 1;
          if (sendCount === 1) return Promise.reject(new Error(`${provider} transport failed`));
          expect(args?.sessionId).toBe("session-2");
          return Promise.resolve();
        }
        return Promise.resolve(null);
      });

      await ensureAgentChat(chatId, "/project", provider, null, { engine: "v2" });
      await expect(sendAgentMessage(chatId, "first")).rejects.toThrow("transport failed");

      expect(agentChat(chatId)?.sessionId).toBeNull();
      expect(timeline(chatId)).toEqual([]);

      await sendAgentMessage(chatId, "second");

      expect(startCount).toBe(2);
      expect(sendCount).toBe(2);
      expect(agentChat(chatId)?.sessionId).toBe("session-2");
      expect(agentChat(chatId)?.error).toBeNull();
      expect(timeline(chatId)).toEqual([
        { type: "userMessage", seq: 1, text: "second", optimistic: true },
      ]);
    },
  );

  it.each(["omp", "pi"] as const)(
    "replaces a failed live %s session on explicit retry",
    async (provider) => {
      flags.ompAgents = true;
      const chatId = nextChatId();
      let startCount = 0;
      let emit: ((event: AgentEvent) => void) | undefined;
      tauri.invoke.mockImplementation((cmd: string, args?: {
        sessionId?: string;
        onEvent?: { onmessage?: (event: AgentEvent) => void };
      }) => {
        if (cmd === "agent_chat_history") return Promise.resolve([]);
        if (cmd === "agent_chat_start") {
          startCount += 1;
          emit = args?.onEvent?.onmessage;
          return Promise.resolve(`session-${startCount}`);
        }
        return Promise.resolve(null);
      });

      await ensureAgentChat(chatId, "/project", provider, null, { engine: "v2" });
      emit?.({ kind: "turnFailed", error: "connection lost" });
      expect(agentChat(chatId)?.sessionId).toBe("session-1");
      expect(agentChat(chatId)?.error).toBe("connection lost");

      await retryAgentChatConnection(chatId);

      expect(tauri.invoke).toHaveBeenCalledWith("agent_chat_dispose", {
        sessionId: "session-1",
      });
      expect(startCount).toBe(2);
      expect(agentChat(chatId)?.sessionId).toBe("session-2");
      expect(agentChat(chatId)?.error).toBeNull();
    },
  );

  it("keeps the recovery error visible while a dead live session is being replaced", async () => {
    flags.ompAgents = true;
    const chatId = nextChatId();
    const dispose = deferred<void>();
    let startCount = 0;
    let emit: ((event: AgentEvent) => void) | undefined;
    tauri.invoke.mockImplementation((cmd: string, args?: {
      onEvent?: { onmessage?: (event: AgentEvent) => void };
    }) => {
      if (cmd === "agent_chat_history") return Promise.resolve([]);
      if (cmd === "agent_chat_start") {
        startCount += 1;
        emit = args?.onEvent?.onmessage;
        return Promise.resolve(`session-${startCount}`);
      }
      if (cmd === "agent_chat_dispose") return dispose.promise;
      return Promise.resolve(null);
    });

    await ensureAgentChat(chatId, "/project", "omp", null, { engine: "v2" });
    emit?.({ kind: "turnFailed", error: "connection lost" });
    const retry = retryAgentChatConnection(chatId);

    expect(agentChat(chatId)?.sessionId).toBeNull();
    expect(agentChat(chatId)?.error).toBe("connection lost");

    dispose.resolve(undefined);
    await retry;
    expect(agentChat(chatId)?.sessionId).toBe("session-2");
    expect(agentChat(chatId)?.error).toBeNull();
  });

  it("does not let an OMP retry completion overwrite a provider switch", async () => {
    flags.ompAgents = true;
    const chatId = nextChatId();
    workspace.chats.set(chatId, workspace.makeChat(chatId, { agentId: "omp" }));
    const dispose = deferred<void>();
    let startCount = 0;
    let emit: ((event: AgentEvent) => void) | undefined;
    tauri.invoke.mockImplementation((cmd: string, args?: {
      onEvent?: { onmessage?: (event: AgentEvent) => void };
    }) => {
      if (cmd === "agent_chat_history") return Promise.resolve([]);
      if (cmd === "agent_chat_start") {
        startCount += 1;
        emit = args?.onEvent?.onmessage;
        return Promise.resolve(`session-${startCount}`);
      }
      if (cmd === "agent_chat_dispose") return dispose.promise;
      return Promise.resolve(null);
    });

    await ensureAgentChat(chatId, "/project", "omp", null, { engine: "v2" });
    emit?.({ kind: "turnFailed", error: "connection lost" });
    const retry = retryAgentChatConnection(chatId);
    const switching = switchAgentChatProvider(chatId, "codex", null);
    dispose.resolve(undefined);
    await Promise.all([retry, switching]);

    expect(startCount).toBe(2);
    expect(agentChat(chatId)?.provider).toBe("codex");
    expect(agentChat(chatId)?.sessionId).toBe("session-2");
  });

  it.each(["claudeCode", "codex"] as const)(
    "keeps the live %s session after a send failure",
    async (provider) => {
      const chatId = nextChatId();
      let startCount = 0;
      tauri.invoke.mockImplementation((cmd: string) => {
        if (cmd === "agent_chat_history") return Promise.resolve([]);
        if (cmd === "agent_chat_start") {
          startCount += 1;
          return Promise.resolve("session-1");
        }
        if (cmd === "agent_chat_send") return Promise.reject(new Error("send failed"));
        return Promise.resolve(null);
      });

      await ensureAgentChat(chatId, "/project", provider, null, { engine: "v2" });
      await expect(sendAgentMessage(chatId, "hello")).rejects.toThrow("send failed");

      expect(agentChat(chatId)?.sessionId).toBe("session-1");
      expect(startCount).toBe(1);
    },
  );

  it("does not recreate a disposed chat when an in-flight send fails", async () => {
    const { chatId } = await startChat();
    const send = deferred<void>();
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_send") return send.promise;
      return Promise.resolve(null);
    });

    const sending = sendAgentMessage(chatId, "hello");
    expect(timeline(chatId)).toEqual([
      { type: "userMessage", seq: 1, text: "hello", optimistic: true },
    ]);

    disposeAgentChat(chatId);
    const expectation = expect(sending).rejects.toThrow("send failed");
    send.reject(new Error("send failed"));
    await expectation;

    expect(agentChat(chatId)).toBeUndefined();
    expect(activity.agentTurnCleared).not.toHaveBeenCalledWith(chatId);
  });

  it("aborts a Claude send when the chat is disposed during a pending model update", async () => {
    const chatId = nextChatId();
    const setModel = deferred<void>();
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_history") return Promise.resolve([]);
      if (cmd === "agent_chat_start") return Promise.resolve("session-1");
      if (cmd === "agent_chat_set_model") return setModel.promise;
      if (cmd === "agent_chat_send") return Promise.resolve();
      if (cmd === "agent_chat_dispose") return Promise.resolve();
      return Promise.resolve(null);
    });

    await ensureAgentChat(chatId, "/project", "claudeCode", "claude-old");
    setAgentChatModel(chatId, "claude-new");
    await flushPromises();

    const sending = sendAgentMessage(chatId, "hello");
    await flushPromises();

    expect(timeline(chatId)).toEqual([
      { type: "userMessage", seq: 1, text: "hello", optimistic: true },
    ]);
    expect(tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_send")).toHaveLength(
      0,
    );

    await disposeAgentChat(chatId);
    setModel.resolve(undefined);
    await expect(sending).resolves.toBeUndefined();

    expect(agentChat(chatId)).toBeUndefined();
    expect(tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_send")).toHaveLength(
      0,
    );
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
      effort: null,
      model: null,
      images: [],
    });
    expect(timeline(chatId)).toEqual([
      { type: "userMessage", seq: 1, text: "hello", optimistic: true },
    ]);
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

describe("switchAgentChatProvider", () => {
  it("disposes, persists the provider marker, and starts a fresh provider session", async () => {
    const chatId = nextChatId();
    workspace.chats.set(chatId, workspace.makeChat(chatId, { agentId: "codex", kind: "agent" }));
    const history: AgentTimelineEntry[] = [
      { entryType: "message", seq: 1, role: "user", content: "before", createdAt: 1 },
      { entryType: "message", seq: 2, role: "assistant", content: "after", createdAt: 2 },
    ];
    mockInvoke(history);
    setAgentEngine("v1");
    await ensureAgentChat(chatId, "/project", "codex", "gpt-old");
    expect(agentChat(chatId)?.engine).toBe("v1");
    setAgentEngine("v2");

    await expect(switchAgentChatProvider(chatId, "claudeCode", "claude-new")).resolves.toBe(true);

    expect(tauri.invoke).toHaveBeenCalledWith("agent_chat_dispose", { sessionId: "session-1" });
    expect(workspace.setChatAgent).toHaveBeenCalledWith(chatId, "claudeCode", "agent");
    expect(workspace.chats.get(chatId)?.agentId).toBe("claudeCode");
    const starts = tauri.invoke.mock.calls.filter((call) => call[0] === "agent_chat_start");
    expect(starts).toHaveLength(2);
    expect(starts[1][1]).toEqual(
      expect.objectContaining({
        chatId,
        projectRoot: "/project",
        provider: "claudeCode",
        model: "claude-new",
        engine: "v2",
      }),
    );
    expect(agentChat(chatId)).toMatchObject({
      provider: "claudeCode",
      engine: "v2",
      model: "claude-new",
      providerSwitched: true,
      contextUsed: null,
      contextWindow: null,
    });
    expect(timeline(chatId)).toMatchObject([
      { type: "userMessage", seq: 1, text: "before" },
      { type: "assistantText", seq: 2, text: "after" },
    ]);
  });

  it("resets the context meter but keeps the whole-conversation cost total across a provider switch", async () => {
    // contextUsed/contextWindow describe the NEW provider's occupancy, so they
    // must reset — but totals.costUsd tracks spend across the whole chat, so a
    // provider switch must not silently drop everything spent before it.
    const chatId = nextChatId();
    workspace.chats.set(chatId, workspace.makeChat(chatId, { agentId: "codex", kind: "agent" }));
    const history: AgentTimelineEntry[] = [
      { entryType: "message", seq: 1, role: "user", content: "before", createdAt: 1 },
      {
        entryType: "item",
        seq: 2,
        kind: "usage",
        payload: JSON.stringify({
          kind: "usage",
          inputTokens: 1_000,
          cachedInputTokens: 0,
          outputTokens: 200,
          costUsd: 0.05,
          contextUsed: 9_000,
          contextWindow: 100_000,
        }),
        createdAt: 2,
      },
    ];
    mockInvoke(history);
    setAgentEngine("v1");
    await ensureAgentChat(chatId, "/project", "codex", "gpt-old");
    expect(agentChat(chatId)?.contextUsed).toBe(9_000);
    expect(agentChat(chatId)?.contextWindow).toBe(100_000);
    expect(agentChat(chatId)?.totals.costUsd).toBeCloseTo(0.05);
    setAgentEngine("v2");

    await expect(switchAgentChatProvider(chatId, "claudeCode", "claude-new")).resolves.toBe(true);

    // Context describes the new provider's (not-yet-reported) occupancy.
    expect(agentChat(chatId)?.contextUsed).toBeNull();
    expect(agentChat(chatId)?.contextWindow).toBeNull();
    // Cost is a whole-conversation total; it must survive the switch.
    expect(agentChat(chatId)?.totals.costUsd).toBeCloseTo(0.05);
  });

  it("rejects provider switching while a turn is active", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "turnStarted" });

    await expect(switchAgentChatProvider(chatId, "claudeCode", "claude-new")).rejects.toThrow(
      "Cannot switch provider while a turn is active",
    );
    expect(workspace.setChatAgent).not.toHaveBeenCalled();
  });
});

describe("steerAgentChat", () => {
  it("rejects unsupported Claude steering before adding an optimistic action", async () => {
    const chatId = nextChatId();
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "claudeCode", null);

    await expect(steerAgentChat(chatId, "change direction")).rejects.toThrow(
      "Agent SDK exposes it",
    );

    expect(timeline(chatId)).toEqual([]);
    expect(tauri.invoke.mock.calls.some((call) => call[0] === "agent_chat_steer")).toBe(false);
  });

  it("rejects Codex steering when the active engine cannot perform it", async () => {
    const chatId = nextChatId();
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null, { engine: "v1" });

    await expect(steerAgentChat(chatId, "change direction")).rejects.toThrow(
      "v2 agent engine",
    );

    expect(timeline(chatId)).toEqual([]);
    expect(tauri.invoke.mock.calls.some((call) => call[0] === "agent_chat_steer")).toBe(false);
  });
});

describe("agent chat auto-rename", () => {
  it("renames a default-titled chat once after the first completed turn", async () => {
    const chatId = nextChatId();
    workspace.chats.set(
      chatId,
      workspace.makeChat(chatId, { title: "New chat", titleSource: "default" }),
    );
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null);
    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");
    const emit = (event: AgentEvent) => startCall?.[1].onEvent.onmessage(event);

    await sendAgentMessage(chatId, "fix the login bug");
    emit({ kind: "textFinal", itemId: null, text: "I will trace it." });
    emit({ kind: "turnDone", status: "completed" });
    await sendAgentMessage(chatId, "also update the test");
    emit({ kind: "turnDone", status: "completed" });

    expect(workspace.setChatTitle).toHaveBeenCalledTimes(1);
    expect(workspace.setChatTitle).toHaveBeenCalledWith(chatId, "Fix the login bug");
  });

  it("does not rename a custom-titled chat", async () => {
    const chatId = nextChatId();
    workspace.chats.set(chatId, workspace.makeChat(chatId, { title: "Custom title" }));
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null);
    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");

    await sendAgentMessage(chatId, "fix the login bug");
    startCall?.[1].onEvent.onmessage({ kind: "turnDone", status: "completed" });

    expect(workspace.setChatTitle).not.toHaveBeenCalled();
  });

  it("does not rename from a hidden internal prompt", async () => {
    const chatId = nextChatId();
    workspace.chats.set(
      chatId,
      workspace.makeChat(chatId, { title: "New chat", titleSource: "default" }),
    );
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null);
    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");

    await sendAgentMessage(chatId, "Pickforge swarm finished for this chat.", [], {
      hidden: true,
    });
    startCall?.[1].onEvent.onmessage({ kind: "textFinal", itemId: null, text: "Done." });
    startCall?.[1].onEvent.onmessage({ kind: "turnDone", status: "completed" });

    expect(workspace.setChatTitle).not.toHaveBeenCalled();
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
    expect(agentChat(chatId)?.turnActive).toBe(true);
    expect(activity.agentTurnCleared).not.toHaveBeenCalled();

    emit({ kind: "turnFailed", error: "interrupted" });
    expect(agentChat(chatId)?.turnActive).toBe(false);
    expect(activity.agentTurnDone).not.toHaveBeenCalled();
    expect(activity.agentTurnCleared).toHaveBeenCalledTimes(1);

    emit({ kind: "turnStarted" });
    emit({ kind: "turnDone", status: "completed" });
    expect(activity.agentTurnDone).toHaveBeenCalledTimes(1);
  });

  it("keeps dispose pending until the backend session is released", async () => {
    const { chatId } = await startChat();
    const dispose = deferred<void>();
    tauri.invoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_chat_dispose") return dispose.promise;
      return Promise.resolve(null);
    });

    let settled = false;
    const pending = disposeAgentChat(chatId).then(() => {
      settled = true;
    });

    expect(agentChat(chatId)).toBeUndefined();
    await Promise.resolve();
    expect(settled).toBe(false);

    dispose.resolve();
    await pending;
    expect(settled).toBe(true);
  });

  it("dispose drops the store entry and ignores late events", async () => {
    const { chatId, emit } = await startChat();

    emit({ kind: "turnStarted" });
    activity.agentTurnStarted.mockClear();
    await disposeAgentChat(chatId);

    expect(agentChat(chatId)).toBeUndefined();
    expect(tauri.invoke.mock.calls.some((call) => call[0] === "agent_chat_dispose")).toBe(true);

    emit({ kind: "turnDone", status: "completed" });
    expect(agentChat(chatId)).toBeUndefined();
    expect(activity.agentTurnDone).not.toHaveBeenCalled();
    expect(activity.agentTurnStarted).not.toHaveBeenCalled();
  });
});

describe("dynamic native chat titles", () => {
  it("ignores greetings and names from the first meaningful completed task", async () => {
    const chatId = nextChatId();
    workspace.chats.set(
      chatId,
      workspace.makeChat(chatId, { title: "New chat", titleSource: "default" }),
    );
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null);
    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");
    const emit = (event: AgentEvent) => startCall?.[1].onEvent.onmessage(event);

    await sendAgentMessage(chatId, "hi");
    emit({ kind: "textFinal", itemId: null, text: "How can I help?" });
    emit({ kind: "turnDone", status: "completed" });
    expect(workspace.setChatTitle).not.toHaveBeenCalled();

    await sendAgentMessage(chatId, "fix the login redirect race");
    emit({ kind: "turnDone", status: "completed" });
    expect(workspace.setChatTitle).toHaveBeenCalledWith(
      chatId,
      "Fix the login redirect race",
    );
  });

  it("refreshes from the fourth meaningful completed user turn", async () => {
    const chatId = nextChatId();
    workspace.chats.set(
      chatId,
      workspace.makeChat(chatId, { title: "New chat", titleSource: "default" }),
    );
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null);
    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");
    const emit = (event: AgentEvent) => startCall?.[1].onEvent.onmessage(event);

    for (const text of [
      "fix the login redirect",
      "add regression coverage",
      "verify the database migration",
      "rework settings navigation",
    ]) {
      await sendAgentMessage(chatId, text);
      emit({ kind: "turnDone", status: "completed" });
    }

    expect(workspace.setChatTitle).toHaveBeenCalledTimes(2);
    expect(workspace.setChatTitle).toHaveBeenNthCalledWith(
      1,
      chatId,
      "Fix the login redirect",
    );
    expect(workspace.setChatTitle).toHaveBeenNthCalledWith(
      2,
      chatId,
      "Rework settings navigation",
    );
  });
  it("ties a completed title milestone to the prompt that started the turn", async () => {
    const chatId = nextChatId();
    workspace.chats.set(
      chatId,
      workspace.makeChat(chatId, { title: "New chat", titleSource: "default" }),
    );
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null);
    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");

    await sendAgentMessage(chatId, "fix the login redirect race");
    await steerAgentChat(chatId, "also run tests");
    startCall?.[1].onEvent.onmessage({ kind: "turnDone", status: "completed" });

    expect(workspace.setChatTitle).toHaveBeenCalledTimes(1);
    expect(workspace.setChatTitle).toHaveBeenCalledWith(
      chatId,
      "Fix the login redirect race",
    );
  });


  it("counts only successful turns when failures come first or intervene", async () => {
    const chatId = nextChatId();
    workspace.chats.set(
      chatId,
      workspace.makeChat(chatId, { title: "New chat", titleSource: "default" }),
    );
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null);
    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");
    const emit = (event: AgentEvent) => startCall?.[1].onEvent.onmessage(event);

    await sendAgentMessage(chatId, "failed first task");
    emit({ kind: "turnFailed", error: "boom" });
    await sendAgentMessage(chatId, "first successful task");
    emit({ kind: "turnDone", status: "completed" });
    await sendAgentMessage(chatId, "failed intervening task");
    emit({ kind: "turnFailed", error: "boom again" });
    for (const text of ["second successful task", "third successful task", "fourth successful task"]) {
      await sendAgentMessage(chatId, text);
      emit({ kind: "turnDone", status: "completed" });
    }

    expect(workspace.setChatTitle).toHaveBeenCalledTimes(2);
    expect(workspace.setChatTitle).toHaveBeenNthCalledWith(
      1,
      chatId,
      "First successful task",
    );
    expect(workspace.setChatTitle).toHaveBeenNthCalledWith(
      2,
      chatId,
      "Fourth successful task",
    );
  });

  it("stages provider plans during streaming and gives them precedence at turn end", async () => {
    const chatId = nextChatId();
    workspace.chats.set(
      chatId,
      workspace.makeChat(chatId, {
        title: "Fix the login redirect",
        titleSource: "auto",
      }),
    );
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null);
    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");
    const emit = (event: AgentEvent) => startCall?.[1].onEvent.onmessage(event);

    await sendAgentMessage(chatId, "add regression coverage");
    emit({
      kind: "planUpdate",
      items: [
        { text: "Rework OAuth session recovery", status: "pending" },
        { text: "Run focused tests", status: "pending" },
      ],
    });
    expect(workspace.setChatTitle).not.toHaveBeenCalled();
    emit({ kind: "turnDone", status: "completed" });
    expect(workspace.setChatTitle).toHaveBeenCalledWith(
      chatId,
      "Rework OAuth session recovery",
    );
  });

  it("commits OMP session title events only at a successful durable ownership boundary", async () => {
    const chatId = nextChatId();
    workspace.chats.set(
      chatId,
      workspace.makeChat(chatId, {
        title: "Existing automatic title",
        titleSource: "auto",
      }),
    );
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null);
    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");

    await sendAgentMessage(chatId, "rework the OMP connector");
    startCall?.[1].onEvent.onmessage({
      kind: "sessionTitle",
      title: "Safe OMP connector lifecycle",
    });
    expect(workspace.setChatTitle).not.toHaveBeenCalled();
    startCall?.[1].onEvent.onmessage({ kind: "turnDone", status: "completed" });
    expect(workspace.setChatTitle).toHaveBeenCalledWith(
      chatId,
      "Safe OMP connector lifecycle",
    );
  });

  it("discards a staged provider title when its turn fails", async () => {
    const chatId = nextChatId();
    workspace.chats.set(
      chatId,
      workspace.makeChat(chatId, { title: "New chat", titleSource: "default" }),
    );
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null);
    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");
    const emit = (event: AgentEvent) => startCall?.[1].onEvent.onmessage(event);

    await sendAgentMessage(chatId, "first task will fail");
    emit({
      kind: "planUpdate",
      items: [{ text: "Stale provider plan title", status: "pending" }],
    });
    emit({ kind: "turnFailed", error: "provider failed" });
    expect(workspace.setChatTitle).not.toHaveBeenCalled();

    await sendAgentMessage(chatId, "complete the later visible task");
    emit({ kind: "turnDone", status: "completed" });
    expect(workspace.setChatTitle).toHaveBeenCalledTimes(1);
    expect(workspace.setChatTitle).toHaveBeenCalledWith(
      chatId,
      "Complete the later visible task",
    );
    expect(workspace.setChatTitle).not.toHaveBeenCalledWith(
      chatId,
      "Stale provider plan title",
    );
  });

  it("does not let interrupted turns rename or advance title milestones", async () => {
    const chatId = nextChatId();
    workspace.chats.set(
      chatId,
      workspace.makeChat(chatId, { title: "New chat", titleSource: "default" }),
    );
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null);
    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");
    const emit = (event: AgentEvent) => startCall?.[1].onEvent.onmessage(event);

    const interruptWithPlan = async (task: string, plan: string) => {
      await sendAgentMessage(chatId, task);
      emit({ kind: "planUpdate", items: [{ text: plan, status: "pending" }] });
      emit({ kind: "turnDone", status: "interrupted" });
    };
    const complete = async (task: string) => {
      await sendAgentMessage(chatId, task);
      emit({ kind: "turnDone", status: "completed" });
    };

    await interruptWithPlan("interrupted before first", "Stale first provider plan");
    expect(workspace.setChatTitle).not.toHaveBeenCalled();
    await complete("first successful milestone");
    expect(workspace.setChatTitle).toHaveBeenNthCalledWith(
      1,
      chatId,
      "First successful milestone",
    );

    await complete("second successful task");
    await complete("third successful task");
    await interruptWithPlan("interrupted before fourth", "Stale fourth provider plan");
    expect(workspace.setChatTitle).toHaveBeenCalledTimes(1);
    await complete("fourth successful milestone");
    expect(workspace.setChatTitle).toHaveBeenNthCalledWith(
      2,
      chatId,
      "Fourth successful milestone",
    );

    await complete("fifth successful task");
    await complete("sixth successful task");
    await interruptWithPlan("interrupted before seventh", "Stale seventh provider plan");
    expect(workspace.setChatTitle).toHaveBeenCalledTimes(2);
    await complete("seventh successful milestone");
    expect(workspace.setChatTitle).toHaveBeenNthCalledWith(
      3,
      chatId,
      "Seventh successful milestone",
    );
  });

  it("does not hydrate interrupted turns into the successful title cadence", async () => {
    const chatId = nextChatId();
    workspace.chats.set(
      chatId,
      workspace.makeChat(chatId, { title: "New chat", titleSource: "default" }),
    );
    const history: AgentTimelineEntry[] = [
      {
        entryType: "message",
        seq: 1,
        role: "user",
        content: "interrupted persisted task",
        createdAt: 1,
      },
      {
        entryType: "item",
        seq: 2,
        kind: "planUpdate",
        payload: JSON.stringify({
          kind: "planUpdate",
          items: [{ text: "Stale persisted provider plan", status: "pending" }],
        }),
        createdAt: 2,
      },
      {
        entryType: "item",
        seq: 3,
        kind: "turnDone",
        payload: JSON.stringify({ kind: "turnDone", status: "interrupted" }),
        createdAt: 3,
      },
    ];
    mockInvoke(history);
    await ensureAgentChat(chatId, "/project", "codex", null);
    expect(workspace.setChatTitle).not.toHaveBeenCalled();

    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");
    await sendAgentMessage(chatId, "first successful task after hydration");
    startCall?.[1].onEvent.onmessage({ kind: "turnDone", status: "completed" });

    expect(workspace.setChatTitle).toHaveBeenCalledTimes(1);
    expect(workspace.setChatTitle).toHaveBeenCalledWith(
      chatId,
      "First successful task after hydration",
    );
    expect(workspace.setChatTitle).not.toHaveBeenCalledWith(
      chatId,
      "Stale persisted provider plan",
    );
  });

  it("never stages or commits provider plans from hidden internal turns", async () => {
    const chatId = nextChatId();
    workspace.chats.set(
      chatId,
      workspace.makeChat(chatId, { title: "New chat", titleSource: "default" }),
    );
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null);
    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");
    const emit = (event: AgentEvent) => startCall?.[1].onEvent.onmessage(event);

    await sendAgentMessage(chatId, "Pickforge swarm finished for this chat.", [], {
      hidden: true,
    });
    emit({
      kind: "planUpdate",
      items: [{ text: "Sensitive internal synthesis plan", status: "pending" }],
    });
    emit({ kind: "turnDone", status: "completed" });
    expect(workspace.setChatTitle).not.toHaveBeenCalled();

    await sendAgentMessage(chatId, "fix the visible settings flow");
    emit({ kind: "turnDone", status: "completed" });
    expect(workspace.setChatTitle).toHaveBeenCalledWith(
      chatId,
      "Fix the visible settings flow",
    );
  });

  it("never refreshes a persisted user-owned title", async () => {
    const chatId = nextChatId();
    workspace.chats.set(
      chatId,
      workspace.makeChat(chatId, {
        title: "My deliberate title",
        titleSource: "user",
      }),
    );
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null);
    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");

    await sendAgentMessage(chatId, "replace the title from this task");
    startCall?.[1].onEvent.onmessage({
      kind: "planUpdate",
      items: [{ text: "Provider title suggestion", status: "pending" }],
    });
    startCall?.[1].onEvent.onmessage({ kind: "turnDone", status: "completed" });

    expect(workspace.setChatTitle).not.toHaveBeenCalled();
  });
  it("locks immediately when a manual rename races an active turn", async () => {
    const chatId = nextChatId();
    workspace.chats.set(
      chatId,
      workspace.makeChat(chatId, {
        title: "Current automatic title",
        titleSource: "auto",
      }),
    );
    mockInvoke();
    await ensureAgentChat(chatId, "/project", "codex", null);
    const startCall = tauri.invoke.mock.calls.find((call) => call[0] === "agent_chat_start");

    await sendAgentMessage(chatId, "replace the task");
    startCall?.[1].onEvent.onmessage({
      kind: "planUpdate",
      items: [{ text: "Provider replacement title", status: "pending" }],
    });
    markChatTitleManual(chatId);
    startCall?.[1].onEvent.onmessage({ kind: "turnDone", status: "completed" });

    expect(workspace.setChatTitle).not.toHaveBeenCalled();
  });

});
