// Project list view-mode (list/grid) + grouping. Kept in localStorage so it
// needs no DB/Rust migration; assignments are keyed by projectRoot.
import { createSignal } from "solid-js";

export type ProjectViewMode = "list" | "grid";
export interface ProjectGroup {
  id: string;
  name: string;
  collapsed: boolean;
}
interface GroupingState {
  viewMode: ProjectViewMode;
  groups: ProjectGroup[];
  assignments: Record<string, string>; // projectRoot -> groupId
}

const KEY = "pickforge.projectGrouping";
const empty: GroupingState = { viewMode: "list", groups: [], assignments: {} };

function load(): GroupingState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...empty };
    const p = JSON.parse(raw);
    return {
      viewMode: p.viewMode === "grid" ? "grid" : "list",
      groups: Array.isArray(p.groups) ? p.groups : [],
      assignments:
        p.assignments && typeof p.assignments === "object" ? p.assignments : {},
    };
  } catch {
    return { ...empty };
  }
}

const [state, setState] = createSignal<GroupingState>(load());
export const grouping = state;

function persist(next: GroupingState) {
  setState(next);
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function setViewMode(mode: ProjectViewMode) {
  persist({ ...state(), viewMode: mode });
}

export function createGroup(name = "New group"): string {
  const id = `grp-${Date.now()}`;
  persist({
    ...state(),
    groups: [...state().groups, { id, name: name.trim() || "New group", collapsed: false }],
  });
  return id;
}

export function renameGroup(id: string, name: string) {
  persist({
    ...state(),
    groups: state().groups.map((g) =>
      g.id === id ? { ...g, name: name.trim() || g.name } : g,
    ),
  });
}

export function toggleGroup(id: string) {
  persist({
    ...state(),
    groups: state().groups.map((g) =>
      g.id === id ? { ...g, collapsed: !g.collapsed } : g,
    ),
  });
}

/** Remove a group; its projects fall back to Ungrouped (never deleted). */
export function removeGroup(id: string) {
  const assignments = { ...state().assignments };
  for (const root of Object.keys(assignments)) {
    if (assignments[root] === id) delete assignments[root];
  }
  persist({
    ...state(),
    groups: state().groups.filter((g) => g.id !== id),
    assignments,
  });
}

export function assignProject(root: string, groupId: string | null) {
  const assignments = { ...state().assignments };
  if (groupId) assignments[root] = groupId;
  else delete assignments[root];
  persist({ ...state(), assignments });
}

/** The valid group id for a project, or null (Ungrouped / stale id). */
export function groupOf(root: string): string | null {
  const id = state().assignments[root];
  return id && state().groups.some((g) => g.id === id) ? id : null;
}
