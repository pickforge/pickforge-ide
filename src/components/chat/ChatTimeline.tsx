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
import { ChangesReceiptCard, type ChangesReceiptStatus } from "./ChangesReceiptCard";
import { ToolUseCard } from "./ToolUseCard";
import { McpCard } from "./McpCard";
import { WebSearchCard } from "./WebSearchCard";
import { PlanCard } from "./PlanCard";
import { TokenBadge } from "./TokenBadge";
import { isPlanPinned, togglePlanPinned } from "../../stores/pinnedAgentPlans";
import { reviewTurnChanges } from "../../lib/changesReceiptActions";
import type { ChangeSet } from "../../lib/changes";
import "./chat.css";

/** Resolves a chat receipt's turn ordinal to its backend `ChangeSet` (#231
 *  PR2's `changes_list_turn_change_sets`) plus that fetch's loading/error
 *  state. The data fetch itself lives one level up (`AgentChatView`, which
 *  owns `chatId`/`projectRoot` and knows when a new turn closed); this is
 *  just the read seam threaded down through the virtualized timeline. */
export interface ChangesReceiptSource {
  changeSetAt: (ordinal: number) => ChangeSet | undefined;
  loading: () => boolean;
  error: () => boolean;
}

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

/** Persists a row's expansion toggle by key so it survives virtualization
 *  remounts. `key` scopes each toggle (the row key, plus a sub-key for the
 *  file-change list's per-file diffs). */
export interface RowExpansion {
  get: (key: string) => boolean;
  toggle: (key: string) => void;
}

function resolveChangesReceiptStatus(
  ordinal: number,
  receipts?: ChangesReceiptSource,
): ChangesReceiptStatus {
  if (!receipts) return "unavailable";
  if (receipts.changeSetAt(ordinal)) return "ready";
  if (receipts.loading()) return "loading";
  if (receipts.error()) return "error";
  return "unavailable";
}

