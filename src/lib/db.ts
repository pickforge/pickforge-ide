// Typed client for the SQLite-backed Tauri commands. Interfaces mirror
// pickforge-core's row models (camelCase). Timestamps are Unix-ms.
import { invoke } from "@tauri-apps/api/core";

export interface Project {
  projectRoot: string;
  displayName: string;
  createdAt: number;
  lastOpenedAt: number;
  sortOrder: number;
  archivedAt: number | null;
  remoteHost: string | null;
  remoteRoot: string | null;
}

export type ChatTitleSource = "default" | "auto" | "user";

export interface Chat {
  chatId: string;
  projectRoot: string;
  title: string;
  titleSource: ChatTitleSource;
  titleUpdatedAt: number;
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
}

export interface PickHistory {
  id: number;
  projectRoot: string;
  widgetClass: string;
  creationFile: string | null;
  creationLine: number | null;
  skillId: string;
  agentId: string;
  terminalId: string;
  chatId: string | null;
  pickedAt: number;
  widgetContextJson: string;
}

export interface RunSessionLog {
  sessionId: string;
  projectRoot: string;
  startedAt: number;
  endedAt: number | null;
  avdId: string | null;
  avdName: string | null;
  serial: string | null;
  vmServiceUrl: string | null;
  targetFile: string | null;
  connectionMode: string;
  exitReason: string | null;
  exitCode: number | null;
  hotReloadCount: number;
  hotRestartCount: number;
  errorCount: number;
  lastError: string | null;
}

export interface AgentRunLog {
  id: number;
  pickId: number;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  hotReloadCount: number;
  wrapperScriptPath: string;
}

export interface AgentSessionRow {
  id: string;
  chatId: string;
  provider: string;
  providerSessionId: string | null;
  model: string | null;
  status: string;
  createdAt: number;
}

export interface OperatorAuditRow {
  id: string;
  createdAt: number;
  projectRoot: string | null;
  inputText: string;
  intentJson: string;
  riskTier: number;
  status: "started" | "done" | "failed" | "denied" | "needs_confirmation" | "noop";
  result: string | null;
}

// ---- projects ----
export const projectsList = (includeArchived = false) =>
  invoke<Project[]>("projects_list", { includeArchived });
export const projectUpsert = (project: Project) =>
  invoke<void>("project_upsert", { project });
export const projectSetArchived = (root: string, archivedAt: number | null) =>
  invoke<void>("project_set_archived", { root, archivedAt });
export const projectTouch = (root: string, ts: number) =>
  invoke<void>("project_touch", { root, ts });
export const projectDelete = (root: string) =>
  invoke<void>("project_delete", { root });
/** Narrow sort_order write (project reorder) — touches only sort_order. */
export const updateProjectSortOrder = (root: string, sortOrder: number) =>
  invoke<void>("update_project_sort_order", { root, sortOrder });
export const projectRemoteSet = (
  projectRoot: string,
  host: string,
  remoteRoot: string,
) => invoke<void>("project_remote_set", { projectRoot, host, remoteRoot });
export const projectRemoteClear = (projectRoot: string) =>
  invoke<void>("project_remote_clear", { projectRoot });

// ---- chats ----
export const chatsList = (projectRoot: string) =>
  invoke<Chat[]>("chats_list", { projectRoot });
export const chatUpsert = (chat: Chat) => invoke<void>("chat_upsert", { chat });
export const chatDelete = (chatId: string) =>
  invoke<void>("chat_delete", { chatId });
/** Narrow title write; returns whether the durable write was applied. */
export const updateChatTitle = (
  chatId: string,
  title: string,
  metadata?: { titleSource: ChatTitleSource; titleUpdatedAt: number },
) =>
  invoke<boolean>("update_chat_title", {
    chatId,
    title,
    titleSource: metadata?.titleSource,
    titleUpdatedAt: metadata?.titleUpdatedAt,
  });
/** Narrow ownership-only write; returns whether the monotonic write applied. */
export const updateChatTitleOwnership = (
  chatId: string,
  titleSource: ChatTitleSource,
  titleUpdatedAt: number,
) => invoke<boolean>("update_chat_title_ownership", { chatId, titleSource, titleUpdatedAt });
/** Narrow agent/kind write; leaves title ownership and every other field untouched. */
export const updateChatAgent = (chatId: string, agentId: string, kind: string) =>
  invoke<void>("update_chat_agent", { chatId, agentId, kind });
/** Narrow session_id write (chat recovery) — pass null to clear. */
export const updateChatSessionId = (chatId: string, sessionId: string | null) =>
  invoke<void>("update_chat_session_id", { chatId, sessionId });
/** Narrow sort_order write (reorder) — won't clobber a live session_id. */
export const updateChatSortOrder = (chatId: string, sortOrder: number) =>
  invoke<void>("update_chat_sort_order", { chatId, sortOrder });

// ---- history ----
export const picksList = (projectRoot: string, limit = 100) =>
  invoke<PickHistory[]>("picks_list", { projectRoot, limit });
export const pickInsert = (pick: PickHistory) =>
  invoke<number>("pick_insert", { pick });
export const runsList = (projectRoot: string, limit = 100) =>
  invoke<RunSessionLog[]>("runs_list", { projectRoot, limit });
export const runInsert = (run: RunSessionLog) =>
  invoke<void>("run_insert", { run });
export const runFinish = (
  sessionId: string,
  endedAt: number,
  exitReason: string | null,
  exitCode: number | null,
) => invoke<void>("run_finish", { sessionId, endedAt, exitReason, exitCode });
export const agentRunInsert = (run: AgentRunLog) =>
  invoke<number>("agent_run_insert", { run });
export const agentSessionLatestForChat = (chatId: string) =>
  invoke<AgentSessionRow | null>("agent_session_latest_for_chat", { chatId });

// ---- operator audit ----
export const operatorAuditInsert = (row: OperatorAuditRow) =>
  invoke<void>("operator_audit_insert", { row });
export const operatorAuditUpdate = (
  id: string,
  status: OperatorAuditRow["status"],
  result: string | null,
) => invoke<void>("operator_audit_update", { id, status, result });
export const operatorAuditList = (limit = 100) =>
  invoke<OperatorAuditRow[]>("operator_audit_list", { limit });
