import type { AgentProvider } from "../lib/agentChat";
import * as db from "../lib/db";
import type { Chat, Project } from "../lib/db";
import { riskTier, type OperatorAction, type OperatorIntent } from "../lib/operatorIntent";
import { flagEnabled } from "./flags";
import {
  agentChat,
  ensureAgentChat,
  interruptAgentChat,
  sendAgentMessage,
  steerAgentChat,
} from "./agentChat";
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
  return resolveReference(
    "Chat",
    chatRef,
    chats,
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
    case "launchRun":
    case "reloadRun":
    case "enterSelectMode":
    case "takeScreenshot":
      return `${action.action} is planned for #140`;
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

async function chatToOpen(intent: OperatorIntent, chatRef: string | null): Promise<Resolution<Chat>> {
  const project = await projectFor(intent);
  if (!project.ok) return project;
  if (chatRef) return resolveChatReference(project.value.projectRoot, chatRef);

  await ensureChatsLoaded(project.value.projectRoot);
  const chats = chatsFor(project.value.projectRoot);
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

async function sendToChat(chat: Chat, prompt: string): Promise<DispatchResult> {
  const target = agentTarget(chat);
  if (!target.ok) return { status: "failed", message: target.message };
  const state = agentChat(chat.chatId);
  if (!state?.sessionId) {
    await ensureAgentChat(
      chat.chatId,
      chat.projectRoot,
      target.value.provider,
      state?.model ?? null,
    );
  }
  await sendAgentMessage(chat.chatId, prompt);
  return { status: "done", summary: `Sent prompt to ${chat.title}` };
}

async function resolveRunChat(intent: OperatorIntent, runRef: string | null): Promise<Resolution<Chat>> {
  if (!runRef) return activeChat();
  return chatFor(intent, runRef);
}

function swarmSummary(): string {
  const runs = swarmRuns();
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

function unsupported(action: OperatorAction): DispatchResult | null {
  switch (action.action) {
    case "launchEmulator":
    case "launchRun":
    case "reloadRun":
    case "enterSelectMode":
    case "takeScreenshot":
      return { status: "unsupported", message: `${action.action} is planned for #140` };
    case "selectWidget":
      return { status: "unsupported", message: "selectWidget is planned for #142" };
    default:
      return null;
  }
}

async function runIntent(intent: OperatorIntent): Promise<DispatchResult> {
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
      const chat = await chatToOpen(intent, action.chat);
      if (!chat.ok) return { status: "failed", message: chat.message };
      selectChat(chat.value.chatId);
      return { status: "done", summary: `Opened chat ${chat.value.title}` };
    }
    case "createChat": {
      const project = await projectFor(intent);
      if (!project.ok) return { status: "failed", message: project.message };
      const provider = agentProviderFromIntent(action.provider);
      const chatId = await addChat("Operator chat", provider, project.value.projectRoot, "agent");
      if (!chatId) return { status: "failed", message: "Could not create operator chat" };
      await ensureAgentChat(chatId, project.value.projectRoot, provider, action.model);
      return { status: "done", summary: "Created Operator chat" };
    }
    case "sendPrompt": {
      if (action.chat) {
        const chat = await chatFor(intent, action.chat);
        if (!chat.ok) return { status: "failed", message: chat.message };
        return sendToChat(chat.value, action.prompt);
      }
      const chat = activeChat();
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
    case "swarmStatus":
      return { status: "done", summary: swarmSummary() };
    case "interruptRun": {
      const chat = await resolveRunChat(intent, action.run);
      if (!chat.ok) return { status: "failed", message: chat.message };
      const target = agentTarget(chat.value);
      if (!target.ok) return { status: "failed", message: target.message };
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
    case "launchRun":
    case "reloadRun":
    case "enterSelectMode":
    case "takeScreenshot":
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
    const result = await runIntent(intent);
    await finishAudit(auditId, auditStatusFor(result), resultText(result));
    return result;
  } catch (error) {
    const message = errorText(error);
    await finishAudit(auditId, "failed", message);
    return { status: "failed", message };
  }
}
