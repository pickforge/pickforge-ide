// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { PlanCard } from "../../src/components/chat/PlanCard";
import type { PlanItem } from "../../src/lib/agentChat";

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

function mount(items: PlanItem[], props: { pinned?: boolean; onTogglePin?: () => void } = {}) {
  dispose = render(() => <PlanCard items={items} {...props} />, root);
  return root;
}

describe("PlanCard", () => {
  it("renders the [ ], [>], [x] markers for pending, in-progress, and completed steps", () => {
    mount([
      { text: "pending step", status: "pending" },
      { text: "active step", status: "inProgress" },
      { text: "done step", status: "completed" },
    ]);

    const marks = Array.from(root.querySelectorAll(".pf-chat-plan-mark")).map(
      (el) => el.textContent,
    );
    expect(marks).toEqual(["[ ]", "[>]", "[x]"]);
  });

  it("counts only completed items in the done/total summary", () => {
    mount([
      { text: "pending step", status: "pending" },
      { text: "active step", status: "inProgress" },
      { text: "done step", status: "completed" },
      { text: "second done step", status: "completed" },
    ]);

    expect(root.querySelector(".pf-chat-meta")?.textContent).toBe("2/4");
  });

  it("exposes the active step to assistive technology via aria-current", () => {
    mount([
      { text: "pending step", status: "pending" },
      { text: "active step", status: "inProgress" },
      { text: "done step", status: "completed" },
    ]);

    const items = root.querySelectorAll(".pf-chat-plan-item");
    expect(items[0].getAttribute("aria-current")).toBeNull();
    expect(items[1].getAttribute("aria-current")).toBe("step");
    expect(items[2].getAttribute("aria-current")).toBeNull();
  });

  it("applies a distinct active style to in-progress steps beyond color", () => {
    mount([{ text: "active step", status: "inProgress" }]);

    const item = root.querySelector(".pf-chat-plan-item");
    expect(item?.classList.contains("pf-chat-plan-item--active")).toBe(true);
    expect(item?.classList.contains("pf-chat-plan-item--done")).toBe(false);
  });

  it("renders an empty plan without markers", () => {
    mount([]);

    expect(root.querySelectorAll(".pf-chat-plan-item")).toHaveLength(0);
    expect(root.querySelector(".pf-chat-meta")?.textContent).toBe("0/0");
  });

  it("toggles pin state through onTogglePin", () => {
    const onTogglePin = vi.fn();
    mount([{ text: "step", status: "pending" }], { pinned: true, onTogglePin });

    const pinButton = root.querySelector<HTMLButtonElement>(".pf-chat-plan-pin");
    expect(pinButton?.getAttribute("aria-pressed")).toBe("true");
    pinButton?.click();
    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });
});
