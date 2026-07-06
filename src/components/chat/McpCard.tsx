import { type JSX, Show } from "solid-js";
import { compactInline } from "../../lib/chatDisplay";
import "./chat.css";

export function McpCard(props: {
  server: string;
  tool: string;
  detail?: string | null;
}): JSX.Element {
  return (
    <div class="pf-chat-line">
      <span class="pf-chat-line-tag">mcp</span>
      <code class="pf-chat-line-name">
        {props.server}
        <span class="pf-chat-line-sep">/</span>
        {props.tool}
      </code>
      <Show when={props.detail}>
        <span class="pf-chat-line-detail" title={props.detail ?? undefined}>
          {compactInline(props.detail ?? "", 120)}
        </span>
      </Show>
    </div>
  );
}
