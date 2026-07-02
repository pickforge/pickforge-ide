import { createStore } from "solid-js/store";
import {
  agentUsageSummary,
  orchestraTaskDelete,
  orchestraTasksList,
  orchestraTaskUpsert,
  type AgentUsageSummary,
  type OrchestraTask,
} from "../lib/orchestra";

const MAX_LANES = 4;
const ALL_USAGE_KEY = "__all__";

export type OrchestraLayout = "columns" | "rows" | "grid";
const LAYOUTS: OrchestraLayout[] = ["columns", "rows", "grid"];

export interface OrchestraTaskListState {
  items: OrchestraTask[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

export interface OrchestraUsageState {
  items: AgentUsageSummary[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

export interface OrchestraState {
  tasksByRoot: Record<string, OrchestraTaskListState>;
  lanesByRoot: Record<string, string[]>;
  layoutByRoot: Record<string, OrchestraLayout>;
  usageByRoot: Record<string, OrchestraUsageState>;
}

const [state, setState] = createStore<OrchestraState>({
  tasksByRoot: {},
  lanesByRoot: {},
  layoutByRoot: {},
  usageByRoot: {},
});

export const orchestra = state;

let taskCounter = 0;

export function newTaskId(): string {
  taskCounter += 1;
  return `otask-${Date.now()}-${taskCounter}`;
}

function emptyTasks(): OrchestraTaskListState {
  return { items: [], loading: false, loaded: false, error: null };
}

function emptyUsage(): OrchestraUsageState {
  return { items: [], loading: false, loaded: false, error: null };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compareTasks(a: OrchestraTask, b: OrchestraTask): number {
  return (
    a.sortOrder - b.sortOrder ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id)
  );
}

function sortedTasks(tasks: OrchestraTask[]): OrchestraTask[] {
  return [...tasks].sort(compareTasks);
}

function upsertLocalTask(tasks: OrchestraTask[], task: OrchestraTask): OrchestraTask[] {
  return sortedTasks([...tasks.filter((item) => item.id !== task.id), task]);
}

function taskState(projectRoot: string): OrchestraTaskListState {
  return state.tasksByRoot[projectRoot] ?? emptyTasks();
}

function ensureTaskState(projectRoot: string) {
  if (!state.tasksByRoot[projectRoot]) setState("tasksByRoot", projectRoot, emptyTasks());
}

async function reloadTasksAfterError(
  projectRoot: string,
  fallback: OrchestraTask[],
  wasLoaded: boolean,
  error: unknown,
) {
  const message = errorText(error);
  try {
    const items = await orchestraTasksList(projectRoot);
    setState("tasksByRoot", projectRoot, {
      items: sortedTasks(items),
      loading: false,
      loaded: true,
      error: message,
    });
  } catch {
    setState("tasksByRoot", projectRoot, {
      items: fallback,
      loading: false,
      loaded: wasLoaded,
      error: message,
    });
  }
}

export function taskList(projectRoot: string): OrchestraTaskListState {
  return taskState(projectRoot);
}

export function tasksFor(projectRoot: string): OrchestraTask[] {
  return taskState(projectRoot).items;
}

export async function loadTasks(projectRoot: string): Promise<OrchestraTask[]> {
  ensureTaskState(projectRoot);
  setState("tasksByRoot", projectRoot, { loading: true, error: null });
  try {
    const items = sortedTasks(await orchestraTasksList(projectRoot));
    setState("tasksByRoot", projectRoot, {
      items,
      loading: false,
      loaded: true,
      error: null,
    });
    return items;
  } catch (error) {
    setState("tasksByRoot", projectRoot, { loading: false, error: errorText(error) });
    throw error;
  }
}

export async function upsertTask(task: OrchestraTask): Promise<void> {
  const projectRoot = task.projectRoot;
  ensureTaskState(projectRoot);
  const beforeState = taskState(projectRoot);
  const before = beforeState.items.slice();
  setState("tasksByRoot", projectRoot, {
    items: upsertLocalTask(before, task),
    error: null,
  });
  try {
    await orchestraTaskUpsert(task);
  } catch (error) {
    await reloadTasksAfterError(projectRoot, before, beforeState.loaded, error);
    throw error;
  }
}

export async function deleteTask(projectRoot: string, id: string): Promise<void> {
  ensureTaskState(projectRoot);
  const beforeState = taskState(projectRoot);
  const before = beforeState.items.slice();
  setState("tasksByRoot", projectRoot, {
    items: before.filter((task) => task.id !== id),
    error: null,
  });
  try {
    await orchestraTaskDelete(id);
  } catch (error) {
    await reloadTasksAfterError(projectRoot, before, beforeState.loaded, error);
    throw error;
  }
}

function laneStorageKey(projectRoot: string): string {
  return `pickforge.orchestraLanes.${projectRoot}`;
}

function normalizeLanes(chatIds: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const chatId of chatIds) {
    if (typeof chatId !== "string" || chatId.length === 0 || seen.has(chatId)) continue;
    seen.add(chatId);
    next.push(chatId);
    if (next.length === MAX_LANES) break;
  }
  return next;
}

function loadLanes(projectRoot: string): string[] {
  try {
    const raw = localStorage.getItem(laneStorageKey(projectRoot));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? normalizeLanes(parsed) : [];
  } catch {
    return [];
  }
}

function ensureLanes(projectRoot: string) {
  if (!(projectRoot in state.lanesByRoot)) {
    setState("lanesByRoot", projectRoot, loadLanes(projectRoot));
  }
}

function persistLanes(projectRoot: string, next: string[]) {
  setState("lanesByRoot", projectRoot, next);
  localStorage.setItem(laneStorageKey(projectRoot), JSON.stringify(next));
}

export function selectedLanes(projectRoot: string): string[] {
  ensureLanes(projectRoot);
  return state.lanesByRoot[projectRoot] ?? [];
}

export function setSelectedLanes(projectRoot: string, chatIds: string[]) {
  persistLanes(projectRoot, normalizeLanes(chatIds));
}

export function addSelectedLane(projectRoot: string, chatId: string) {
  const current = selectedLanes(projectRoot);
  if (current.includes(chatId) || current.length >= MAX_LANES) return;
  persistLanes(projectRoot, normalizeLanes([...current, chatId]));
}

export function removeSelectedLane(projectRoot: string, chatId: string) {
  const current = selectedLanes(projectRoot);
  if (!current.includes(chatId)) return;
  persistLanes(projectRoot, current.filter((id) => id !== chatId));
}

export function reorderSelectedLane(projectRoot: string, fromIndex: number, toIndex: number) {
  const current = selectedLanes(projectRoot);
  if (fromIndex < 0 || fromIndex >= current.length || current.length < 2) return;
  const next = current.slice();
  const [item] = next.splice(fromIndex, 1);
  const target = Math.max(0, Math.min(toIndex, next.length));
  next.splice(target, 0, item);
  persistLanes(projectRoot, next);
}

function layoutStorageKey(projectRoot: string): string {
  return `pickforge.orchestraLayout.${projectRoot}`;
}

function loadLayout(projectRoot: string): OrchestraLayout {
  try {
    const raw = localStorage.getItem(layoutStorageKey(projectRoot));
    return raw && (LAYOUTS as string[]).includes(raw) ? (raw as OrchestraLayout) : "columns";
  } catch {
    return "columns";
  }
}

function ensureLayout(projectRoot: string) {
  if (!(projectRoot in state.layoutByRoot)) {
    setState("layoutByRoot", projectRoot, loadLayout(projectRoot));
  }
}

export function selectedLayout(projectRoot: string): OrchestraLayout {
  ensureLayout(projectRoot);
  return state.layoutByRoot[projectRoot] ?? "columns";
}

export function setSelectedLayout(projectRoot: string, layout: OrchestraLayout) {
  setState("layoutByRoot", projectRoot, layout);
  localStorage.setItem(layoutStorageKey(projectRoot), layout);
}

function usageKey(projectRoot?: string | null): string {
  return projectRoot ?? ALL_USAGE_KEY;
}

function usageState(projectRoot?: string | null): OrchestraUsageState {
  return state.usageByRoot[usageKey(projectRoot)] ?? emptyUsage();
}

function ensureUsageState(projectRoot?: string | null) {
  const key = usageKey(projectRoot);
  if (!state.usageByRoot[key]) setState("usageByRoot", key, emptyUsage());
}

export function usageSummary(projectRoot?: string | null): OrchestraUsageState {
  return usageState(projectRoot);
}

export async function refreshUsage(projectRoot?: string | null): Promise<AgentUsageSummary[]> {
  const key = usageKey(projectRoot);
  ensureUsageState(projectRoot);
  setState("usageByRoot", key, { loading: true, error: null });
  try {
    const items = await agentUsageSummary(projectRoot ?? null);
    setState("usageByRoot", key, {
      items,
      loading: false,
      loaded: true,
      error: null,
    });
    return items;
  } catch (error) {
    setState("usageByRoot", key, { loading: false, error: errorText(error) });
    throw error;
  }
}