// eslint-disable-next-line complexity -- TODO(#263): reduce legacy function complexity.
function renderItem(
  item: AgentTimelineItem,
  rowKey: string,
  chatId?: string,
  expansion?: RowExpansion,
  projectRoot?: string,
  changesReceipts?: ChangesReceiptSource,
): JSX.Element {
  // Inline `open={...}` / `onToggle={...}` (not a spread) so SolidJS keeps `open`
  // reactive — the child re-reads it when `expansion.get` bumps the version.
  switch (item.type) {
    case "userMessage":
      if (item.hidden) return <></>;
      return <ChatBubble role="user" text={item.text} images={item.images} />;
    case "assistantText":
      return <ChatBubble role="assistant" text={item.text} streaming={item.streaming} />;
    case "thinking":
      return (
        <ThinkingBubble
          text={item.text}
          streaming={item.streaming}
          open={expansion ? expansion.get(rowKey) : undefined}
          onToggle={expansion ? () => expansion.toggle(rowKey) : undefined}
        />
      );
    case "command":
      return (
        <CommandCard
          command={item.command}
          status={item.status}
          exitCode={item.exitCode}
          outputTail={item.outputTail}
          open={expansion ? expansion.get(rowKey) : undefined}
          onToggle={expansion ? () => expansion.toggle(rowKey) : undefined}
        />
      );
    case "fileChange":
      // An in-progress turn keeps the existing raw per-event card; only a
      // COMPLETED turn collapses to the compact receipt (#231 PR3).
      if (!item.turnComplete) {
        return <FileChangeCard changes={item.changes} expansion={expansion} rowKey={rowKey} />;
      }
      return (
        <ChangesReceiptCard
          status={resolveChangesReceiptStatus(item.ordinal, changesReceipts)}
          changeSet={changesReceipts?.changeSetAt(item.ordinal) ?? null}
          open={expansion ? expansion.get(rowKey) : undefined}
          onToggle={expansion ? () => expansion.toggle(rowKey) : undefined}
          onReviewChanges={() => {
            const changeSet = changesReceipts?.changeSetAt(item.ordinal);
            if (changeSet && chatId && projectRoot) reviewTurnChanges(chatId, projectRoot, changeSet);
          }}
        />
      );
    case "toolUse":
      return <ToolUseCard name={item.name} detail={item.detail} />;
    case "mcpToolCall":
      return <McpCard server={item.server} tool={item.tool} />;
    case "webSearch":
      return <WebSearchCard query={item.query} />;
    case "plan":
      return (
        <PlanCard
          items={item.items}
          pinned={chatId ? isPlanPinned(chatId) : undefined}
          onTogglePin={chatId ? () => togglePlanPinned(chatId) : undefined}
        />
      );
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

// eslint-disable-next-line max-lines-per-function -- TODO(#263): reduce legacy function complexity.
export function ChatTimeline(props: {
  items: AgentTimelineItem[];
  working?: boolean;
  chatId?: string;
  projectRoot?: string;
  changesReceipts?: ChangesReceiptSource;
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
  // Row heights are width-dependent (text wraps), so a horizontal resize makes
  // every cached height stale. Track the scroller's content width and drop the
  // cache when it changes so rows remeasure at the new width.
  let lastContentWidth = 0;
  const THRESHOLD = 96;
  const SCROLL_IDLE_MS = 120;
  const rowHeights = new Map<string, number>();
  const queuedRowHeights = new Map<string, number>();
  const deferredRowHeights = new Map<string, number>();
  const [heightVersion, setHeightVersion] = createSignal(0);
  // Virtualization disposes rows that leave the overscan, so any expansion state
  // held inside a row (thinking / command output / file diff) would reset when
  // it scrolls back. Persist it here, keyed by a stable row/sub-row key, so the
  // toggle survives remount. The version signal makes reads reactive.
  const expandedKeys = new Map<string, boolean>();
  const [expandedVersion, setExpandedVersion] = createSignal(0);
  const expansion = {
    get: (key: string) => {
      expandedVersion();
      return expandedKeys.get(key) ?? false;
    },
    toggle: (key: string) => {
      expandedKeys.set(key, !(expandedKeys.get(key) ?? false));
      setExpandedVersion((version) => version + 1);
    },
  };
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);
  // True while App.tsx holds `body.pf-window-resizing` — row widths change every
  // tick, so we defer height commits (see flushQueuedRowHeights) until settle.
  const [windowResizing, setWindowResizing] = createSignal(false);
  const [metrics, setMetrics] = createSignal({
    padding: DEFAULT_VIRTUAL_PADDING_PX,
    gap: DEFAULT_VIRTUAL_GAP_PX,
  });

  const rows = createMemo(() => buildTimelineRows(props.items, props.working));

  const layout = createMemo(() => {
    heightVersion();
    return buildTimelineLayout(rows(), metrics(), rowHeights);
  });

  // Reads only cached signals (no scrollHeight/clientHeight) so the scroll
  // handler never forces a layout flush — that flush per scroll event is the
  // main scroll-jank cost on WebKitGTK (macOS WKWebView absorbs it).
  const atBottom = (top: number) =>
    layout().totalHeight - top - viewportHeight() < THRESHOLD;

  // The row spanning `top` and how far `top` sits into it, in the current layout.
  // Used to keep a detached reader anchored across a height invalidation.
  const anchorRowAt = (top: number): { key: string; offset: number } | null => {
    const current = layout();
    const { rows: layoutRows, starts } = current;
    if (layoutRows.length === 0) return null;
    const target = top - metrics().padding;
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= target) lo = mid + 1;
      else hi = mid;
    }
    const index = Math.max(0, lo - 1);
    const key = timelineVirtualRowKey(layoutRows[index]);
    return { key, offset: top - (starts[index] + metrics().padding) };
  };

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
      const target = Math.max(0, layout().totalHeight - viewportHeight());
      if (Math.abs(target - scroller.scrollTop) < 1) return;
      applyProgrammaticScroll(target);
    });
  };

  // eslint-disable-next-line complexity -- TODO(#263): reduce legacy function complexity.
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
    // Each commit recomputes layout O(n) over all rows and re-applies every
    // visible row's transform. While the user is scrolling or the window is
    // being resized, defer those commits — WebKitGTK pays them on the main
    // thread (macOS WKWebView hides it). They flush on scroll-idle / resize-settle.
    if (userScrolling || windowResizing()) {
      for (const [key, height] of updates) deferredRowHeights.set(key, height);
      return;
    }
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
    else if (atBottom(top)) stick = true; // user returned to the bottom → follow again
    lastTop = top;
  };

  // A wheel-up gesture should detach the streaming follow even when it can't move
  // scrollTop (the content already fits the viewport, or a sub-pixel touchpad
  // delta) — otherwise onScroll never fires and the next streamed token re-pins
  // the view against the user's intent.
  const onWheel = (event: WheelEvent) => {
    if (event.deltaY < 0 && stick) stick = false;
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

    // The virtual padding/gap are token-based CSS vars that only change when the
    // theme flips — not on resize. Re-read on `data-theme` change instead of on
    // every resize tick; getComputedStyle forces a style-recalc on WebKitGTK.
    const themeObserver = new MutationObserver(() => readMetrics());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    // App.tsx toggles `body.pf-window-resizing` during a window resize. While
    // it's active every visible row's ResizeObserver fires each tick (row width
    // changes with window width), so defer those commits and flush once on settle
    // rather than recomputing layout + re-applying transforms every tick.
    const bodyObserver = new MutationObserver(() => {
      const resizing = document.body.classList.contains("pf-window-resizing");
      setWindowResizing(resizing);
      if (!resizing) flushDeferredRowHeights();
    });
    bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    setWindowResizing(document.body.classList.contains("pf-window-resizing"));

    // Coalesce the scroller's own resize ticks into one rAF: a single
    // clientHeight read + pin per frame, no getComputedStyle on the hot path.
    lastContentWidth = scroller.clientWidth;
    let resizeFrame: number | null = null;
    const scrollerObserver = new ResizeObserver(() => {
      if (resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        setViewportHeight(scroller.clientHeight);
        // Width changed → cached row heights (measured at the old width) are
        // stale for any wrapped text. Drop them so rows remeasure; the layout
        // falls back to estimates until each row is re-observed.
        const width = scroller.clientWidth;
        if (width !== lastContentWidth && width > 0) {
          lastContentWidth = width;
          if (rowHeights.size > 0) {
            // A detached reader is anchored to whatever they scrolled to; clearing
            // heights shifts every row's start, so capture the first visible row
            // and the offset into it, then restore that offset after the layout
            // recomputes so the view doesn't jump. (When stuck, pin() re-anchors
            // to the bottom anyway, so skip the extra work.)
            const currentTop = scroller.scrollTop;
            const anchor = stick ? null : anchorRowAt(currentTop);
            rowHeights.clear();
            queuedRowHeights.clear();
            deferredRowHeights.clear();
            setHeightVersion((version) => version + 1);
            if (anchor) {
              const nextLayout = layout();
              const index = nextLayout.keyToIndex.get(anchor.key);
              if (index !== undefined) {
                applyProgrammaticScroll(
                  Math.max(0, nextLayout.starts[index] + metrics().padding + anchor.offset),
                );
              }
            }
          }
        }
        if (stick) pin();
      });
    });
    scrollerObserver.observe(scroller);
    onCleanup(() => {
      scrollerObserver.disconnect();
      themeObserver.disconnect();
      bodyObserver.disconnect();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      if (pinFrame !== null) cancelAnimationFrame(pinFrame);
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      if (measureFrame !== null) cancelAnimationFrame(measureFrame);
      if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer);
    });
  });

  return (
    <div class="pf-chat-timeline" ref={scroller} onScroll={onScroll} onWheel={onWheel}>
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
                    chatId={props.chatId}
                    projectRoot={props.projectRoot}
                    changesReceipts={props.changesReceipts}
                    expansion={expansion}
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
  chatId?: string;
  projectRoot?: string;
  changesReceipts?: ChangesReceiptSource;
  expansion?: RowExpansion;
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
      {props.row.kind === "item"
        ? renderItem(
            props.row.item,
            props.rowKey,
            props.chatId,
            props.expansion,
            props.projectRoot,
            props.changesReceipts,
          )
        : <WorkingRow />}
    </div>
  );
}
