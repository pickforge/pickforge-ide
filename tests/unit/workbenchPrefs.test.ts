import { beforeEach, describe, expect, it, vi } from "vitest";

// workbenchPrefs loads its state from localStorage at MODULE LOAD (same
// pattern as `stores/scmCollapsed.ts`'s own test), so the global must exist
// before the (hoisted) import runs.
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

import { setDiffViewMode, workbenchPrefs } from "../../src/stores/workbenchPrefs";

async function reloadStore() {
  vi.resetModules();
  return import("../../src/stores/workbenchPrefs");
}

beforeEach(() => {
  mem.clear();
});

describe("workbenchPrefs — diffViewMode (#231 PR5, persisted)", () => {
  it("defaults to unified", () => {
    expect(workbenchPrefs().diffViewMode).toBe("unified");
  });

  it("persists a split preference across the setter and to localStorage", () => {
    setDiffViewMode("split");
    expect(workbenchPrefs().diffViewMode).toBe("split");
    expect(JSON.parse(mem.get("pickforge.workbenchPrefs")!)).toMatchObject({ diffViewMode: "split" });
  });

  it("reloads a persisted split preference on a fresh module load", async () => {
    mem.set("pickforge.workbenchPrefs", JSON.stringify({ diffViewMode: "split" }));
    const fresh = await reloadStore();
    expect(fresh.workbenchPrefs().diffViewMode).toBe("split");
  });

  it("never lets an unrecognized persisted value become anything but a known mode", async () => {
    mem.set("pickforge.workbenchPrefs", JSON.stringify({ diffViewMode: "garbage" }));
    const fresh = await reloadStore();
    expect(fresh.workbenchPrefs().diffViewMode).toBe("unified");
  });

  it("survives corrupt JSON in the persisted value by falling back to defaults", async () => {
    mem.set("pickforge.workbenchPrefs", "{not json");
    const fresh = await reloadStore();
    expect(fresh.workbenchPrefs().diffViewMode).toBe("unified");
  });
});
