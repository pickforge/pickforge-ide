import type { AgentProvider } from "../lib/agentChat";
import {
  loadAgentEfforts,
  loadAgentModels,
  nativeChatModel,
} from "../lib/agentModels";
import { loadAgentModes } from "../lib/agentModes";
import { isPrimaryChat } from "../lib/chatLabels";
import { loadAgentEngine } from "../lib/chatDefaults";
import * as db from "../lib/db";
import {
  adbScreenshot,
  androidLaunchAvd,
  iosScreenshot,
  type DeviceEntry,
} from "../lib/device";
import type { Chat, Project } from "../lib/db";
import { riskTier, type OperatorAction, type OperatorIntent } from "../lib/operatorIntent";
import type { RunTarget } from "../lib/runTargets";
import {
  inspectDir,
  inspectSave,
  vmFindIsolate,
  vmScreenshot,
  vmSelectedWidget,
  vmShowSelectMode,
} from "../lib/vm";
import { isChatArchived } from "./chatArchive";
import { refreshDevices } from "./deviceList";
import { flagEnabled } from "./flags";
import { captureInRepo } from "./inspectStorage";
import {
  agentChat,
  ensureAgentChat,
  interruptAgentChat,
  sendAgentMessage,
  steerAgentChat,
} from "./agentChat";
import {
  deviceKey,
  deviceLabel,
  isBooting,
  launchActiveTarget,
  launchError,
  resolveSelectedDevice,
} from "./runLaunch";
import { setRunDevice } from "./runDevice";
import {
  reloadRun as reloadActiveRun,
  restartRun as restartActiveRun,
  runConsole,
  stopRun as stopActiveRun,
} from "./runConsole";
import { activeTarget, runTargets, setActiveTargetId } from "./runTargets";
import { startSwarm as startSwarmRun, swarmRuns } from "./swarm";
import {
  addChat,
  chatsFor,
  ensureChatsLoaded,
  findChat,
  selectChat,
  selectProject,
  workspace,
} from "./workspace";

export type DispatchResult =
  | { status: "done"; summary: string }
  | { status: "noop"; summary: string }
  | { status: "needsConfirmation"; summary: string }
  | { status: "denied" | "failed" | "unsupported"; message: string };

export type DispatchOptions = {
  confirmed?: boolean;
  inputText?: string;
};

type Resolution<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

type AuditStatus = db.OperatorAuditRow["status"];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function pathBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function projectLabel(project: Project): string {
  const base = pathBasename(project.projectRoot);
  return project.displayName === base
    ? project.displayName
    : `${project.displayName} (${base})`;
}

function candidateList(candidates: string[]): string {
  return candidates.length ? candidates.join(", ") : "none";
}

function resolveReference<T>(
  noun: string,
  ref: string,
  items: T[],
  label: (item: T) => string,
  exactValues: (item: T) => string[],
  partialValues: (item: T) => string[],
): Resolution<T> {
  const query = normalize(ref);
  const exact = items.filter((item) =>
    exactValues(item).some((value) => normalize(value) === query),
  );
  if (exact.length === 1) return { ok: true, value: exact[0] };
  if (exact.length > 1) {
    return {
      ok: false,
      message: `${noun} "${ref}" is ambiguous. Candidates: ${candidateList(exact.map(label))}`,
    };
  }

  const partial = items.filter((item) =>
    partialValues(item).some((value) => normalize(value).includes(query)),
  );
  if (partial.length === 1) return { ok: true, value: partial[0] };
  if (partial.length > 1) {
    return {
      ok: false,
      message: `${noun} "${ref}" is ambiguous. Candidates: ${candidateList(partial.map(label))}`,
    };
  }

  return {
    ok: false,
    message: `${noun} "${ref}" was not found. Candidates: ${candidateList(items.map(label))}`,
  };
}

function referenceMatches<T>(
  ref: string,
  item: T,
  exactValues: (item: T) => string[],
  partialValues: (item: T) => string[],
): boolean {
  const query = normalize(ref);
  return (
    exactValues(item).some((value) => normalize(value) === query) ||
    partialValues(item).some((value) => normalize(value).includes(query))
  );
}

