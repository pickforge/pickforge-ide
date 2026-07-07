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

function estimateTextHeight(text: string, base: number): number {
  // No upper clamp: this estimate feeds visibility culling for unmeasured rows,
  // and undercounting a tall row can drop its lower portion from the visible set
  // until it mounts. Overcounting only mounts a harmless extra offscreen row that
  // self-corrects once measured, so bias toward not undercounting.
  const lines = Math.ceil(text.length / 82);
  return Math.max(base, base + lines * 23);
}

export function buildTimelineRows(
  items: AgentTimelineItem[],
  working?: boolean,
): TimelineVirtualRow[] {
  const rows: TimelineVirtualRow[] = items.map((item) => ({ kind: "item", item }));
  if (working) rows.push({ kind: "working" });
  return rows;
}

export function timelineVirtualRowKey(row: TimelineVirtualRow): string {
  return row.kind === "working" ? "working" : `${row.item.type}:${row.item.seq}`;
}

export function estimateTimelineRowHeight(row: TimelineVirtualRow): number {
  if (row.kind === "working") return 40;
  const item = row.item;
  switch (item.type) {
    case "userMessage":
      return estimateTextHeight(item.text, item.images?.length ? 190 : 84);
    case "assistantText":
    case "thinking":
      return estimateTextHeight(item.text, 96);
    case "command":
      return item.outputTail ? 116 : 96;
    case "fileChange":
      return Math.min(520, 76 + item.changes.length * 32);
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
    y += rowHeights.get(key) ?? estimateTimelineRowHeight(row);
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
    const prevHeight = rowHeights.get(prevKey) ?? estimateTimelineRowHeight(rows[prev]);
    if (starts[prev] + prevHeight <= top) break;
    i = prev;
  }
  const visible: string[] = [];
  for (; i < rows.length; i++) {
    const rowStart = starts[i];
    if (rowStart > bottom) break;
    const row = rows[i];
    const key = timelineVirtualRowKey(row);
    const rowHeight = rowHeights.get(key) ?? estimateTimelineRowHeight(row);
    if (rowStart + rowHeight < top) continue;
    visible.push(key);
  }
  return visible;
}
