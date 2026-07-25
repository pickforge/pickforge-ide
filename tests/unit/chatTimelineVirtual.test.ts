import { describe, expect, it } from "vitest";
import { type AgentTimelineItem } from "../../src/stores/agentChat";
import { decideTimelineScroll } from "../../src/lib/chatTimelineScroll";

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

describe("chat timeline scroll decisions", () => {
  const decide = (
    overrides: Partial<Parameters<typeof decideTimelineScroll>[0]> = {},
  ) =>
    decideTimelineScroll({
      stick: true,
      top: 900,
      lastTop: 900,
      programmaticTarget: null,
      scrollHeight: 1_000,
      viewportHeight: 100,
      ...overrides,
    });

  it("keeps following when its programmatic pin settles", () => {
    expect(decide({ top: 901, programmaticTarget: 900 })).toEqual({
      stick: true,
      programmatic: true,
    });
  });

  it("does not swallow an interleaved upward user scroll near a pin target", () => {
    expect(
      decide({ top: 898.5, lastTop: 900, programmaticTarget: 900 }),
    ).toEqual({ stick: false, programmatic: false });
  });

  it("detaches when the user scrolls up", () => {
    expect(decide({ top: 700, lastTop: 900 })).toEqual({
      stick: false,
      programmatic: false,
    });
  });

  it("re-arms from live scroll geometry when the user returns near the bottom", () => {
    expect(
      decide({
        stick: false,
        top: 1_805,
        lastTop: 1_700,
        scrollHeight: 2_000,
        viewportHeight: 100,
      }),
    ).toEqual({ stick: true, programmatic: false });
  });

  it("reads a shrink clamp at the bottom edge as our own layout, not a scroll-up", () => {
    // End of turn: the working row leaves and the streamed row settles to its
    // measured height, so the browser clamps scrollTop into the smaller range.
    // Treating that as a gesture detached the follow right before the usage row
    // (tokens, cost) was appended, so it was never pinned (#352).
    expect(
      decide({ top: 900, lastTop: 1_000, scrollHeight: 1_000, viewportHeight: 100 }),
    ).toEqual({ stick: true, programmatic: true });
  });

  it("still detaches on an upward scroll that stops short of the bottom edge", () => {
    expect(
      decide({ top: 897, lastTop: 1_000, scrollHeight: 1_000, viewportHeight: 100 }),
    ).toEqual({ stick: false, programmatic: false });
  });

  it("leaves a detached reader detached when a shrink clamps them to the bottom", () => {
    expect(
      decide({ stick: false, top: 900, lastTop: 1_000, scrollHeight: 1_000, viewportHeight: 100 }),
    ).toEqual({ stick: false, programmatic: true });
  });

  it("keeps following through non-upward streaming scroll events", () => {
    expect(
      decide({
        top: 950,
        lastTop: 900,
        scrollHeight: 1_200,
        viewportHeight: 100,
      }),
    ).toEqual({ stick: true, programmatic: false });
  });
});

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

  it("counts explicit newlines in the estimate", () => {
    // Many short lines (a list/log) have more visual rows than a plain char
    // count implies; the estimate must not undercount them for culling.
    const manyShortLines: TimelineVirtualRow = {
      kind: "item",
      item: { type: "assistantText", seq: 1, text: "a\n".repeat(40), streaming: false },
    };
    const sameCharsOneLine: TimelineVirtualRow = {
      kind: "item",
      item: { type: "assistantText", seq: 2, text: "a".repeat(80), streaming: false },
    };
    expect(estimateTimelineRowHeight(manyShortLines)).toBeGreaterThan(
      estimateTimelineRowHeight(sameCharsOneLine),
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

  it("estimates a collapsed command row the same with or without a tail", () => {
    // Measured in the app (#352): both render as one truncated line — the tail
    // only appears once the reader expands the row, and an expanded row
    // remeasures on mount. The old estimate charged a tail premium (116 vs 96)
    // against rows that are both 29px.
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

    expect(estimateTimelineRowHeight(withOutput)).toBe(estimateTimelineRowHeight(base));
    expect(estimateTimelineRowHeight(base)).toBeLessThan(48);
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
          ordinal: 0,
          turnComplete: false,
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
        item: { type: "plan", seq: 6, items: [{ text: "Fix scroll", status: "pending" }] },
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

    // Big enough to be a row at all…
    expect(estimates.every((height) => height >= 16)).toBe(true);
    // …and the ones that render as a single compact line or a small badge stay
    // well under the 48px slot they were all forced into before (#352). Only
    // the file-change and plan cards grow with their content.
    const compact = [
      estimateTimelineRowHeight({ kind: "working" }),
      estimateTimelineRowHeight({
        kind: "item",
        item: { type: "thinking", seq: 1, text: "reasoning".repeat(200), streaming: true },
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
    ];
    expect(compact.every((height) => height <= 48)).toBe(true);
  });

  it("uses taller estimates for image messages and scales file batches", () => {
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
        ordinal: 0,
        turnComplete: false,
      },
    });

    expect(withImage).toBeGreaterThan(textOnly);
    // Scales with file count (no cap) so a big batch isn't undercounted for
    // visibility culling: 76 + 30 * 32.
    expect(largeFileBatch).toBe(76 + 30 * 32);
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

  it("trusts a streaming row's measurement over the estimate (#352)", () => {
    // `estimateTextHeight` deliberately over-counts, and the streaming tail is
    // remeasured on every delta. Taking the larger of the two reserved hundreds
    // of px of empty space below the stream and pinned the view to a phantom
    // bottom; the measurement is the honest number.
    const rows = buildTimelineRows(
      [{ type: "assistantText", seq: 1, text: "x".repeat(20_000), streaming: true }],
      false,
    );
    const metrics = { padding: 0, gap: 0 };
    const heights = new Map([["assistantText:1", 120]]);

    expect(estimateTimelineRowHeight(rows[0])).toBeGreaterThan(120);
    expect(buildTimelineLayout(rows, metrics, heights).totalHeight).toBe(120);
  });

  it("keeps culling in step with a measured streaming row's layout", () => {
    const rows = buildTimelineRows(
      [
        { type: "assistantText", seq: 1, text: "x".repeat(20_000), streaming: true },
        { type: "usage", seq: 2, inputTokens: 1, cachedInputTokens: 0, outputTokens: 2, costUsd: null, estimatedCostUsd: null },
      ],
      false,
    );
    const metrics = { padding: 0, gap: 0 };
    const heights = new Map([
      ["assistantText:1", 120],
      ["usage:2", 40],
    ]);
    const layout = buildTimelineLayout(rows, metrics, heights);

    // starts: [0, 120] — the usage row is in view only because the streaming
    // row above it is not inflated back to its estimate.
    expect(layout.starts).toEqual([0, 120]);
    expect(visibleTimelineKeys(layout, heights, metrics, 0, 200, 0)).toEqual([
      "assistantText:1",
      "usage:2",
    ]);
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