export function resolveProjectReference(projectRef: string | null): Resolution<Project> {
  if (!projectRef) {
    if (!workspace.activeRoot) {
      return {
        ok: false,
        message: `No active project. Candidates: ${candidateList(workspace.projects.map(projectLabel))}`,
      };
    }
    const active = workspace.projects.find((project) => project.projectRoot === workspace.activeRoot);
    if (!active) {
      return {
        ok: false,
        message: `Active project is not loaded. Candidates: ${candidateList(workspace.projects.map(projectLabel))}`,
      };
    }
    return { ok: true, value: active };
  }

  const rootMatch = workspace.projects.find((project) => project.projectRoot === projectRef.trim());
  if (rootMatch) return { ok: true, value: rootMatch };

  return resolveReference(
    "Project",
    projectRef,
    workspace.projects,
    projectLabel,
    (project) => [project.displayName, pathBasename(project.projectRoot)],
    (project) => [project.displayName, pathBasename(project.projectRoot)],
  );
}

export async function resolveChatReference(
  projectRoot: string,
  chatRef: string | null,
): Promise<Resolution<Chat>> {
  if (!chatRef) {
    return { ok: false, message: "Chat reference is required" };
  }

  await ensureChatsLoaded(projectRoot);
  const chats = chatsFor(projectRoot);
  const idMatch = findChat(chatRef);
  if (idMatch) {
    if (idMatch.projectRoot !== projectRoot) {
      return {
        ok: false,
        message: `Chat "${chatRef}" is not in project ${projectRoot}`,
      };
    }
    if (!isVisiblePrimaryChat(idMatch)) {
      return {
        ok: false,
        message: `Chat "${chatRef}" is archived or hidden. Candidates: ${idMatch.title}`,
      };
    }
    return { ok: true, value: idMatch };
  }
  const visibleChats = chats.filter(isVisiblePrimaryChat);
  const visibleMatches = visibleChats.filter((chat) =>
    referenceMatches(chatRef, chat, (item) => [item.title], (item) => [item.title]),
  );
  const hiddenMatches = chats
    .filter((chat) => !isVisiblePrimaryChat(chat))
    .filter((chat) =>
      referenceMatches(chatRef, chat, (item) => [item.title], (item) => [item.title]),
    );
  if (!visibleMatches.length && hiddenMatches.length) {
    return {
      ok: false,
      message: `Chat "${chatRef}" is archived or hidden. Candidates: ${candidateList(hiddenMatches.map((chat) => chat.title))}`,
    };
  }
  return resolveReference(
    "Chat",
    chatRef,
    visibleChats,
    (chat) => chat.title,
    (chat) => [chat.title],
    (chat) => [chat.title],
  );
}

function agentProviderFromIntent(provider: "claude" | "codex"): AgentProvider {
  return provider === "claude" ? "claudeCode" : "codex";
}

function agentProviderFromChat(chat: Chat): AgentProvider | null {
  if (chat.agentId === "claudeCode" || chat.agentId === "claude") return "claudeCode";
  if (chat.agentId === "codex") return "codex";
  return null;
}

function activeChat(): Resolution<Chat> {
  const chatId = workspace.activeChatId;
  if (!chatId) return { ok: false, message: "No active chat" };
  const chat = findChat(chatId);
  if (!chat) return { ok: false, message: "Active chat is not loaded" };
  return { ok: true, value: chat };
}

function agentTarget(chat: Chat): Resolution<{ chat: Chat; provider: AgentProvider }> {
  if (chat.kind !== "agent") {
    return { ok: false, message: `Chat "${chat.title}" is not an agent chat` };
  }
  const provider = agentProviderFromChat(chat);
  if (!provider) {
    return { ok: false, message: `Chat "${chat.title}" has unsupported agent "${chat.agentId}"` };
  }
  return { ok: true, value: { chat, provider } };
}

function isVisiblePrimaryChat(chat: Chat): boolean {
  return !isChatArchived(chat.chatId) && isPrimaryChat(chat);
}

