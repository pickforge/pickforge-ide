import { type JSX, Show } from "solid-js";
import "./chat.css";

export function ChatBubble(props: {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
}): JSX.Element {
  return (
    <div
      class="pf-chat-bubble-row"
      classList={{
        "pf-chat-bubble-row--user": props.role === "user",
        "pf-chat-bubble-row--assistant": props.role === "assistant",
      }}
    >
      <div
        class="pf-chat-bubble"
        classList={{
          "pf-chat-bubble--user": props.role === "user",
          "pf-chat-bubble--assistant": props.role === "assistant",
        }}
      >
        <span class="pf-chat-bubble-text">{props.text}</span>
        <Show when={props.streaming}>
          <span class="pf-chat-caret" aria-hidden="true" />
        </Show>
      </div>
    </div>
  );
}
