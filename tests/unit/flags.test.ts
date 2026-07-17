import { beforeEach, describe, expect, it, vi } from "vitest";

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

const KEY = "pickforge.flags";

async function loadStore() {
  vi.resetModules();
  return import("../../src/stores/flags");
}

beforeEach(() => {
  mem.clear();
});

describe("flags", () => {
  it("registers all feature flags with v0.1.10 ship defaults", async () => {
    const store = await loadStore();

    const states = store.flagStates();
    expect(states.map((s) => s.key)).toEqual([
      "operator",
      "ompPiAgents",
      "remoteProjects",
      "remoteProcessLeases",
      "accounts",
      "settingsSync",
      "settingsNavigation",
      "dynamicChatTitles",
    ]);
    // Shipped in v0.1.10 (#210, #211); everything else stays dark.
    const shipped = new Set(["settingsNavigation", "dynamicChatTitles"]);
    for (const state of states) {
      expect(state.defaultValue).toBe(shipped.has(state.key));
      expect(state.enabled).toBe(shipped.has(state.key));
    }
    expect(store.flagEnabled("operator")).toBe(false);
    expect(store.flagEnabled("ompPiAgents")).toBe(false);
    expect(store.flagEnabled("remoteProjects")).toBe(false);
    expect(store.flagEnabled("remoteProcessLeases")).toBe(false);
    expect(store.flagEnabled("accounts")).toBe(false);
    expect(store.flagEnabled("settingsSync")).toBe(false);
    expect(store.flagEnabled("settingsNavigation")).toBe(true);
    expect(store.flagEnabled("dynamicChatTitles")).toBe(true);
  });

  it("persists an override to localStorage and reflects it", async () => {
    const store = await loadStore();

    store.setFlagOverride("operator", true);

    expect(store.flagEnabled("operator")).toBe(true);
    expect(JSON.parse(mem.get(KEY)!)).toEqual({ operator: true });
  });

  it("enables remote process leases only through its typed override", async () => {
    const store = await loadStore();

    expect(store.flagEnabled("remoteProcessLeases")).toBe(false);
    store.setFlagOverride("remoteProcessLeases", true);

    expect(store.flagEnabled("remoteProcessLeases")).toBe(true);
    expect(JSON.parse(mem.get(KEY)!)).toEqual({ remoteProcessLeases: true });
  });

  it("ignores corrupt localStorage content", async () => {
    mem.set(KEY, "{");

    const store = await loadStore();

    expect(store.flagEnabled("operator")).toBe(false);
    expect(store.flagStates().every((s) => s.enabled === s.defaultValue)).toBe(true);
  });

  it("drops non-boolean values from stored overrides", async () => {
    mem.set(KEY, JSON.stringify({ operator: "yes", accounts: 1, remoteProjects: true }));

    const store = await loadStore();

    expect(store.flagEnabled("operator")).toBe(false);
    expect(store.flagEnabled("accounts")).toBe(false);
    expect(store.flagEnabled("remoteProjects")).toBe(true);
  });

  it("clears an override back to the default", async () => {
    const store = await loadStore();

    store.setFlagOverride("settingsSync", true);
    expect(store.flagEnabled("settingsSync")).toBe(true);

    store.setFlagOverride("settingsSync", undefined);
    expect(store.flagEnabled("settingsSync")).toBe(false);
    expect(JSON.parse(mem.get(KEY)!)).toEqual({});
  });
});
