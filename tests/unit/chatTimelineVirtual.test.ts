import { describe, expect, it } from "vitest";
import { type AgentTimelineItem } from "../../src/stores/agentChat";

import {
  DEFAULT_VIRTUAL_GAP_PX,
  DEFAULT_VIRTUAL_PADDING_PX,
  buildTimelineLayout,
  buildTimelineRows,
  estimateTimelineRowHeight,
  timelineVirtualRowKey,
  visibleTimelineKeys,
  type TimelineVirtualRow,
} from "../../src/lib/chatTimelineVirtual";

describe("chat timeline virtualization helpers", () => {
  it("uses stable row keys from item type and sequence", () => {
    const item: AgentTimelineItem = {
      type: "assistantText",
      seq: 42,
      text: "hello",
      streaming: false,
    };

    expect(timelineVirtualRowKey({ kind: "item", item })).toBe("assistantText:42");
    expect(timelineVirtualRowKey({ kind: "working" })).toBe("working");
  });

  it("adds a working row after timeline items", () => {
    const item: AgentTimelineItem = {
      type: "assistantText",
      seq: 7,
      text: "hello",
      streaming: true,
    };

    expect(buildTimelineRows([item], true).map(timelineVirtualRowKey)).toEqual([
      "assistantText:7",
      "working",
    ]);
    expect(buildTimelineRows([item], false).map(timelineVirtualRowKey)).toEqual([
      "assistantText:7",
    ]);
  });

  it("omits hidden user messages from the rows", () => {
    // Hidden prompts (e.g. swarm synthesis) render nothing, so they must not
    // occupy a virtual row and reserve blank height.
    const items: AgentTimelineItem[] = [
      { type: "userMessage", seq: 1, text: "visible" },
      { type: "userMessage", seq: 2, text: "internal", hidden: true },
      { type: "assistantText", seq: 3, text: "reply", streaming: false },
    ];

    expect(buildTimelineRows(items, false).map(timelineVirtualRowKey)).toEqual([
      "userMessage:1",
      "assistantText:3",
    ]);
  });

  it("estimates larger rows for long markdown than short markdown", () => {
    const shortRow: TimelineVirtualRow = {
      kind: "item",
      item: { type: "assistantText", seq: 1, text: "short", streaming: false },
    };
    const longRow: TimelineVirtualRow = {
      kind: "item",
      item: {
        type: "assistantText",
        seq: 2,
        text: "long ".repeat(600),
        streaming: false,
      },
    };

    expect(estimateTimelineRowHeight(longRow)).toBeGreaterThan(
      estimateTimelineRowHeight(shortRow),
    );
  });

  it("does not cap the estimate for very long text", () => {
    // The estimate feeds visibility culling for unmeasured rows; undercounting a
    // tall row can drop its lower portion from the visible set. A row far taller
    // than the old 1,800px clamp must estimate proportionally larger.
    const huge: TimelineVirtualRow = {
      kind: "item",
      item: { type: "assistantText", seq: 1, text: "x".repeat(20_000), streaming: false },
    };
    expect(estimateTimelineRowHeight(huge)).toBeGreaterThan(1_800);
  });

  it("accounts for command output tails", () => {
    const base: TimelineVirtualRow = {
      kind: "item",
      item: {
        type: "command",
        seq: 1,
        itemId: "cmd",
        command: "npm test",
        status: "completed",
        exitCode: 0,
        outputTail: null,
      },
    };
    const withOutput: TimelineVirtualRow = {
      kind: "item",
      item: {
        type: "command",
        seq: 2,
        itemId: "cmd",
        command: "npm test",
        status: "completed",
        exitCode: 0,
        outputTail: "ok\n".repeat(20),
      },
    };

    expect(estimateTimelineRowHeight(withOutput)).toBeGreaterThan(
      estimateTimelineRowHeight(base),
    );
  });

  it("estimates the non-message timeline row variants", () => {
    const estimates = [
      estimateTimelineRowHeight({ kind: "working" }),
      estimateTimelineRowHeight({
        kind: "item",
        item: { type: "thinking", seq: 1, text: "reasoning", streaming: true },
      }),
      estimateTimelineRowHeight({
        kind: "item",
        item: {
          type: "fileChange",
          seq: 2,
          itemId: "files",
          changes: [{ path: "src/app.ts", kind: "modified", diff: null }],
        },
      }),
      estimateTimelineRowHeight({
        kind: "item",
        item: { type: "toolUse", seq: 3, itemId: "tool", name: "read", detail: null },
      }),
      estimateTimelineRowHeight({
        kind: "item",
        item: { type: "mcpToolCall", seq: 4, itemId: "mcp", server: "github", tool: "list" },
      }),
      estimateTimelineRowHeight({
        kind: "item",
        item: { type: "webSearch", seq: 5, itemId: "search", query: "pickforge" },
      }),
      estimateTimelineRowHeight({
        kind: "item",
        item: { type: "plan", seq: 6, items: [{ text: "Fix scroll", completed: false }] },
      }),
      estimateTimelineRowHeight({
        kind: "item",
        item: {
          type: "usage",
          seq: 7,
          inputTokens: 1,
          cachedInputTokens: 0,
          outputTokens: 2,
          costUsd: null,
          estimatedCostUsd: null,
        },
      }),
    ];

    expect(estimates.every((height) => height >= 40)).toBe(true);
  });

  it("uses taller estimates for image messages and caps large file batches", () => {
    const textOnly = estimateTimelineRowHeight({
      kind: "item",
      item: { type: "userMessage", seq: 1, text: "hello" },
    });
    const withImage = estimateTimelineRowHeight({
      kind: "item",
      item: { type: "userMessage", seq: 2, text: "hello", images: ["shot.png"] },
    });
    const largeFileBatch = estimateTimelineRowHeight({
      kind: "item",
      item: {
        type: "fileChange",
        seq: 3,
        itemId: "files",
        changes: Array.from({ length: 30 }, (_, index) => ({
          path: `file-${index}.ts`,
          kind: "modified",
          diff: null,
        })),
      },
    });

    expect(withImage).toBeGreaterThan(textOnly);
    expect(largeFileBatch).toBe(520);
  });

  it("builds measured layouts with padding and gaps", () => {
    const rows = buildTimelineRows(
      [
        { type: "assistantText", seq: 1, text: "one", streaming: false },
        { type: "assistantText", seq: 2, text: "two", streaming: false },
      ],
      false,
    );
    const heights = new Map([
      ["assistantText:1", 100],
      ["assistantText:2", 120],
    ]);

    const layout = buildTimelineLayout(
      rows,
      { padding: DEFAULT_VIRTUAL_PADDING_PX, gap: DEFAULT_VIRTUAL_GAP_PX },
      heights,
    );

    expect(layout.starts).toEqual([0, 100 + DEFAULT_VIRTUAL_GAP_PX]);
    expect(layout.totalHeight).toBe(
      DEFAULT_VIRTUAL_PADDING_PX * 2 + 100 + DEFAULT_VIRTUAL_GAP_PX + 120,
    );
    expect(layout.keyToIndex.get("assistantText:2")).toBe(1);
  });

  it("handles empty layouts and unmeasured visible rows", () => {
    const metrics = { padding: 10, gap: 4 };
    const empty = buildTimelineLayout([], metrics, new Map());
    const rows = buildTimelineRows(
      [{ type: "assistantText", seq: 1, text: "unmeasured", streaming: false }],
      false,
    );
    const layout = buildTimelineLayout(rows, metrics, new Map());

    expect(empty.totalHeight).toBe(0);
    expect(layout.totalHeight).toBeGreaterThan(metrics.padding * 2);
    expect(visibleTimelineKeys(layout, new Map(), metrics, 0, 120, 0)).toEqual([
      "assistantText:1",
    ]);
  });

  it("returns only rows inside the viewport plus overscan", () => {
    const rows = buildTimelineRows(
      Array.from({ length: 6 }, (_, index): AgentTimelineItem => ({
        type: "assistantText",
        seq: index + 1,
        text: `row ${index + 1}`,
        streaming: false,
      })),
      true,
    );
    const heights = new Map(rows.map((row) => [timelineVirtualRowKey(row), 100]));
    const metrics = { padding: 10, gap: 0 };
    const layout = buildTimelineLayout(rows, metrics, heights);

    expect(visibleTimelineKeys(layout, heights, metrics, 250, 100, 0)).toEqual([
      "assistantText:3",
      "assistantText:4",
    ]);
    expect(visibleTimelineKeys(layout, heights, metrics, 250, 100, 100)).toEqual([
      "assistantText:2",
      "assistantText:3",
      "assistantText:4",
      "assistantText:5",
    ]);
  });

  it("includes a tall row straddling the top boundary", () => {
    // Row 2 is tall (500px) and starts above the scroll top but extends into view.
    // The binary-search lower bound lands on row 3 (first start >= top); the
    // step-back must pull row 2 back in so it isn't dropped.
    const rows = buildTimelineRows(
      Array.from({ length: 4 }, (_, index): AgentTimelineItem => ({
        type: "assistantText",
        seq: index + 1,
        text: `row ${index + 1}`,
        streaming: false,
      })),
      false,
    );
    const heights = new Map([
      ["assistantText:1", 100],
      ["assistantText:2", 500],
      ["assistantText:3", 100],
      ["assistantText:4", 100],
    ]);
    const metrics = { padding: 0, gap: 0 };
    const layout = buildTimelineLayout(rows, metrics, heights);
    // starts: [0, 100, 600, 700]; scroll top 150 falls inside row 2.
    expect(visibleTimelineKeys(layout, heights, metrics, 150, 100, 0)).toEqual([
      "assistantText:2",
    ]);
    // Top exactly on a row boundary must not drop the boundary row.
    expect(visibleTimelineKeys(layout, heights, metrics, 100, 100, 0)).toEqual([
      "assistantText:2",
    ]);
  });

  it("scans only the visible window of a long chat", () => {
    // 200 rows of 100px each; a scroll position deep in the middle must return
    // just the rows inside the viewport + overscan, not the full list.
    const rows = buildTimelineRows(
      Array.from({ length: 200 }, (_, index): AgentTimelineItem => ({
        type: "assistantText",
        seq: index + 1,
        text: `row ${index + 1}`,
        streaming: false,
      })),
      false,
    );
    const heights = new Map(rows.map((row) => [timelineVirtualRowKey(row), 100]));
    const metrics = { padding: 0, gap: 0 };
    const layout = buildTimelineLayout(rows, metrics, heights);

    expect(visibleTimelineKeys(layout, heights, metrics, 5000, 300, 0)).toEqual([
      "assistantText:51",
      "assistantText:52",
      "assistantText:53",
      "assistantText:54",
    ]);
  });
});
