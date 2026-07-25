// @vitest-environment jsdom
//
// Regression coverage for #352: the timeline must still be pinned to the bottom
// when a turn closes, so the usage row (tokens in/out, cost) that lands right
// after the last text is visible.
//
// The failure was a shrink, not a gesture. At end of turn the working row
// leaves and the streamed row settles to its measured height, so the timeline's
// height drops and the browser clamps `scrollTop` into the smaller range. That
// clamp arrives as a `scroll` event reporting a *smaller* top, which the
// decision helper read as the user scrolling up — follow detached, and the
// usage row appended a tick later was never pinned.
//
// `chatTimelineVirtual.test.ts` pins the pure decision helper against passed-in
// numbers; it cannot show that the component feeds it live geometry on an
// upward event (without which the clamp is indistinguishable from a gesture).
// This drives the real component against a scroller whose height follows the
// rendered inner div, so the shrink and its clamp actually happen.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { AgentTimelineItem } from "../../src/stores/agentChat";

const opener = vi.hoisted(() => ({ openExternalUrl: vi.fn(async () => {}) }));
vi.mock("../../src/lib/opener", () => ({ openExternalUrl: opener.openExternalUrl }));

const terminalHosts = vi.hoisted(() => ({ openFileInChat: vi.fn() }));
vi.mock("../../src/stores/terminalHosts", () => ({
  openFileInChat: terminalHosts.openFileInChat,
}));

const remoteContext = vi.hoisted(() => ({ remotePtyFor: vi.fn(() => null as unknown) }));
vi.mock("../../src/lib/remoteContext", () => ({ remotePtyFor: remoteContext.remotePtyFor }));

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("../../src/components/chat/ImageLightbox", () => ({ openLightbox: () => {} }));

import { ChatTimeline } from "../../src/components/chat/ChatTimeline";

const VIEWPORT_HEIGHT = 300;

// Every row measures to this, well under what `estimateTextHeight` predicts for
// the long text below — the gap between the two is the bug's whole mechanism.
const MEASURED_ROW_HEIGHT = 120;

// Overridable per test: a collapsed log row measures far smaller than this.
let measuredRowHeight = MEASURED_ROW_HEIGHT;

let root: HTMLDivElement;
let dispose: (() => void) | undefined;
let originalRAF: typeof requestAnimationFrame;
let originalCAF: typeof cancelAnimationFrame;
let originalResizeObserver: typeof ResizeObserver | undefined;
const restoreProps: Array<[string, PropertyDescriptor | undefined]> = [];

let scrollTopValues = new WeakMap<Element, number>();
let rafQueue: FrameRequestCallback[] = [];

/** The rendered timeline's own height — the inner div's inline style, which the
 *  component sets from the virtual layout. This is what shrinks at end of turn. */
function innerHeight(): number {
  const inner = root.querySelector<HTMLDivElement>(".pf-chat-timeline-inner");
  return inner ? Number.parseFloat(inner.style.height) || 0 : 0;
}

function maxScrollTop(): number {
  return Math.max(0, innerHeight() - VIEWPORT_HEIGHT);
}

/** Runs queued rAF callbacks, including ones queued while draining, then
 *  delivers the scroll event the browser fires after a clamped write. */
function flushFrames(maxRounds = 12): void {
  for (let round = 0; round < maxRounds && rafQueue.length > 0; round++) {
    const pending = rafQueue;
    rafQueue = [];
    for (const cb of pending) cb(0);
  }
}

function scroller(): HTMLDivElement {
  return root.querySelector<HTMLDivElement>(".pf-chat-timeline")!;
}

/** Applies the browser's own clamp and dispatches the settle event, the way a
 *  real scroller does once its content shrinks under the current scrollTop. */
function settleScroll(): void {
  const element = scroller();
  const clamped = Math.min(scrollTopValues.get(element) ?? 0, maxScrollTop());
  const changed = clamped !== (scrollTopValues.get(element) ?? 0);
  scrollTopValues.set(element, clamped);
  if (changed) element.dispatchEvent(new Event("scroll"));
}

function defineElementProp(name: string, descriptor: PropertyDescriptor): void {
  restoreProps.push([name, Object.getOwnPropertyDescriptor(Element.prototype, name)]);
  Object.defineProperty(Element.prototype, name, { configurable: true, ...descriptor });
}

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  scrollTopValues = new WeakMap();
  rafQueue = [];
  measuredRowHeight = MEASURED_ROW_HEIGHT;

  originalRAF = globalThis.requestAnimationFrame;
  originalCAF = globalThis.cancelAnimationFrame;
  originalResizeObserver = globalThis.ResizeObserver;
  // Queue rather than run inline: the component assigns its `frame` handle
  // *after* requestAnimationFrame returns, so a synchronous callback would run
  // the callback's own reset first and wedge the guard forever.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;

  defineElementProp("clientHeight", {
    get(this: Element) {
      return this.classList.contains("pf-chat-timeline") ? VIEWPORT_HEIGHT : 0;
    },
  });
  defineElementProp("scrollHeight", {
    get(this: Element) {
      return this.classList.contains("pf-chat-timeline") ? innerHeight() : 0;
    },
  });
  defineElementProp("scrollTop", {
    get(this: Element) {
      return scrollTopValues.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      scrollTopValues.set(this, Math.min(Math.max(value, 0), maxScrollTop()));
    },
  });
  // Rows report a fixed measured height; jsdom has no layout of its own.
  restoreProps.push([
    "getBoundingClientRect",
    Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect"),
  ]);
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: Element) {
      const height = this.classList.contains("pf-chat-virtual-row") ? measuredRowHeight : 0;
      return { top: 0, left: 0, right: 0, bottom: height, width: 0, height, x: 0, y: 0 } as DOMRect;
    },
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  globalThis.requestAnimationFrame = originalRAF;
  globalThis.cancelAnimationFrame = originalCAF;
  if (originalResizeObserver) globalThis.ResizeObserver = originalResizeObserver;
  else delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  for (const [name, descriptor] of restoreProps.reverse()) {
    if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
    else delete (Element.prototype as unknown as Record<string, unknown>)[name];
  }
  restoreProps.length = 0;
});

