// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { ContextMeter, formatCardCost, formatCost } from "../../src/components/chat/ContextMeter";
import type { AgentChatTotals } from "../../src/stores/agentChat";

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
});

function emptyTotals(): AgentChatTotals {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: 0, estimated: false };
}

function mount(props: {
  contextUsed: number | null;
  contextWindow: number | null;
  totals?: AgentChatTotals;
}) {
  dispose = render(
    () => (
      <ContextMeter
        contextUsed={props.contextUsed}
        contextWindow={props.contextWindow}
        totals={props.totals ?? emptyTotals()}
      />
    ),
    root,
  );
  return root;
}

describe("ContextMeter", () => {
  it("renders the compact used/window label and a bar sized to the fraction", () => {
    mount({ contextUsed: 12_000, contextWindow: 200_000 });

    expect(root.querySelector(".pf-chat-context-frac")?.textContent).toBe("12k / 200k");
    const fill = root.querySelector<HTMLElement>(".pf-chat-context-fill");
    expect(fill?.style.width).toBe("6%");
    expect(root.querySelector(".pf-chat-context")?.classList.contains("pf-chat-context--warn"))
      .toBe(false);
  });

  it("clamps the bar to 100% width when used exceeds the window", () => {
    mount({ contextUsed: 230_000, contextWindow: 200_000 });

    const fill = root.querySelector<HTMLElement>(".pf-chat-context-fill");
    expect(fill?.style.width).toBe("100%");
  });

  it("clamps the label too, but flags a surfaced warning instead of hiding the overflow", () => {
    mount({ contextUsed: 230_000, contextWindow: 200_000 });

    // The label never prints raw digits above the window (no "230k / 200k")...
    expect(root.querySelector(".pf-chat-context-frac")?.textContent).toBe("200k / 200k");
    // ...but the inconsistency is surfaced, not silently hidden: a distinct
    // warning class plus a title carrying the raw values.
    const container = root.querySelector(".pf-chat-context");
    expect(container?.classList.contains("pf-chat-context--warn")).toBe(true);
    const label = root.querySelector(".pf-chat-context-frac");
    expect(label?.getAttribute("title")).toContain("230,000");
    expect(label?.getAttribute("title")).toContain("200,000");
  });

  it("exposes the overflow warning to assistive tech, not just a title tooltip", () => {
    // title alone is invisible to keyboard/touch/AT users; pair it with
    // role="img" + aria-label like the repo's other compact-status precedent
    // (src/components/ui.tsx's StatusPill compact mode).
    mount({ contextUsed: 230_000, contextWindow: 200_000 });

    const label = root.querySelector(".pf-chat-context-frac");
    expect(label?.getAttribute("role")).toBe("img");
    expect(label?.getAttribute("aria-label")).toContain("230,000");
    expect(label?.getAttribute("aria-label")).toContain("200,000");
  });

  it("does not warn when used is within the window", () => {
    mount({ contextUsed: 199_999, contextWindow: 200_000 });

    const container = root.querySelector(".pf-chat-context");
    expect(container?.classList.contains("pf-chat-context--warn")).toBe(false);
    const label = root.querySelector(".pf-chat-context-frac");
    expect(label?.getAttribute("title")).toBeNull();
    expect(label?.getAttribute("role")).toBeNull();
    expect(label?.getAttribute("aria-label")).toBeNull();
  });

  it("hides the context block entirely when no window is known, even with cost", () => {
    mount({
      contextUsed: null,
      contextWindow: null,
      totals: { ...emptyTotals(), costUsd: 0.05 },
    });

    expect(root.querySelector(".pf-chat-context-frac")).toBeNull();
    expect(root.querySelector(".pf-chat-context-track")).toBeNull();
    expect(root.querySelector(".pf-chat-context-cost")?.textContent).toBe("$0.0500");
  });

  it("stays hidden entirely when there is neither context nor cost", () => {
    mount({ contextUsed: null, contextWindow: null });

    expect(root.querySelector(".pf-chat-context")).toBeNull();
  });
});

// #361: the sidebar work card's footer is scanned, not read. `$1.8884` is four
// digits nobody compares at a glance and it crowds the branch and `plan M/N`
// items beside it. The composer readout keeps 4dp — same number, different job.
describe("formatCardCost", () => {
  it("renders two decimals at card scale", () => {
    expect(formatCardCost(1.8884, false)).toBe("$1.89");
    expect(formatCardCost(0.41, false)).toBe("$0.41");
    expect(formatCardCost(12, false)).toBe("$12.00");
  });

  it("collapses a sub-cent figure rather than rounding it to $0.00", () => {
    expect(formatCardCost(0.0004, false)).toBe("<$0.01");
    expect(formatCardCost(0.009, false)).toBe("<$0.01");
  });

  it("keeps exact zero as $0.00 — no cost is not the same as nearly none", () => {
    expect(formatCardCost(0, false)).toBe("$0.00");
  });

  it("carries the estimate marker through both branches", () => {
    expect(formatCardCost(1.8884, true)).toBe("~$1.89");
    expect(formatCardCost(0.0004, true)).toBe("~<$0.01");
  });

  it("leaves the composer readout's precision alone", () => {
    expect(formatCost(1.8884, false)).toBe("$1.8884");
    expect(formatCost(0.0004, false)).toBe("$0.0004");
  });
});
