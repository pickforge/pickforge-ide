// Dockable workbench layout (localStorage; no DB migration). Two docks (left /
// right) each hold an ordered list of panes; panes can be collapsed, reordered,
// or moved between docks. Dock widths are drag-resizable and each dock can be
// hidden (with a reveal affordance). The center terminal column is never a pane,
// so terminal hosts are never remounted by layout changes.
import { createSignal } from "solid-js";

export type PaneId = "projects" | "chats" | "files" | "sourceControl" | "inspector";
export type DockId = "left" | "right";

export const PANE_TITLES: Record<PaneId, string> = {
  projects: "Projects",
  chats: "Chats",
  files: "Files",
  sourceControl: "Source control",
  inspector: "Inspector",
};

const ALL_PANES: PaneId[] = ["projects", "chats", "files", "sourceControl", "inspector"];
const DEFAULT_DOCK: Record<PaneId, DockId> = {
  projects: "left",
  chats: "left",
  files: "left",
  sourceControl: "right",
  inspector: "right",
};

export interface LayoutState {
  leftWidth: number;
  rightWidth: number;
  leftVisible: boolean;
  rightVisible: boolean;
  docks: Record<DockId, PaneId[]>;
  collapsed: Partial<Record<PaneId, boolean>>;
}

const KEY = "pickforge.workbenchLayout";
const MIN_W = 180;
const MAX_W = 600;

const DEFAULTS: LayoutState = {
  leftWidth: 260,
  rightWidth: 320,
  leftVisible: true,
  rightVisible: true,
  docks: { left: ["projects", "chats", "files"], right: ["sourceControl", "inspector"] },
  collapsed: {},
};

const clampW = (n: number) => Math.min(MAX_W, Math.max(MIN_W, Math.round(n)));

function normalize(input: Partial<LayoutState>): LayoutState {
  const left = (input.docks?.left ?? []).filter((p): p is PaneId => ALL_PANES.includes(p));
  const right = (input.docks?.right ?? []).filter((p): p is PaneId => ALL_PANES.includes(p));
  const seen = new Set<PaneId>();
  const dedupe = (list: PaneId[]) => list.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
  const docks = { left: dedupe(left), right: dedupe(right) };
  // Any pane not placed yet (new pane / corrupt state) returns to its default dock.
  for (const p of ALL_PANES) {
    if (!seen.has(p)) docks[DEFAULT_DOCK[p]].push(p);
  }
  return {
    leftWidth: clampW(input.leftWidth ?? DEFAULTS.leftWidth),
    rightWidth: clampW(input.rightWidth ?? DEFAULTS.rightWidth),
    leftVisible: input.leftVisible !== false,
    rightVisible: input.rightVisible !== false,
    docks,
    collapsed: input.collapsed ?? {},
  };
}

function load(): LayoutState {
  try {
    const raw = localStorage.getItem(KEY);
    return normalize(raw ? JSON.parse(raw) : {});
  } catch {
    return normalize({});
  }
}

const [state, setState] = createSignal<LayoutState>(load());
export const layout = state;

function persist(next: LayoutState) {
  setState(next);
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function setDockWidth(dock: DockId, width: number) {
  persist({ ...state(), [dock === "left" ? "leftWidth" : "rightWidth"]: clampW(width) });
}
export function setDockVisible(dock: DockId, visible: boolean) {
  persist({ ...state(), [dock === "left" ? "leftVisible" : "rightVisible"]: visible });
}
export function toggleDock(dock: DockId) {
  setDockVisible(dock, dock === "left" ? !state().leftVisible : !state().rightVisible);
}
export function togglePaneCollapsed(pane: PaneId) {
  const s = state();
  persist({ ...s, collapsed: { ...s.collapsed, [pane]: !s.collapsed[pane] } });
}
export function isCollapsed(pane: PaneId): boolean {
  return !!state().collapsed[pane];
}

/** Move `pane` into `toDock` at `index` (clamped). Removes it from both docks
 *  first, so this also reorders within a dock. */
export function movePane(pane: PaneId, toDock: DockId, index: number) {
  const s = state();
  const docks: Record<DockId, PaneId[]> = {
    left: s.docks.left.filter((p) => p !== pane),
    right: s.docks.right.filter((p) => p !== pane),
  };
  const target = docks[toDock];
  const i = Math.max(0, Math.min(index, target.length));
  target.splice(i, 0, pane);
  // Never let a dock with content stay hidden after a drop.
  const vis =
    toDock === "left" ? { leftVisible: true } : { rightVisible: true };
  persist({ ...s, docks, ...vis });
}

export function resetLayout() {
  persist(normalize({}));
}
