import type { AgentProvider } from "../lib/agentChat";
import { normalizeAgentProvider } from "../lib/agentBackends";
import {
  loadAgentEfforts,
  loadAgentModels,
  nativeChatModel,
} from "../lib/agentModels";
import { loadAgentModes } from "../lib/agentModes";
import { isPrimaryChat } from "../lib/chatLabels";
import { loadAgentEngine } from "../lib/chatDefaults";
import * as db from "../lib/db";
import { errorText } from "../lib/errors";
import {
  adbScreenshot,
  androidLaunchAvd,
  iosBootDevice,
  iosScreenshot,
  type DeviceEntry,
} from "../lib/device";
import type { Chat, Project } from "../lib/db";
import { riskTier, type OperatorIntent } from "../lib/operatorIntent";
import { hasCapability, isCompatibleDevice, type RunTarget } from "../lib/runTargets";
import { remotePtyFor } from "../lib/remoteContext";
import type { RemotePty } from "../lib/pty";
import { matchWidget, type IndexedWidgetNode } from "../lib/widgetMatch";
import {
  inspectDir,
  inspectSave,
  vmFindIsolate,
  vmScreenshot,
  vmSelectedWidget,
  vmSetSelection,
  vmShowSelectMode,
  vmWidgetTreeSemantic,
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
} from "./runLaunch";
import { selectedDevice, setRunDevice } from "./runDevice";
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
  | {
    status: "needsConfirmation";
    summary: string;
    auditId: string;
    candidates?: WidgetSelectionCandidate[];
  }
  | { status: "denied" | "failed" | "unsupported"; message: string };

export type WidgetSelectionCandidate = {
  index: number;
  className: string;
  label: string | null;
};

type DispatchResultDraft =
  | Exclude<DispatchResult, { status: "needsConfirmation" }>
  | { status: "needsConfirmation"; summary: string; candidates?: WidgetSelectionCandidate[] };

export type DispatchOptions = {
  confirmed?: boolean;
  inputText?: string;
  reuseAuditId?: string;
};

type Resolution<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

type AuditStatus = db.OperatorAuditRow["status"];

type PendingWidgetSelection = {
  isolate: string;
  groupName: string;
  candidates: Map<number, IndexedWidgetNode>;
};

const WIDGET_MATCH_OBJECT_GROUP = "pf-operator-widget-match";
const pendingWidgetSelections = new Map<string, PendingWidgetSelection>();

/** The one execution transaction for an Operator intent: every mutable
 *  Project/target/device/chat fact an action or its audit row can depend on,
 *  resolved ONCE, synchronously, at dispatch intent — before the first await
 *  (the audit insert). `runIntent` and every action helper below thread this
 *  through instead of re-resolving live store state, so a Project switch (or
 *  a target/device/chat change for the same Project) mid-await can never
 *  retarget an audit row, launch, screenshot, widget select, or run control
 *  that already started dispatching. Mirrors the pre-await capture discipline
 *  `launchTarget` (runLaunch.ts) and `resolvePtyRemote` (remoteContext.ts)
 *  established for the direct run path. */
type ExecutionFacts = {
  intent: OperatorIntent;
  /** The intent's own Project reference, resolved once (null ref resolves to
   *  whatever was active at capture time). */
  project: Resolution<Project>;
  /** The active Project at capture time, ignoring any explicit projectRef —
   *  used only for chat-open's "fall back to the active project" rule. */
  activeProject: Resolution<Project>;
  /** workspace.activeRoot at capture time, for "is Project X active" checks
   *  that must not read live state after an await. */
  activeRoot: string | null;
  /** workspace.activeChatId at capture time. */
  activeChatId: string | null;
  /** The target a fresh run would use for this Project at capture time
   *  (the live run's target if one is running, else the selected launcher
   *  target) — target discovery is Project-scoped, so this must be captured
   *  alongside the Project, not re-read after an await. */
  target: RunTarget | null;
  /** All discovered targets for the captured Project at capture time. */
  targets: RunTarget[];
  /** The stored device selection for the captured Project at capture time
   *  (a key, not a live DeviceEntry — device connection state is refreshed
   *  fresh at use time, only WHICH device was chosen is captured). */
  deviceSelectionKey: string;
  /** The captured Project's remote binding (execution location): local-only
   *  device adapters (emulator/simulator boot, adb/ios screenshot) must never
   *  fall back to the local machine for a Project bound to a remote host. */
  remote: RemotePty | null;
};

