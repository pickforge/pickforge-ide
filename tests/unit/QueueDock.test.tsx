// @vitest-environment jsdom
// @vitest-environment-options {"jsdom":{"customExportConditions":["browser"]}}
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedMessage } from "../../src/stores/agentChat";

const flags = vi.hoisted(() => ({ messageQueue: true }));
vi.mock("../../src/stores/flags", () => ({
  flagEnabled: (key: string) => key === "messageQueue" && flags.messageQueue,
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

import { QueueDock } from "../../src/components/chat/QueueDock";

function queued(id: string, text: string): QueuedMessage {
  return { id, text, images: [], queuedAt: 1 };
}

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  flags.messageQueue = true;
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  vi.clearAllMocks();
});

describe("QueueDock", () => {
  it("renders nothing when the queue is empty", () => {
    dispose = render(() => <QueueDock messages={[]} onRemove={() => {}} />, root);

    // The live region stays mounted so emptying the queue can be announced;
    // the dock itself must not render.
    expect(root.querySelector(".pf-chat-queue")).toBeNull();
    expect(root.querySelector('[role="region"]')).toBeNull();
    expect(root.textContent).toBe("");
  });

  it("renders nothing while the messageQueue flag is off", () => {
    flags.messageQueue = false;
    dispose = render(
      () => <QueueDock messages={[queued("queued-1", "hidden")]} onRemove={() => {}} />,
      root,
    );

    expect(root.querySelector(".pf-chat-queue")).toBeNull();
    expect(root.textContent).toBe("");
  });

  it("announces the queue emptying after the last entry leaves", () => {
    // The live region used to unmount with the last row, so the transition
    // that matters most — the queue draining to nothing — was silent.
    const [messages, setMessages] = createSignal([queued("queued-1", "only")]);
    dispose = render(
      () => <QueueDock messages={messages()} onRemove={() => setMessages([])} />,
      root,
    );
    const live = () => root.querySelector('[role="status"]')?.textContent;
    expect(live()).toBe("1 message queued");

    root.querySelector<HTMLButtonElement>('[aria-label="Remove queued message 1"]')?.click();

    expect(root.querySelector(".pf-chat-queue")).toBeNull();
    expect(live()).toBe("Queued message removed, none remaining");
  });

  it("announces a drained message distinctly from a manual removal", () => {
    const [messages, setMessages] = createSignal([
      queued("queued-1", "first"),
      queued("queued-2", "second"),
    ]);
    dispose = render(
      () => <QueueDock messages={messages()} onRemove={() => {}} />,
      root,
    );

    // The store drops the head entry when it drains — no remove click.
    setMessages((current) => current.slice(1));

    expect(root.querySelector('[role="status"]')?.textContent).toBe("Message sent, 1 remaining");
  });

  it("removes the selected entry and keeps the other queued message", () => {
    const [messages, setMessages] = createSignal([
      queued("queued-1", "first"),
      queued("queued-2", "second"),
    ]);
    const onRemove = vi.fn((id: string) => {
      setMessages((current) => current.filter((message) => message.id !== id));
    });
    dispose = render(
      () => <QueueDock messages={messages()} onRemove={onRemove} />,
      root,
    );

    const removeSecond = root.querySelector<HTMLButtonElement>(
      '[aria-label="Remove queued message 2"]',
    );
    removeSecond?.click();

    // Removal commits straight to the store — it is never deferred behind an
    // exit animation that a closing turn could race.
    expect(onRemove).toHaveBeenCalledWith("queued-2");
    expect(root.querySelector('[aria-label="Remove queued message 1"]')).not.toBeNull();
    expect(root.textContent).toContain("first");
    expect(root.textContent).not.toContain("second");
  });
});
