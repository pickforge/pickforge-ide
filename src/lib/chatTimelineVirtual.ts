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
export const OVERSCAN_PX = 1_200;

function estimateTextHeight(text: string, base: number): number {
  const lines = Math.ceil(text.length / 82);
  return Math.max(base, Math.min(1_800, base + lines * 23));
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

export function visibleTimelineKeys(
  layout: TimelineVirtualLayout,
  rowHeights: ReadonlyMap<string, number>,
  metrics: TimelineVirtualMetrics,
  scrollTop: number,
  viewportHeight: number,
  overscan = OVERSCAN_PX,
): string[] {
  const top = Math.max(0, scrollTop - metrics.padding - overscan);
  const bottom = scrollTop + viewportHeight - metrics.padding + overscan;
  const visible: string[] = [];
  for (let i = 0; i < layout.rows.length; i++) {
    const row = layout.rows[i];
    const key = timelineVirtualRowKey(row);
    const rowStart = layout.starts[i];
    const rowHeight = rowHeights.get(key) ?? estimateTimelineRowHeight(row);
    if (rowStart + rowHeight < top) continue;
    if (rowStart > bottom) break;
    visible.push(key);
  }
  return visible;
}
