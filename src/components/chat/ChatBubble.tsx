import { type JSX, For, Show } from "solid-js";
import { convertFileSrc } from "@tauri-apps/api/core";
import "./chat.css";

export function ChatBubble(props: {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  images?: string[];
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
        <Show when={props.images && props.images.length > 0}>
          <div class="pf-chat-bubble-images">
            <For each={props.images}>
              {(path) => (
                <img
                  class="pf-chat-bubble-img"
                  src={convertFileSrc(path)}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
            </For>
          </div>
        </Show>
        <Show when={props.text.length > 0}>
          <span class="pf-chat-bubble-text">{props.text}</span>
        </Show>
        <Show when={props.streaming}>
          <span class="pf-chat-caret" aria-hidden="true" />
        </Show>
      </div>
    </div>
  );
}
