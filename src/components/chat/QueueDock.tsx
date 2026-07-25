import { For, Show, createEffect, createSignal, type JSX } from "solid-js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { type QueuedMessage } from "../../stores/agentChat";
import "./chat.css";

const MAX_THUMBNAILS = 4;
const SUMMARY_LENGTH = 80;

function messageSummary(message: QueuedMessage): string {
  const summary = message.text.replace(/\s+/g, " ").trim().slice(0, SUMMARY_LENGTH);
  return summary || "Image-only message";
}

function queuedMessageLabel(
  message: QueuedMessage,
  index: number,
  total: number,
  sending: boolean,
): string {
  const count = message.images.length;
  // The thumbnail strip is decorative, so attachments are invisible to a
  // screen reader unless the label says so.
  const images = count > 0 ? ` ${count} image${count === 1 ? "" : "s"} attached.` : "";
  if (sending) return `Sending message: ${messageSummary(message)}.${images}`;
  const next = index === 0 ? " Sends next." : "";
  return `Queued message ${index + 1} of ${total}: ${messageSummary(message)}.${images} Sends when the turn ends.${next}`;
}

function remaining(count: number): string {
  return count === 0 ? "none remaining" : `${count} remaining`;
}

function QueueEntry(props: {
  message: QueuedMessage;
  index: number;
  total: number;
  sending: boolean;
  registerRemove: (id: string, element: HTMLButtonElement) => void;
  onRemove: (id: string) => void;
}): JSX.Element {
  return (
    <li
      class="pf-chat-queue-row"
      classList={{ "pf-chat-queue-row--sending": props.sending }}
      aria-label={queuedMessageLabel(props.message, props.index, props.total, props.sending)}
    >
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
          <Show when={!props.sending}>
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
          </Show>
        </div>
      </div>
    </li>
  );
}

/** Resting, the header is a plain mono count. Held, it re-voices as
 *  bracket-cornered status and takes on the one decision the user owes. */
function QueueHeader(props: {
  count: number;
  held: boolean;
  onSendHeld: () => void;
  onDiscard: () => void;
}): JSX.Element {
  return (
    <div class="pf-chat-queue-head">
      <Show when={props.held} fallback={<span>QUEUED · {props.count}</span>}>
        {/* The bracket is the indicator — never a filled chip, never a dot —
            and it alone carries the warning colour; the words stay neutral. */}
        <span class="pf-chat-queue-status">
          <span class="pf-chat-queue-bracket" />
          HELD · {props.count}
        </span>
        <span class="pf-chat-queue-actions">
          <button
            type="button"
            class="pf-approval-btn pf-approval-btn--primary"
            onClick={() => props.onSendHeld()}
          >
            Send {props.count}
          </button>
          <button
            type="button"
            class="pf-approval-btn pf-approval-btn--quiet"
            onClick={() => props.onDiscard()}
          >
            Discard
          </button>
        </span>
      </Show>
    </div>
  );
}

interface QueueDockProps {
  messages: readonly QueuedMessage[];
  onRemove: (id: string) => void;
  onFallbackFocus?: () => void;
  /** The entry currently being dispatched — past the point of cancellation. */
  drainingId?: string | null;
  /** Held after an interrupt or a reconnect: nothing sends without a choice. */
  held?: boolean;
  onSendHeld?: () => void;
  onDiscard?: () => void;
}

export function QueueDock(props: QueueDockProps): JSX.Element {
  const [announcement, setAnnouncement] = createSignal("");
  const removeButtons = new Map<string, HTMLButtonElement>();
  let previousIds: string[] = [];
  let manuallyRemovedId: string | null = null;
  let discardedAll = false;

  createEffect(() => {
    const ids = props.messages.map((message) => message.id);
    for (const id of removeButtons.keys()) {
      if (!ids.includes(id)) removeButtons.delete(id);
    }
    if (previousIds.length === 0 && ids.length === 0) {
      previousIds = ids;
      return;
    }
    if (props.held && ids.length > 0) {
      setAnnouncement(`Queue held, ${ids.length} waiting. Choose send or discard.`);
    } else if (ids.length > previousIds.length) {
      setAnnouncement(`${ids.length} ${ids.length === 1 ? "message" : "messages"} queued`);
    } else if (ids.length < previousIds.length) {
      const byHand = manuallyRemovedId !== null && !ids.includes(manuallyRemovedId);
      if (discardedAll) setAnnouncement(`Queue discarded, ${remaining(ids.length)}`);
      else if (byHand) setAnnouncement(`Queued message removed, ${remaining(ids.length)}`);
      else setAnnouncement(`Message sent, ${remaining(ids.length)}`);
    }
    // Consumed unconditionally: a run that took the held branch used to leave
    // these set, so the next shrink was attributed to whatever happened before
    // the hold rather than to what actually just changed.
    manuallyRemovedId = null;
    discardedAll = false;
    previousIds = ids;
  });

  const focusAfterRemoval = (index: number) => {
    const after = props.messages[index + 1];
    const before = index > 0 ? props.messages[index - 1] : undefined;
    const target = after ?? before;
    const button = target ? removeButtons.get(target.id) : undefined;
    // The dispatching entry keeps its place in the queue but loses its Remove
    // control, so the map can still hold that detached node. Focusing it is a
    // silent no-op that would drop focus to <body>.
    if (button?.isConnected) button.focus();
    else props.onFallbackFocus?.();
  };

  const remove = (id: string) => {
    if (id === props.drainingId) return;
    const index = props.messages.findIndex((message) => message.id === id);
    if (index < 0) return;
    manuallyRemovedId = id;
    focusAfterRemoval(index);
    // Committed straight to the store. Deferring removal behind an exit
    // animation would let a turn closing in that window drain the very entry
    // the user just deleted, and a cancelled animation would strand it.
    props.onRemove(id);
    removeButtons.delete(id);
  };

  return (
    <>
      {/* Always mounted: a live region that unmounts with the last entry can
          never announce that the queue emptied. */}
      <span class="pf-chat-queue-live" role="status" aria-live="polite" aria-atomic="true">
        {announcement()}
      </span>
      <Show when={props.messages.length > 0}>
        <section class="pf-chat-queue" role="region" aria-label="Message queue">
          <QueueHeader
            count={props.messages.length}
            held={props.held === true}
            onSendHeld={() => {
              props.onFallbackFocus?.();
              props.onSendHeld?.();
            }}
            onDiscard={() => {
              discardedAll = true;
              props.onFallbackFocus?.();
              props.onDiscard?.();
            }}
          />
          <ol class="pf-chat-queue-list">
            <For each={props.messages}>
              {(message, index) => (
                <QueueEntry
                  message={message}
                  index={index()}
                  total={props.messages.length}
                  sending={message.id === props.drainingId}
                  registerRemove={(id, element) => removeButtons.set(id, element)}
                  onRemove={remove}
                />
              )}
            </For>
          </ol>
        </section>
      </Show>
    </>
  );
}