function summaryFor(intent: OperatorIntent): string {
  const action = intent.action;
  switch (action.action) {
    case "openProject":
      return `Open project ${intent.projectRef ?? "active project"}`;
    case "openChat":
      return `Open chat ${action.chat ?? "active chat"}`;
    case "createChat":
      return `Create ${action.provider} chat${action.model ? ` with model ${action.model}` : ""}`;
    case "sendPrompt":
      return `Send prompt to ${action.chat ? `chat ${action.chat}` : "active chat"}`;
    case "startSwarm":
      return `Start ${action.mode} swarm with ${action.count} lanes`;
    case "swarmStatus":
      return "Show swarm status";
    case "interruptRun":
      return `Interrupt ${action.run ?? "active chat"}`;
    case "steerRun":
      return `Steer ${action.run ?? "active chat"}`;
    case "launchEmulator":
      return `Launch emulator ${action.device ?? "default"}`;
    case "launchRun":
      return `Launch run target ${action.target ?? "default"}`;
    case "reloadRun":
      return "Hot reload active run";
    case "stopRun":
      return "Stop active run";
    case "hotRestart":
      return "Hot restart active run";
    case "enterSelectMode":
      return "Enter select mode";
    case "takeScreenshot":
      return "Take screenshot";
    case "selectWidget":
      return "selectWidget is planned for #142";
  }
}

function resultText(result: DispatchResult): string {
  return "summary" in result ? result.summary : result.message;
}

function auditStatusFor(result: DispatchResult): AuditStatus {
  switch (result.status) {
    case "done":
      return "done";
    case "noop":
      return "noop";
    case "needsConfirmation":
      return "needs_confirmation";
    case "denied":
      return "denied";
    case "failed":
    case "unsupported":
      return "failed";
  }
}

function auditProjectRoot(intent: OperatorIntent): string | null {
  if (!flagEnabled("operator")) return null;
  const resolved = resolveProjectReference(intent.projectRef);
  return resolved.ok ? resolved.value.projectRoot : null;
}

function auditInputText(intent: OperatorIntent, inputText: string | undefined): string {
  return inputText?.trim() ? inputText : JSON.stringify(intent.action);
}

async function insertAudit(
  intent: OperatorIntent,
  tier: 0 | 1,
  projectRoot: string | null,
  inputText: string | undefined,
) {
  const auditId = crypto.randomUUID();
  await db.operatorAuditInsert({
    id: auditId,
    createdAt: Date.now(),
    projectRoot,
    inputText: auditInputText(intent, inputText),
    intentJson: JSON.stringify(intent),
    riskTier: tier,
    status: "started",
    result: null,
  });
  return auditId;
}

async function finishAudit(
  auditId: string,
  status: AuditStatus,
  result: string,
): Promise<void> {
  await db.operatorAuditUpdate(auditId, status, result);
}

async function noteAuditUpdateFailure(
  auditId: string,
  status: AuditStatus,
  result: string,
): Promise<void> {
  try {
    await finishAudit(auditId, status, result);
  } catch (error) {
    console.warn("[pickforge] operator audit update failed", error);
  }
}