/** Facts captured for a tier-1 preview, kept until its confirmation dispatch
 *  consumes them by auditId — so "confirm" executes against exactly what was
 *  shown/audited at preview time, even if the active Project changed while
 *  the confirmation was pending. Mirrors `pendingWidgetSelections` above:
 *  no explicit TTL, an abandoned preview is simply never consumed. */
const pendingExecutionFacts = new Map<string, ExecutionFacts>();

function activeRunTarget(): RunTarget | null {
  return runConsole.status() === "running" ? runConsole.target() : activeTarget();
}

function captureExecutionFacts(intent: OperatorIntent): ExecutionFacts {
  const project = resolveProjectReference(intent.projectRef);
  const activeProject = resolveProjectReference(null);
  return {
    intent,
    project,
    activeProject,
    activeRoot: workspace.activeRoot,
    activeChatId: workspace.activeChatId,
    target: activeRunTarget(),
    targets: runTargets(),
    deviceSelectionKey: project.ok ? selectedDevice(project.value.projectRoot) : "",
    remote: project.ok ? remotePtyFor(project.value.projectRoot) : null,
  };
}

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


function agentTarget(chat: Chat): Resolution<{ chat: Chat; provider: AgentProvider }> {
  if (chat.kind !== "agent") {
    return { ok: false, message: `Chat "${chat.title}" is not an agent chat` };
  }
  const provider = normalizeAgentProvider(chat.agentId);
  if (!provider) {
    return { ok: false, message: `Chat "${chat.title}" has unsupported agent "${chat.agentId}"` };
  }
  return { ok: true, value: { chat, provider } };
}

function isVisiblePrimaryChat(chat: Chat): boolean {
  return !isChatArchived(chat.chatId) && isPrimaryChat(chat);
}

// OperatorAction's discriminated union has 16 "action" variants and every case body is already
// a single, non-branching return — there is no internal complexity left to extract. A switch is
// the standard exhaustiveness-checked way to dispatch a TS discriminated union (ESLint counts
// every case uniformly regardless of body size); a lookup-table dispatch would trade
// compiler-enforced exhaustiveness for a runtime lookup plus an unsafe cast for no real gain here.
// eslint-disable-next-line complexity -- TODO(#263): see comment above.
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
      return `Select widget ${action.description}`;
  }
}

function resultText(result: DispatchResultDraft): string {
  return "summary" in result ? result.summary : result.message;
}

