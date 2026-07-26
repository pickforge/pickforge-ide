import { type AgentTimelineItem } from "../stores/agentChat";

export type TimelineVirtualRow =
  | { kind: "item"; item: AgentTimelineItem }
  | { kind: "working" };

export type TimelineVirtualMetrics = {
  padding: number;
  /** Between any pair with a non-compact side: a prose boundary, a card, a
   *  usage receipt. The "new thought" distance. */
  gap: number;
  /** Between two adjacent compact log rows (see isCompactTimelineRow): a burst
   *  of tool work reads as one block, so its internal gap is tighter. */
  runGap: number;
};

export type TimelineVirtualLayout = {
  rows: TimelineVirtualRow[];
  starts: number[];
  keyToIndex: Map<string, number>;
  totalHeight: number;
};

export const DEFAULT_VIRTUAL_PADDING_PX = 16;
// Fallbacks mirroring the CSS custom properties on `.pf-chat-timeline`
// (--pf-space-lg / --pf-space-md / --pf-space-xs); used until getComputedStyle
// can read them.
export const DEFAULT_VIRTUAL_GAP_PX = 12;
export const DEFAULT_VIRTUAL_RUN_GAP_PX = 4;
export const OVERSCAN_PX = 1_800;

const CHARS_PER_LINE = 82;
const LINE_HEIGHT_PX = 23;

function estimateTextHeight(text: string, base: number): number {
  // No upper clamp: this estimate feeds visibility culling for unmeasured rows,
  // and undercounting a tall row can drop its lower portion from the visible set
  // until it mounts. Overcounting only mounts a harmless extra offscreen row that
  // self-corrects once measured, so bias toward not undercounting.
  //
  // Count wrapped lines per hard line break rather than over the whole length:
  // a message of many short lines (e.g. a list or log) has more visual rows than
  // text.length / CHARS_PER_LINE implies, so a plain char-count undercounts it.
  let lines = 0;
  for (const segment of text.split("\n")) {
    lines += Math.max(1, Math.ceil(segment.length / CHARS_PER_LINE));
  }
  return Math.max(base, base + lines * LINE_HEIGHT_PX);
}

export function buildTimelineRows(
  items: AgentTimelineItem[],
  working?: boolean,
): TimelineVirtualRow[] {
  // Hidden user messages (e.g. swarm synthesis prompts) render nothing, so they
  // must not occupy a virtual row — otherwise the layout reserves estimated
  // height for an empty row, leaving a blank gap and skewing scroll math.
  const rows: TimelineVirtualRow[] = items
    .filter((item) => !(item.type === "userMessage" && item.hidden))
    .map((item) => ({ kind: "item", item }));
  if (working) rows.push({ kind: "working" });
  return rows;
}

export function timelineVirtualRowKey(row: TimelineVirtualRow): string {
  return row.kind === "working" ? "working" : `${row.item.type}:${row.item.seq}`;
}

// Row heights measured in the rendered app (#352), rounded up: an estimate only
// governs the frame before a row mounts, and one that is wildly off shows up as
// a gap that snaps shut. Bias slightly high — undercounting can drop a row's
// lower portion from the visible set until it mounts, overcounting only mounts
// a harmless extra offscreen row.
//
// The four `.pf-chat-line` rows (command / tool / mcp / web) are single-line by
// construction: their name and detail spans are `nowrap` + ellipsis, so no text
// model applies while collapsed, which is how they all render by default. A row
// the reader expanded remeasures on mount.
const COMPACT_COMMAND_PX = 32; // measured 29 — taller for its status mark
const COMPACT_LINE_PX = 28; // measured 24 — tool / mcp / web
const COLLAPSED_THINKING_PX = 28; // measured 17, floored at 24 for target spacing
const WORKING_ROW_PX = 28; // measured 24
const USAGE_ROW_PX = 20; // measured 16
const PLAN_BASE_PX = 60; // measured 56 fixed …
const PLAN_ITEM_PX = 25; // … + 23 per item
// Bubble chrome around the text model's own `LINE_HEIGHT_PX` per line: a
// one-line bubble measures 41, i.e. ~18 of padding and border.
const BUBBLE_BASE_PX = 24;
// The image variant keeps its original allowance for the thumbnail block on top
// of the (now measured) text chrome; only the text case has evidence behind it.
const BUBBLE_IMAGE_EXTRA_PX = 106;

function userMessageBaseHeight(hasImages: boolean): number {
  return hasImages ? BUBBLE_BASE_PX + BUBBLE_IMAGE_EXTRA_PX : BUBBLE_BASE_PX;
}

/** A completed turn renders the compact, collapsed-by-default receipt (#231
 *  PR3) instead of the raw per-file card, so its estimate is a small fixed
 *  header height rather than growing with file count. No cap on the raw-card
 *  branch: like estimateTextHeight, this feeds visibility culling for
 *  unmeasured rows, so undercounting a many-file batch could drop its lower
 *  files from the visible set until it mounts. */
function estimateFileChangeRowHeight(item: Extract<AgentTimelineItem, { type: "fileChange" }>): number {
  return item.turnComplete ? 56 : 76 + item.changes.length * 32;
}

