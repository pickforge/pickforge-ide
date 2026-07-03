import { invoke } from "@tauri-apps/api/core";

export type OrchestraTaskStatus = "planned" | "building" | "reviewing" | "fixing" | "done";

export interface OrchestraTask {
  id: string;
  projectRoot: string;
  title: string;
  status: OrchestraTaskStatus;
  builderChatId: string | null;
  reviewerChatId: string | null;
  note: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentUsageSummary {
  provider: string;
  model: string | null;
  chats: number;
  turns: number | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export const orchestraTaskUpsert = (task: OrchestraTask) =>
  invoke<void>("orchestra_task_upsert", { task });

export const orchestraTaskDelete = (id: string) =>
  invoke<void>("orchestra_task_delete", { id });

export const orchestraTasksList = (projectRoot: string) =>
  invoke<OrchestraTask[]>("orchestra_tasks_list", { projectRoot });

export const agentUsageSummary = (projectRoot?: string | null) =>
  invoke<AgentUsageSummary[]>("agent_usage_summary", { projectRoot: projectRoot ?? null });
