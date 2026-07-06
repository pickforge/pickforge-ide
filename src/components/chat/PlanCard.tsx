import { type JSX, For, Show } from "solid-js";
import { HairlinePanel, MonoEyebrow } from "../ui";
import { IconPin } from "../icons";
import "./chat.css";

export interface PlanItem {
  text: string;
  completed: boolean;
}

export function PlanCard(props: {
  items: PlanItem[];
  pinned?: boolean;
  onTogglePin?: () => void;
}): JSX.Element {
  const done = () => props.items.filter((i) => i.completed).length;
  const pinTitle = () => (props.pinned ? "Unpin plan" : "Pin plan");
  return (
    <HairlinePanel class="pf-chat-card pf-chat-plan">
      <div class="pf-chat-plan-head">
        <MonoEyebrow text="Plan" />
        <div class="pf-chat-plan-actions">
          <span class="pf-chat-meta">
            {done()}/{props.items.length}
          </span>
          <Show when={props.onTogglePin}>
            <button
              type="button"
              class="pf-chat-plan-pin"
              classList={{ "pf-chat-plan-pin--active": props.pinned }}
              aria-pressed={props.pinned ? "true" : "false"}
              aria-label="Pin plan"
              title={pinTitle()}
              onClick={() => props.onTogglePin?.()}
            >
              <IconPin size={14} />
            </button>
          </Show>
        </div>
      </div>
      <ul class="pf-chat-plan-list">
        <For each={props.items}>
          {(item) => (
            <li
              class="pf-chat-plan-item"
              classList={{ "pf-chat-plan-item--done": item.completed }}
            >
              <span class="pf-chat-plan-mark" aria-hidden="true">
                {item.completed ? "[x]" : "[ ]"}
              </span>
              <span class="pf-chat-plan-text">{item.text}</span>
            </li>
          )}
        </For>
      </ul>
    </HairlinePanel>
  );
}
