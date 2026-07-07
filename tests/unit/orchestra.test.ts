import { beforeEach, describe, expect, it, vi } from "vitest";

const testEnv = vi.hoisted(() => {
  const storage = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return { invoke: vi.fn(), storage };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: testEnv.invoke }));

import type { OrchestraTask } from "../../src/lib/orchestra";
import {
  type LaneNode,
  type LaneSplit,
  addLaneAt,
  addSelectedLane,
  applyLayoutPreset,
  commitLaneLayout,
  deleteTask,
  detectLayoutPreset,
  laneTree,
  loadTasks,
  moveLane,
  orchestra,
  removeSelectedLane,
  selectedLanes,
  setLaneSplitRatio,
  setSelectedLanes,
  tasksFor,
  upsertTask,
} from "../../src/stores/orchestra";

function asSplit(node: LaneNode | null): LaneSplit {
  if (!node || node.kind !== "split") throw new Error("expected a split node");
  return node;
}

const v2Key = (root: string) => `pickforge.orchestraLanes.v2.${root}`;
const v1LanesKey = (root: string) => `pickforge.orchestraLanes.${root}`;
const v1LayoutKey = (root: string) => `pickforge.orchestraLayout.${root}`;

let rootCounter = 0;

function nextRoot(): string {
  rootCounter += 1;
  return `/project-${rootCounter}`;
}

function makeTask(
  projectRoot: string,
  id: string,
  sortOrder: number,
  title = id,
): OrchestraTask {
  return {
    id,
    projectRoot,
    title,
    status: "planned",
    builderChatId: null,
    reviewerChatId: null,
    note: null,
    sortOrder,
    createdAt: sortOrder,
    updatedAt: sortOrder,
  };
}

beforeEach(() => {
  testEnv.invoke.mockReset();
  testEnv.storage.clear();
});

describe("orchestra task store", () => {
  it("loads, upserts, and deletes tasks through invoke wrappers", async () => {
    const root = nextRoot();
    const first = makeTask(root, "task-1", 1);
    const second = makeTask(root, "task-2", 0);

    testEnv.invoke.mockImplementation((command: string) => {
      if (command === "orchestra_tasks_list") return Promise.resolve([first]);
      return Promise.resolve();
    });

    await loadTasks(root);
    expect(tasksFor(root)).toEqual([first]);

    await upsertTask(second);
    expect(tasksFor(root).map((task) => task.id)).toEqual(["task-2", "task-1"]);

    await deleteTask(root, "task-1");
    expect(tasksFor(root).map((task) => task.id)).toEqual(["task-2"]);
    expect(testEnv.invoke.mock.calls.map((call) => call[0])).toEqual([
      "orchestra_tasks_list",
      "orchestra_task_upsert",
      "orchestra_task_delete",
    ]);
  });

  it("reloads authoritative tasks after an optimistic write fails", async () => {
    const root = nextRoot();
    const persisted = makeTask(root, "persisted", 0);
    const optimistic = makeTask(root, "optimistic", 1);

    testEnv.invoke.mockImplementation((command: string) => {
      if (command === "orchestra_tasks_list") return Promise.resolve([persisted]);
      if (command === "orchestra_task_upsert") return Promise.reject(new Error("write failed"));
      return Promise.resolve();
    });

    await loadTasks(root);
    await expect(upsertTask(optimistic)).rejects.toThrow("write failed");

    expect(tasksFor(root)).toEqual([persisted]);
    expect(orchestra.tasksByRoot[root].error).toBe("write failed");
    expect(testEnv.invoke.mock.calls.map((call) => call[0])).toEqual([
      "orchestra_tasks_list",
      "orchestra_task_upsert",
      "orchestra_tasks_list",
    ]);
  });
});

