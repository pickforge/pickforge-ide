import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorAction, OperatorIntent } from "../../src/lib/operatorIntent";

const deps = vi.hoisted(() => {
  type Project = {
    projectRoot: string;
    displayName: string;
    createdAt: number;
    lastOpenedAt: number;
    sortOrder: number;
    archivedAt: number | null;
  };
  type Chat = {
    chatId: string;
    projectRoot: string;
    title: string;
    kind: string;
    agentId: string;
    skillId: string | null;
    sessionId: string | null;
    labelsJson: string | null;
    status: string | null;
    taskBriefText: string | null;
    createdAt: number;
    lastActivityAt: number;
    sortOrder: number;
  };
  const workspace = {
    projects: [] as Project[],
    activeRoot: null as string | null,
    chatsByRoot: {} as Record<string, Chat[]>,
    activeChatId: null as string | null,
  };
  const agentStates = new Map<string, { sessionId: string | null; model: string | null }>();
  const archivedChats = new Set<string>();
  const runs: Array<{
    projectRoot: string;
    status: "queued" | "starting" | "running" | "completed" | "failed" | "cancelled";
  }> = [];
  return {
    workspace,
    agentStates,
    archivedChats,
    runs,
    flagEnabled: vi.fn(),
    loadAgentModels: vi.fn(),
    loadAgentEfforts: vi.fn(),
    nativeChatModel: vi.fn(),
    loadAgentModes: vi.fn(),
    loadAgentEngine: vi.fn(),
    isChatArchived: vi.fn((chatId: string) => archivedChats.has(chatId)),
    operatorAuditInsert: vi.fn(),
    operatorAuditUpdate: vi.fn(),
    operatorAuditList: vi.fn(),
    addChat: vi.fn(),
    chatsFor: vi.fn((root: string) => workspace.chatsByRoot[root] ?? []),
    ensureChatsLoaded: vi.fn(),
    findChat: vi.fn((chatId: string) => {
      for (const chats of Object.values(workspace.chatsByRoot)) {
        const hit = chats.find((chat) => chat.chatId === chatId);
        if (hit) return hit;
      }
      return undefined;
    }),
    selectChat: vi.fn((chatId: string | null) => {
      workspace.activeChatId = chatId;
    }),
    selectProject: vi.fn((root: string) => {
      workspace.activeRoot = root;
    }),
    agentChat: vi.fn((chatId: string) => agentStates.get(chatId)),
    ensureAgentChat: vi.fn(),
    sendAgentMessage: vi.fn(),
    interruptAgentChat: vi.fn(),
    steerAgentChat: vi.fn(),
    startSwarm: vi.fn(),
    swarmRuns: vi.fn(() => runs),
    reset() {
      workspace.projects = [];
      workspace.activeRoot = null;
      workspace.chatsByRoot = {};
      workspace.activeChatId = null;
      agentStates.clear();
      archivedChats.clear();
      runs.splice(0);
      this.flagEnabled.mockReset().mockReturnValue(true);
      this.loadAgentModels.mockReset().mockReturnValue({
        claudeCode: "claude-opus-4-8",
        codex: "gpt-5.5",
      });
      this.loadAgentEfforts.mockReset().mockReturnValue({
        claudeCode: "max",
        codex: "high",
      });
      this.nativeChatModel.mockReset().mockImplementation((_provider: string, model: string | null) => model);
      this.loadAgentModes.mockReset().mockReturnValue({
        claudeCode: "plan",
        codex: "read-only",
      });
      this.loadAgentEngine.mockReset().mockReturnValue("test-engine");
      this.isChatArchived.mockClear();
      this.operatorAuditInsert.mockReset().mockResolvedValue(undefined);
      this.operatorAuditUpdate.mockReset().mockResolvedValue(undefined);
      this.operatorAuditList.mockReset().mockResolvedValue([]);
      this.addChat.mockReset().mockResolvedValue("chat-new");
      this.chatsFor.mockClear();
      this.ensureChatsLoaded.mockReset().mockResolvedValue(undefined);
      this.findChat.mockClear();
      this.selectChat.mockClear();
      this.selectProject.mockReset().mockImplementation((root: string) => {
        workspace.activeRoot = root;
      });
      this.agentChat.mockClear();
      this.ensureAgentChat.mockReset().mockResolvedValue(undefined);
      this.sendAgentMessage.mockReset().mockResolvedValue(undefined);
      this.interruptAgentChat.mockReset().mockResolvedValue(undefined);
      this.steerAgentChat.mockReset().mockResolvedValue(undefined);
      this.startSwarm.mockReset().mockResolvedValue("swarm-1");
      this.swarmRuns.mockClear();
    },
  };
});

vi.mock("../../src/stores/flags", () => ({
  flagEnabled: deps.flagEnabled,
}));