async function terminalResult(
  intent: OperatorIntent,
  tier: 0 | 1,
  projectRoot: string | null,
  result: DispatchResult,
  inputText: string | undefined,
): Promise<DispatchResult> {
  try {
    const auditId = await insertAudit(intent, tier, projectRoot, inputText);
    await finishAudit(auditId, auditStatusFor(result), resultText(result));
    return result;
  } catch (error) {
    return { status: "failed", message: errorText(error) };
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function projectFor(intent: OperatorIntent): Promise<Resolution<Project>> {
  return resolveProjectReference(intent.projectRef);
}

async function chatFor(intent: OperatorIntent, chatRef: string | null): Promise<Resolution<Chat>> {
  const project = await projectFor(intent);
  if (!project.ok) return project;
  return resolveChatReference(project.value.projectRoot, chatRef);
}

function openChatFallbackRef(inputText: string | undefined): string | null {
  const match = /^open\s+chat\s+([\s\S]+)$/i.exec(inputText?.trim() ?? "");
  return nonEmpty(match?.[1]);
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

async function chatToOpen(intent: OperatorIntent, chatRef: string | null): Promise<Resolution<Chat>> {
  const project = await projectFor(intent);
  if (!project.ok) return project;
  if (chatRef) return resolveChatReference(project.value.projectRoot, chatRef);

  await ensureChatsLoaded(project.value.projectRoot);
  const chats = chatsFor(project.value.projectRoot).filter(isVisiblePrimaryChat);
  if (!chats.length) {
    return { ok: false, message: `no chat to open in ${project.value.displayName}` };
  }

  return {
    ok: true,
    value: chats.reduce((latest, chat) =>
      chat.lastActivityAt > latest.lastActivityAt ? chat : latest,
    ),
  };
}

function normalizeNativeModel(provider: AgentProvider, model: string | null): Resolution<string | null> {
  const normalized = nativeChatModel(provider, model);
  if (model && normalized === null) {
    return {
      ok: false,
      message: `Model "${model}" is not available for native ${provider} chats`,
    };
  }
  return { ok: true, value: normalized };
}

async function sendToChat(chat: Chat, prompt: string): Promise<DispatchResult> {
  const target = agentTarget(chat);
  if (!target.ok) return { status: "failed", message: target.message };
  const state = agentChat(chat.chatId);
  if (!state?.sessionId) {
    const provider = target.value.provider;
    let model: string | null;
    if (state) {
      model = state.model;
    } else {
      const latestSession = await db.agentSessionLatestForChat(chat.chatId);
      const selectedModel = latestSession
        ? nativeChatModel(provider, latestSession.model)
        : nativeChatModel(provider, loadAgentModels()[provider] ?? null);
      model = selectedModel;
    }
    await ensureAgentChat(
      chat.chatId,
      chat.projectRoot,
      provider,
      model,
      {
        engine: loadAgentEngine(),
        effort: loadAgentEfforts()[provider] ?? null,
        mode: loadAgentModes()[provider] ?? null,
      },
    );
  }
  await sendAgentMessage(chat.chatId, prompt);
  return { status: "done", summary: `Sent prompt to ${chat.title}` };
}

async function activeChatForIntent(intent: OperatorIntent): Promise<Resolution<Chat>> {
  const project = intent.projectRef ? await projectFor(intent) : null;
  if (project && !project.ok) return { ok: false, message: project.message };
  const chat = activeChat();
  if (!chat.ok) return chat;
  if (project && chat.value.projectRoot !== project.value.projectRoot) {
    return {
      ok: false,
      message: `Active chat "${chat.value.title}" is not in project ${project.value.displayName}`,
    };
  }
  return chat;
}

async function resolveRunChat(intent: OperatorIntent, runRef: string | null): Promise<Resolution<Chat>> {
  if (!runRef) return activeChatForIntent(intent);
  return chatFor(intent, runRef);
}

function swarmSummary(projectRoot: string): string {
  const runs = swarmRuns().filter((run) => run.projectRoot === projectRoot);
  if (!runs.length) return "No swarm runs.";
  const statuses: Array<ReturnType<typeof swarmRuns>[number]["status"]> = [
    "queued",
    "starting",
    "running",
    "completed",
    "failed",
    "cancelled",
  ];
  const counts = statuses
    .map((status) => [status, runs.filter((run) => run.status === status).length] as const)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${status} ${count}`)
    .join(", ");
  return `Swarm runs: ${counts}`;
}

function runTargetLabel(target: RunTarget): string {
  return target.label === target.id ? target.label : `${target.label} (${target.id})`;
}

function resolveRunTargetReference(targetRef: string | null): Resolution<RunTarget> {
  const targets = runTargets();
  if (!targetRef) {
    const target = activeTarget();
    if (!target) {
      return {
        ok: false,
        message: `No run target available. Candidates: ${candidateList(targets.map(runTargetLabel))}`,
      };
    }
    return { ok: true, value: target };
  }

  return resolveReference(
    "Run target",
    targetRef,
    targets,
    runTargetLabel,
    (target) => [target.id, target.label],
    (target) => [target.label, target.id],
  );
}

async function activeProjectForDeviceIntent(intent: OperatorIntent): Promise<Resolution<Project>> {
  const project = await projectFor(intent);
  if (!project.ok) return project;
  if (workspace.activeRoot !== project.value.projectRoot) {
    return {
      ok: false,
      message: `Project ${project.value.displayName} is not active`,
    };
  }
  return project;
}

function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function pathIsWithinProject(path: string, projectRoot: string): boolean {
  const normalizedPath = normalizeProjectPath(path);
  const normalizedRoot = normalizeProjectPath(projectRoot);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function activeRunBelongsToProject(projectRoot: string): boolean {
  const cwd = runConsole.current()?.cwd;
  if (!cwd) return workspace.activeRoot === projectRoot;
  return pathIsWithinProject(cwd, projectRoot);
}

function activeRunTarget(): RunTarget | null {
  return runConsole.status() === "running" ? runConsole.target() : activeTarget();
}

function resolveDeviceReference(ref: string, devices: DeviceEntry[]): Resolution<DeviceEntry> {
  return resolveReference(
    "Device",
    ref,
    devices,
    deviceLabel,
    (device) => [device.displayName, device.avdId ?? "", device.serial ?? ""],
    (device) => [device.displayName, device.avdId ?? "", device.serial ?? ""],
  );
}

function defaultEmulator(devices: DeviceEntry[]): DeviceEntry | null {
  const selected = resolveSelectedDevice();
  if (selected?.kind === "emulator") {
    const key = deviceKey(selected);
    const match = devices.find((device) => deviceKey(device) === key);
    if (match) return match;
  }
  return devices.find((device) => device.state === "running") ??
    devices.find((device) => device.state === "stopped") ??
    null;
}

async function launchEmulatorIntent(intent: OperatorIntent, deviceRef: string | null): Promise<DispatchResult> {
  const project = await activeProjectForDeviceIntent(intent);
  if (!project.ok) return { status: "failed", message: project.message };

  const devices = (await refreshDevices()).filter((device) => device.kind === "emulator");
  const fallback = defaultEmulator(devices);
  const resolved = deviceRef
    ? resolveDeviceReference(deviceRef, devices)
    : fallback
      ? { ok: true as const, value: fallback }
      : {
          ok: false as const,
          message: `No emulator available. Candidates: ${candidateList(devices.map(deviceLabel))}`,
        };
  if (!resolved.ok) return { status: "failed", message: resolved.message };

  const device = resolved.value;
  if (device.state === "offline") {
    return { status: "failed", message: `${device.displayName} is offline or unauthorized` };
  }
  setRunDevice(project.value.projectRoot, deviceKey(device));
  if (device.state === "running") {
    return { status: "done", summary: `Selected emulator ${deviceLabel(device)}` };
  }
  if (!device.avdId) {
    return { status: "failed", message: `Device "${device.displayName}" cannot be launched` };
  }

  await androidLaunchAvd(device.avdId);
  return { status: "done", summary: `Launched emulator ${device.displayName}` };
}

async function launchRunIntent(intent: OperatorIntent, targetRef: string | null): Promise<DispatchResult> {
  const project = await activeProjectForDeviceIntent(intent);
  if (!project.ok) return { status: "failed", message: project.message };
  if (runConsole.status() === "running") {
    return { status: "noop", summary: "run already active" };
  }

  const target = resolveRunTargetReference(targetRef);
  if (!target.ok) return { status: "failed", message: target.message };
  if (targetRef) setActiveTargetId(target.value.id);
  await launchActiveTarget();
  if (isBooting()) return { status: "failed", message: "Run launch is already in progress" };
  const error = launchError();
  if (error) return { status: "failed", message: error };
  if (runConsole.status() !== "running") {
    return { status: "noop", summary: "run launch did not start" };
  }
  return { status: "done", summary: `Launched run target ${target.value.label}` };
}

async function runControlIntent(
  intent: OperatorIntent,
  action: "reloadRun" | "hotRestart" | "stopRun",
): Promise<DispatchResult> {
  const project = await activeProjectForDeviceIntent(intent);
  if (!project.ok) return { status: "failed", message: project.message };
  if (runConsole.status() !== "running") {
    return { status: "noop", summary: "no active run" };
  }
  if (!activeRunBelongsToProject(project.value.projectRoot)) {
    return { status: "failed", message: `Active run is not in project ${project.value.displayName}` };
  }

  const target = runConsole.target();
  if (action === "reloadRun") {
    if (!target?.capabilities.includes("hotReload")) {
      return { status: "failed", message: "Active run target does not support hot reload" };
    }
    reloadActiveRun();
    return { status: "done", summary: "Reloaded active run" };
  }
  if (action === "hotRestart") {
    if (!target?.capabilities.includes("hotRestart")) {
      return { status: "failed", message: "Active run target does not support hot restart" };
    }
    restartActiveRun();
    return { status: "done", summary: "Hot restarted active run" };
  }
  stopActiveRun();
  return { status: "done", summary: "Stopped active run" };
}

async function enterSelectModeIntent(intent: OperatorIntent): Promise<DispatchResult> {
  const project = await activeProjectForDeviceIntent(intent);
  if (!project.ok) return { status: "failed", message: project.message };
  let isolate: string;
  try {
    isolate = await vmFindIsolate();
  } catch {
    return { status: "noop", summary: "no active device/session" };
  }
  await vmShowSelectMode(isolate, true);
  return { status: "done", summary: "Entered select mode" };
}

async function captureVmScreenshot(projectRoot: string): Promise<string | null> {
  const isolate = await vmFindIsolate().catch(() => null);
  if (!isolate) return null;
  const selected = await vmSelectedWidget(isolate, "pf-operator-screenshot").catch(() => null);
  if (!selected?.id) return null;
  const png = await vmScreenshot(isolate, selected.id, 1024, 2048).catch(() => null);
  if (!png) return null;
  const dir = await inspectDir(captureInRepo(projectRoot), projectRoot);
  const paths = await inspectSave(dir, "operator-screenshot", "Operator screenshot", png);
  return paths.pngPath;
}

async function captureDeviceScreenshot(projectRoot: string): Promise<string | null> {
  await refreshDevices();
  const device = resolveSelectedDevice();
  if (!device?.serial || device.state !== "running") return null;
  const dir = await inspectDir(captureInRepo(projectRoot), projectRoot);
  return device.kind === "simulator"
    ? iosScreenshot(device.serial, dir, "operator-screenshot.png")
    : adbScreenshot(device.serial, dir, "operator-screenshot.png");
}

async function takeScreenshotIntent(intent: OperatorIntent): Promise<DispatchResult> {
  const project = await activeProjectForDeviceIntent(intent);
  if (!project.ok) return { status: "failed", message: project.message };

  const target = activeRunTarget();
  const vmPath = target?.inspectorKind === "vmService"
    ? await captureVmScreenshot(project.value.projectRoot)
    : null;
  const path = vmPath ?? await captureDeviceScreenshot(project.value.projectRoot);
  if (!path) return { status: "noop", summary: "no active device/session" };
  return { status: "done", summary: `Captured screenshot ${path}` };
}

function unsupported(action: OperatorAction): DispatchResult | null {
  switch (action.action) {
    case "selectWidget":
      return { status: "unsupported", message: "selectWidget is planned for #142" };
    default:
      return null;
  }
}

async function runIntent(intent: OperatorIntent, inputText?: string): Promise<DispatchResult> {
  const action = intent.action;
  const unsupportedResult = unsupported(action);
  if (unsupportedResult) return unsupportedResult;

  switch (action.action) {
    case "openProject": {
      const project = await projectFor(intent);
      if (!project.ok) return { status: "failed", message: project.message };
      await selectProject(project.value.projectRoot);
      return { status: "done", summary: `Opened project ${project.value.displayName}` };
    }
    case "openChat": {
      const fallbackRef = openChatFallbackRef(inputText);
      let chat: Resolution<Chat> | null = null;
      if (fallbackRef && fallbackRef !== action.chat) {
        const fallback = await chatToOpen({ ...intent, projectRef: null }, fallbackRef);
        if (fallback.ok) chat = fallback;
      }
      chat ??= await chatToOpen(intent, action.chat);
      if (!chat.ok && intent.projectRef && fallbackRef && fallbackRef !== action.chat) {
        const fallback = await chatToOpen({ ...intent, projectRef: null }, fallbackRef);
        if (fallback.ok) chat = fallback;
      }
      if (!chat.ok) return { status: "failed", message: chat.message };
      selectChat(chat.value.chatId);
      return { status: "done", summary: `Opened chat ${chat.value.title}` };
    }
    case "createChat": {
      const project = await projectFor(intent);
      if (!project.ok) return { status: "failed", message: project.message };
      const provider = agentProviderFromIntent(action.provider);
      const model = normalizeNativeModel(
        provider,
        action.model
          ? action.model
          : nativeChatModel(provider, loadAgentModels()[provider] ?? null),
      );
      if (!model.ok) return { status: "failed", message: model.message };
      const chatId = await addChat("Operator chat", provider, project.value.projectRoot, "agent");
      if (!chatId) return { status: "failed", message: "Could not create operator chat" };
      await ensureAgentChat(
        chatId,
        project.value.projectRoot,
        provider,
        model.value,
        {
          engine: loadAgentEngine(),
          effort: loadAgentEfforts()[provider] ?? null,
          mode: loadAgentModes()[provider] ?? null,
        },
      );
      return { status: "done", summary: "Created Operator chat" };
    }
    case "sendPrompt": {
      if (action.chat) {
        const chat = await chatFor(intent, action.chat);
        if (!chat.ok) return { status: "failed", message: chat.message };
        return sendToChat(chat.value, action.prompt);
      }
      const chat = await activeChatForIntent(intent);
      if (!chat.ok) return { status: "failed", message: chat.message };
      return sendToChat(chat.value, action.prompt);
    }
    case "startSwarm": {
      const project = await projectFor(intent);
      if (!project.ok) return { status: "failed", message: project.message };
      const providerPreference = action.provider === "claude" ? "claudeCode" : action.provider;
      const runId = await startSwarmRun(project.value.projectRoot, action.goal, {
        mode: action.mode,
        count: action.count,
        providerPreference,
      });
      return { status: "done", summary: `Started swarm ${runId}` };
    }
    case "swarmStatus": {
      const project = await projectFor(intent);
      if (!project.ok) return { status: "failed", message: project.message };
      return { status: "done", summary: swarmSummary(project.value.projectRoot) };
    }
    case "interruptRun": {
      const chat = await resolveRunChat(intent, action.run);
      if (!chat.ok) return { status: "failed", message: chat.message };
      const target = agentTarget(chat.value);
      if (!target.ok) return { status: "failed", message: target.message };
      const state = agentChat(chat.value.chatId);
      if (!state?.sessionId || !state.turnActive) {
        return { status: "noop", summary: "nothing to interrupt" };
      }
      await interruptAgentChat(chat.value.chatId);
      return { status: "done", summary: `Interrupted ${chat.value.title}` };
    }
    case "steerRun": {
      const chat = await resolveRunChat(intent, action.run);
      if (!chat.ok) return { status: "failed", message: chat.message };
      const target = agentTarget(chat.value);
      if (!target.ok) return { status: "failed", message: target.message };
      await steerAgentChat(chat.value.chatId, action.instruction);
      return { status: "done", summary: `Steered ${chat.value.title}` };
    }
    case "launchEmulator":
      return launchEmulatorIntent(intent, action.device);
    case "launchRun":
      return launchRunIntent(intent, action.target);
    case "reloadRun":
      return runControlIntent(intent, "reloadRun");
    case "stopRun":
      return runControlIntent(intent, "stopRun");
    case "hotRestart":
      return runControlIntent(intent, "hotRestart");
    case "enterSelectMode":
      return enterSelectModeIntent(intent);
    case "takeScreenshot":
      return takeScreenshotIntent(intent);
    case "selectWidget":
      return { status: "unsupported", message: summaryFor(intent) };
  }
}

export async function dispatchIntent(
  intent: OperatorIntent,
  opts: DispatchOptions = {},
): Promise<DispatchResult> {
  const tier = riskTier(intent.action);
  if (!flagEnabled("operator")) {
    return terminalResult(
      intent,
      tier,
      null,
      {
        status: "denied",
        message: "Operator is disabled.",
      },
      opts.inputText,
    );
  }

  const projectRoot = auditProjectRoot(intent);
  if (tier === 1 && !opts.confirmed) {
    return terminalResult(
      intent,
      tier,
      projectRoot,
      {
        status: "needsConfirmation",
        summary: summaryFor(intent),
      },
      opts.inputText,
    );
  }

  let auditId: string;
  try {
    auditId = await insertAudit(intent, tier, projectRoot, opts.inputText);
  } catch (error) {
    return { status: "failed", message: errorText(error) };
  }

  try {
    const result = await runIntent(intent, opts.inputText);
    await noteAuditUpdateFailure(auditId, auditStatusFor(result), resultText(result));
    return result;
  } catch (error) {
    const message = errorText(error);
    await noteAuditUpdateFailure(auditId, "failed", message);
    return { status: "failed", message };
  }
}
