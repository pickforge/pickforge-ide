import { type AgentTimelineItem } from "../stores/agentChat";

export type TimelineVirtualRow =
  | { kind: "item"; item: AgentTimelineItem }
  | { kind: "working" };

export type TimelineVirtualMetrics = {
  padding: number;
  gap: number;
};

export type TimelineVirtualLayout = {
  rows: TimelineVirtualRow[];
  starts: number[];
  keyToIndex: Map<string, number>;
  totalHeight: number;
};

export const DEFAULT_VIRTUAL_PADDING_PX = 16;
export const DEFAULT_VIRTUAL_GAP_PX = 12;
export const MIN_ROW_HEIGHT_PX = 48;
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

function userMessageBaseHeight(hasImages: boolean): number {
  return hasImages ? 190 : 84;
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
  if (row.kind === "working") return 40;
  const item = row.item;
  switch (item.type) {
    case "userMessage":
      return estimateTextHeight(item.text, userMessageBaseHeight(!!item.images?.length));
    case "assistantText":
    case "thinking":
      return estimateTextHeight(item.text, 96);
    case "command":
      return item.outputTail ? 116 : 96;
    case "fileChange":
      return estimateFileChangeRowHeight(item);
    case "toolUse":
      return estimateTextHeight(item.detail ?? item.name, 72);
    case "mcpToolCall":
    case "webSearch":
      return 68;
    case "plan":
      return 64 + item.items.length * 30;
    case "usage":
      return 40;
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
    if (i < rows.length - 1) y += metrics.gap;
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
