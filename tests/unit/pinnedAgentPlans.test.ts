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

const KEY = "pickforge.pinnedAgentPlans";

async function loadStore() {
  vi.resetModules();
  return import("../../src/stores/pinnedAgentPlans");
}

beforeEach(() => {
  mem.clear();
});

describe("pinnedAgentPlans", () => {
  it("loads pinned ids from localStorage, sanitizing to strings", async () => {
    mem.set(KEY, JSON.stringify(["a", 1, null, "b", { c: 1 }]));

    const store = await loadStore();

    expect(store.pinnedPlanIds()).toEqual(["a", "b"]);
    expect(store.isPlanPinned("a")).toBe(true);
    expect(store.isPlanPinned("z")).toBe(false);
  });

  it("falls back to an empty list for malformed json", async () => {
    mem.set(KEY, "{");

    const store = await loadStore();

    expect(store.pinnedPlanIds()).toEqual([]);
  });

  it("pins a chat and persists it", async () => {
    const store = await loadStore();

    store.setPlanPinned("chat-1", true);

    expect(store.isPlanPinned("chat-1")).toBe(true);
    expect(store.pinnedPlanIds()).toEqual(["chat-1"]);
    expect(JSON.parse(mem.get(KEY)!)).toEqual(["chat-1"]);
  });

  it("does not pin the same chat twice", async () => {
    const store = await loadStore();

    store.setPlanPinned("chat-1", true);
    store.setPlanPinned("chat-1", true);

    expect(store.pinnedPlanIds()).toEqual(["chat-1"]);
  });

  it("unpins a chat and persists the removal", async () => {
    mem.set(KEY, JSON.stringify(["chat-1", "chat-2"]));
    const store = await loadStore();

    store.setPlanPinned("chat-1", false);

    expect(store.isPlanPinned("chat-1")).toBe(false);
    expect(store.pinnedPlanIds()).toEqual(["chat-2"]);
    expect(JSON.parse(mem.get(KEY)!)).toEqual(["chat-2"]);
  });

  it("toggles a chat on and back off", async () => {
    const store = await loadStore();

    store.togglePlanPinned("chat-1");
    expect(store.isPlanPinned("chat-1")).toBe(true);

    store.togglePlanPinned("chat-1");
    expect(store.isPlanPinned("chat-1")).toBe(false);
    expect(store.pinnedPlanIds()).toEqual([]);
  });
});