vi.mock("../../src/lib/agentModels", () => ({
  loadAgentModels: deps.loadAgentModels,
  loadAgentEfforts: deps.loadAgentEfforts,
  nativeChatModel: deps.nativeChatModel,
}));

vi.mock("../../src/lib/agentModes", () => ({
  loadAgentModes: deps.loadAgentModes,
}));

vi.mock("../../src/lib/chatDefaults", () => ({
  loadAgentEngine: deps.loadAgentEngine,
}));

vi.mock("../../src/lib/db", () => ({
  operatorAuditInsert: deps.operatorAuditInsert,
  operatorAuditUpdate: deps.operatorAuditUpdate,
  operatorAuditList: deps.operatorAuditList,
}));

vi.mock("../../src/stores/chatArchive", () => ({
  isChatArchived: deps.isChatArchived,
}));

vi.mock("../../src/stores/workspace", () => ({
  workspace: deps.workspace,
  addChat: deps.addChat,
  chatsFor: deps.chatsFor,
  ensureChatsLoaded: deps.ensureChatsLoaded,
  findChat: deps.findChat,
  selectChat: deps.selectChat,
  selectProject: deps.selectProject,
}));

vi.mock("../../src/stores/agentChat", () => ({
  agentChat: deps.agentChat,
  ensureAgentChat: deps.ensureAgentChat,
  sendAgentMessage: deps.sendAgentMessage,
  interruptAgentChat: deps.interruptAgentChat,
  steerAgentChat: deps.steerAgentChat,
}));

vi.mock("../../src/stores/swarm", () => ({
  startSwarm: deps.startSwarm,
  swarmRuns: deps.swarmRuns,
}));

function project(projectRoot: string, displayName: string) {
  return {
    projectRoot,
    displayName,
    createdAt: 1,
    lastOpenedAt: 1,
    sortOrder: 0,
    archivedAt: null,
  };
}

function chat(chatId: string, projectRoot: string, title: string, kind = "agent", agentId = "codex") {
  return {
    chatId,
    projectRoot,
    title,
    kind,
    agentId,
    skillId: null,
    sessionId: null,
    labelsJson: null,
    status: null,
    taskBriefText: null,
    createdAt: 1,
    lastActivityAt: 1,
    sortOrder: 0,
  };
}

function intent(action: OperatorAction, projectRef: string | null = null): OperatorIntent {
  return {
    v: 1,
    id: `intent-${action.action}`,
    provenance: "typed",
    confidence: 1,
    projectRef,
    action,
  };
}

async function loadStore() {
  vi.resetModules();
  return import("../../src/stores/operator");
}

function auditUpdateStatus() {
  return deps.operatorAuditUpdate.mock.calls.at(-1)?.[1];
}

beforeEach(() => {
  deps.reset();
  deps.workspace.projects = [project("/repo/app", "App")];
  deps.workspace.activeRoot = "/repo/app";
  deps.workspace.chatsByRoot["/repo/app"] = [
    chat("chat-main", "/repo/app", "Main", "agent", "codex"),
  ];
  deps.workspace.activeChatId = "chat-main";
});

