import { createStore, produce, reconcile } from "solid-js/store";
import {
  agentUsageSummary,
  orchestraTaskDelete,
  orchestraTasksList,
  orchestraTaskUpsert,
  type AgentUsageSummary,
  type OrchestraTask,
} from "../lib/orchestra";
import { errorText } from "../lib/errors";

export const MAX_LANES = 5;
const ALL_USAGE_KEY = "__all__";
// Guard against pathological persisted trees: a well-formed 4-leaf tree is at
// most 3 splits deep; give generous headroom before we bail on a corrupt blob.
const MAX_LANE_DEPTH = 12;

export type OrchestraLayout = "columns" | "rows" | "grid"; // now presets, not a mode
const LAYOUTS: OrchestraLayout[] = ["columns", "rows", "grid"];

// The lane arrangement is a binary split tree — the same model the embedded
// terminal uses (see TerminalHost.tsx). Leaves are chat ids; splits carry a
// row/col axis and a live ratio. Chat ids are stable keys, so rearranging a lane
// repositions it (never remounts the chat, which would lose composer/scroll).
export type LaneDir = "left" | "right" | "up" | "down";
export type LaneRegion = LaneDir | "center";
export interface LaneLeaf {
  kind: "leaf";
  chatId: string;
}
export interface LaneSplit {
  kind: "split";
  id: string;
  dir: "row" | "col";
  ratio: number;
  a: LaneNode;
  b: LaneNode;
}
export type LaneNode = LaneLeaf | LaneSplit;

let laneSplitCounter = 0;
function newLaneSplitId(): string {
  return `lsplit-${laneSplitCounter++}`;
}
function laneLeaf(chatId: string): LaneLeaf {
  return { kind: "leaf", chatId };
}

function clampRatio(ratio: number): number {
  return Math.min(0.85, Math.max(0.15, ratio));
}

// Deep-clone into plain objects. Tree ops reuse existing subtree references
// (which, read back from the store, are proxies); cloning before persisting
// keeps reconcile from tripping over proxy identity / cycles.
function cloneLaneNode(node: LaneNode | null): LaneNode | null {
  if (!node) return null;
  if (node.kind === "leaf") return { kind: "leaf", chatId: node.chatId };
  return {
    kind: "split",
    id: node.id,
    dir: node.dir,
    ratio: node.ratio,
    a: cloneLaneNode(node.a)!,
    b: cloneLaneNode(node.b)!,
  };
}

function collectLaneChatIds(node: LaneNode | null, out: string[] = []): string[] {
  if (!node) return out;
  if (node.kind === "leaf") out.push(node.chatId);
  else {
    collectLaneChatIds(node.a, out);
    collectLaneChatIds(node.b, out);
  }
  return out;
}

/** Replace the targeted leaf with a split that adds `fresh` on the given side. */
function splitLaneTree(node: LaneNode, targetChatId: string, dir: LaneDir, fresh: LaneNode): LaneNode {
  if (node.kind === "leaf") {
    if (node.chatId !== targetChatId) return node;
    const horizontal = dir === "left" || dir === "right";
    const newFirst = dir === "left" || dir === "up";
    return {
      kind: "split",
      id: newLaneSplitId(),
      dir: horizontal ? "row" : "col",
      ratio: 0.5,
      a: newFirst ? fresh : node,
      b: newFirst ? node : fresh,
    };
  }
  return {
    ...node,
    a: splitLaneTree(node.a, targetChatId, dir, fresh),
    b: splitLaneTree(node.b, targetChatId, dir, fresh),
  };
}

/** Remove a leaf, collapsing its parent split into the surviving sibling. */
function removeLaneLeaf(node: LaneNode, chatId: string): LaneNode | null {
  if (node.kind === "leaf") return node.chatId === chatId ? null : node;
  const a = removeLaneLeaf(node.a, chatId);
  const b = removeLaneLeaf(node.b, chatId);
  if (a === null) return b;
  if (b === null) return a;
  if (a === node.a && b === node.b) return node;
  return { ...node, a, b };
}

/** Clone only the path to `splitId`, updating its ratio (leaf refs preserved). */
function setLaneRatio(node: LaneNode, splitId: string, ratio: number): LaneNode {
  if (node.kind === "leaf") return node;
  if (node.id === splitId) return { ...node, ratio };
  return { ...node, a: setLaneRatio(node.a, splitId, ratio), b: setLaneRatio(node.b, splitId, ratio) };
}

/** Rebuild the tree, swapping chat ids at leaves — used to swap two lanes. */
function mapLaneLeaves(node: LaneNode, fn: (chatId: string) => string): LaneNode {
  if (node.kind === "leaf") return { kind: "leaf", chatId: fn(node.chatId) };
  return { ...node, a: mapLaneLeaves(node.a, fn), b: mapLaneLeaves(node.b, fn) };
}