describe("orchestra lane tree", () => {
  it("migrates legacy v1 lanes, sanitizing duplicates/non-strings and capping at five", () => {
    const root = nextRoot();
    localStorage.setItem(
      v1LanesKey(root),
      JSON.stringify(["chat-1", "chat-2", "chat-1", 7, "chat-3"]),
    );

    expect(selectedLanes(root)).toEqual(["chat-1", "chat-2", "chat-3"]);
    // Migration persists to v2 up front and retires the v1 keys.
    expect(testEnv.storage.has(v2Key(root))).toBe(true);
    expect(testEnv.storage.has(v1LanesKey(root))).toBe(false);

    addSelectedLane(root, "chat-4");
    addSelectedLane(root, "chat-5");
    addSelectedLane(root, "chat-6"); // over the cap -> no-op
    expect(selectedLanes(root)).toEqual(["chat-1", "chat-2", "chat-3", "chat-4", "chat-5"]);

    // Appends land on the RIGHT: the whole prior tree is the split's left child.
    const persisted = JSON.parse(testEnv.storage.get(v2Key(root))!) as LaneSplit;
    expect(persisted.kind).toBe("split");
    expect(persisted.b).toEqual({ kind: "leaf", chatId: "chat-5" });
    expect(selectedLanes(root)).toEqual(["chat-1", "chat-2", "chat-3", "chat-4", "chat-5"]);
  });

  it("does not resurrect deleted lanes after migration", () => {
    const root = nextRoot();
    localStorage.setItem(v1LanesKey(root), JSON.stringify(["a", "b"]));
    localStorage.setItem(v1LayoutKey(root), "rows");

    expect(selectedLanes(root)).toEqual(["a", "b"]);
    expect(testEnv.storage.has(v1LanesKey(root))).toBe(false);
    expect(testEnv.storage.has(v1LayoutKey(root))).toBe(false);

    removeSelectedLane(root, "a");
    removeSelectedLane(root, "b");
    expect(selectedLanes(root)).toEqual([]);
    // No v2 blob and no legacy keys → a reload has nothing to migrate from.
    expect(testEnv.storage.has(v2Key(root))).toBe(false);
    expect(testEnv.storage.has(v1LanesKey(root))).toBe(false);
    expect(testEnv.storage.has(v1LayoutKey(root))).toBe(false);
  });

  it("builds a columns tree from a list and detects the preset", () => {
    const root = nextRoot();
    setSelectedLanes(root, ["a", "b", "c", "d", "e", "f"]); // 6 -> capped to 5
    expect(selectedLanes(root)).toEqual(["a", "b", "c", "d", "e"]);
    expect(detectLayoutPreset(laneTree(root))).toBe("columns");
    expect(asSplit(laneTree(root)).dir).toBe("row");
  });

  it("inserts a lane directionally relative to a target (each direction)", () => {
    const dirs = [
      { dir: "right" as const, axis: "row", order: ["a", "x"] },
      { dir: "left" as const, axis: "row", order: ["x", "a"] },
      { dir: "down" as const, axis: "col", order: ["a", "x"] },
      { dir: "up" as const, axis: "col", order: ["x", "a"] },
    ];
    for (const { dir, axis, order } of dirs) {
      const root = nextRoot();
      setSelectedLanes(root, ["a"]);
      addLaneAt(root, "a", dir, "x");
      const split = asSplit(laneTree(root));
      expect(split.dir).toBe(axis);
      expect(selectedLanes(root)).toEqual(order);
    }
  });

  it("respects the cap and rejects duplicates on directional insert", () => {
    const root = nextRoot();
    setSelectedLanes(root, ["a", "b", "c", "d", "e"]);
    addLaneAt(root, "a", "right", "f"); // at cap -> no-op
    expect(selectedLanes(root)).toEqual(["a", "b", "c", "d", "e"]);

    const root2 = nextRoot();
    setSelectedLanes(root2, ["a", "b"]);
    addLaneAt(root2, "a", "right", "b"); // duplicate → no-op
    expect(selectedLanes(root2)).toEqual(["a", "b"]);
  });

  it("moveLane center swaps leaves; edge removes and re-splits beside target", () => {
    const swapRoot = nextRoot();
    setSelectedLanes(swapRoot, ["a", "b", "c"]);
    moveLane(swapRoot, "a", "c", "center");
    expect(selectedLanes(swapRoot)).toEqual(["c", "b", "a"]);

    const edgeRoot = nextRoot();
    setSelectedLanes(edgeRoot, ["a", "b"]);
    moveLane(edgeRoot, "a", "b", "down");
    expect(selectedLanes(edgeRoot)).toEqual(["b", "a"]);
    expect(asSplit(laneTree(edgeRoot)).dir).toBe("col");
  });

  it("removeSelectedLane collapses the parent split into the sibling", () => {
    const root = nextRoot();
    setSelectedLanes(root, ["a", "b", "c"]);
    removeSelectedLane(root, "b");
    expect(selectedLanes(root)).toEqual(["a", "c"]);
    const split = asSplit(laneTree(root));
    expect(split.a).toEqual({ kind: "leaf", chatId: "a" });
    expect(split.b).toEqual({ kind: "leaf", chatId: "c" });

    removeSelectedLane(root, "a");
    expect(laneTree(root)).toEqual({ kind: "leaf", chatId: "c" });
  });

  it("clamps split ratios to 0.15–0.85 and persists only on commit", () => {
    const root = nextRoot();
    setSelectedLanes(root, ["a", "b"]);
    const id = asSplit(laneTree(root)).id;
    setLaneSplitRatio(root, id, 0.95);
    expect(asSplit(laneTree(root)).ratio).toBe(0.85);
    setLaneSplitRatio(root, id, 0.01);
    expect(asSplit(laneTree(root)).ratio).toBe(0.15);

    // Ratio moves are store-only (they fire per pointermove); the localStorage
    // blob still holds the pre-drag ratio until the drag-end flush.
    expect((JSON.parse(testEnv.storage.get(v2Key(root))!) as LaneSplit).ratio).toBe(0.5);
    commitLaneLayout(root);
    expect((JSON.parse(testEnv.storage.get(v2Key(root))!) as LaneSplit).ratio).toBe(0.15);
  });

  it("applies each preset and round-trips through detection", () => {
    const root = nextRoot();
    setSelectedLanes(root, ["a", "b", "c", "d"]);

    applyLayoutPreset(root, "rows");
    expect(detectLayoutPreset(laneTree(root))).toBe("rows");
    expect(asSplit(laneTree(root)).dir).toBe("col");

    applyLayoutPreset(root, "grid");
    expect(detectLayoutPreset(laneTree(root))).toBe("grid");
    const grid = asSplit(laneTree(root));
    expect(grid.dir).toBe("col");
    expect(asSplit(grid.a).dir).toBe("row");
    expect(asSplit(grid.b).dir).toBe("row");

    applyLayoutPreset(root, "columns");
    expect(detectLayoutPreset(laneTree(root))).toBe("columns");
  });

  it("migrates the legacy layout mode into the equivalent tree shape", () => {
    const root = nextRoot();
    localStorage.setItem(v1LanesKey(root), JSON.stringify(["a", "b", "c"]));
    localStorage.setItem(v1LayoutKey(root), "grid");

    expect(selectedLanes(root)).toEqual(["a", "b", "c"]);
    expect(detectLayoutPreset(laneTree(root))).toBe("grid");

    // Migration itself persisted the tree under the v2 key; ops keep it fresh.
    expect(testEnv.storage.get(v2Key(root))).toBeTruthy();
    removeSelectedLane(root, "c");
    expect(selectedLanes(root)).toEqual(["a", "b"]);
  });
});

