import { beforeEach, describe, expect, it, vi } from "vitest";

// scmCollapsed loads its set from localStorage at MODULE LOAD, so the global
// must exist before the (hoisted) import runs.
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
  isScmCollapsed,
  scmCollapsedPaths,
  toggleScmCollapsed,
} from "../../src/stores/scmCollapsed";

beforeEach(() => {
  mem.clear();
  // Reset the in-memory signal to empty by toggling any leftover paths off.
  for (const p of [...scmCollapsedPaths()]) toggleScmCollapsed(p);
});

describe("scmCollapsed — per-repo collapse, persisted", () => {
  it("defaults every repo to expanded", () => {
    expect(isScmCollapsed("/a/api")).toBe(false);
  });

  it("toggles a path collapsed then expanded again", () => {
    toggleScmCollapsed("/a/api");
    expect(isScmCollapsed("/a/api")).toBe(true);
    // Other repos are unaffected.
    expect(isScmCollapsed("/a/app")).toBe(false);
    toggleScmCollapsed("/a/api");
    expect(isScmCollapsed("/a/api")).toBe(false);
  });

  it("persists the collapsed set to localStorage", () => {
    toggleScmCollapsed("/a/api");
    expect(JSON.parse(mem.get("pickforge.scmCollapsed")!)).toEqual(["/a/api"]);
  });
});