/** Structural equality ignoring ids/ratios (leaf order is positional). */
function sameLaneShape(a: LaneNode, b: LaneNode): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "leaf") return true;
  const bs = b as LaneSplit;
  return a.dir === bs.dir && sameLaneShape(a.a, bs.a) && sameLaneShape(a.b, bs.b);
}

// ---- preset tree builders (right-leaning chains keep lanes equal) ----
function buildChain(chatIds: string[], dir: "row" | "col", genId: () => string): LaneNode | null {
  if (chatIds.length === 0) return null;
  if (chatIds.length === 1) return laneLeaf(chatIds[0]);
  const [head, ...rest] = chatIds;
  return {
    kind: "split",
    id: genId(),
    dir,
    // head takes 1/n; the remaining chain fills (n-1)/n and subdivides equally.
    ratio: 1 / chatIds.length,
    a: laneLeaf(head),
    b: buildChain(rest, dir, genId)!,
  };
}

function buildGrid(chatIds: string[], genId: () => string): LaneNode | null {
  const n = chatIds.length;
  if (n <= 2) return buildChain(chatIds, "row", genId);
  const row = (a: string, b: string): LaneSplit => ({
    kind: "split",
    id: genId(),
    dir: "row",
    ratio: 0.5,
    a: laneLeaf(a),
    b: laneLeaf(b),
  });
  if (n === 3) {
    return {
      kind: "split",
      id: genId(),
      dir: "col",
      ratio: 0.5,
      a: row(chatIds[0], chatIds[1]),
      b: laneLeaf(chatIds[2]),
    };
  }
  if (n === 4) {
    return {
      kind: "split",
      id: genId(),
      dir: "col",
      ratio: 0.5,
      a: row(chatIds[0], chatIds[1]),
      b: row(chatIds[2], chatIds[3]),
    };
  }
  return {
    kind: "split",
    id: genId(),
    dir: "col",
    ratio: 0.5,
    a: row(chatIds[0], chatIds[1]),
    b: buildChain(chatIds.slice(2), "row", genId)!,
  };
}

function buildPreset(chatIds: string[], preset: OrchestraLayout, genId: () => string): LaneNode | null {
  if (preset === "rows") return buildChain(chatIds, "col", genId);
  if (preset === "grid") return buildGrid(chatIds, genId);
  return buildChain(chatIds, "row", genId);
}

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
  laneTreeByRoot: Record<string, LaneNode | null>;
  usageByRoot: Record<string, OrchestraUsageState>;
}

