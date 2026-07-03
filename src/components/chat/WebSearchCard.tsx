import { type JSX } from "solid-js";
import "./chat.css";

export function WebSearchCard(props: { query: string }): JSX.Element {
  return (
    <div class="pf-chat-line">
      <span class="pf-chat-line-tag">web</span>
      <code class="pf-chat-line-name">{props.query}</code>
    </div>
  );
}
