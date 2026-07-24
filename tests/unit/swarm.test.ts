import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SwarmRunSnapshot } from "../../src/lib/mcp";

const deps = vi.hoisted(() => {
  type ChatRow = {
    chatId: string;
    projectRoot: string;
    title: string;
    kind: string;
    agentId: string;
    labelsJson: string | null;
  };
  const chats = new Map<string, ChatRow>();
  const agentStates = new Map<string, { turnActive: boolean; error: string | null; timeline: unknown[] }>();
  let chatCounter = 0;
  return {
    chats,
    agentStates,
    workspace: { activeRoot: "/project" as string | null },
    mcpSwarmStatus: vi.fn(),
    mcpTakeSwarmRequests: vi.fn(),
    mcpUpdateSwarmRun: vi.fn(),
    addChat: vi.fn(async (
      title: string,
      agentId: string,
      root: string,
      kind: string,
      options: { labelsJson?: string | null },
    ) => {
      chatCounter += 1;
      const chatId = `swarm-chat-${chatCounter}`;
      chats.set(chatId, {
        chatId,
        projectRoot: root,
        title,
        kind,
        agentId,
        labelsJson: options.labelsJson ?? null,
      });
      return chatId;
    }),
    ensureChatsLoaded: vi.fn(async () => undefined),
    findChat: vi.fn((chatId: string) => chats.get(chatId)),
    ensureAgentChat: vi.fn(async (chatId: string) => {
      if (!agentStates.has(chatId)) {
        agentStates.set(chatId, { turnActive: false, error: null, timeline: [] });
      }
    }),
    agentChat: vi.fn((chatId: string) => agentStates.get(chatId)),
    sendAgentMessage: vi.fn(async (chatId: string, text: string) => {
      agentStates.set(chatId, {
        turnActive: true,
        error: null,
        timeline: [{ type: "userMessage", text }],
      });
    }),
    loadAgentModels: vi.fn(),
    modelOption: vi.fn(),
    loadAgentEngine: vi.fn(),
    reset() {
      chatCounter = 0;
      chats.clear();
      agentStates.clear();
      this.workspace.activeRoot = "/project";
      this.mcpSwarmStatus.mockReset().mockResolvedValue(null);
      this.mcpTakeSwarmRequests.mockReset().mockResolvedValue([]);
      this.mcpUpdateSwarmRun.mockReset().mockResolvedValue(undefined);
      this.addChat.mockClear();
      this.ensureChatsLoaded.mockClear();
      this.findChat.mockClear();
      this.ensureAgentChat.mockClear();
      this.agentChat.mockClear();
      this.sendAgentMessage.mockClear();
      this.loadAgentModels.mockReset().mockReturnValue({
        claudeCode: "claude-opus-5",
        codex: "gpt-5.5",
      });
      this.modelOption.mockReset().mockImplementation((provider: string, modelId: string | null) => {
        if (modelId === "glm-5.2:cloud") return { id: modelId, terminalOnly: true };
        if (provider === "codex" && modelId === "gpt-5.5") return { id: "gpt-5.5" };
        if (provider === "codex" && modelId === "gpt-5.4") return { id: "gpt-5.4" };
        if (provider === "claudeCode" && modelId === "claude-opus-5") {
          return { id: "claude-opus-5" };
        }
        if (provider === "claudeCode" && modelId === "claude-sonnet-5") {
          return { id: "claude-sonnet-5" };
        }
        return undefined;
      });
      this.loadAgentEngine.mockReset().mockReturnValue("test-engine");
    },
  };
});

vi.mock("../../src/lib/mcp", () => ({
  mcpSwarmStatus: deps.mcpSwarmStatus,
  mcpTakeSwarmRequests: deps.mcpTakeSwarmRequests,
  mcpUpdateSwarmRun: deps.mcpUpdateSwarmRun,
}));
vi.mock("../../src/lib/agentModels", () => ({
  loadAgentModels: deps.loadAgentModels,
  modelOption: deps.modelOption,
  ompNativeChatAvailable: vi.fn(() => false),
  piNativeChatAvailable: vi.fn(() => true),
}));
vi.mock("../../src/stores/flags", () => ({
  flagEnabled: (key: string) => key === "ompAgents",
  subscribeToFlagChanges: vi.fn(() => () => undefined),
}));
vi.mock("../../src/lib/chatDefaults", () => ({ loadAgentEngine: deps.loadAgentEngine }));
vi.mock("../../src/stores/agentChat", () => ({
  ensureAgentChat: deps.ensureAgentChat,
  agentChat: deps.agentChat,
  sendAgentMessage: deps.sendAgentMessage,
}));
vi.mock("../../src/stores/workspace", () => ({
  addChat: deps.addChat,
  ensureChatsLoaded: deps.ensureChatsLoaded,
  findChat: deps.findChat,
  workspace: deps.workspace,
}));