const [state, setState] = createStore<OrchestraState>({
  tasksByRoot: {},
  laneTreeByRoot: {},
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

function laneTreeKey(projectRoot: string): string {
  return `pickforge.orchestraLanes.v2.${projectRoot}`;
}
function legacyLanesKey(projectRoot: string): string {
  return `pickforge.orchestraLanes.${projectRoot}`;
}
function legacyLayoutKey(projectRoot: string): string {
  return `pickforge.orchestraLayout.${projectRoot}`;
}

function normalizeChatIds(chatIds: unknown[]): string[] {
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

function sanitizeLeafNode(node: Record<string, unknown>, seen: Set<string>): LaneNode | null {
  const chatId = node.chatId;
  if (typeof chatId !== "string" || chatId.length === 0 || seen.has(chatId)) return null;
  if (seen.size >= MAX_LANES) return null;
  seen.add(chatId);
  return { kind: "leaf", chatId };
}

function sanitizeSplitNode(
  node: Record<string, unknown>,
  seen: Set<string>,
  depth: number,
): LaneNode | null {
  const dir = node.dir === "col" ? "col" : node.dir === "row" ? "row" : null;
  if (!dir) return null;
  const a = sanitizeLaneNode(node.a, seen, depth + 1);
  const b = sanitizeLaneNode(node.b, seen, depth + 1);
  if (!a) return b; // collapse into the surviving child
  if (!b) return a;
  const ratio =
    typeof node.ratio === "number" && Number.isFinite(node.ratio) ? clampRatio(node.ratio) : 0.5;
  return { kind: "split", id: newLaneSplitId(), dir, ratio, a, b };
}

// Sanitize whatever we load: drop unknown shapes, prune duplicate/empty chat
// ids, clamp ratios, and cap the lane count — collapsing splits whose children
// were dropped. `seen` enforces dedup + the lane cap across the whole tree.
function sanitizeLaneNode(raw: unknown, seen: Set<string>, depth: number): LaneNode | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;
  if (node.kind === "leaf") return sanitizeLeafNode(node, seen);
  if (node.kind === "split" && depth < MAX_LANE_DEPTH) return sanitizeSplitNode(node, seen, depth);
  return null;
}

// On first load without a v2 tree, migrate the legacy flat lanes + layout mode
// into the equivalent split tree (columns → row chain, rows → col chain, grid →
// 2×2). The caller persists the result to v2 and removes the v1 keys.
function migrateLegacyLanes(projectRoot: string): LaneNode | null {
  try {
    const rawLanes = localStorage.getItem(legacyLanesKey(projectRoot));
    if (!rawLanes) return null;
    const parsed = JSON.parse(rawLanes);
    if (!Array.isArray(parsed)) return null;
    const chatIds = normalizeChatIds(parsed);
    if (chatIds.length === 0) return null;
    const rawLayout = localStorage.getItem(legacyLayoutKey(projectRoot));
    const layout: OrchestraLayout =
      typeof rawLayout === "string" && (LAYOUTS as string[]).includes(rawLayout)
        ? (rawLayout as OrchestraLayout)
        : "columns";
    return buildPreset(chatIds, layout, newLaneSplitId);
  } catch {
    return null;
  }
}

function loadLaneTree(projectRoot: string): LaneNode | null {
  try {
    const raw = localStorage.getItem(laneTreeKey(projectRoot));
    if (raw) return sanitizeLaneNode(JSON.parse(raw), new Set(), 0);
  } catch {
    /* fall through to legacy migration */
  }
  const migrated = migrateLegacyLanes(projectRoot);
  // Persist the migrated tree under v2 immediately AND drop the v1 keys —
  // otherwise removing the last lane (which deletes the v2 key) would fall back
  // to migration on the next load and resurrect lanes the user just deleted.
  if (migrated) {
    try {
      localStorage.setItem(laneTreeKey(projectRoot), JSON.stringify(migrated));
      localStorage.removeItem(legacyLanesKey(projectRoot));
      localStorage.removeItem(legacyLayoutKey(projectRoot));
    } catch {
      /* a failed write just means we migrate again next load */
    }
  }
  return migrated;
}

function ensureLaneTree(projectRoot: string) {
  if (!(projectRoot in state.laneTreeByRoot)) {
    setState("laneTreeByRoot", projectRoot, loadLaneTree(projectRoot));
  }
}

function persistLaneTree(projectRoot: string, tree: LaneNode | null) {
  const plain = cloneLaneNode(tree);
  // reconcile (not a plain set) so an object→object update REPLACES the tree
  // rather than shallow-merging stale split keys onto a new leaf, and so leaf
  // rects stay fine-grained-reactive when only a ratio changes.
  setState("laneTreeByRoot", projectRoot, reconcile(plain));
  if (plain) localStorage.setItem(laneTreeKey(projectRoot), JSON.stringify(plain));
  else localStorage.removeItem(laneTreeKey(projectRoot));
}

export function laneTree(projectRoot: string): LaneNode | null {
  ensureLaneTree(projectRoot);
  return state.laneTreeByRoot[projectRoot] ?? null;
}

/** Leaves in tree order — the selected lanes for this project. */
export function selectedLanes(projectRoot: string): string[] {
  return collectLaneChatIds(laneTree(projectRoot));
}

/** Rebuild the tree as columns from the list. */
export function setSelectedLanes(projectRoot: string, chatIds: string[]) {
  const ids = normalizeChatIds(chatIds);
  persistLaneTree(projectRoot, buildPreset(ids, "columns", newLaneSplitId));
}

/** Append a lane: the new leaf splits the whole tree on the RIGHT. */
export function addSelectedLane(projectRoot: string, chatId: string) {
  if (typeof chatId !== "string" || chatId.length === 0) return;
  const tree = laneTree(projectRoot);
  const current = collectLaneChatIds(tree);
  if (current.includes(chatId) || current.length >= MAX_LANES) return;
  const fresh = laneLeaf(chatId);
  if (!tree) {
    persistLaneTree(projectRoot, fresh);
    return;
  }
  persistLaneTree(projectRoot, {
    kind: "split",
    id: newLaneSplitId(),
    dir: "row",
    // existing tree keeps its share; the new single lane takes 1/(n+1).
    ratio: current.length / (current.length + 1),
    a: tree,
    b: fresh,
  });
}

/** Insert a lane directly beside `targetChatId` on the given side. */
export function addLaneAt(projectRoot: string, targetChatId: string, dir: LaneDir, chatId: string) {
  if (typeof chatId !== "string" || chatId.length === 0) return;
  const tree = laneTree(projectRoot);
  const current = collectLaneChatIds(tree);
  if (current.includes(chatId) || current.length >= MAX_LANES) return;
  if (!tree) {
    persistLaneTree(projectRoot, laneLeaf(chatId));
    return;
  }
  if (!current.includes(targetChatId)) {
    addSelectedLane(projectRoot, chatId); // stale target → fall back to append
    return;
  }
  persistLaneTree(projectRoot, splitLaneTree(tree, targetChatId, dir, laneLeaf(chatId)));
}

/** Remove a leaf, collapsing its parent split into the sibling. */
export function removeSelectedLane(projectRoot: string, chatId: string) {
  const tree = laneTree(projectRoot);
  if (!tree || !collectLaneChatIds(tree).includes(chatId)) return;
  persistLaneTree(projectRoot, removeLaneLeaf(tree, chatId));
}

export function clearProjectOrchestra(projectRoot: string) {
  if (!projectRoot) return;
  setState("tasksByRoot", produce((items) => { delete items[projectRoot]; }));
  setState("laneTreeByRoot", produce((items) => { delete items[projectRoot]; }));
  setState("usageByRoot", produce((items) => { delete items[projectRoot]; }));
  localStorage.removeItem(laneTreeKey(projectRoot));
  localStorage.removeItem(legacyLanesKey(projectRoot));
  localStorage.removeItem(legacyLayoutKey(projectRoot));
}

export async function removeChatFromOrchestra(projectRoot: string, chatId: string): Promise<void> {
  if (!projectRoot || !chatId) return;
  removeSelectedLane(projectRoot, chatId);

  const current = taskState(projectRoot);
  const tasks = current.loaded ? current.items : await loadTasks(projectRoot);
  const now = Date.now();
  await Promise.all(
    tasks
      .filter((task) => task.builderChatId === chatId || task.reviewerChatId === chatId)
      .map((task) =>
        upsertTask({
          ...task,
          builderChatId: task.builderChatId === chatId ? null : task.builderChatId,
          reviewerChatId: task.reviewerChatId === chatId ? null : task.reviewerChatId,
          updatedAt: now,
        }),
      ),
  );
}

/** center = swap the two lanes; edge = pull source out and re-split beside target. */
export function moveLane(
  projectRoot: string,
  sourceChatId: string,
  targetChatId: string,
  region: LaneRegion,
) {
  if (sourceChatId === targetChatId) return;
  const tree = laneTree(projectRoot);
  if (!tree) return;
  const ids = collectLaneChatIds(tree);
  if (!ids.includes(sourceChatId) || !ids.includes(targetChatId)) return;
  if (region === "center") {
    persistLaneTree(
      projectRoot,
      mapLaneLeaves(tree, (id) =>
        id === sourceChatId ? targetChatId : id === targetChatId ? sourceChatId : id,
      ),
    );
    return;
  }
  const without = removeLaneLeaf(tree, sourceChatId);
  if (!without) return;
  persistLaneTree(projectRoot, splitLaneTree(without, targetChatId, region, laneLeaf(sourceChatId)));
}

// Store-only: divider drags call this on every pointermove, so it skips the
// JSON.stringify + localStorage write. The view flushes once on pointerup via
// commitLaneLayout.
export function setLaneSplitRatio(projectRoot: string, splitId: string, ratio: number) {
  const tree = laneTree(projectRoot);
  if (!tree) return;
  const next = cloneLaneNode(setLaneRatio(tree, splitId, clampRatio(ratio)));
  setState("laneTreeByRoot", projectRoot, reconcile(next));
}

/** Flush the current tree to localStorage (call once when a drag ends). */
export function commitLaneLayout(projectRoot: string) {
  const plain = cloneLaneNode(laneTree(projectRoot));
  if (plain) localStorage.setItem(laneTreeKey(projectRoot), JSON.stringify(plain));
  else localStorage.removeItem(laneTreeKey(projectRoot));
}

/** Rebuild the tree from the current leaves into the chosen preset shape. */
export function applyLayoutPreset(projectRoot: string, preset: OrchestraLayout) {
  const chatIds = collectLaneChatIds(laneTree(projectRoot));
  persistLaneTree(projectRoot, buildPreset(chatIds, preset, newLaneSplitId));
}

/** Shape-detect the current tree for the toggle highlight; null = free-form. */
export function detectLayoutPreset(tree: LaneNode | null): OrchestraLayout | null {
  if (!tree) return null;
  const leaves = collectLaneChatIds(tree);
  for (const preset of LAYOUTS) {
    const canonical = buildPreset(leaves, preset, () => "");
    if (canonical && sameLaneShape(tree, canonical)) return preset;
  }
  return null;
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
