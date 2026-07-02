import { type JSX, For } from "solid-js";
import { HairlinePanel, MonoEyebrow } from "../ui";
import "./chat.css";

export interface PlanItem {
  text: string;
  completed: boolean;
}

export function PlanCard(props: { items: PlanItem[] }): JSX.Element {
  const done = () => props.items.filter((i) => i.completed).length;
  return (
    <HairlinePanel class="pf-chat-card pf-chat-plan">
      <div class="pf-chat-plan-head">
        <MonoEyebrow text="Plan" />
        <span class="pf-chat-meta">
          {done()}/{props.items.length}
        </span>
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
