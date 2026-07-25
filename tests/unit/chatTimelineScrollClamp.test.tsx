// @vitest-environment jsdom
//
// Regression coverage for the #332 fix in `applyProgrammaticScroll`
// (src/components/chat/ChatTimeline.tsx): a programmatic pin must track the
// browser-applied (clamped) scrollTop, not the requested target, because a
// stale/optimistic layout estimate can request a target the DOM immediately
// clamps to its real scrollable range. If the component instead remembered
// the unclamped target, the next `scroll` event (which reports the real,
// much-smaller clamped position) looks like a large upward user scroll and
// incorrectly detaches `stick` — freezing the view mid-stream.
//
// `tests/unit/chatTimelineVirtual.test.ts` already pins the pure decision
// helper (`decideTimelineScroll`) against passed-in numbers, but that can't
// distinguish "stored the requested target" from "stored the applied one" —
// both are just numbers to the helper. This test drives the real component
// against a scroller whose `scrollTop` setter clamps writes, so it exercises
// the exact assignment/re-read at ChatTimeline.tsx:333-340.
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

// jsdom implements neither, and ChatTimeline needs both to mount.
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let root: HTMLDivElement;
let dispose: (() => void) | undefined;
let originalRAF: typeof requestAnimationFrame;
let originalCAF: typeof cancelAnimationFrame;
let originalResizeObserver: typeof ResizeObserver | undefined;
let originalClientHeight: PropertyDescriptor | undefined;
let originalScrollHeight: PropertyDescriptor | undefined;
let originalScrollTop: PropertyDescriptor | undefined;

// The real scrollable extent: a browser never lets scrollTop exceed
// `scrollHeight - clientHeight`, no matter what a caller assigns.
const VIEWPORT_HEIGHT = 100;
const REAL_SCROLL_HEIGHT = 400;
const CLAMP_MAX = REAL_SCROLL_HEIGHT - VIEWPORT_HEIGHT;

let scrollTopValues = new WeakMap<Element, number>();
let scrollTopSetCount = 0;
let rafQueue: FrameRequestCallback[] = [];

// Drains queued rAF callbacks, including any newly queued while draining
// (pin() and MeasuredTimelineRow's measure() each re-arm themselves).
function flushRAF(maxRounds = 10): void {
  for (let round = 0; round < maxRounds && rafQueue.length > 0; round++) {
    const pending = rafQueue;
    rafQueue = [];
    for (const cb of pending) cb(0);
  }
}

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  scrollTopValues = new WeakMap();
  scrollTopSetCount = 0;

  originalRAF = globalThis.requestAnimationFrame;
  originalCAF = globalThis.cancelAnimationFrame;
  originalResizeObserver = globalThis.ResizeObserver;
  // Queue rAF callbacks instead of running them inline: ChatTimeline's
  // pin()/measure() helpers assign their own "frame" variable to the
  // `requestAnimationFrame` call's return value *after* the call returns
  // (matching real, async rAF). Invoking the callback synchronously inside
  // `requestAnimationFrame` itself would run the callback's own `frame =
  // null` reset before that outer assignment lands, permanently wedging the
  // guard. `flushRAF()` runs queued callbacks from a separate tick instead.
  rafQueue = [];
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;

  originalClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
  originalScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
  originalScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");

  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get() {
      return VIEWPORT_HEIGHT;
    },
  });
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return REAL_SCROLL_HEIGHT;
    },
  });
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return scrollTopValues.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      scrollTopSetCount += 1;
      scrollTopValues.set(this, Math.min(Math.max(value, 0), CLAMP_MAX));
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
  if (originalClientHeight) Object.defineProperty(Element.prototype, "clientHeight", originalClientHeight);
  if (originalScrollHeight) Object.defineProperty(Element.prototype, "scrollHeight", originalScrollHeight);
  if (originalScrollTop) Object.defineProperty(Element.prototype, "scrollTop", originalScrollTop);
});

// Long enough (~lines * 23px + base) that the layout's *estimated* totalHeight
// vastly exceeds the real, DOM-clamped scrollable range — this is what a pin
// requests a target the browser then clamps.
function bigAssistantText(seq: number): AgentTimelineItem {
  return { type: "assistantText", seq, itemId: `a${seq}`, text: "x".repeat(20_000), streaming: false };
}

describe("ChatTimeline scroll clamp (#332 regression)", () => {
  it("keeps following the stream after a clamped programmatic scroll", () => {
    const [items, setItems] = createSignal<AgentTimelineItem[]>([bigAssistantText(1)]);
    dispose = render(() => <ChatTimeline items={items()} />, root);
    flushRAF();

    const scroller = root.querySelector<HTMLDivElement>(".pf-chat-timeline")!;

    // The initial pin already requested far more than CLAMP_MAX and got
    // clamped by the DOM.
    expect(scroller.scrollTop).toBe(CLAMP_MAX);

    // Simulate the browser's async "settle" scroll event that follows the
    // clamped write, reporting the real (clamped) position.
    scroller.dispatchEvent(new Event("scroll"));

    // More content streams in, growing the layout's estimated height well
    // past the (unchanged) real scrollable range again.
    const setCountBeforeGrowth = scrollTopSetCount;
    setItems([...items(), bigAssistantText(2)]);
    flushRAF();

    // If the settling event had wrongly detached `stick` (because the applied,
    // clamped position looked like a big upward scroll against a stored
    // *requested* target instead of the applied one), the growth above would
    // not re-pin at all: scrollTop's setter would see no further writes.
    expect(scrollTopSetCount).toBeGreaterThan(setCountBeforeGrowth);
    expect(scroller.scrollTop).toBe(CLAMP_MAX);
  });
});
