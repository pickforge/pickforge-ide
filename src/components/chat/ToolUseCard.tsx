import { type JSX, Show } from "solid-js";
import "./chat.css";

export function ToolUseCard(props: {
  name: string;
  detail?: string | null;
}): JSX.Element {
  return (
    <div class="pf-chat-line">
      <span class="pf-chat-line-tag">tool</span>
      <code class="pf-chat-line-name">{props.name}</code>
      <Show when={props.detail}>
        <span class="pf-chat-line-detail">{props.detail}</span>
      </Show>
    </div>
  );
}