// Long enough that the row's *estimate* dwarfs its measured height.
const LONG_TEXT = "x".repeat(20_000);

function assistant(seq: number, streaming: boolean): AgentTimelineItem {
  return { type: "assistantText", seq, itemId: `a${seq}`, text: LONG_TEXT, streaming };
}

/** A turn tall enough to actually scroll: the last row is the streaming tail. */
function turn(streaming: boolean): AgentTimelineItem[] {
  return [assistant(1, false), assistant(2, false), assistant(3, streaming)];
}

/** What the virtual layout should come to for `rows` rows of measured height. */
function expectedHeight(rows: number, height = MEASURED_ROW_HEIGHT, gap = 4): number {
  return 16 * 2 + height * rows + gap * (rows - 1);
}

function usage(seq: number): AgentTimelineItem {
  return {
    type: "usage",
    seq,
    inputTokens: 1_200,
    cachedInputTokens: 0,
    outputTokens: 340,
    costUsd: 0.02,
    estimatedCostUsd: null,
  };
}

describe("ChatTimeline end-of-turn follow (#352)", () => {
  it("does not reserve estimated height under a mounted streaming row", () => {
    const [items] = createSignal<AgentTimelineItem[]>(turn(true));
    dispose = render(() => <ChatTimeline items={items()} working={true} />, root);
    flushFrames();

    // Three text rows plus the working row, all measured. Anything larger means
    // the estimate is still reserving space the content does not use — the wall
    // of empty black below the stream.
    expect(innerHeight()).toBe(expectedHeight(4));
  });

  it("gives a collapsed log row its measured height, with no floor (#352)", () => {
    // A 48px floor used to sit under every measurement, so a 24px collapsed
    // command/thinking/usage row still occupied a 48px slot. The dead space
    // that produced is what made the timeline read as an airy card list.
    measuredRowHeight = 24;
    const [items] = createSignal<AgentTimelineItem[]>(turn(false));
    dispose = render(() => <ChatTimeline items={items()} working={false} />, root);
    flushFrames();

    // Below the viewport floor, so assert on the layout rather than the
    // inner div's `max(totalHeight, viewportHeight)` clamp.
    const rowTops = Array.from(
      root.querySelectorAll<HTMLDivElement>(".pf-chat-virtual-row"),
      (el) => Number.parseFloat(/translate3d\(0, ([-\d.]+)px/.exec(el.style.transform)?.[1] ?? "0"),
    );
    expect(rowTops).toEqual([16, 16 + 24 + 4, 16 + (24 + 4) * 2]);
  });

  it("pins the usage row that lands after the turn's content shrinks", () => {
    const [items, setItems] = createSignal<AgentTimelineItem[]>(turn(true));
    const [working, setWorking] = createSignal(true);
    dispose = render(() => <ChatTimeline items={items()} working={working()} />, root);
    flushFrames();
    settleScroll();

    expect(scroller().scrollTop).toBe(maxScrollTop());

    // Turn closes: the working row leaves, so the timeline shrinks under the
    // current scrollTop. The browser clamps at layout time — before any rAF of
    // ours runs — and the settle event is what used to read as a scroll-up.
    setItems(turn(false));
    setWorking(false);
    settleScroll();
    flushFrames();

    // The usage row arrives a tick later, as the reducer appends it.
    setItems([...turn(false), usage(4)]);
    flushFrames();
    settleScroll();

    expect(scroller().scrollTop).toBe(maxScrollTop());
    expect(root.querySelector(".pf-chat-tokens")).not.toBeNull();
  });

  it("still detaches when the user scrolls up mid-stream", () => {
    const [items, setItems] = createSignal<AgentTimelineItem[]>(turn(true));
    dispose = render(() => <ChatTimeline items={items()} working={true} />, root);
    flushFrames();
    settleScroll();

    const element = scroller();
    const bottom = maxScrollTop();
    expect(bottom).toBeGreaterThan(40);

    scrollTopValues.set(element, bottom - 40);
    element.dispatchEvent(new Event("scroll"));

    setItems([...turn(false), assistant(4, true)]);
    flushFrames();

    expect(element.scrollTop).toBe(bottom - 40);
  });
});