describe("orchestra lane tree sanitizer (v2 load)", () => {
  const leaf = (chatId: string) => ({ kind: "leaf", chatId });
  const split = (dir: "row" | "col", ratio: unknown, a: unknown, b: unknown) => ({
    kind: "split",
    id: "persisted-id",
    dir,
    ratio,
    a,
    b,
  });

  it("falls back safely on corrupt JSON", () => {
    const root = nextRoot();
    localStorage.setItem(v2Key(root), "{not json");
    expect(selectedLanes(root)).toEqual([]);
    expect(laneTree(root)).toBeNull();
  });

  it("drops unknown-kind and non-object nodes, collapsing into survivors", () => {
    const root = nextRoot();
    localStorage.setItem(
      v2Key(root),
      JSON.stringify(split("row", 0.5, { kind: "mystery" }, split("col", 0.5, 42, leaf("a")))),
    );
    expect(laneTree(root)).toEqual({ kind: "leaf", chatId: "a" });
  });

  it("clamps out-of-range and repairs non-numeric ratios on load", () => {
    const root = nextRoot();
    localStorage.setItem(
      v2Key(root),
      JSON.stringify(split("row", 7, leaf("a"), split("col", null, leaf("b"), leaf("c")))),
    );
    const top = asSplit(laneTree(root));
    expect(top.ratio).toBe(0.85);
    expect(asSplit(top.b).ratio).toBe(0.5);
  });

  it("prunes duplicate and empty chat ids", () => {
    const root = nextRoot();
    localStorage.setItem(
      v2Key(root),
      JSON.stringify(split("row", 0.5, leaf("a"), split("col", 0.5, leaf("a"), leaf("")))),
    );
    expect(laneTree(root)).toEqual({ kind: "leaf", chatId: "a" });
  });

  it("caps a persisted tree at five leaves, collapsing emptied splits", () => {
    const root = nextRoot();
    const chain = split(
      "row",
      0.5,
      leaf("a"),
      split("row", 0.5, leaf("b"), split("row", 0.5, leaf("c"), split("row", 0.5, leaf("d"), split("row", 0.5, leaf("e"), leaf("f"))))),
    );
    localStorage.setItem(v2Key(root), JSON.stringify(chain));
    expect(selectedLanes(root)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("bounds pathologically deep trees instead of recursing forever", () => {
    const root = nextRoot();
    // A 20-deep one-armed chain whose only leaf sits past MAX_LANE_DEPTH: every
    // split on the path is dropped, so the whole blob sanitizes to no lanes.
    let node: unknown = leaf("deep");
    for (let i = 0; i < 20; i++) node = split("row", 0.5, node, { kind: "mystery" });
    localStorage.setItem(v2Key(root), JSON.stringify(node));
    expect(selectedLanes(root)).toEqual([]);
    expect(laneTree(root)).toBeNull();
  });
});