export function estimateTimelineRowHeight(row: TimelineVirtualRow): number {
  if (row.kind === "working") return WORKING_ROW_PX;
  const item = row.item;
  switch (item.type) {
    case "userMessage":
      return estimateTextHeight(item.text, userMessageBaseHeight(!!item.images?.length));
    case "assistantText":
      return estimateTextHeight(item.text, BUBBLE_BASE_PX);
    // A thinking row renders collapsed to its one-line header, so its text
    // says nothing about its height until the reader opens it.
    case "thinking":
      return COLLAPSED_THINKING_PX;
    // Collapsed with or without a tail is the same single line; the tail only
    // shows once expanded.
    case "command":
      return COMPACT_COMMAND_PX;
    case "fileChange":
      return estimateFileChangeRowHeight(item);
    case "toolUse":
    case "mcpToolCall":
    case "webSearch":
      return COMPACT_LINE_PX;
    case "plan":
      return PLAN_BASE_PX + item.items.length * PLAN_ITEM_PX;
    case "usage":
      return USAGE_ROW_PX;
  }
}

/** Resolve a row's layout height: the measurement when there is one, the
 *  estimate until then.
 *
 *  A streaming row used to take the larger of the two, to cover its cache going
 *  stale while unmounted and text kept arriving. That cost far more than it
 *  bought: `estimateTextHeight` intentionally over-counts (a fixed 82
 *  chars/line against a much wider real column), so the streaming tail — which
 *  is mounted and remeasured on every delta whenever the reader is at the
 *  bottom — reserved hundreds of pixels it did not use. The timeline pinned to
 *  that phantom bottom, leaving a wall of empty space below the stream, and the
 *  reserved height collapsing at end of turn clamped the scroll position hard
 *  enough to detach the follow (#352). An unmounted streaming row is by
 *  definition one the reader has scrolled away from; its height self-corrects
 *  when they come back and it remounts. */
function rowHeight(
  row: TimelineVirtualRow,
  key: string,
  rowHeights: ReadonlyMap<string, number>,
): number {
  return rowHeights.get(key) ?? estimateTimelineRowHeight(row);
}

// The row kinds that render as one-line machine-log entries (the
// `.pf-chat-line` family, the collapsed thinking header, and the transient
// working pulse). A run of these is one burst of work, so the gap inside the
// run is `metrics.runGap`; any pair with a prose/card side keeps `metrics.gap`.
// Kind-based on purpose: expansion state lives in the component, and a row the
// reader opened is still part of the same burst.
const COMPACT_ROW_TYPES: ReadonlySet<AgentTimelineItem["type"]> = new Set([
  "command",
  "toolUse",
  "mcpToolCall",
  "webSearch",
  "thinking",
]);

export function isCompactTimelineRow(row: TimelineVirtualRow): boolean {
  return row.kind === "working" || COMPACT_ROW_TYPES.has(row.item.type);
}

export function buildTimelineLayout(
  rows: TimelineVirtualRow[],
  metrics: TimelineVirtualMetrics,
  rowHeights: ReadonlyMap<string, number>,
): TimelineVirtualLayout {
  const starts: number[] = [];
  const keyToIndex = new Map<string, number>();
  let y = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = timelineVirtualRowKey(row);
    starts[i] = y;
    keyToIndex.set(key, i);
    y += rowHeight(row, key, rowHeights);
    if (i < rows.length - 1) {
      y += isCompactTimelineRow(row) && isCompactTimelineRow(rows[i + 1])
        ? metrics.runGap
        : metrics.gap;
    }
  }
  return {
    rows,
    starts,
    keyToIndex,
    totalHeight: rows.length > 0 ? metrics.padding * 2 + y : 0,
  };
}

function lowerBoundStarts(starts: number[], target: number): number {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function visibleTimelineKeys(
  layout: TimelineVirtualLayout,
  rowHeights: ReadonlyMap<string, number>,
  metrics: TimelineVirtualMetrics,
  scrollTop: number,
  viewportHeight: number,
  overscan = OVERSCAN_PX,
): string[] {
  const { rows, starts } = layout;
  if (rows.length === 0) return [];
  const top = Math.max(0, scrollTop - metrics.padding - overscan);
  const bottom = scrollTop + viewportHeight - metrics.padding + overscan;
  // `starts` is monotonically increasing (cumulative y), so binary-search the
  // first row whose start >= top, then step back while the previous row extends
  // into view (a tall row straddling `top`). This makes the per-scroll-frame
  // recompute O(log n + visible) instead of O(n) over every row — the scroll
  // handler fires this every frame, so on long chats the linear scan was the
  // dominant per-frame JS cost on WebKitGTK (where scroll + paint share one
  // main thread).
  let i = lowerBoundStarts(starts, top);
  while (i > 0) {
    const prev = i - 1;
    const prevKey = timelineVirtualRowKey(rows[prev]);
    // Same height resolution as buildTimelineLayout so culling agrees with the
    // `starts` it was computed from.
    const prevHeight = rowHeight(rows[prev], prevKey, rowHeights);
    if (starts[prev] + prevHeight <= top) break;
    i = prev;
  }
  const visible: string[] = [];
  for (; i < rows.length; i++) {
    const rowStart = starts[i];
    if (rowStart > bottom) break;
    const row = rows[i];
    const key = timelineVirtualRowKey(row);
    const height = rowHeight(row, key, rowHeights);
    if (rowStart + height < top) continue;
    visible.push(key);
  }
  return visible;
}