function auditStatusFor(result: DispatchResultDraft): AuditStatus {
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

function auditProjectRootFor(facts: ExecutionFacts): string | null {
  if (!flagEnabled("operator")) return null;
  return facts.project.ok ? facts.project.value.projectRoot : null;
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
  result: DispatchResultDraft,
  inputText: string | undefined,
  facts: ExecutionFacts | null,
): Promise<DispatchResult> {
  try {
    const auditId = await insertAudit(intent, tier, projectRoot, inputText);
    if (facts && result.status === "needsConfirmation") {
      pendingExecutionFacts.set(auditId, facts);
    }
    const auditedResult: DispatchResult = result.status === "needsConfirmation"
      ? { ...result, auditId }
      : result;
    await finishAudit(auditId, auditStatusFor(auditedResult), resultText(auditedResult));
    return auditedResult;
  } catch (error) {
    return { status: "failed", message: errorText(error) };
  }
}

async function chatForFacts(facts: ExecutionFacts, chatRef: string | null): Promise<Resolution<Chat>> {
  const project = facts.project;
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

async function chatToOpenIn(project: Resolution<Project>, chatRef: string | null): Promise<Resolution<Chat>> {
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

function capturedActiveChat(facts: ExecutionFacts): Resolution<Chat> {
  const chatId = facts.activeChatId;
  if (!chatId) return { ok: false, message: "No active chat" };
  const chat = findChat(chatId);
  if (!chat) return { ok: false, message: "Active chat is not loaded" };
  return { ok: true, value: chat };
}

function activeChatForFacts(facts: ExecutionFacts): Resolution<Chat> {
  const project = facts.intent.projectRef ? facts.project : null;
  if (project && !project.ok) return { ok: false, message: project.message };
  const chat = capturedActiveChat(facts);
  if (!chat.ok) return chat;
  if (project && chat.value.projectRoot !== project.value.projectRoot) {
    return {
      ok: false,
      message: `Active chat "${chat.value.title}" is not in project ${project.value.displayName}`,
    };
  }
  return chat;
}

async function resolveRunChatFacts(facts: ExecutionFacts, runRef: string | null): Promise<Resolution<Chat>> {
  if (!runRef) return activeChatForFacts(facts);
  return chatForFacts(facts, runRef);
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

function resolveRunTargetFacts(facts: ExecutionFacts, targetRef: string | null): Resolution<RunTarget> {
  const targets = facts.targets;
  if (!targetRef) {
    const target = facts.target;
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

function activeProjectFacts(facts: ExecutionFacts): Resolution<Project> {
  const project = facts.project;
  if (!project.ok) return project;
  if (facts.activeRoot !== project.value.projectRoot) {
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

/** Whether the LIVE run console's current run belongs to the captured
 *  Project: the run process is global (switching the active Project in the
 *  UI doesn't retarget it), so reading it live here is correct — what must
 *  never drift is which Project it's compared against, which is why callers
 *  always pass the captured `project.projectRoot`, not a live re-resolution. */
function activeRunBelongsToProject(projectRoot: string): boolean {
  const cwd = runConsole.current()?.cwd;
  if (!cwd) return workspace.activeRoot === projectRoot;
  return pathIsWithinProject(cwd, projectRoot);
}

function activeFlutterRunForProject(project: Project): Resolution<RunTarget> {
  if (runConsole.status() !== "running") {
    return { ok: false, message: `No active Flutter run in project ${project.displayName}` };
  }
  if (!activeRunBelongsToProject(project.projectRoot)) {
    return { ok: false, message: `Active run is not in project ${project.displayName}` };
  }
  const target = runConsole.target();
  if (target?.inspectorKind !== "vmService") {
    return { ok: false, message: "Active run is not a Flutter VM-service target" };
  }
  return { ok: true, value: target };
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

function isLaunchableVirtualDevice(device: DeviceEntry): boolean {
  return device.kind === "emulator" || device.kind === "simulator";
}

function selectableDeviceKindLabel(device: DeviceEntry): "device" | "emulator" | "simulator" {
  if (device.kind === "simulator") return "simulator";
  if (device.kind === "emulator") return "emulator";
  return "device";
}

/** Resolve a device among an already target-compatible list using the
 *  captured stored-selection key (an exact serial/avdId match), falling back
 *  to the first running device, then the first stopped one — mirrors
 *  `resolveSelectedDevice`'s matching order in runLaunch.ts, but reads the
 *  key CAPTURED at intent time instead of the live selection, so a selection
 *  change for the same Project mid-await can't retarget an in-flight
 *  launch/screenshot. An explicit stored match always wins over the fallback,
 *  even if it isn't currently running (never silently switches devices). */
function resolveDeviceFromSelection(devices: DeviceEntry[], capturedKey: string): DeviceEntry | null {
  const match = capturedKey
    ? devices.find((device) => (device.serial && device.serial === capturedKey) || (device.avdId && device.avdId === capturedKey))
    : undefined;
  return match ??
    devices.find((device) => device.state === "running") ??
    devices.find((device) => device.state === "stopped") ??
    null;
}

function compatibleDevices(target: RunTarget | null, devices: DeviceEntry[]): DeviceEntry[] {
  return devices.filter((device) => isCompatibleDevice(target, device.kind));
}

function compatibleVirtualDevices(target: RunTarget | null, devices: DeviceEntry[]): DeviceEntry[] {
  return compatibleDevices(target, devices).filter(isLaunchableVirtualDevice);
}

async function launchEmulatorIntent(facts: ExecutionFacts, deviceRef: string | null): Promise<DispatchResult> {
  const project = activeProjectFacts(facts);
  if (!project.ok) return { status: "failed", message: project.message };
  if (facts.remote) {
    return {
      status: "failed",
      message: `Project ${project.value.displayName} runs on ${facts.remote.host} — local emulator/simulator launch is unavailable`,
    };
  }

  const target = facts.target;
  const refreshedDevices = await refreshDevices();
  const devices = deviceRef
    ? compatibleDevices(target, refreshedDevices)
    : compatibleVirtualDevices(target, refreshedDevices);
  const fallback = deviceRef ? null : resolveDeviceFromSelection(devices, facts.deviceSelectionKey);
  const resolved = deviceRef
    ? resolveDeviceReference(deviceRef, devices)
    : fallback
      ? { ok: true as const, value: fallback }
      : {
          ok: false as const,
          message: `No virtual device available. Candidates: ${candidateList(devices.map(deviceLabel))}`,
        };
  if (!resolved.ok) return { status: "failed", message: resolved.message };

  const device = resolved.value;
  if (device.state === "offline") {
    return { status: "failed", message: `${device.displayName} is offline or unauthorized` };
  }
  setRunDevice(project.value.projectRoot, deviceKey(device));
  if (device.state === "running") {
    return { status: "done", summary: `Selected ${selectableDeviceKindLabel(device)} ${deviceLabel(device)}` };
  }
  if (!isLaunchableVirtualDevice(device)) {
    return { status: "done", summary: `Selected ${selectableDeviceKindLabel(device)} ${deviceLabel(device)}` };
  }
  if (device.kind === "simulator") {
    if (!device.serial) {
      return { status: "failed", message: `Device "${device.displayName}" cannot be launched` };
    }
    await iosBootDevice(device.serial);
    return { status: "done", summary: `Launched simulator ${device.displayName}` };
  }
  if (!device.avdId) {
    return { status: "failed", message: `Device "${device.displayName}" cannot be launched` };
  }

  await androidLaunchAvd(device.avdId);
  return { status: "done", summary: `Launched emulator ${device.displayName}` };
}

async function launchRunIntent(facts: ExecutionFacts, targetRef: string | null): Promise<DispatchResult> {
  const project = activeProjectFacts(facts);
  if (!project.ok) return { status: "failed", message: project.message };
  if (runConsole.status() === "running") {
    return { status: "noop", summary: "run already active" };
  }
  if (isBooting()) return { status: "failed", message: "Run launch is already in progress" };

  const target = resolveRunTargetFacts(facts, targetRef);
  if (!target.ok) return { status: "failed", message: target.message };
  // The captured Project was active when this intent was resolved (checked
  // above), but this dispatch already crossed one await (the audit insert)
  // before reaching here. Re-check against LIVE state right before handing
  // off to `launchActiveTarget` — which reads `workspace.activeRoot` itself,
  // with no parameter to inject the captured Project — so a switch during
  // that earlier await can never launch against the wrong Project.
  if (workspace.activeRoot !== project.value.projectRoot) {
    return { status: "failed", message: `Project ${project.value.displayName} is no longer active` };
  }
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
  facts: ExecutionFacts,
  action: "reloadRun" | "hotRestart" | "stopRun",
): Promise<DispatchResult> {
  const project = activeProjectFacts(facts);
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

async function enterSelectModeIntent(facts: ExecutionFacts): Promise<DispatchResult> {
  const project = activeProjectFacts(facts);
  if (!project.ok) return { status: "failed", message: project.message };
  const target = activeFlutterRunForProject(project.value);
  if (!target.ok) return { status: "failed", message: target.message };
  let isolate: string;
  try {
    isolate = await vmFindIsolate();
  } catch {
    return { status: "noop", summary: "no active device/session" };
  }
  await vmShowSelectMode(isolate, true);
  return { status: "done", summary: "Entered select mode" };
}

function selectedWidgetSummary(node: Pick<IndexedWidgetNode, "className" | "label">): string {
  return `Selected ${node.className}${node.label ? ` — '${node.label}'` : ""}`;
}

function candidateFor(node: IndexedWidgetNode): WidgetSelectionCandidate {
  return { index: node.index, className: node.className, label: node.label };
}

async function selectWidgetIntent(
  facts: ExecutionFacts,
  description: string,
  auditId: string,
): Promise<DispatchResultDraft> {
  const project = activeProjectFacts(facts);
  if (!project.ok) return { status: "failed", message: project.message };
  const target = activeFlutterRunForProject(project.value);
  if (!target.ok) return { status: "failed", message: target.message };
  let isolate: string;
  try {
    isolate = await vmFindIsolate();
  } catch {
    return { status: "noop", summary: "no active device/session" };
  }

  const tree = await vmWidgetTreeSemantic(isolate, WIDGET_MATCH_OBJECT_GROUP);
  const match = await matchWidget(description, tree);
  switch (match.kind) {
    case "match": {
      const selected = await vmSetSelection(isolate, match.node.valueId, WIDGET_MATCH_OBJECT_GROUP);
      if (!selected) return { status: "failed", message: "Could not select the matched widget" };
      return { status: "done", summary: selectedWidgetSummary(match.node) };
    }
    case "ambiguous":
      pendingWidgetSelections.set(auditId, {
        isolate,
        groupName: WIDGET_MATCH_OBJECT_GROUP,
        candidates: new Map(match.candidates.map((candidate) => [candidate.index, candidate])),
      });
      return {
        status: "needsConfirmation",
        summary: "Choose the matching widget",
        candidates: match.candidates.map(candidateFor),
      };
    case "notFound":
      return { status: "failed", message: `No widget matched "${description}"` };
    case "unconfigured":
      return {
        status: "unsupported",
        message: "Operator router is off. Choose a backend in Settings.",
      };
    case "error":
      return { status: "failed", message: `Widget matching failed: ${match.message}` };
  }
}

export async function selectWidgetCandidate(auditId: string, index: number): Promise<DispatchResult> {
  const pending = pendingWidgetSelections.get(auditId);
  const candidate = pending?.candidates.get(index);
  if (!pending || !candidate) {
    return { status: "failed", message: "Widget choice is no longer available" };
  }
  pendingWidgetSelections.delete(auditId);
  const selected = await vmSetSelection(pending.isolate, candidate.valueId, pending.groupName);
  if (!selected) return { status: "failed", message: "Could not select the chosen widget" };
  return { status: "done", summary: selectedWidgetSummary(candidate) };
}

export function discardWidgetSelection(auditId: string): void {
  pendingWidgetSelections.delete(auditId);
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

async function captureDeviceScreenshot(
  projectRoot: string,
  device: DeviceEntry,
): Promise<string | null> {
  if (!device.serial) return null;
  const dir = await inspectDir(captureInRepo(projectRoot), projectRoot);
  return device.kind === "simulator"
    ? iosScreenshot(device.serial, dir, "operator-screenshot.png")
    : adbScreenshot(device.serial, dir, "operator-screenshot.png");
}

function screenshotTargetFor(target: RunTarget | null): RunTarget | null {
  if (!hasCapability(target, "captureScreenshot")) return null;
  return target?.inspectorKind === "vmService" || target?.deviceConvention !== "none" ? target : null;
}

async function takeScreenshotIntent(facts: ExecutionFacts): Promise<DispatchResult> {
  const project = activeProjectFacts(facts);
  if (!project.ok) return { status: "failed", message: project.message };
  if (runConsole.status() === "running" && !activeRunBelongsToProject(project.value.projectRoot)) {
    return { status: "failed", message: `Active run is not in project ${project.value.displayName}` };
  }

  const vmPath = await captureVmScreenshot(project.value.projectRoot);
  if (vmPath) return { status: "done", summary: `Captured screenshot ${vmPath}` };

  // A remote Project's VM session already tried above (it works over the
  // wire); its adb/ios screenshot fallback is local-only and must never
  // capture the local machine on its behalf.
  if (facts.remote) return { status: "noop", summary: "no device or VM session to capture" };

  const screenshotTarget = screenshotTargetFor(facts.target);
  if (screenshotTarget) {
    const refreshedDevices = await refreshDevices();
    const compatible = refreshedDevices.filter((device) => isCompatibleDevice(screenshotTarget, device.kind));
    const device = resolveDeviceFromSelection(compatible, facts.deviceSelectionKey);
    if (device?.serial && device.state === "running") {
      const path = await captureDeviceScreenshot(project.value.projectRoot, device);
      if (path) return { status: "done", summary: `Captured screenshot ${path}` };
    }
  }
  return { status: "noop", summary: "no device or VM session to capture" };
}

async function runOpenProjectIntent(facts: ExecutionFacts): Promise<DispatchResultDraft> {
  const project = facts.project;
  if (!project.ok) return { status: "failed", message: project.message };
  await selectProject(project.value.projectRoot);
  return { status: "done", summary: `Opened project ${project.value.displayName}` };
}

async function runOpenChatIntent(
  facts: ExecutionFacts,
  inputText: string | undefined,
  action: Extract<OperatorIntent["action"], { action: "openChat" }>,
): Promise<DispatchResultDraft> {
  const fallbackRef = openChatFallbackRef(inputText);
  let chat: Resolution<Chat> | null = null;
  if (fallbackRef && fallbackRef !== action.chat) {
    const fallback = await chatToOpenIn(facts.activeProject, fallbackRef);
    if (fallback.ok) chat = fallback;
  }
  chat ??= await chatToOpenIn(facts.project, action.chat);
  if (!chat.ok && facts.intent.projectRef && fallbackRef && fallbackRef !== action.chat) {
    const fallback = await chatToOpenIn(facts.activeProject, fallbackRef);
    if (fallback.ok) chat = fallback;
  }
  if (!chat.ok) return { status: "failed", message: chat.message };
  selectChat(chat.value.chatId);
  return { status: "done", summary: `Opened chat ${chat.value.title}` };
}

async function runCreateChatIntent(
  facts: ExecutionFacts,
  action: Extract<OperatorIntent["action"], { action: "createChat" }>,
): Promise<DispatchResultDraft> {
  const project = facts.project;
  if (!project.ok) return { status: "failed", message: project.message };
  const provider = agentProviderFromIntent(action.provider);
  const model = normalizeNativeModel(
    provider,
    action.model ? action.model : nativeChatModel(provider, loadAgentModels()[provider] ?? null),
  );
  if (!model.ok) return { status: "failed", message: model.message };
  const chatId = await addChat("Operator chat", provider, project.value.projectRoot, "agent");
  if (!chatId) return { status: "failed", message: "Could not create operator chat" };
  await ensureAgentChat(chatId, project.value.projectRoot, provider, model.value, {
    engine: loadAgentEngine(),
    effort: loadAgentEfforts()[provider] ?? null,
    mode: loadAgentModes()[provider] ?? null,
  });
  return { status: "done", summary: "Created Operator chat" };
}

async function runSendPromptIntent(
  facts: ExecutionFacts,
  action: Extract<OperatorIntent["action"], { action: "sendPrompt" }>,
): Promise<DispatchResultDraft> {
  if (action.chat) {
    const chat = await chatForFacts(facts, action.chat);
    if (!chat.ok) return { status: "failed", message: chat.message };
    return sendToChat(chat.value, action.prompt);
  }
  const chat = activeChatForFacts(facts);
  if (!chat.ok) return { status: "failed", message: chat.message };
  return sendToChat(chat.value, action.prompt);
}

async function runStartSwarmIntent(
  facts: ExecutionFacts,
  action: Extract<OperatorIntent["action"], { action: "startSwarm" }>,
): Promise<DispatchResultDraft> {
  const project = facts.project;
  if (!project.ok) return { status: "failed", message: project.message };
  const providerPreference = action.provider === "claude" ? "claudeCode" : action.provider;
  const runId = await startSwarmRun(project.value.projectRoot, action.goal, {
    mode: action.mode,
    count: action.count,
    providerPreference,
  });
  return { status: "done", summary: `Started swarm ${runId}` };
}

async function runInterruptRunIntent(
  facts: ExecutionFacts,
  action: Extract<OperatorIntent["action"], { action: "interruptRun" }>,
): Promise<DispatchResultDraft> {
  const chat = await resolveRunChatFacts(facts, action.run);
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

async function runSteerRunIntent(
  facts: ExecutionFacts,
  action: Extract<OperatorIntent["action"], { action: "steerRun" }>,
): Promise<DispatchResultDraft> {
  const chat = await resolveRunChatFacts(facts, action.run);
  if (!chat.ok) return { status: "failed", message: chat.message };
  const target = agentTarget(chat.value);
  if (!target.ok) return { status: "failed", message: target.message };
  await steerAgentChat(chat.value.chatId, action.instruction);
  return { status: "done", summary: `Steered ${chat.value.title}` };
}

// OperatorAction's discriminated union has 16 "action" variants; a switch is the standard
// exhaustiveness-checked way to dispatch one in TypeScript (ESLint counts every case uniformly
// regardless of body size), and every case with real branching is already extracted into its own
// run*Intent helper above. A lookup-table dispatch would trade compiler-enforced exhaustiveness
// for a runtime lookup plus an unsafe cast — a real design tradeoff, not just more extraction effort.
// eslint-disable-next-line complexity -- TODO(#263): see comment above.
async function runIntent(
  facts: ExecutionFacts,
  inputText: string | undefined,
  auditId: string,
): Promise<DispatchResultDraft> {
  const action = facts.intent.action;

  switch (action.action) {
    case "openProject":
      return runOpenProjectIntent(facts);
    case "openChat":
      return runOpenChatIntent(facts, inputText, action);
    case "createChat":
      return runCreateChatIntent(facts, action);
    case "sendPrompt":
      return runSendPromptIntent(facts, action);
    case "startSwarm":
      return runStartSwarmIntent(facts, action);
    case "swarmStatus": {
      const project = facts.project;
      if (!project.ok) return { status: "failed", message: project.message };
      return { status: "done", summary: swarmSummary(project.value.projectRoot) };
    }
    case "interruptRun":
      return runInterruptRunIntent(facts, action);
    case "steerRun":
      return runSteerRunIntent(facts, action);
    case "launchEmulator":
      return launchEmulatorIntent(facts, action.device);
    case "launchRun":
      return launchRunIntent(facts, action.target);
    case "reloadRun":
      return runControlIntent(facts, "reloadRun");
    case "stopRun":
      return runControlIntent(facts, "stopRun");
    case "hotRestart":
      return runControlIntent(facts, "hotRestart");
    case "enterSelectMode":
      return enterSelectModeIntent(facts);
    case "takeScreenshot":
      return takeScreenshotIntent(facts);
    case "selectWidget":
      return selectWidgetIntent(facts, action.description, auditId);
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
      null,
    );
  }

  // The one execution transaction: every mutable Project/target/device/chat
  // fact this dispatch can depend on is captured HERE, synchronously, before
  // the first await below (the audit insert). A Project switch (or a
  // target/device/chat change for the same Project) during that await, or
  // during any await inside an action helper, can never retarget this
  // dispatch's audit attribution or execution — everything downstream reads
  // `facts`, never live store state.
  const facts = captureExecutionFacts(intent);
  const projectRoot = auditProjectRootFor(facts);

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
      facts,
    );
  }

  let auditId: string;
  // A confirmed reuse consumes the facts captured at PREVIEW time (kept in
  // `pendingExecutionFacts` since the preview's audit insert), so the
  // confirmed execution matches exactly what was audited/shown to the user —
  // not whatever Project happens to be active now. Falls back to this call's
  // own freshly captured facts if the preview's were never recorded (e.g. an
  // externally supplied reuseAuditId).
  let execFacts = facts;
  try {
    if (opts.reuseAuditId) {
      auditId = opts.reuseAuditId;
      const pending = pendingExecutionFacts.get(auditId);
      if (pending) {
        execFacts = pending;
        pendingExecutionFacts.delete(auditId);
      }
    } else {
      auditId = await insertAudit(intent, tier, projectRoot, opts.inputText);
    }
  } catch (error) {
    return { status: "failed", message: errorText(error) };
  }

  try {
    const result = await runIntent(execFacts, opts.inputText, auditId);
    const auditedResult: DispatchResult = result.status === "needsConfirmation"
      ? { ...result, auditId }
      : result;
    await noteAuditUpdateFailure(auditId, auditStatusFor(auditedResult), resultText(auditedResult));
    return auditedResult;
  } catch (error) {
    const message = errorText(error);
    await noteAuditUpdateFailure(auditId, "failed", message);
    return { status: "failed", message };
  }
}
