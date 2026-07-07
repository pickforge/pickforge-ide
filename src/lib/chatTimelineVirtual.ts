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

/** True while a row's content can still grow without a mounted observer to
 *  remeasure it — a streaming assistant/thinking row scrolled out of the virtual
 *  window. Its cached height would otherwise stay stuck at the last measured
 *  value while text keeps arriving. */
function isStreamingRow(row: TimelineVirtualRow): boolean {
  return (
    row.kind === "item" &&
    (row.item.type === "assistantText" || row.item.type === "thinking") &&
    row.item.streaming === true
  );
}

/** Resolve a row's layout height. For a streaming row, the cached measurement
 *  can lag the still-growing content while it's unmounted, so track the larger
 *  of the cache and the live estimate; otherwise trust the measurement. */
function rowHeight(
  row: TimelineVirtualRow,
  key: string,
  rowHeights: ReadonlyMap<string, number>,
): number {
  const cached = rowHeights.get(key);
  const estimate = estimateTimelineRowHeight(row);
  if (cached === undefined) return estimate;
  return isStreamingRow(row) ? Math.max(cached, estimate) : cached;
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
    // `starts` it was computed from (streaming rows included).
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
