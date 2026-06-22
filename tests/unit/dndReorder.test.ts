import { describe, expect, it } from "vitest";

import {
  beforeIdForDrop,
  dropEdge,
  dropEdgeForRect,
  dropEdgeForRectX,
  reorder,
} from "../../src/lib/dndReorder";

describe("dropEdge", () => {
  // Row spans y ∈ [100, 140], midpoint 120.
  it("is 'before' above the midpoint", () => {
    expect(dropEdge(100, 100, 140)).toBe("before");
    expect(dropEdge(119, 100, 140)).toBe("before");
  });
  it("is 'after' at/below the midpoint", () => {
    expect(dropEdge(120, 100, 140)).toBe("after");
    expect(dropEdge(140, 100, 140)).toBe("after");
  });
  it("dropEdgeForRect reads top/bottom", () => {
    expect(dropEdgeForRect(105, { top: 100, bottom: 140 })).toBe("before");
    expect(dropEdgeForRect(135, { top: 100, bottom: 140 })).toBe("after");
  });
  it("dropEdgeForRectX reads left/right", () => {
    expect(dropEdgeForRectX(105, { left: 100, right: 140 })).toBe("before");
    expect(dropEdgeForRectX(135, { left: 100, right: 140 })).toBe("after");
  });
});

describe("beforeIdForDrop", () => {
  const order = ["a", "b", "c"];
  it("'before' keeps the target id", () => {
    expect(beforeIdForDrop(order, "b", "before")).toBe("b");
  });
  it("'after' resolves to the following id", () => {
    expect(beforeIdForDrop(order, "a", "after")).toBe("b");
    expect(beforeIdForDrop(order, "b", "after")).toBe("c");
  });
  it("'after' the last id is the end (null)", () => {
    expect(beforeIdForDrop(order, "c", "after")).toBeNull();
  });
});

describe("reorder — both directions", () => {
  const order = ["a", "b", "c", "d"];

  it("moves an item UP (bottom → top): drop 'd' before 'a'", () => {
    expect(reorder(order, "d", "a", "before")).toEqual(["d", "a", "b", "c"]);
  });

  // The downward case the bug missed: dragging a top item past a lower one must
  // land AFTER it, not before.
  it("moves an item DOWN (top → bottom): drop 'a' after 'd'", () => {
    expect(reorder(order, "a", "d", "after")).toEqual(["b", "c", "d", "a"]);
  });

  it("moves DOWN one slot: drop 'a' after 'b'", () => {
    expect(reorder(order, "a", "b", "after")).toEqual(["b", "a", "c", "d"]);
  });

  it("moves UP one slot: drop 'c' before 'b'", () => {
    expect(reorder(order, "c", "b", "before")).toEqual(["a", "c", "b", "d"]);
  });
});

describe("reorder — no-ops", () => {
  const order = ["a", "b", "c"];

  it("dropping onto itself is a no-op", () => {
    expect(reorder(order, "b", "b", "before")).toBeNull();
    expect(reorder(order, "b", "b", "after")).toBeNull();
  });

  it("dropping before the item's existing next slot is a no-op", () => {
    // 'a' before 'b' → 'a' is already there.
    expect(reorder(order, "a", "b", "before")).toBeNull();
  });

  it("dropping after the item's existing previous slot is a no-op", () => {
    // 'b' after 'a' → 'b' is already there.
    expect(reorder(order, "b", "a", "after")).toBeNull();
  });

  it("returns null for an unknown dragged id", () => {
    expect(reorder(order, "z", "a", "before")).toBeNull();
  });
});
