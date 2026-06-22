import { beforeEach, describe, expect, it, vi } from "vitest";

// projectGrouping reads its state from localStorage at MODULE LOAD (top-level),
// so the global must exist before the (hoisted) import runs — set it in
// vi.hoisted. The store is pure (solid signal + localStorage), no Tauri runtime.
const mem = vi.hoisted(() => {
  const m = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return m;
});

import {
  assignProject,
  createGroup,
  groupOf,
  removeGroup,
} from "../../src/stores/projectGrouping";

beforeEach(() => {
  // Reset assignments between tests (groups created earlier persist in the
  // signal, but each test re-creates the groups it needs).
  mem.clear();
});

describe("projectGrouping — assignment round-trip", () => {
  it("ungrouped projects resolve to null", () => {
    expect(groupOf("/a")).toBeNull();
  });

  it("assigning a project to a group reflects in groupOf", () => {
    const g = createGroup("Work");
    assignProject("/a", g);
    expect(groupOf("/a")).toBe(g);
  });

  it("reassigning a project to a different group moves it (the cross-group drop case)", () => {
    const g1 = createGroup("One");
    const g2 = createGroup("Two");
    assignProject("/a", g1);
    expect(groupOf("/a")).toBe(g1);
    // Dropping onto a row in another group reassigns to that group.
    assignProject("/a", g2);
    expect(groupOf("/a")).toBe(g2);
  });

  it("assigning null returns a project to Ungrouped", () => {
    const g = createGroup("One");
    assignProject("/a", g);
    assignProject("/a", null);
    expect(groupOf("/a")).toBeNull();
  });

  it("a stale group id resolves to null after the group is removed", () => {
    const g = createGroup("Temp");
    assignProject("/a", g);
    removeGroup(g);
    expect(groupOf("/a")).toBeNull();
  });
});
