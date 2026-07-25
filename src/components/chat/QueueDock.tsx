import { For, Show, createEffect, createSignal, type JSX } from "solid-js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { type QueuedMessage } from "../../stores/agentChat";
import { flagEnabled } from "../../stores/flags";
import "./chat.css";

const MAX_THUMBNAILS = 4;
const SUMMARY_LENGTH = 80;

function messageSummary(message: QueuedMessage): string {
  const summary = message.text.replace(/\s+/g, " ").trim().slice(0, SUMMARY_LENGTH);
  return summary || "Image-only message";
}

function queuedMessageLabel(message: QueuedMessage, index: number, total: number): string {
  const position = index === 0 ? " Sends next." : "";
  return `Queued message ${index + 1} of ${total}: ${messageSummary(message)}. Sends when the turn ends.${position}`;
}

function queuedCount(count: number): string {
  return `${count} ${count === 1 ? "message" : "messages"} queued`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function QueueEntry(props: {
  message: QueuedMessage;
  index: number;
  total: number;
  removing: boolean;
  registerRemove: (id: string, element: HTMLButtonElement) => void;
  onRemove: (id: string) => void;
  onRemoveAnimationEnd: (id: string) => void;
}): JSX.Element {
  return (
    <li
      class="pf-chat-queue-row"
      classList={{ "pf-chat-queue-row--removing": props.removing }}
      aria-label={queuedMessageLabel(props.message, props.index, props.total)}
      onAnimationEnd={() => props.onRemoveAnimationEnd(props.message.id)}
    >
      <div class="pf-chat-queue-collapse">
        <div class="pf-chat-queue-item">
          <Show when={props.message.images.length > 0}>
            <div class="pf-chat-queue-thumbs" aria-hidden="true">
              <For each={props.message.images.slice(0, MAX_THUMBNAILS)}>
                {(image) => (
                  <img class="pf-chat-queue-thumb" src={convertFileSrc(image)} alt="" />
                )}
              </For>
              <Show when={props.message.images.length > MAX_THUMBNAILS}>
                <span class="pf-chat-queue-thumb-more">
                  +{props.message.images.length - MAX_THUMBNAILS}
                </span>
              </Show>
            </div>
          </Show>
          <div class="pf-chat-queue-content">
            <Show when={props.message.text.trim().length > 0}>
              <span class="pf-chat-queue-text">{props.message.text}</span>
            </Show>
            <button
              ref={(element) => {
                props.registerRemove(props.message.id, element);
              }}
              type="button"
              class="pf-chat-queue-remove"
              aria-label={`Remove queued message ${props.index + 1}`}
              onClick={() => props.onRemove(props.message.id)}
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

interface QueueDockProps {
  messages: readonly QueuedMessage[];
  onRemove: (id: string) => void;
  onFallbackFocus?: () => void;
}

export function QueueDock(props: QueueDockProps): JSX.Element {
  const [removing, setRemoving] = createSignal<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = createSignal(queuedCount(props.messages.length));
  const removeButtons = new Map<string, HTMLButtonElement>();
  let previousIds = props.messages.map((message) => message.id);
  let manuallyRemovedId: string | null = null;

  createEffect(() => {
    if (!flagEnabled("messageQueue")) {
      previousIds = [];
      return;
    }
    const messages = props.messages;
    const ids = messages.map((message) => message.id);
    if (messages.length === 0) {
      previousIds = ids;
      return;
    }
    if (previousIds.length === 0 || ids.length > previousIds.length) {
      setAnnouncement(queuedCount(messages.length));
    } else if (ids.length < previousIds.length) {
      const removedManually = manuallyRemovedId !== null && !ids.includes(manuallyRemovedId);
      setAnnouncement(
        removedManually
          ? `Queued message removed, ${messages.length} remaining`
          : `Message sent, ${messages.length} remaining`,
      );
      manuallyRemovedId = null;
    }
    previousIds = ids;
  });

  const focusAfterRemoval = (id: string) => {
    const available = props.messages.filter(
      (message) => message.id !== id && !removing().has(message.id),
    );
    const removedIndex = props.messages.findIndex((message) => message.id === id);
    const next = available.find(
      (message) => props.messages.findIndex((candidate) => candidate.id === message.id) > removedIndex,
    );
    const previous = [...available].reverse().find(
      (message) => props.messages.findIndex((candidate) => candidate.id === message.id) < removedIndex,
    );
    const target = next ?? previous;
    if (target) {
      removeButtons.get(target.id)?.focus();
      return;
    }
    props.onFallbackFocus?.();
  };

  const finishRemove = (id: string) => {
    manuallyRemovedId = id;
    setRemoving((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    props.onRemove(id);
  };

  const remove = (id: string) => {
    if (removing().has(id)) return;
    focusAfterRemoval(id);
    if (prefersReducedMotion()) {
      finishRemove(id);
      return;
    }
    setRemoving((current) => new Set(current).add(id));
  };

  return (
    <Show when={flagEnabled("messageQueue") && props.messages.length > 0}>
      <section class="pf-chat-queue" role="region" aria-label="Message queue">
        <div class="pf-chat-queue-head">QUEUED · {props.messages.length}</div>
        {/* A live region announces its *content* changing, so the wording has
            to be the element's text — putting it in `aria-label` on the visible
            header would both go unspoken and override "QUEUED · n" as that
            header's accessible name. */}
        <span class="pf-chat-queue-live" role="status" aria-live="polite" aria-atomic="true">
          {announcement()}
        </span>
        <ol class="pf-chat-queue-list">
          <For each={props.messages}>
            {(message, index) => (
              <QueueEntry
                message={message}
                index={index()}
                total={props.messages.length}
                removing={removing().has(message.id)}
                registerRemove={(id, element) => removeButtons.set(id, element)}
                onRemove={remove}
                onRemoveAnimationEnd={(id) => {
                  if (removing().has(id)) finishRemove(id);
                }}
              />
            )}
          </For>
        </ol>
      </section>
    </Show>
  );
}