describe("dispatchIntent", () => {
  it("denies when the operator flag is off and audits the attempt", async () => {
    deps.flagEnabled.mockReturnValue(false);
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openProject" }, "App"), {
      inputText: "open project App",
    });

    expect(result).toEqual({ status: "denied", message: "Operator is disabled." });
    expect(deps.operatorAuditInsert).toHaveBeenCalledWith(expect.objectContaining({
      status: "started",
      riskTier: 0,
      inputText: "open project App",
    }));
    expect(auditUpdateStatus()).toBe("denied");
    expect(deps.selectProject).not.toHaveBeenCalled();
  });

  it("requires confirmation for tier-1 actions without calling dispatch seams", async () => {
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({
      action: "startSwarm",
      mode: "review",
      count: 3,
      goal: "review this",
      provider: "mixed",
    }));

    expect(result.status).toBe("needsConfirmation");
    expect(deps.operatorAuditInsert).toHaveBeenCalledWith(expect.objectContaining({
      status: "started",
      riskTier: 1,
    }));
    expect(auditUpdateStatus()).toBe("needs_confirmation");
    expect(deps.startSwarm).not.toHaveBeenCalled();
    expect(deps.addChat).not.toHaveBeenCalled();
    expect(deps.sendAgentMessage).not.toHaveBeenCalled();
  });

  it("runs confirmed tier-1 actions through the matching seam", async () => {
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(
      intent({ action: "createChat", provider: "claude", model: "opus" }, "App"),
      { confirmed: true },
    );

    expect(result.status).toBe("done");
    expect(deps.addChat).toHaveBeenCalledWith("Operator chat", "claudeCode", "/repo/app", "agent");
    expect(deps.ensureAgentChat).toHaveBeenCalledWith("chat-new", "/repo/app", "claudeCode", "opus");
    expect(auditUpdateStatus()).toBe("done");
  });

  it("falls back to compact action JSON when audit input text is absent", async () => {
    const { dispatchIntent } = await loadStore();

    await dispatchIntent(intent({ action: "openProject" }, "App"));

    expect(deps.operatorAuditInsert).toHaveBeenCalledWith(expect.objectContaining({
      inputText: "{\"action\":\"openProject\"}",
    }));
  });

  it("resolves projects by exact match before substring match", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/mobile-application", "Mobile Application"),
    ];
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openProject" }, "app"));

    expect(result.status).toBe("done");
    expect(deps.selectProject).toHaveBeenCalledWith("/repo/app");
  });

  it("resolves projects by unique substring match", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/dashboard", "Dashboard"),
    ];
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openProject" }, "dash"));

    expect(result.status).toBe("done");
    expect(deps.selectProject).toHaveBeenCalledWith("/repo/dashboard");
  });

  it("fails ambiguous project resolution and lists candidates", async () => {
    deps.workspace.projects = [
      project("/repo/mobile", "Mobile App"),
      project("/repo/web", "Web App"),
    ];
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openProject" }, "app"));

    expect(result.status).toBe("failed");
    expect("message" in result ? result.message : "").toContain("Mobile App");
    expect("message" in result ? result.message : "").toContain("Web App");
    expect(deps.selectProject).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("resolves chat titles by unique substring match", async () => {
    deps.workspace.chatsByRoot["/repo/app"] = [
      chat("chat-main", "/repo/app", "Main Chat"),
      chat("chat-review", "/repo/app", "Review Notes"),
    ];
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openChat", chat: "review" }));

    expect(result.status).toBe("done");
    expect(deps.ensureChatsLoaded).toHaveBeenCalledWith("/repo/app");
    expect(deps.selectChat).toHaveBeenCalledWith("chat-review");
  });

  it("opens the most recently active project chat when openChat has no chat ref", async () => {
    deps.workspace.chatsByRoot["/repo/app"] = [
      { ...chat("chat-old", "/repo/app", "Old Chat"), lastActivityAt: 10 },
      { ...chat("chat-new", "/repo/app", "New Chat"), lastActivityAt: 30 },
      { ...chat("chat-mid", "/repo/app", "Mid Chat"), lastActivityAt: 20 },
    ];
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openChat", chat: null }));

    expect(result).toEqual({ status: "done", summary: "Opened chat New Chat" });
    expect(deps.ensureChatsLoaded).toHaveBeenCalledWith("/repo/app");
    expect(deps.selectChat).toHaveBeenCalledWith("chat-new");
  });

  it("opens the most recent visible primary chat when openChat has no chat ref", async () => {
    deps.archivedChats.add("chat-archived");
    deps.workspace.chatsByRoot["/repo/app"] = [
      { ...chat("chat-visible", "/repo/app", "Visible Chat"), lastActivityAt: 20 },
      { ...chat("chat-archived", "/repo/app", "Archived Chat"), lastActivityAt: 40 },
      {
        ...chat("chat-worker", "/repo/app", "Worker Chat"),
        labelsJson: JSON.stringify({ role: "swarmWorker" }),
        lastActivityAt: 60,
      },
    ];
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openChat", chat: null }));

    expect(result).toEqual({ status: "done", summary: "Opened chat Visible Chat" });
    expect(deps.selectChat).toHaveBeenCalledWith("chat-visible");
  });

  it("fails clearly when openChat has no chat ref and the project has no chats", async () => {
    deps.workspace.chatsByRoot["/repo/app"] = [];
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openChat", chat: null }));

    expect(result).toEqual({ status: "failed", message: "no chat to open in App" });
    expect(deps.selectChat).not.toHaveBeenCalled();
  });

  it("fails clearly when openChat has no visible chats", async () => {
    deps.archivedChats.add("chat-archived");
    deps.workspace.chatsByRoot["/repo/app"] = [
      { ...chat("chat-archived", "/repo/app", "Archived Chat"), lastActivityAt: 40 },
      {
        ...chat("chat-worker", "/repo/app", "Worker Chat"),
        labelsJson: JSON.stringify({ role: "swarmWorker" }),
        lastActivityAt: 60,
      },
    ];
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openChat", chat: null }));

    expect(result).toEqual({ status: "failed", message: "no chat to open in App" });
    expect(deps.selectChat).not.toHaveBeenCalled();
  });

  it("fails ambiguous chat resolution and lists candidates", async () => {
    deps.workspace.chatsByRoot["/repo/app"] = [
      chat("chat-main", "/repo/app", "Main Chat"),
      chat("chat-side", "/repo/app", "Side Chat"),
    ];
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openChat", chat: "chat" }));

    expect(result.status).toBe("failed");
    expect("message" in result ? result.message : "").toContain("Main Chat");
    expect("message" in result ? result.message : "").toContain("Side Chat");
    expect(deps.selectChat).not.toHaveBeenCalled();
  });

  it("returns unsupported for M1.5 actions and audits as failed", async () => {
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "launchRun", target: null }));

    expect(result).toEqual({
      status: "unsupported",
      message: "launchRun is planned for #140",
    });
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("preserves the stored agent model when sending to an existing cold chat", async () => {
    deps.agentStates.set("chat-main", { sessionId: null, model: "gpt-5.5" });
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(
      intent({ action: "sendPrompt", prompt: "ship it", chat: null }),
      { confirmed: true },
    );

    expect(result.status).toBe("done");
    expect(deps.ensureAgentChat).toHaveBeenCalledWith(
      "chat-main",
      "/repo/app",
      "codex",
      "gpt-5.5",
      { engine: "test-engine", effort: "high", mode: "read-only" },
    );
    expect(deps.sendAgentMessage).toHaveBeenCalledWith("chat-main", "ship it");
  });

  it("uses configured agent defaults when cold-starting an unmounted chat", async () => {
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(
      intent({ action: "sendPrompt", prompt: "ship it", chat: null }),
      { confirmed: true },
    );

    expect(result.status).toBe("done");
    expect(deps.ensureAgentChat).toHaveBeenCalledWith(
      "chat-main",
      "/repo/app",
      "codex",
      "gpt-5.5",
      { engine: "test-engine", effort: "high", mode: "read-only" },
    );
    expect(deps.loadAgentModels).toHaveBeenCalled();
    expect(deps.loadAgentEfforts).toHaveBeenCalled();
    expect(deps.loadAgentModes).toHaveBeenCalled();
    expect(deps.loadAgentEngine).toHaveBeenCalled();
    expect(deps.sendAgentMessage).toHaveBeenCalledWith("chat-main", "ship it");
  });

  it("does not re-ensure an already live agent chat before sending", async () => {
    deps.agentStates.set("chat-main", { sessionId: "session-1", model: "gpt-5.5" });
    const { dispatchIntent } = await loadStore();

    await dispatchIntent(
      intent({ action: "sendPrompt", prompt: "continue", chat: null }),
      { confirmed: true },
    );

    expect(deps.ensureAgentChat).not.toHaveBeenCalled();
    expect(deps.sendAgentMessage).toHaveBeenCalledWith("chat-main", "continue");
  });

  it("does not send to an active chat from a different project when projectRef is set", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/other", "Other"),
    ];
    deps.workspace.chatsByRoot["/repo/other"] = [
      chat("chat-other", "/repo/other", "Other Chat", "agent", "codex"),
    ];
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(
      intent({ action: "sendPrompt", prompt: "ship it", chat: null }, "Other"),
      { confirmed: true },
    );

    expect(result).toEqual({
      status: "failed",
      message: 'Active chat "Main" is not in project Other',
    });
    expect(deps.ensureAgentChat).not.toHaveBeenCalled();
    expect(deps.sendAgentMessage).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("scopes swarm status to the resolved project", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/other", "Other"),
    ];
    deps.runs.push(
      { projectRoot: "/repo/app", status: "running" },
      { projectRoot: "/repo/app", status: "completed" },
      { projectRoot: "/repo/other", status: "failed" },
    );
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "swarmStatus" }, "App"));

    expect(result).toEqual({
      status: "done",
      summary: "Swarm runs: running 1, completed 1",
    });
  });

  it("returns done when a successful dispatch cannot update its audit row", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deps.operatorAuditUpdate.mockRejectedValueOnce(new Error("audit down"));
    const { dispatchIntent } = await loadStore();

    try {
      const result = await dispatchIntent(intent({ action: "openProject" }, "App"));

      expect(result).toEqual({ status: "done", summary: "Opened project App" });
      expect(deps.selectProject).toHaveBeenCalledTimes(1);
      expect(deps.operatorAuditUpdate).toHaveBeenCalledWith(
        expect.any(String),
        "done",
        "Opened project App",
      );
      expect(warn).toHaveBeenCalledWith(
        "[pickforge] operator audit update failed",
        expect.any(Error),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("returns failed and updates audit when a seam throws", async () => {
    deps.selectProject.mockRejectedValueOnce(new Error("select failed"));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openProject" }, "App"));

    expect(result).toEqual({ status: "failed", message: "select failed" });
    expect(auditUpdateStatus()).toBe("failed");
    expect(deps.operatorAuditUpdate.mock.calls.at(-1)?.[2]).toBe("select failed");
  });
});
