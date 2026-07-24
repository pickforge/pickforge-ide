import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseOperatorIntent, type OperatorAction, type OperatorIntent } from "../../src/lib/operatorIntent";
import { parseCommand } from "../../src/lib/operatorParser";

const deps = vi.hoisted(() => {
  type Project = {
    projectRoot: string;
    displayName: string;
    createdAt: number;
    lastOpenedAt: number;
    sortOrder: number;
    archivedAt: number | null;
    remoteHost: string | null;
    remoteRoot: string | null;
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
  type DeviceEntry = {
    serial: string | null;
    avdId: string | null;
    displayName: string;
    state: "running" | "offline" | "stopped";
    kind: "emulator" | "physical" | "simulator";
  };
  type RunTarget = {
    id: string;
    label: string;
    command: string;
    cwd?: string;
    capabilities: string[];
    needsDevice: boolean;
    deviceConvention: "arg" | "rnDevice" | "env" | "xcodeDestination" | "none";
    inspectorKind: "vmService" | "uiAutomator" | "cdp" | "iosAccessibility" | "none";
    logSource: "pty" | "logcat" | "oslog";
    source: "detected" | "vscode";
  };

  const workspace = {
    projects: [] as Project[],
    activeRoot: null as string | null,
    chatsByRoot: {} as Record<string, Chat[]>,
    activeChatId: null as string | null,
  };
  const deviceSelections = {} as Record<string, string>;
  const agentStates = new Map<string, {
    sessionId: string | null;
    model: string | null;
    turnActive?: boolean;
  }>();
  const latestSessions = new Map<string, { model: string | null }>();
  const archivedChats = new Set<string>();
  const runs: Array<{
    projectRoot: string;
    status: "queued" | "starting" | "running" | "completed" | "failed" | "cancelled";
  }> = [];
  const devices: DeviceEntry[] = [];
  const targets: RunTarget[] = [];
  const runConsoleState = {
    status: "idle" as "idle" | "running" | "stopped",
    target: null as RunTarget | null,
    current: null as { key: number; command: string; cwd: string | null } | null,
  };
  const runLaunchState = {
    booting: false,
    error: null as string | null,
  };
  let activeTargetId = "";
  const activeTarget = () => targets.find((target) => target.id === activeTargetId) ?? targets[0] ?? null;
  const currentDeviceTarget = () =>
    runConsoleState.status === "running" ? runConsoleState.target : activeTarget();
  const isCompatibleDevice = (
    target: RunTarget | null,
    kind: DeviceEntry["kind"],
  ) => {
    if (target?.deviceConvention === "xcodeDestination") return kind === "simulator";
    if (target?.deviceConvention === "rnDevice" || target?.deviceConvention === "env") {
      return kind !== "simulator";
    }
    return true;
  };
  const screenshotTarget = () => {
    const target = currentDeviceTarget();
    if (!target?.capabilities.includes("captureScreenshot")) return null;
    return target.inspectorKind === "vmService" || target.deviceConvention !== "none"
      ? target
      : null;
  };
  const deviceKey = (device: DeviceEntry) => device.serial ?? device.avdId ?? device.displayName;
  const deviceLabel = (device: DeviceEntry) =>
    device.state === "running" && device.serial ? `${device.displayName} · ${device.serial}` : device.displayName;
  const resolveSelectedDevice = () => {
    const target = currentDeviceTarget();
    const list = devices.filter((device) => isCompatibleDevice(target, device.kind));
    return list.find((device) => device.state === "running") ??
      list.find((device) => device.state === "stopped") ??
      null;
  };
  return {
    workspace,
    deviceSelections,
    agentStates,
    latestSessions,
    archivedChats,
    runs,
    devices,
    targets,
    runConsoleState,
    runLaunchState,
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
    agentSessionLatestForChat: vi.fn((chatId: string) => latestSessions.get(chatId) ?? null),
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
    refreshDevices: vi.fn(async () => devices),
    androidLaunchAvd: vi.fn(),
    iosBootDevice: vi.fn(),
    adbScreenshot: vi.fn(),
    iosScreenshot: vi.fn(),
    setRunDevice: vi.fn((root: string, key: string) => {
      deviceSelections[root] = key;
    }),
    selectedDevice: vi.fn((root: string) => deviceSelections[root] ?? ""),
    remotePtyFor: vi.fn((root: string | null) => {
      const proj = workspace.projects.find((p) => p.projectRoot === root);
      return proj?.remoteHost && proj?.remoteRoot
        ? { host: proj.remoteHost, remoteRoot: proj.remoteRoot, remoteProcessLeases: false }
        : null;
    }),
    launchActiveTarget: vi.fn(),
    isBooting: vi.fn(() => runLaunchState.booting),
    launchError: vi.fn(() => runLaunchState.error),
    currentDeviceTarget: vi.fn(currentDeviceTarget),
    screenshotTarget: vi.fn(screenshotTarget),
    resolveScreenshotDevice: vi.fn(() => {
      const target = screenshotTarget();
      if (!target) return null;
      const selected = resolveSelectedDevice();
      if (!selected?.serial || selected.state !== "running") return null;
      return isCompatibleDevice(target, selected.kind) ? selected : null;
    }),
    resolveSelectedDevice: vi.fn(resolveSelectedDevice),
    deviceKey: vi.fn(deviceKey),
    deviceLabel: vi.fn(deviceLabel),
    reloadRun: vi.fn(),
    restartRun: vi.fn(),
    stopRun: vi.fn(),
    runConsole: {
      status: vi.fn(() => runConsoleState.status),
      target: vi.fn(() => runConsoleState.target),
      current: vi.fn(() => runConsoleState.current),
    },
    runTargets: vi.fn(() => targets),
    activeTarget: vi.fn(activeTarget),
    setActiveTargetId: vi.fn((id: string) => {
      activeTargetId = id;
    }),
    captureInRepo: vi.fn(() => false),
    inspectDir: vi.fn(),
    inspectSave: vi.fn(),
    vmFindIsolate: vi.fn(),
    vmSelectedWidget: vi.fn(),
    vmScreenshot: vi.fn(),
    vmShowSelectMode: vi.fn(),
    vmSetSelection: vi.fn(),
    vmWidgetTreeSemantic: vi.fn(),
    matchWidget: vi.fn(),
    reset() {
      workspace.projects = [];
      workspace.activeRoot = null;
      workspace.chatsByRoot = {};
      workspace.activeChatId = null;
      for (const key of Object.keys(deviceSelections)) delete deviceSelections[key];
      agentStates.clear();
      latestSessions.clear();
      archivedChats.clear();
      runs.splice(0);
      devices.splice(0);
      targets.splice(0);
      runConsoleState.status = "idle";
      runConsoleState.target = null;
      runConsoleState.current = null;
      runLaunchState.booting = false;
      runLaunchState.error = null;
      activeTargetId = "";
      this.flagEnabled.mockReset().mockReturnValue(true);
      this.loadAgentModels.mockReset().mockReturnValue({
        claudeCode: "claude-opus-5",
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
      this.agentSessionLatestForChat.mockClear();
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
      this.refreshDevices.mockReset().mockResolvedValue(devices);
      this.androidLaunchAvd.mockReset().mockResolvedValue(undefined);
      this.iosBootDevice.mockReset().mockResolvedValue(undefined);
      this.adbScreenshot.mockReset().mockResolvedValue("/repo/app/.pickforge/operator-screenshot.png");
      this.iosScreenshot.mockReset().mockResolvedValue("/repo/app/.pickforge/operator-screenshot.png");
      this.setRunDevice.mockReset().mockImplementation((root: string, key: string) => {
        deviceSelections[root] = key;
      });
      this.selectedDevice.mockClear();
      this.remotePtyFor.mockClear();
      this.launchActiveTarget.mockReset().mockImplementation(async () => {
        const target = activeTarget();
        runConsoleState.status = "running";
        runConsoleState.target = target;
        runConsoleState.current = {
          key: 1,
          command: target?.command ?? "",
          cwd: workspace.activeRoot,
        };
      });
      this.isBooting.mockClear();
      this.launchError.mockClear();
      this.currentDeviceTarget.mockClear();
      this.screenshotTarget.mockClear();
      this.resolveScreenshotDevice.mockClear();
      this.resolveSelectedDevice.mockClear();
      this.deviceKey.mockClear();
      this.deviceLabel.mockClear();
      this.reloadRun.mockReset().mockReturnValue(undefined);
      this.restartRun.mockReset().mockReturnValue(undefined);
      this.stopRun.mockReset().mockReturnValue(undefined);
      this.runConsole.status.mockClear();
      this.runConsole.target.mockClear();
      this.runConsole.current.mockClear();
      this.runTargets.mockClear();
      this.activeTarget.mockClear();
      this.setActiveTargetId.mockClear();
      this.captureInRepo.mockClear();
      this.inspectDir.mockReset().mockResolvedValue("/repo/app/.pickforge");
      this.inspectSave.mockReset().mockResolvedValue({
        mdPath: "/repo/app/.pickforge/operator-screenshot/context.md",
        pngPath: "/repo/app/.pickforge/operator-screenshot/screenshot.png",
      });
      this.vmFindIsolate.mockReset().mockRejectedValue(new Error("no isolate"));
      this.vmSelectedWidget.mockReset().mockResolvedValue(null);
      this.vmScreenshot.mockReset().mockResolvedValue(null);
      this.vmShowSelectMode.mockReset().mockResolvedValue(undefined);
      this.vmSetSelection.mockReset().mockResolvedValue(true);
      this.vmWidgetTreeSemantic.mockReset().mockResolvedValue({
        id: "root",
        className: "MaterialApp",
        label: null,
        children: [],
      });
      this.matchWidget.mockReset().mockResolvedValue({ kind: "notFound" });
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
  agentSessionLatestForChat: deps.agentSessionLatestForChat,
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

vi.mock("../../src/stores/deviceList", () => ({
  refreshDevices: deps.refreshDevices,
}));

vi.mock("../../src/lib/device", () => ({
  androidLaunchAvd: deps.androidLaunchAvd,
  adbScreenshot: deps.adbScreenshot,
  iosBootDevice: deps.iosBootDevice,
  iosScreenshot: deps.iosScreenshot,
}));

vi.mock("../../src/stores/runDevice", () => ({
  setRunDevice: deps.setRunDevice,
  selectedDevice: deps.selectedDevice,
}));

vi.mock("../../src/lib/remoteContext", () => ({
  remotePtyFor: deps.remotePtyFor,
}));

vi.mock("../../src/stores/runLaunch", () => ({
  currentDeviceTarget: deps.currentDeviceTarget,
  deviceKey: deps.deviceKey,
  deviceLabel: deps.deviceLabel,
  isBooting: deps.isBooting,
  launchActiveTarget: deps.launchActiveTarget,
  launchError: deps.launchError,
  resolveSelectedDevice: deps.resolveSelectedDevice,
  resolveScreenshotDevice: deps.resolveScreenshotDevice,
  screenshotTarget: deps.screenshotTarget,
}));

vi.mock("../../src/stores/runConsole", () => ({
  reloadRun: deps.reloadRun,
  restartRun: deps.restartRun,
  runConsole: deps.runConsole,
  stopRun: deps.stopRun,
}));

vi.mock("../../src/stores/runTargets", () => ({
  activeTarget: deps.activeTarget,
  runTargets: deps.runTargets,
  setActiveTargetId: deps.setActiveTargetId,
}));

vi.mock("../../src/stores/inspectStorage", () => ({
  captureInRepo: deps.captureInRepo,
}));

vi.mock("../../src/lib/vm", () => ({
  inspectDir: deps.inspectDir,
  inspectSave: deps.inspectSave,
  vmFindIsolate: deps.vmFindIsolate,
  vmScreenshot: deps.vmScreenshot,
  vmSelectedWidget: deps.vmSelectedWidget,
  vmSetSelection: deps.vmSetSelection,
  vmShowSelectMode: deps.vmShowSelectMode,
  vmWidgetTreeSemantic: deps.vmWidgetTreeSemantic,
}));

vi.mock("../../src/lib/widgetMatch", () => ({
  matchWidget: deps.matchWidget,
}));

function project(
  projectRoot: string,
  displayName: string,
  overrides: Partial<{ remoteHost: string | null; remoteRoot: string | null }> = {},
) {
  return {
    projectRoot,
    displayName,
    createdAt: 1,
    lastOpenedAt: 1,
    sortOrder: 0,
    archivedAt: null,
    remoteHost: null,
    remoteRoot: null,
    ...overrides,
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

function runTarget(id: string, label: string, overrides: Partial<ReturnType<typeof baseRunTarget>> = {}) {
  return { ...baseRunTarget(id, label), ...overrides };
}

function baseRunTarget(id: string, label: string) {
  return {
    id,
    label,
    command: "flutter run",
    capabilities: ["launch", "hotReload", "hotRestart", "stop", "captureScreenshot", "inspectSelection"],
    needsDevice: true,
    deviceConvention: "arg" as const,
    inspectorKind: "vmService" as const,
    logSource: "pty" as const,
    source: "detected" as const,
  };
}

function device(
  displayName: string,
  overrides: Partial<{
    serial: string | null;
    avdId: string | null;
    state: "running" | "offline" | "stopped";
    kind: "emulator" | "physical" | "simulator";
  }> = {},
) {
  return {
    serial: null,
    avdId: displayName,
    displayName,
    state: "stopped" as const,
    kind: "emulator" as const,
    ...overrides,
  };
}

function setActiveRun(target = runTarget("detected", "Flutter"), cwd = "/repo/app") {
  deps.runConsoleState.status = "running";
  deps.runConsoleState.target = target;
  deps.runConsoleState.current = {
    key: 1,
    command: target.command,
    cwd,
  };
  return target;
}

function intent(action: OperatorAction, projectRef: string | null = null): OperatorIntent {
  return {
    v: 2,
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
    expect(result).toMatchObject({ auditId: expect.any(String) });
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
    expect(deps.ensureAgentChat).toHaveBeenCalledWith(
      "chat-new",
      "/repo/app",
      "claudeCode",
      "opus",
      { engine: "test-engine", effort: "max", mode: "plan" },
    );
    expect(auditUpdateStatus()).toBe("done");
  });

  it("reuses the preview audit row for confirmed tier-1 actions", async () => {
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(
      intent({
        action: "startSwarm",
        mode: "review",
        count: 2,
        goal: "check the operator flow",
        provider: "mixed",
      }, "App"),
      {
        confirmed: true,
        inputText: "start review swarm",
        reuseAuditId: "audit-1",
      },
    );

    expect(result).toEqual({ status: "done", summary: "Started swarm swarm-1" });
    expect(deps.operatorAuditInsert).not.toHaveBeenCalled();
    expect(deps.operatorAuditUpdate).toHaveBeenCalledTimes(1);
    expect(deps.operatorAuditUpdate).toHaveBeenCalledWith(
      "audit-1",
      "done",
      "Started swarm swarm-1",
    );
  });

  it("starts created chats with configured model and run options when no model is explicit", async () => {
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(
      intent({ action: "createChat", provider: "codex", model: null }, "App"),
      { confirmed: true },
    );

    expect(result.status).toBe("done");
    expect(deps.ensureAgentChat).toHaveBeenCalledWith(
      "chat-new",
      "/repo/app",
      "codex",
      "gpt-5.5",
      { engine: "test-engine", effort: "high", mode: "read-only" },
    );
  });

  it("fails before creating a chat when an explicit model is not native-chat compatible", async () => {
    deps.nativeChatModel.mockImplementation((_provider: string, model: string | null) =>
      model === "glm-5.2:cloud" ? null : model,
    );
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(
      intent({ action: "createChat", provider: "codex", model: "glm-5.2:cloud" }, "App"),
      { confirmed: true },
    );

    expect(result).toEqual({
      status: "failed",
      message: 'Model "glm-5.2:cloud" is not available for native codex chats',
    });
    expect(deps.addChat).not.toHaveBeenCalled();
    expect(deps.ensureAgentChat).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
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

  it("resolves project roots exactly before display name matching", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/other", "/repo/app"),
    ];
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openProject" }, "/repo/app"));

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

  it("awaits chat loading before reading the project chat bucket", async () => {
    deps.workspace.chatsByRoot["/repo/app"] = [];
    deps.ensureChatsLoaded.mockImplementationOnce(async (root: string) => {
      await Promise.resolve();
      deps.workspace.chatsByRoot[root] = [
        chat("chat-loaded", root, "Loaded Chat"),
      ];
    });
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openChat", chat: "Loaded Chat" }));

    expect(result).toEqual({ status: "done", summary: "Opened chat Loaded Chat" });
    expect(deps.selectChat).toHaveBeenCalledWith("chat-loaded");
  });

  it("resolves named chat references by exact chat id before title matching", async () => {
    deps.workspace.chatsByRoot["/repo/app"] = [
      chat("chat-review", "/repo/app", "Review Notes"),
      chat("chat-other", "/repo/app", "Other Notes"),
    ];
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openChat", chat: "chat-review" }));

    expect(result.status).toBe("done");
    expect(deps.selectChat).toHaveBeenCalledWith("chat-review");
  });

  it("rejects chat id references outside the resolved project", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/other", "Other"),
    ];
    deps.workspace.chatsByRoot["/repo/other"] = [
      chat("chat-other", "/repo/other", "Other Chat"),
    ];
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openChat", chat: "chat-other" }, "App"));

    expect(result.status).toBe("failed");
    expect("message" in result ? result.message : "").toContain("not in project /repo/app");
    expect(deps.selectChat).not.toHaveBeenCalled();
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

  it("fails named chat resolution when the name only matches hidden chats", async () => {
    deps.archivedChats.add("chat-archived");
    deps.workspace.chatsByRoot["/repo/app"] = [
      { ...chat("chat-archived", "/repo/app", "Hidden Chat"), lastActivityAt: 40 },
      {
        ...chat("chat-worker", "/repo/app", "Hidden Worker"),
        labelsJson: JSON.stringify({ role: "swarmWorker" }),
        lastActivityAt: 60,
      },
      { ...chat("chat-visible", "/repo/app", "Visible Chat"), lastActivityAt: 20 },
    ];
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openChat", chat: "hidden" }));

    expect(result.status).toBe("failed");
    expect("message" in result ? result.message : "").toContain("archived or hidden");
    expect("message" in result ? result.message : "").toContain("Hidden Chat");
    expect("message" in result ? result.message : "").toContain("Hidden Worker");
    expect(deps.selectChat).not.toHaveBeenCalled();
  });

  it("fails exact hidden chat id resolution clearly", async () => {
    deps.archivedChats.add("chat-archived");
    deps.workspace.chatsByRoot["/repo/app"] = [
      { ...chat("chat-archived", "/repo/app", "Archived Chat"), lastActivityAt: 40 },
    ];
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "openChat", chat: "chat-archived" }));

    expect(result.status).toBe("failed");
    expect("message" in result ? result.message : "").toContain("archived or hidden");
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

  it("launches the default run target through the run launcher", async () => {
    deps.targets.push(runTarget("detected", "Flutter"));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "launchRun", target: null }));

    expect(result).toEqual({ status: "done", summary: "Launched run target Flutter" });
    expect(deps.launchActiveTarget).toHaveBeenCalledTimes(1);
    expect(deps.setActiveTargetId).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("done");
  });

  it("resolves a named run target case-insensitively before launching", async () => {
    deps.targets.push(
      runTarget("detected", "Flutter"),
      runTarget("vscode-1", "Web Debug", { needsDevice: false, deviceConvention: "none" }),
    );
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "launchRun", target: "web debug" }));

    expect(result).toEqual({ status: "done", summary: "Launched run target Web Debug" });
    expect(deps.setActiveTargetId).toHaveBeenCalledWith("vscode-1");
    expect(deps.launchActiveTarget).toHaveBeenCalledTimes(1);
  });

  it("fails launchRun when the run launcher soft-aborts with an exposed error", async () => {
    deps.targets.push(runTarget("detected", "Flutter"));
    deps.launchActiveTarget.mockImplementation(async () => {
      deps.runLaunchState.error = "Pixel 8 is offline or unauthorized";
    });
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "launchRun", target: null }));

    expect(result).toEqual({
      status: "failed",
      message: "Pixel 8 is offline or unauthorized",
    });
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("fails launchRun when another boot is already in progress", async () => {
    deps.targets.push(
      runTarget("detected", "Flutter"),
      runTarget("vscode-1", "Web Debug", { needsDevice: false, deviceConvention: "none" }),
    );
    deps.runLaunchState.booting = true;
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "launchRun", target: "web debug" }));

    expect(result).toEqual({
      status: "failed",
      message: "Run launch is already in progress",
    });
    expect(deps.setActiveTargetId).not.toHaveBeenCalled();
    expect(deps.launchActiveTarget).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("fails ambiguous run target resolution and lists candidates", async () => {
    deps.targets.push(
      runTarget("flutter-app", "App Debug"),
      runTarget("web-app", "App Web"),
    );
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "launchRun", target: "app" }));

    expect(result.status).toBe("failed");
    expect("message" in result ? result.message : "").toContain("App Debug");
    expect("message" in result ? result.message : "").toContain("App Web");
    expect(deps.launchActiveTarget).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("launches a stopped emulator by resolved name and selects it for the project", async () => {
    deps.devices.push(device("Pixel 8 API 35", { avdId: "Pixel_8_API_35" }));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "launchEmulator", device: "pixel 8" }));

    expect(result).toEqual({ status: "done", summary: "Launched emulator Pixel 8 API 35" });
    expect(deps.refreshDevices).toHaveBeenCalledTimes(1);
    expect(deps.setRunDevice).toHaveBeenCalledWith("/repo/app", "Pixel_8_API_35");
    expect(deps.androidLaunchAvd).toHaveBeenCalledWith("Pixel_8_API_35");
    expect(auditUpdateStatus()).toBe("done");
  });

  it("launches a stopped simulator by resolved name and selects it for the project", async () => {
    deps.devices.push(device("iPhone 15", {
      serial: "SIM-123",
      avdId: null,
      kind: "simulator",
    }));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "launchEmulator", device: "iphone" }));

    expect(result).toEqual({ status: "done", summary: "Launched simulator iPhone 15" });
    expect(deps.setRunDevice).toHaveBeenCalledWith("/repo/app", "SIM-123");
    expect(deps.iosBootDevice).toHaveBeenCalledWith("SIM-123");
    expect(deps.androidLaunchAvd).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("done");
  });

  it("selects a connected physical device by explicit ref", async () => {
    deps.devices.push(device("Pixel 9", {
      serial: "R58M12345",
      avdId: null,
      state: "running",
      kind: "physical",
    }));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "launchEmulator", device: "pixel" }));

    expect(result).toEqual({ status: "done", summary: "Selected device Pixel 9 · R58M12345" });
    expect(deps.setRunDevice).toHaveBeenCalledWith("/repo/app", "R58M12345");
    expect(deps.androidLaunchAvd).not.toHaveBeenCalled();
    expect(deps.iosBootDevice).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("done");
  });

  it("does not default launchEmulator to a physical device", async () => {
    deps.devices.push(device("Pixel 9", {
      serial: "R58M12345",
      avdId: null,
      state: "running",
      kind: "physical",
    }));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "launchEmulator", device: null }));

    expect(result).toEqual({
      status: "failed",
      message: "No virtual device available. Candidates: none",
    });
    expect(deps.setRunDevice).not.toHaveBeenCalled();
    expect(deps.androidLaunchAvd).not.toHaveBeenCalled();
    expect(deps.iosBootDevice).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("does not default launchEmulator to a virtual device incompatible with the active target", async () => {
    deps.targets.push(runTarget("ios", "iOS", {
      deviceConvention: "xcodeDestination",
      inspectorKind: "iosAccessibility",
      logSource: "oslog",
    }));
    deps.devices.push(device("Pixel 8", { avdId: "Pixel_8" }));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "launchEmulator", device: null }));

    expect(result).toEqual({
      status: "failed",
      message: "No virtual device available. Candidates: none",
    });
    expect(deps.androidLaunchAvd).not.toHaveBeenCalled();
    expect(deps.iosBootDevice).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("resolves launchEmulator names only within target-compatible devices", async () => {
    deps.targets.push(runTarget("ios", "iOS", {
      deviceConvention: "xcodeDestination",
      inspectorKind: "iosAccessibility",
      logSource: "oslog",
    }));
    deps.devices.push(
      device("Pixel 8", { avdId: "Pixel_8" }),
      device("iPhone 15", {
        serial: "SIM-123",
        avdId: null,
        kind: "simulator",
      }),
    );
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "launchEmulator", device: "pixel" }));

    expect(result).toEqual({
      status: "failed",
      message: "Device \"pixel\" was not found. Candidates: iPhone 15",
    });
    expect(deps.androidLaunchAvd).not.toHaveBeenCalled();
    expect(deps.iosBootDevice).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("fails ambiguous device resolution and lists candidates", async () => {
    deps.devices.push(
      device("Pixel 8", { avdId: "Pixel_8" }),
      device("Pixel 8 Pro", { avdId: "Pixel_8_Pro" }),
    );
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "launchEmulator", device: "pixel" }));

    expect(result.status).toBe("failed");
    expect("message" in result ? result.message : "").toContain("Pixel 8");
    expect("message" in result ? result.message : "").toContain("Pixel 8 Pro");
    expect(deps.androidLaunchAvd).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("wires reload, hot restart, and stop to the active run console", async () => {
    setActiveRun();
    const { dispatchIntent } = await loadStore();

    await expect(dispatchIntent(intent({ action: "reloadRun" }))).resolves.toEqual({
      status: "done",
      summary: "Reloaded active run",
    });
    await expect(dispatchIntent(intent({ action: "hotRestart" }))).resolves.toEqual({
      status: "done",
      summary: "Hot restarted active run",
    });
    await expect(dispatchIntent(intent({ action: "stopRun" }))).resolves.toEqual({
      status: "done",
      summary: "Stopped active run",
    });

    expect(deps.reloadRun).toHaveBeenCalledTimes(1);
    expect(deps.restartRun).toHaveBeenCalledTimes(1);
    expect(deps.stopRun).toHaveBeenCalledTimes(1);
    expect(auditUpdateStatus()).toBe("done");
  });

  it("fails reload and hot restart when the active target lacks those capabilities", async () => {
    setActiveRun(runTarget("detected", "Release Flutter", { capabilities: ["launch", "stop"] }));
    const { dispatchIntent } = await loadStore();

    await expect(dispatchIntent(intent({ action: "reloadRun" }))).resolves.toEqual({
      status: "failed",
      message: "Active run target does not support hot reload",
    });
    await expect(dispatchIntent(intent({ action: "hotRestart" }))).resolves.toEqual({
      status: "failed",
      message: "Active run target does not support hot restart",
    });

    expect(deps.reloadRun).not.toHaveBeenCalled();
    expect(deps.restartRun).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("fails run control when projectRef points at a different active project than the run cwd", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/other", "Other"),
    ];
    deps.workspace.activeRoot = "/repo/other";
    setActiveRun(runTarget("detected", "Flutter"), "/repo/app");
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "reloadRun" }, "Other"));

    expect(result).toEqual({
      status: "failed",
      message: "Active run is not in project Other",
    });
    expect(deps.reloadRun).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("returns noop for run controls when there is no active run", async () => {
    const { dispatchIntent } = await loadStore();

    await expect(dispatchIntent(intent({ action: "reloadRun" }))).resolves.toEqual({
      status: "noop",
      summary: "no active run",
    });
    await expect(dispatchIntent(intent({ action: "hotRestart" }))).resolves.toEqual({
      status: "noop",
      summary: "no active run",
    });
    await expect(dispatchIntent(intent({ action: "stopRun" }))).resolves.toEqual({
      status: "noop",
      summary: "no active run",
    });

    expect(deps.reloadRun).not.toHaveBeenCalled();
    expect(deps.restartRun).not.toHaveBeenCalled();
    expect(deps.stopRun).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("noop");
  });

  it("enters Flutter select mode through the VM service seam", async () => {
    setActiveRun();
    deps.vmFindIsolate.mockResolvedValue("isolates/1");
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "enterSelectMode" }));

    expect(result).toEqual({ status: "done", summary: "Entered select mode" });
    expect(deps.vmShowSelectMode).toHaveBeenCalledWith("isolates/1", true);
    expect(auditUpdateStatus()).toBe("done");
  });

  it("returns noop for select mode when there is no VM session", async () => {
    setActiveRun();
    deps.vmFindIsolate.mockRejectedValue(new Error("no VM"));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "enterSelectMode" }));

    expect(result).toEqual({ status: "noop", summary: "no active device/session" });
    expect(deps.vmShowSelectMode).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("noop");
  });

  it("fails select mode when the active run is not a Flutter VM-service target", async () => {
    setActiveRun(runTarget("detected", "React Native", {
      capabilities: ["launch", "stop", "inspectSelection"],
      deviceConvention: "rnDevice",
      inspectorKind: "uiAutomator",
      logSource: "logcat",
    }));
    deps.vmFindIsolate.mockResolvedValue("isolates/1");
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "enterSelectMode" }));

    expect(result).toEqual({
      status: "failed",
      message: "Active run is not a Flutter VM-service target",
    });
    expect(deps.vmShowSelectMode).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("fails select mode when projectRef is not the active project", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/other", "Other"),
    ];
    deps.vmFindIsolate.mockResolvedValue("isolates/1");
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "enterSelectMode" }, "Other"));

    expect(result).toEqual({
      status: "failed",
      message: "Project Other is not active",
    });
    expect(deps.vmShowSelectMode).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("returns noop for semantic selection when the live VM session is unavailable", async () => {
    setActiveRun();
    deps.vmFindIsolate.mockRejectedValue(new Error("no VM"));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "selectWidget", description: "sign in" }));

    expect(result).toEqual({ status: "noop", summary: "no active device/session" });
    expect(deps.vmWidgetTreeSemantic).not.toHaveBeenCalled();
    expect(deps.matchWidget).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("noop");
  });

  it("fails semantic selection when no Flutter run is active", async () => {
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "selectWidget", description: "sign in" }));

    expect(result).toEqual({ status: "failed", message: "No active Flutter run in project App" });
    expect(deps.vmFindIsolate).not.toHaveBeenCalled();
    expect(deps.matchWidget).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("matches and selects a semantic widget through the VM seam", async () => {
    setActiveRun();
    deps.vmFindIsolate.mockResolvedValue("isolates/1");
    const semanticTree = {
      id: "root",
      className: "MaterialApp",
      label: null,
      children: [],
    };
    deps.vmWidgetTreeSemantic.mockResolvedValue(semanticTree);
    deps.matchWidget.mockResolvedValue({
      kind: "match",
      node: { index: 4, valueId: "widget-login", className: "LoginButton", label: "Sign in" },
    });
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "selectWidget", description: "sign in" }));

    expect(result).toEqual({ status: "done", summary: "Selected LoginButton — 'Sign in'" });
    expect(deps.vmWidgetTreeSemantic).toHaveBeenCalledWith("isolates/1", "pf-operator-widget-match");
    expect(deps.matchWidget).toHaveBeenCalledWith("sign in", semanticTree);
    expect(deps.vmSetSelection).toHaveBeenCalledWith(
      "isolates/1",
      "widget-login",
      "pf-operator-widget-match",
    );
    expect(auditUpdateStatus()).toBe("done");
  });

  it("keeps ambiguous semantic candidates local until the dock picks one", async () => {
    setActiveRun();
    deps.vmFindIsolate.mockResolvedValue("isolates/1");
    deps.matchWidget.mockResolvedValue({
      kind: "ambiguous",
      candidates: [
        { index: 4, valueId: "widget-login", className: "LoginButton", label: "Sign in" },
        { index: 8, valueId: "widget-create", className: "LoginButton", label: "Create account" },
      ],
    });
    const { dispatchIntent, selectWidgetCandidate } = await loadStore();

    const pending = await dispatchIntent(intent({ action: "selectWidget", description: "the login button" }));

    expect(pending).toMatchObject({
      status: "needsConfirmation",
      summary: "Choose the matching widget",
      candidates: [
        { index: 4, className: "LoginButton", label: "Sign in" },
        { index: 8, className: "LoginButton", label: "Create account" },
      ],
    });
    expect(JSON.stringify(pending)).not.toContain("widget-login");
    expect(auditUpdateStatus()).toBe("needs_confirmation");

    const picked = await selectWidgetCandidate(pending.auditId, 8);

    expect(picked).toEqual({ status: "done", summary: "Selected LoginButton — 'Create account'" });
    expect(deps.vmSetSelection).toHaveBeenCalledWith(
      "isolates/1",
      "widget-create",
      "pf-operator-widget-match",
    );
  });

  it("does not select a discarded semantic widget candidate", async () => {
    setActiveRun();
    deps.vmFindIsolate.mockResolvedValue("isolates/1");
    deps.matchWidget.mockResolvedValue({
      kind: "ambiguous",
      candidates: [
        { index: 4, valueId: "widget-login", className: "LoginButton", label: "Sign in" },
      ],
    });
    const { discardWidgetSelection, dispatchIntent, selectWidgetCandidate } = await loadStore();

    const pending = await dispatchIntent(intent({ action: "selectWidget", description: "the login button" }));
    discardWidgetSelection(pending.auditId);

    await expect(selectWidgetCandidate(pending.auditId, 4)).resolves.toEqual({
      status: "failed",
      message: "Widget choice is no longer available",
    });
    expect(deps.vmSetSelection).not.toHaveBeenCalled();
  });

  it("reports not-found and unconfigured semantic matching honestly", async () => {
    setActiveRun();
    deps.vmFindIsolate.mockResolvedValue("isolates/1");
    const { dispatchIntent } = await loadStore();

    deps.matchWidget.mockResolvedValueOnce({ kind: "notFound" });
    await expect(dispatchIntent(intent({ action: "selectWidget", description: "missing control" }))).resolves.toEqual({
      status: "failed",
      message: "No widget matched \"missing control\"",
    });

    deps.matchWidget.mockResolvedValueOnce({ kind: "unconfigured" });
    await expect(dispatchIntent(intent({ action: "selectWidget", description: "sign in" }))).resolves.toEqual({
      status: "unsupported",
      message: "Operator router is off. Choose a backend in Settings.",
    });
  });

  it("captures a screenshot from the selected running device", async () => {
    const target = runTarget("detected", "React Native", {
      deviceConvention: "rnDevice",
      inspectorKind: "uiAutomator",
      logSource: "logcat",
    });
    deps.targets.push(target);
    setActiveRun(target);
    deps.devices.push(device("Pixel 8", {
      serial: "emulator-5554",
      avdId: "Pixel_8",
      state: "running",
    }));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "takeScreenshot" }));

    expect(result).toEqual({
      status: "done",
      summary: "Captured screenshot /repo/app/.pickforge/operator-screenshot.png",
    });
    expect(deps.inspectDir).toHaveBeenCalledWith(false, "/repo/app");
    expect(deps.adbScreenshot).toHaveBeenCalledWith(
      "emulator-5554",
      "/repo/app/.pickforge",
      "operator-screenshot.png",
    );
    expect(auditUpdateStatus()).toBe("done");
  });

  it("fails screenshot when the active run belongs to a different project", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/other", "Other"),
    ];
    deps.workspace.activeRoot = "/repo/other";
    setActiveRun(runTarget("detected", "React Native", {
      deviceConvention: "rnDevice",
      inspectorKind: "uiAutomator",
      logSource: "logcat",
    }), "/repo/app");
    deps.devices.push(device("Pixel 8", {
      serial: "emulator-5554",
      avdId: "Pixel_8",
      state: "running",
    }));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "takeScreenshot" }, "Other"));

    expect(result).toEqual({
      status: "failed",
      message: "Active run is not in project Other",
    });
    expect(deps.inspectDir).not.toHaveBeenCalled();
    expect(deps.vmFindIsolate).not.toHaveBeenCalled();
    expect(deps.adbScreenshot).not.toHaveBeenCalled();
    expect(deps.iosScreenshot).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("does not fall back to a device screenshot for a no-device target", async () => {
    const target = runTarget("web", "Web", {
      capabilities: ["detect", "captureScreenshot"],
      needsDevice: false,
      deviceConvention: "none",
      inspectorKind: "cdp",
    });
    deps.targets.push(target);
    setActiveRun(target);
    deps.devices.push(device("Pixel 8", {
      serial: "emulator-5554",
      avdId: "Pixel_8",
      state: "running",
    }));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "takeScreenshot" }));

    expect(result).toEqual({ status: "noop", summary: "no device or VM session to capture" });
    expect(deps.adbScreenshot).not.toHaveBeenCalled();
    expect(deps.iosScreenshot).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("noop");
  });

  it("captures a VM screenshot when a live Flutter run has no listed device", async () => {
    const target = runTarget("detected", "Flutter");
    deps.targets.push(target);
    setActiveRun(target);
    deps.vmFindIsolate.mockResolvedValue("isolates/1");
    deps.vmSelectedWidget.mockResolvedValue({
      id: "widget-1",
      className: "Text",
      children: [],
      creationLocation: null,
    });
    deps.vmScreenshot.mockResolvedValue("png-b64");
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "takeScreenshot" }));

    expect(result).toEqual({
      status: "done",
      summary: "Captured screenshot /repo/app/.pickforge/operator-screenshot/screenshot.png",
    });
    expect(deps.vmScreenshot).toHaveBeenCalledWith("isolates/1", "widget-1", 1024, 2048);
    expect(deps.inspectSave).toHaveBeenCalledWith(
      "/repo/app/.pickforge",
      "operator-screenshot",
      "Operator screenshot",
      "png-b64",
    );
    expect(deps.adbScreenshot).not.toHaveBeenCalled();
  });

  it("captures a VM screenshot from a launch.json Flutter target without screenshot capability", async () => {
    const target = runTarget("launch-json", "Debug App", {
      capabilities: ["launch"],
      needsDevice: false,
      deviceConvention: "none",
      inspectorKind: "vmService",
    });
    deps.targets.push(target);
    setActiveRun(target);
    deps.vmFindIsolate.mockResolvedValue("isolates/1");
    deps.vmSelectedWidget.mockResolvedValue({
      id: "widget-1",
      className: "Text",
      children: [],
      creationLocation: null,
    });
    deps.vmScreenshot.mockResolvedValue("png-b64");
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "takeScreenshot" }));

    expect(result).toEqual({
      status: "done",
      summary: "Captured screenshot /repo/app/.pickforge/operator-screenshot/screenshot.png",
    });
    expect(deps.vmScreenshot).toHaveBeenCalledWith("isolates/1", "widget-1", 1024, 2048);
    expect(deps.refreshDevices).not.toHaveBeenCalled();
    expect(deps.adbScreenshot).not.toHaveBeenCalled();
    expect(deps.iosScreenshot).not.toHaveBeenCalled();
  });

  it("captures a VM screenshot from a manual VM connection with no active run", async () => {
    deps.vmFindIsolate.mockResolvedValue("isolates/1");
    deps.vmSelectedWidget.mockResolvedValue({
      id: "widget-1",
      className: "Text",
      children: [],
      creationLocation: null,
    });
    deps.vmScreenshot.mockResolvedValue("png-b64");
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "takeScreenshot" }));

    expect(result).toEqual({
      status: "done",
      summary: "Captured screenshot /repo/app/.pickforge/operator-screenshot/screenshot.png",
    });
    expect(deps.vmFindIsolate).toHaveBeenCalled();
    expect(deps.refreshDevices).not.toHaveBeenCalled();
    expect(deps.adbScreenshot).not.toHaveBeenCalled();
    expect(deps.iosScreenshot).not.toHaveBeenCalled();
  });

  it("captures a VM screenshot from a live pinned-device Flutter run", async () => {
    const target = runTarget("pinned", "Pinned Flutter", {
      needsDevice: false,
      deviceConvention: "none",
      inspectorKind: "vmService",
    });
    deps.targets.push(target);
    setActiveRun(target);
    deps.vmFindIsolate.mockResolvedValue("isolates/1");
    deps.vmSelectedWidget.mockResolvedValue({
      id: "widget-1",
      className: "Text",
      children: [],
      creationLocation: null,
    });
    deps.vmScreenshot.mockResolvedValue("png-b64");
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "takeScreenshot" }));

    expect(result).toEqual({
      status: "done",
      summary: "Captured screenshot /repo/app/.pickforge/operator-screenshot/screenshot.png",
    });
    expect(deps.vmScreenshot).toHaveBeenCalledWith("isolates/1", "widget-1", 1024, 2048);
    expect(deps.adbScreenshot).not.toHaveBeenCalled();
    expect(deps.iosScreenshot).not.toHaveBeenCalled();
  });

  it("captures from a launch-only iOS target with a booted simulator", async () => {
    const target = runTarget("native-ios", "Native iOS", {
      capabilities: ["detect", "launch", "captureScreenshot", "streamLogs", "inspectSelection"],
      deviceConvention: "xcodeDestination",
      inspectorKind: "iosAccessibility",
      logSource: "oslog",
    });
    deps.targets.push(target);
    deps.devices.push(device("iPhone 16", {
      serial: "SIM-1",
      avdId: null,
      state: "running",
      kind: "simulator",
    }));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "takeScreenshot" }));

    expect(result).toEqual({
      status: "done",
      summary: "Captured screenshot /repo/app/.pickforge/operator-screenshot.png",
    });
    expect(deps.iosScreenshot).toHaveBeenCalledWith(
      "SIM-1",
      "/repo/app/.pickforge",
      "operator-screenshot.png",
    );
    expect(deps.adbScreenshot).not.toHaveBeenCalled();
    expect(deps.vmScreenshot).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("done");
  });

  it("does not call any screenshot capture seam when nothing is connected", async () => {
    deps.targets.push(runTarget("detected", "Flutter"));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "takeScreenshot" }));

    expect(result).toEqual({ status: "noop", summary: "no device or VM session to capture" });
    expect(deps.vmFindIsolate).toHaveBeenCalled();
    expect(deps.vmSelectedWidget).not.toHaveBeenCalled();
    expect(deps.vmScreenshot).not.toHaveBeenCalled();
    expect(deps.inspectDir).not.toHaveBeenCalled();
    expect(deps.adbScreenshot).not.toHaveBeenCalled();
    expect(deps.iosScreenshot).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("noop");
  });

  it("dispatches a parsed v1 envelope after upgrading it to v2", async () => {
    setActiveRun();
    const parsed = parseOperatorIntent(JSON.stringify({
      v: 1,
      id: "intent-v1-reload",
      provenance: "typed",
      confidence: 1,
      projectRef: null,
      action: { action: "reloadRun" },
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(parsed.intent);

    expect(parsed.intent.v).toBe(2);
    expect(result).toEqual({ status: "done", summary: "Reloaded active run" });
    expect(deps.reloadRun).toHaveBeenCalledTimes(1);
  });

  it("preserves the stored agent model when sending to an existing cold chat", async () => {
    deps.agentStates.set("chat-main", { sessionId: null, model: "gpt-5.5" });
    deps.latestSessions.set("chat-main", { model: "gpt-5.4" });
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
    expect(deps.agentSessionLatestForChat).not.toHaveBeenCalled();
    expect(deps.sendAgentMessage).toHaveBeenCalledWith("chat-main", "ship it");
  });

  it("uses the persisted latest session model when cold-starting an unmounted chat", async () => {
    deps.latestSessions.set("chat-main", { model: "gpt-5.4" });
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
      "gpt-5.4",
      { engine: "test-engine", effort: "high", mode: "read-only" },
    );
    expect(deps.agentSessionLatestForChat).toHaveBeenCalledWith("chat-main");
    expect(deps.sendAgentMessage).toHaveBeenCalledWith("chat-main", "ship it");
  });

  it("preserves an explicit null persisted session model when cold-starting a chat", async () => {
    deps.latestSessions.set("chat-main", { model: null });
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
      null,
      { engine: "test-engine", effort: "high", mode: "read-only" },
    );
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
    expect(deps.agentSessionLatestForChat).toHaveBeenCalledWith("chat-main");
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

  it("returns noop when interrupt targets a cold or idle chat", async () => {
    deps.agentStates.set("chat-main", { sessionId: "session-1", model: "gpt-5.5", turnActive: false });
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(
      intent({ action: "interruptRun", run: null }),
      { confirmed: true },
    );

    expect(result).toEqual({ status: "noop", summary: "nothing to interrupt" });
    expect(deps.interruptAgentChat).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("noop");
  });

  it("interrupts only when the target chat has a live active turn", async () => {
    deps.agentStates.set("chat-main", { sessionId: "session-1", model: "gpt-5.5", turnActive: true });
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(
      intent({ action: "interruptRun", run: null }),
      { confirmed: true },
    );

    expect(result).toEqual({ status: "done", summary: "Interrupted Main" });
    expect(deps.interruptAgentChat).toHaveBeenCalledWith("chat-main");
    expect(auditUpdateStatus()).toBe("done");
  });

  it("does not interrupt the active chat when projectRef resolves to a different project", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/other", "Other"),
    ];
    deps.agentStates.set("chat-main", { sessionId: "session-1", model: "gpt-5.5", turnActive: true });
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(
      intent({ action: "interruptRun", run: null }, "Other"),
      { confirmed: true },
    );

    expect(result).toEqual({
      status: "failed",
      message: 'Active chat "Main" is not in project Other',
    });
    expect(deps.interruptAgentChat).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
  });

  it("does not steer the active chat when projectRef resolves to a different project", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/other", "Other"),
    ];
    deps.agentStates.set("chat-main", { sessionId: "session-1", model: "gpt-5.5", turnActive: false });
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(
      intent({ action: "steerRun", run: null, instruction: "focus" }, "Other"),
      { confirmed: true },
    );

    expect(result).toEqual({
      status: "failed",
      message: 'Active chat "Main" is not in project Other',
    });
    expect(deps.steerAgentChat).not.toHaveBeenCalled();
    expect(auditUpdateStatus()).toBe("failed");
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

  it("prefers the full active-project title before treating in as a qualifier", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/flow", "flow"),
    ];
    deps.workspace.chatsByRoot["/repo/app"] = [
      chat("chat-sign-in", "/repo/app", "Sign in flow"),
    ];
    deps.workspace.chatsByRoot["/repo/flow"] = [
      chat("chat-sign", "/repo/flow", "Sign"),
    ];
    const parsed = parseCommand("open chat Sign in flow");
    expect(parsed.kind).toBe("intent");
    if (parsed.kind !== "intent") throw new Error("expected intent");
    expect(parsed.intent).toMatchObject({
      projectRef: "flow",
      action: { action: "openChat", chat: "Sign" },
    });
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(parsed.intent, {
      inputText: "open chat Sign in flow",
    });

    expect(result).toEqual({ status: "done", summary: "Opened chat Sign in flow" });
    expect(deps.selectChat).toHaveBeenCalledWith("chat-sign-in");
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

// The execution transaction (CAND-1): every mutable Project/target/device/chat
// fact an Operator intent depends on is captured ONCE, synchronously, before
// the audit insert's await — mirrors PR #243's race coverage for the direct
// run path (pending promise, flip live state, resolve, assert the CAPTURED
// facts won, not the live ones).
describe("dispatchIntent execution-transaction races", () => {
  it("audits and executes against the Project captured before the audit insert, not a switch during it", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/other", "Other"),
    ];
    let resolveInsert!: () => void;
    deps.operatorAuditInsert.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveInsert = resolve;
    }));
    const { dispatchIntent } = await loadStore();

    const dispatch = dispatchIntent(intent({ action: "openProject" }));
    await vi.waitFor(() => expect(deps.operatorAuditInsert).toHaveBeenCalledTimes(1));
    deps.workspace.activeRoot = "/repo/other";
    resolveInsert();
    const result = await dispatch;

    expect(result).toEqual({ status: "done", summary: "Opened project App" });
    expect(deps.selectProject).toHaveBeenCalledWith("/repo/app");
    expect(deps.operatorAuditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: "/repo/app" }),
    );
  });

  it("aborts a run launch instead of booting against a Project switched in during the audit insert", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/other", "Other"),
    ];
    deps.targets.push(runTarget("detected", "Flutter"));
    let resolveInsert!: () => void;
    deps.operatorAuditInsert.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveInsert = resolve;
    }));
    const { dispatchIntent } = await loadStore();

    const dispatch = dispatchIntent(intent({ action: "launchRun", target: null }));
    await vi.waitFor(() => expect(deps.operatorAuditInsert).toHaveBeenCalledTimes(1));
    deps.workspace.activeRoot = "/repo/other";
    resolveInsert();
    const result = await dispatch;

    expect(result).toEqual({
      status: "failed",
      message: "Project App is no longer active",
    });
    expect(deps.launchActiveTarget).not.toHaveBeenCalled();
    expect(deps.setActiveTargetId).not.toHaveBeenCalled();
  });

  it("keeps run-control targeting on the Project captured at dispatch despite a live switch during the audit insert", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/other", "Other"),
    ];
    setActiveRun(runTarget("detected", "Flutter"), "/repo/app");
    let resolveInsert!: () => void;
    deps.operatorAuditInsert.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveInsert = resolve;
    }));
    const { dispatchIntent } = await loadStore();

    const dispatch = dispatchIntent(intent({ action: "reloadRun" }));
    await vi.waitFor(() => expect(deps.operatorAuditInsert).toHaveBeenCalledTimes(1));
    deps.workspace.activeRoot = "/repo/other";
    resolveInsert();
    const result = await dispatch;

    expect(result).toEqual({ status: "done", summary: "Reloaded active run" });
    expect(deps.reloadRun).toHaveBeenCalledTimes(1);
  });

  it("keeps a screenshot's device the one selected at intent time, not one changed during device refresh", async () => {
    const target = runTarget("detected", "React Native", {
      deviceConvention: "rnDevice",
      inspectorKind: "uiAutomator",
      logSource: "logcat",
    });
    deps.targets.push(target);
    setActiveRun(target);
    deps.devices.push(
      device("Pixel 8", { serial: "emulator-5554", avdId: "Pixel_8", state: "running" }),
      device("Pixel 9", { serial: "emulator-9999", avdId: "Pixel_9", state: "running" }),
    );
    deps.deviceSelections["/repo/app"] = "Pixel_8";
    let resolveRefresh!: (list: typeof deps.devices) => void;
    deps.refreshDevices.mockImplementation(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    const { dispatchIntent } = await loadStore();

    const dispatch = dispatchIntent(intent({ action: "takeScreenshot" }));
    await vi.waitFor(() => expect(deps.refreshDevices).toHaveBeenCalledTimes(1));
    // A selection change for the SAME project, mid-refresh, must not retarget a
    // screenshot that already captured "Pixel_8" at intent time.
    deps.deviceSelections["/repo/app"] = "Pixel_9";
    resolveRefresh(deps.devices);
    const result = await dispatch;

    expect(result).toEqual({
      status: "done",
      summary: "Captured screenshot /repo/app/.pickforge/operator-screenshot.png",
    });
    expect(deps.adbScreenshot).toHaveBeenCalledWith(
      "emulator-5554",
      "/repo/app/.pickforge",
      "operator-screenshot.png",
    );
  });

  it("keeps widget-select targeting on the Project captured at dispatch despite a live switch during the audit insert", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/other", "Other"),
    ];
    setActiveRun();
    deps.vmFindIsolate.mockResolvedValue("isolates/1");
    deps.matchWidget.mockResolvedValue({
      kind: "match",
      node: { index: 1, valueId: "widget-1", className: "Button", label: "Go" },
    });
    let resolveInsert!: () => void;
    deps.operatorAuditInsert.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveInsert = resolve;
    }));
    const { dispatchIntent } = await loadStore();

    const dispatch = dispatchIntent(intent({ action: "selectWidget", description: "go button" }));
    await vi.waitFor(() => expect(deps.operatorAuditInsert).toHaveBeenCalledTimes(1));
    deps.workspace.activeRoot = "/repo/other";
    resolveInsert();
    const result = await dispatch;

    expect(result).toEqual({ status: "done", summary: "Selected Button — 'Go'" });
    expect(deps.vmSetSelection).toHaveBeenCalledWith("isolates/1", "widget-1", "pf-operator-widget-match");
  });

  it("confirms a tier-1 action against the Project captured at preview time, not a switch made before confirming", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App"),
      project("/repo/other", "Other"),
    ];
    const { dispatchIntent } = await loadStore();
    const action = {
      action: "startSwarm" as const,
      mode: "review" as const,
      count: 2,
      goal: "check the operator flow",
      provider: "mixed" as const,
    };

    const preview = await dispatchIntent(intent(action), { inputText: "start review swarm" });
    expect(preview.status).toBe("needsConfirmation");
    if (preview.status !== "needsConfirmation") throw new Error("expected needsConfirmation");

    // The user takes their time to confirm; the active Project changes in the
    // meantime. The confirmed dispatch must still execute against what was
    // previewed/audited (App), not whatever is active now (Other).
    deps.workspace.activeRoot = "/repo/other";

    const confirmed = await dispatchIntent(intent(action), {
      confirmed: true,
      inputText: "start review swarm",
      reuseAuditId: preview.auditId,
    });

    expect(confirmed).toEqual({ status: "done", summary: "Started swarm swarm-1" });
    expect(deps.startSwarm).toHaveBeenCalledWith(
      "/repo/app",
      "check the operator flow",
      expect.objectContaining({ mode: "review", count: 2 }),
    );
  });

  it("fails launchEmulator cleanly for a remote-bound project instead of using local device APIs", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App", { remoteHost: "mac-mini", remoteRoot: "/srv/app" }),
    ];
    deps.devices.push(device("Pixel 8", { avdId: "Pixel_8" }));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "launchEmulator", device: "pixel 8" }));

    expect(result.status).toBe("failed");
    expect("message" in result ? result.message : "").toContain("mac-mini");
    expect(deps.refreshDevices).not.toHaveBeenCalled();
    expect(deps.androidLaunchAvd).not.toHaveBeenCalled();
    expect(deps.iosBootDevice).not.toHaveBeenCalled();
  });

  it("does not fall back to a local device screenshot for a remote-bound project", async () => {
    deps.workspace.projects = [
      project("/repo/app", "App", { remoteHost: "mac-mini", remoteRoot: "/srv/app" }),
    ];
    deps.targets.push(runTarget("detected", "React Native", {
      deviceConvention: "rnDevice",
      inspectorKind: "uiAutomator",
      logSource: "logcat",
    }));
    deps.devices.push(device("Pixel 8", { serial: "emulator-5554", avdId: "Pixel_8", state: "running" }));
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(intent({ action: "takeScreenshot" }));

    expect(result).toEqual({ status: "noop", summary: "no device or VM session to capture" });
    expect(deps.refreshDevices).not.toHaveBeenCalled();
    expect(deps.adbScreenshot).not.toHaveBeenCalled();
    expect(deps.iosScreenshot).not.toHaveBeenCalled();
  });

  it("fails cleanly when the chat captured as active at intent time is gone by execution", async () => {
    deps.workspace.activeChatId = "chat-ghost";
    const { dispatchIntent } = await loadStore();

    const result = await dispatchIntent(
      intent({ action: "sendPrompt", prompt: "ship it", chat: null }),
      { confirmed: true },
    );

    expect(result).toEqual({ status: "failed", message: "Active chat is not loaded" });
    expect(deps.sendAgentMessage).not.toHaveBeenCalled();
  });
});
