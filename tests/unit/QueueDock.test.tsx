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

  it("still shows entries queued before the flag was turned off", () => {
    // The dock follows the data, not the flag. Entries are text the user typed
    // and never got to send, so hiding them on a flag flip strands them
    // invisibly with no way to remove or drain them (#369).
    flags.messageQueue = false;
    const onRemove = vi.fn();
    dispose = render(
      () => <QueueDock messages={[queued("queued-1", "still here")]} onRemove={onRemove} />,
      root,
    );

    expect(root.querySelector(".pf-chat-queue")).not.toBeNull();
    expect(root.textContent).toContain("still here");

    root.querySelector<HTMLButtonElement>('[aria-label="Remove queued message 1"]')?.click();
    expect(onRemove).toHaveBeenCalledWith("queued-1");
  });

  it("re-voices the header as held and offers the one decision owed", () => {
    const onSendHeld = vi.fn();
    const onDiscard = vi.fn();
    const onFallbackFocus = vi.fn();
    dispose = render(
      () => (
        <QueueDock
          messages={[queued("queued-1", "first"), queued("queued-2", "second")]}
          held
          onSendHeld={onSendHeld}
          onDiscard={onDiscard}
          onFallbackFocus={onFallbackFocus}
          onRemove={() => {}}
        />
      ),
      root,
    );

    const head = root.querySelector(".pf-chat-queue-head");
    expect(head?.textContent).toContain("HELD · 2");
    expect(head?.textContent).not.toContain("QUEUED");
    // The bracket is the indicator, drawn like every other bracket in the
    // system rather than typed as a glyph — so it carries no text.
    const bracket = root.querySelector(".pf-chat-queue-bracket");
    expect(bracket).not.toBeNull();
    expect(bracket?.textContent).toBe("");

    const buttons = [...root.querySelectorAll<HTMLButtonElement>(".pf-approval-btn")];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(["Send 2", "Discard"]);
    // The demanded decision borrows the composition's one ember.
    expect(buttons[0].className).toContain("pf-approval-btn--primary");

    buttons[0].click();
    buttons[1].click();
    expect(onSendHeld).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    // Both actions unmount the button that was clicked, so focus has to be
    // handed somewhere before the mutation or it falls to <body>.
    expect(onFallbackFocus).toHaveBeenCalledTimes(2);

    // Entries stay individually removable while held.
    expect(root.querySelector('[aria-label="Remove queued message 1"]')).not.toBeNull();
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      "Queue held, 2 waiting. Choose send or discard.",
    );
  });

  it("drops the remove control on the entry being dispatched", () => {
    // Removing it would be a silent no-op: the send is already in flight, so
    // the message lands in the timeline regardless (#369).
    const onRemove = vi.fn();
    dispose = render(
      () => (
        <QueueDock
          messages={[queued("queued-1", "going now"), queued("queued-2", "waiting")]}
          drainingId="queued-1"
          onRemove={onRemove}
        />
      ),
      root,
    );

    expect(root.querySelector('[aria-label="Remove queued message 1"]')).toBeNull();
    expect(root.querySelector('[aria-label="Remove queued message 2"]')).not.toBeNull();
    const sending = root.querySelector(".pf-chat-queue-row--sending");
    expect(sending?.getAttribute("aria-label")).toBe("Sending message: going now.");
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

  it("announces a discard as a discard, not as a send", () => {
    // Discard batches queue:[] with held:false, so the effect sees only a
    // shrinking list and used to report the opposite of what the user chose.
    const [messages, setMessages] = createSignal([
      queued("queued-1", "first"),
      queued("queued-2", "second"),
    ]);
    dispose = render(
      () => (
        <QueueDock
          messages={messages()}
          held
          onDiscard={() => setMessages([])}
          onRemove={() => {}}
        />
      ),
      root,
    );

    const discard = [...root.querySelectorAll<HTMLButtonElement>(".pf-approval-btn")][1];
    discard.click();

    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      "Queue discarded, none remaining",
    );
  });

  it("does not attribute a later send to a removal that happened while held", () => {
    // The held branch used to return before consuming the cause flags, so the
    // removal below stayed "pending" and stole the attribution from the send.
    const [messages, setMessages] = createSignal([
      queued("queued-1", "first"),
      queued("queued-2", "second"),
    ]);
    const [held, setHeld] = createSignal(true);
    dispose = render(
      () => (
        <QueueDock
          messages={messages()}
          held={held()}
          onRemove={(id) => setMessages((c) => c.filter((m) => m.id !== id))}
        />
      ),
      root,
    );

    root.querySelector<HTMLButtonElement>('[aria-label="Remove queued message 1"]')?.click();
    // The user then sends the rest, and the store drains the last entry.
    setHeld(false);
    setMessages([]);

    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      "Message sent, none remaining",
    );
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