async function loadSwarmStore() {
  vi.resetModules();
  return import("../../src/stores/swarm");
}

function updatedRuns() {
  return deps.mcpUpdateSwarmRun.mock.calls.map((call) => call[0]);
}

beforeEach(() => {
  deps.reset();
});

describe("swarm dispatch", () => {
  it("creates hidden labeled worker chats owned by the origin chat", async () => {
    const { startSwarm } = await loadSwarmStore();

    await startSwarm("/project", "review the current change", {
      count: 3,
      model: "gpt-5.5",
      providerPreference: "codex",
      mode: "review",
      originChatId: "chat-main",
    });

    expect(deps.ensureChatsLoaded).toHaveBeenCalledWith("/project");
    expect(deps.addChat).toHaveBeenCalledTimes(3);
    expect(deps.ensureAgentChat).toHaveBeenCalledTimes(3);
    expect(deps.sendAgentMessage).toHaveBeenCalledTimes(3);

    for (const call of deps.addChat.mock.calls) {
      const [title, provider, root, kind, options] = call;
      expect(title).toContain(" - Codex");
      expect(provider).toBe("codex");
      expect(root).toBe("/project");
      expect(kind).toBe("agent");
      const labels = JSON.parse(options.labelsJson!);
      expect(labels.role).toBe("swarmWorker");
      expect(labels.originChatId).toBe("chat-main");
    }

    expect(deps.ensureAgentChat.mock.calls[0][3]).toBe("gpt-5.5");
    expect(deps.ensureAgentChat.mock.calls[0][4]).toMatchObject({
      engine: "test-engine",
      mode: "read-only",
      sandbox: "read-only",
      approvalPolicy: "on-request",
    });
    expect(deps.sendAgentMessage.mock.calls[0][1]).toContain("Pickforge swarm worker 1 of 3");
    expect(deps.sendAgentMessage.mock.calls[0][1]).toContain("Do not edit files");

    const last = updatedRuns().at(-1);
    expect(last).toMatchObject({
      originChatId: "chat-main",
      status: "running",
      synthesisStatus: "idle",
    });
  });

  it("routes mixed swarms across native Claude Code and Codex defaults", async () => {
    const { startSwarm } = await loadSwarmStore();

    await startSwarm("/project", "map the repo", {
      count: 4,
      providerPreference: "mixed",
      mode: "scout",
      originChatId: "chat-main",
    });

    expect(deps.addChat.mock.calls.map((call) => call[1])).toEqual([
      "claudeCode",
      "codex",
      "claudeCode",
      "codex",
    ]);
    expect(deps.ensureAgentChat.mock.calls.map((call) => call[3])).toEqual([
      "claude-opus-5",
      "gpt-5.5",
      "claude-opus-5",
      "gpt-5.5",
    ]);
    expect(deps.ensureAgentChat.mock.calls[0][4]).toMatchObject({
      engine: "test-engine",
      mode: "plan",
      permissionMode: "plan",
    });
    expect(deps.ensureAgentChat.mock.calls[1][4]).toMatchObject({
      engine: "test-engine",
      mode: "read-only",
      sandbox: "read-only",
    });
  });

  it("routes explicit Opus requests to Claude Code native lanes", async () => {
    const { startSwarm } = await loadSwarmStore();

    await startSwarm("/project", "ask stronger Claude workers", {
      count: 2,
      model: "opus 5",
      providerPreference: "mixed",
      originChatId: "chat-main",
    });

    expect(deps.addChat.mock.calls.map((call) => call[1])).toEqual([
      "claudeCode",
      "claudeCode",
    ]);
    expect(deps.ensureAgentChat.mock.calls.map((call) => call[3])).toEqual([
      "claude-opus-5",
      "claude-opus-5",
    ]);
    expect(deps.sendAgentMessage.mock.calls[0][1]).toContain("Requested model: opus 5");
  });

  it("fails fast for terminal-only Ollama Cloud models in structured swarms", async () => {
    const { startSwarm } = await loadSwarmStore();

    await startSwarm("/project", "run cloud workers", {
      count: 2,
      model: "glm-5.2:cloud",
      providerPreference: "mixed",
      originChatId: "chat-main",
    });

    expect(deps.addChat).not.toHaveBeenCalled();
    const last = updatedRuns().at(-1);
    expect(last?.status).toBe("failed");
    expect(last?.error).toContain("terminal-only");
  });

  it("fails before dispatch when the requested model is not native to the lane provider", async () => {
    const { startSwarm } = await loadSwarmStore();

    await startSwarm("/project", "use a mystery model", {
      count: 1,
      model: "mystery-9",
      providerPreference: "codex",
      originChatId: "chat-main",
    });

    expect(deps.addChat).not.toHaveBeenCalled();
    const last = updatedRuns().at(-1);
    expect(last).toMatchObject({ status: "failed" });
    expect(last?.error).toContain("mystery-9");
  });

  it("fails terminal-only OMP origin synthesis without a native send", async () => {
    const originChatId = "chat-omp";
    deps.chats.set(originChatId, {
      chatId: originChatId,
      projectRoot: "/project",
      title: "OMP terminal chat",
      kind: "agent",
      agentId: "omp",
      labelsJson: null,
    });
    const { startSwarm, dispatchSynthesis, swarmRuns } = await loadSwarmStore();
    await startSwarm("/project", "summarize terminal results", {
      count: 1,
      providerPreference: "codex",
      originChatId,
    });
    const running = swarmRuns()[0];
    const completed: SwarmRunSnapshot = {
      ...running,
      status: "completed",
      lanes: running.lanes.map((lane) => ({
        ...lane,
        status: "completed",
        summary: "Worker result.",
      })),
    };
    deps.sendAgentMessage.mockClear();

    await dispatchSynthesis(completed);

    expect(deps.sendAgentMessage).not.toHaveBeenCalled();
    expect(updatedRuns().at(-1)).toMatchObject({
      runId: completed.runId,
      synthesisStatus: "failed",
      synthesisError: expect.stringContaining(
        "requires the ompAgents flag and compatible OMP >=17.1.1 and <18.0.0 probe",
      ),
    });
  });

  it("synthesizes completed swarms for native Pi origins", async () => {
    const originChatId = "chat-pi";
    deps.chats.set(originChatId, {
      chatId: originChatId,
      projectRoot: "/project",
      title: "Pi native chat",
      kind: "agent",
      agentId: "pi",
      labelsJson: null,
    });
    const { startSwarm, dispatchSynthesis, swarmRuns } = await loadSwarmStore();
    await startSwarm("/project", "summarize terminal results", {
      count: 1,
      providerPreference: "codex",
      originChatId,
    });
    const running = swarmRuns()[0];
    const completed: SwarmRunSnapshot = {
      ...running,
      status: "completed",
      lanes: running.lanes.map((lane) => ({
        ...lane,
        status: "completed",
        summary: "Worker result.",
      })),
    };
    deps.sendAgentMessage.mockClear();

    await dispatchSynthesis(completed);

    expect(deps.sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(deps.sendAgentMessage).toHaveBeenCalledWith(
      originChatId,
      expect.stringContaining("summarize terminal results"),
      [],
      { hidden: true },
    );
    expect(deps.sendAgentMessage.mock.calls[0][1]).toContain("Worker result.");
    expect(updatedRuns().at(-1)).toMatchObject({
      runId: completed.runId,
      synthesisStatus: "sent",
      synthesisError: null,
      synthesizedAt: expect.any(Number),
    });
  });

  it("synthesizes completed swarms for persisted legacy Claude origins", async () => {
    const timestamp = Date.now();
    deps.chats.set("chat-legacy-claude", {
      chatId: "chat-legacy-claude",
      projectRoot: "/project",
      title: "Legacy Claude chat",
      kind: "agent",
      agentId: "claude",
      labelsJson: null,
    });
    const run: SwarmRunSnapshot = {
      runId: "legacy-claude-run",
      projectRoot: "/project",
      goal: "summarize the review",
      requestedCount: 1,
      model: null,
      providerPreference: "claudeCode",
      mode: "review",
      source: "pickforge",
      originChatId: "chat-legacy-claude",
      status: "completed",
      synthesisStatus: "idle",
      synthesisError: null,
      synthesizedAt: null,
      lanes: [{
        id: "lane-1",
        chatId: "worker-1",
        provider: "future-backend",
        model: "claude-opus-5",
        title: "Review",
        status: "completed",
        summary: "The review passed.",
        error: null,
        updatedAt: timestamp,
      }],
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const { dispatchSynthesis } = await loadSwarmStore();

    await dispatchSynthesis(run);

    expect(deps.sendAgentMessage).toHaveBeenCalledWith(
      "chat-legacy-claude",
      expect.stringContaining("The review passed."),
      [],
      { hidden: true },
    );
    expect(deps.sendAgentMessage.mock.calls[0][1]).toContain(
      "future-backend / claude-opus-5",
    );
    expect(deps.ensureAgentChat).toHaveBeenCalledWith(
      "chat-legacy-claude",
      "/project",
      "claudeCode",
      null,
      { engine: "test-engine" },
    );
  });
});
