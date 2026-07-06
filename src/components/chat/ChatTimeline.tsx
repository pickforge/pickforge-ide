import {
  type JSX,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { type AgentTimelineItem } from "../../stores/agentChat";
import {
  DEFAULT_VIRTUAL_GAP_PX,
  DEFAULT_VIRTUAL_PADDING_PX,
  MIN_ROW_HEIGHT_PX,
  buildTimelineLayout,
  buildTimelineRows,
  estimateTimelineRowHeight,
  timelineVirtualRowKey,
  visibleTimelineKeys,
  type TimelineVirtualRow,
} from "../../lib/chatTimelineVirtual";
import { ForgeEmptyState } from "../ui";
import { ChatBubble } from "./ChatBubble";
import { ThinkingBubble } from "./ThinkingBubble";
import { CommandCard } from "./CommandCard";
import { FileChangeCard } from "./FileChangeCard";
import { ToolUseCard } from "./ToolUseCard";
import { McpCard } from "./McpCard";
import { WebSearchCard } from "./WebSearchCard";
import { PlanCard } from "./PlanCard";
import { TokenBadge } from "./TokenBadge";
import "./chat.css";

function EmptyGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true">
      <path
        d="M4 5h16v11H9l-5 4V5Z"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function renderItem(item: AgentTimelineItem): JSX.Element {
  switch (item.type) {
    case "userMessage":
      return <ChatBubble role="user" text={item.text} images={item.images} />;
    case "assistantText":
      return <ChatBubble role="assistant" text={item.text} streaming={item.streaming} />;
    case "thinking":
      return <ThinkingBubble text={item.text} streaming={item.streaming} />;
    case "command":
      return (
        <CommandCard
          command={item.command}
          status={item.status}
          exitCode={item.exitCode}
          outputTail={item.outputTail}
        />
      );
    case "fileChange":
      return <FileChangeCard changes={item.changes} />;
    case "toolUse":
      return <ToolUseCard name={item.name} detail={item.detail} />;
    case "mcpToolCall":
      return <McpCard server={item.server} tool={item.tool} />;
    case "webSearch":
      return <WebSearchCard query={item.query} />;
    case "plan":
      return <PlanCard items={item.items} />;
    case "usage":
      return (
        <TokenBadge
          inputTokens={item.inputTokens}
          cachedInputTokens={item.cachedInputTokens}
          outputTokens={item.outputTokens}
          costUsd={item.costUsd}
          estimatedCostUsd={item.estimatedCostUsd}
        />
      );
  }
}

function parseCssPx(element: Element, name: string, fallback: number): number {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

/* Immediate turn feedback: dots + label the moment a turn is active with no
 * stream to look at — models without thinking output (or the gap before the
 * first delta / between tool calls) otherwise render nothing at all. */
function WorkingRow(): JSX.Element {
  return (
    <div class="pf-chat-working-row" role="status" aria-label="Agent is working">
      <span class="pf-chat-working" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span class="pf-chat-working-label">Working</span>
    </div>
  );
}

export function ChatTimeline(props: {
  items: AgentTimelineItem[];
  working?: boolean;
}): JSX.Element {
  let scroller!: HTMLDivElement;
  // Follow the streaming tail, but detach the instant the user scrolls up (any
  // amount) and re-attach only once they return to the bottom. A distance-only
  // check let small scroll-ups stay "near bottom" while content kept growing, so
  // the next resize tick yanked the view back down — hence the "scroll fast to
  // escape" stickiness. `programmaticTarget` marks our own pin so only matching
  // scroll events are ignored.
  let stick = true;
  let lastTop = 0;
  let programmaticTarget: number | null = null;
  let pinFrame: number | null = null;
  let scrollFrame: number | null = null;
  let measureFrame: number | null = null;
  let pendingScrollTop = 0;
  let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let userScrolling = false;
  const THRESHOLD = 96;
  const SCROLL_IDLE_MS = 120;
  const rowHeights = new Map<string, number>();
  const queuedRowHeights = new Map<string, number>();
  const deferredRowHeights = new Map<string, number>();
  const [heightVersion, setHeightVersion] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);
  const [metrics, setMetrics] = createSignal({
    padding: DEFAULT_VIRTUAL_PADDING_PX,
    gap: DEFAULT_VIRTUAL_GAP_PX,
  });

  const rows = createMemo(() => buildTimelineRows(props.items, props.working));

  const layout = createMemo(() => {
    heightVersion();
    return buildTimelineLayout(rows(), metrics(), rowHeights);
  });

  const atBottom = () =>
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < THRESHOLD;

  const commitScrollTop = (top: number) => {
    pendingScrollTop = top;
    setScrollTop(top);
  };

  const scheduleScrollTop = (top: number) => {
    pendingScrollTop = top;
    if (scrollFrame !== null) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      setScrollTop(pendingScrollTop);
    });
  };

  const applyProgrammaticScroll = (target: number) => {
    programmaticTarget = target;
    scroller.scrollTop = target;
    commitScrollTop(target);
    lastTop = target;
  };

  const pin = (force = false) => {
    if (pinFrame !== null) return;
    pinFrame = requestAnimationFrame(() => {
      pinFrame = null;
      if (!force && !stick) return;
      const target = Math.max(0, layout().totalHeight - scroller.clientHeight);
      if (Math.abs(target - scroller.scrollTop) < 1) return;
      applyProgrammaticScroll(target);
    });
  };

  const applyRowHeights = (updates: Iterable<[string, number]>, deferAboveViewport: boolean) => {
    const currentLayout = layout();
    const currentTop = scroller.scrollTop;
    let changed = false;
    let anchorDelta = 0;

    for (const [key, height] of updates) {
      if (!Number.isFinite(height) || height < 1) continue;
      const next = Math.max(MIN_ROW_HEIGHT_PX, Math.ceil(height));
      const index = currentLayout.keyToIndex.get(key);
      if (index === undefined) continue;
      const row = currentLayout.rows[index];
      const previous = rowHeights.get(key) ?? estimateTimelineRowHeight(row);
      if (Math.abs(next - previous) < 1) continue;

      const rowTop = currentLayout.starts[index] + metrics().padding;
      if (deferAboveViewport && userScrolling && rowTop + previous < currentTop) {
        deferredRowHeights.set(key, next);
        continue;
      }

      rowHeights.set(key, next);
      changed = true;
      if (!stick && rowTop < currentTop) anchorDelta += next - previous;
    }

    if (!changed) return;
    setHeightVersion((version) => version + 1);

    if (!stick && !userScrolling && Math.abs(anchorDelta) >= 1) {
      applyProgrammaticScroll(Math.max(0, currentTop + anchorDelta));
    } else if (stick) {
      pin();
    }
  };

  const flushDeferredRowHeights = () => {
    if (deferredRowHeights.size === 0) return;
    const updates = Array.from(deferredRowHeights);
    deferredRowHeights.clear();
    applyRowHeights(updates, false);
  };

  const flushQueuedRowHeights = () => {
    measureFrame = null;
    if (queuedRowHeights.size === 0) return;
    const updates = Array.from(queuedRowHeights);
    queuedRowHeights.clear();
    applyRowHeights(updates, true);
  };

  const queueRowHeight = (key: string, height: number) => {
    queuedRowHeights.set(key, height);
    if (measureFrame !== null) return;
    measureFrame = requestAnimationFrame(flushQueuedRowHeights);
  };

  const markUserScrolling = () => {
    userScrolling = true;
    if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => {
      userScrolling = false;
      scrollIdleTimer = null;
      flushDeferredRowHeights();
    }, SCROLL_IDLE_MS);
  };

  const onScroll = () => {
    const top = scroller.scrollTop;
    scheduleScrollTop(top);
    if (programmaticTarget !== null && Math.abs(top - programmaticTarget) < 2) {
      programmaticTarget = null; // our own pin settling; record its resting position
      lastTop = top;
      return;
    }
    programmaticTarget = null;
    markUserScrolling();
    if (top < lastTop - 1) stick = false; // user scrolled up → detach
    else if (atBottom()) stick = true; // user returned to the bottom → follow again
    lastTop = top;
  };

  const readMetrics = () => {
    const next = {
      padding: parseCssPx(scroller, "--pf-chat-virtual-padding", DEFAULT_VIRTUAL_PADDING_PX),
      gap: parseCssPx(scroller, "--pf-chat-virtual-gap", DEFAULT_VIRTUAL_GAP_PX),
    };
    setMetrics((current) => {
      if (current.padding === next.padding && current.gap === next.gap) return current;
      return next;
    });
  };

  const visibleKeys = createMemo(() => {
    return visibleTimelineKeys(layout(), rowHeights, metrics(), scrollTop(), viewportHeight());
  });

  const rowForKey = (key: string): TimelineVirtualRow | undefined => {
    const currentLayout = layout();
    const index = currentLayout.keyToIndex.get(key);
    return index === undefined ? undefined : currentLayout.rows[index];
  };

  const rowStyle = (key: string): JSX.CSSProperties => {
    const currentLayout = layout();
    const index = currentLayout.keyToIndex.get(key);
    const top = index === undefined ? 0 : currentLayout.starts[index] + metrics().padding;
    return { transform: `translate3d(0, ${top}px, 0)` };
  };

  createEffect(() => {
    const keys = new Set(rows().map(timelineVirtualRowKey));
    for (const key of rowHeights.keys()) {
      if (!keys.has(key)) rowHeights.delete(key);
    }
    for (const key of queuedRowHeights.keys()) {
      if (!keys.has(key)) queuedRowHeights.delete(key);
    }
    for (const key of deferredRowHeights.keys()) {
      if (!keys.has(key)) deferredRowHeights.delete(key);
    }
  });

  createEffect(() => {
    layout().totalHeight;
    if (stick) pin();
  });

  onMount(() => {
    readMetrics();
    setViewportHeight(scroller.clientHeight);
    commitScrollTop(scroller.scrollTop);
    pin(true);
    const observer = new ResizeObserver(() => {
      readMetrics();
      setViewportHeight(scroller.clientHeight);
      if (stick) pin();
    });
    observer.observe(scroller);
    onCleanup(() => {
      observer.disconnect();
      if (pinFrame !== null) cancelAnimationFrame(pinFrame);
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      if (measureFrame !== null) cancelAnimationFrame(measureFrame);
      if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer);
    });
  });

  return (
    <div class="pf-chat-timeline" ref={scroller} onScroll={onScroll}>
      <Show
        when={rows().length > 0}
        fallback={
          <div class="pf-chat-timeline-empty">
            <ForgeEmptyState
              glyph={<EmptyGlyph />}
              eyebrow="Agent"
              title="No messages yet"
              hint="Send a message to start the conversation."
            />
          </div>
        }
      >
        <div
          class="pf-chat-timeline-inner"
          style={{ height: `${Math.max(layout().totalHeight, viewportHeight())}px` }}
        >
          <For each={visibleKeys()}>
            {(key) => (
              <Show when={rowForKey(key)}>
                {(row) => (
                  <MeasuredTimelineRow
                    rowKey={key}
                    row={row()}
                    style={rowStyle(key)}
                    onHeight={queueRowHeight}
                  />
                )}
              </Show>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function MeasuredTimelineRow(props: {
  rowKey: string;
  row: TimelineVirtualRow;
  style: JSX.CSSProperties;
  onHeight: (key: string, height: number) => void;
}): JSX.Element {
  let rowEl!: HTMLDivElement;
  let frame: number | null = null;

  const measure = () => {
    frame = null;
    props.onHeight(props.rowKey, rowEl.getBoundingClientRect().height);
  };

  const scheduleMeasure = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(measure);
  };

  onMount(() => {
    scheduleMeasure();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(rowEl);
    onCleanup(() => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    });
  });

  createEffect(() => {
    props.row;
    scheduleMeasure();
  });

  return (
    <div class="pf-chat-virtual-row" ref={rowEl} style={props.style}>
      {props.row.kind === "item" ? renderItem(props.row.item) : <WorkingRow />}
    </div>
  );
}
