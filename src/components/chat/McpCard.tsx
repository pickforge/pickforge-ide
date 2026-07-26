import { type JSX, Show, createSignal } from "solid-js";
import { compactInline, hasHiddenDetail } from "../../lib/chatDisplay";
import { IconChevronRight } from "../icons";
import { Disclosure } from "../ui";
import "./chat.css";

export function McpCard(props: {
  server: string;
  tool: string;
  detail?: string | null;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const detail = () => props.detail ?? "";
  const canExpand = () => hasHiddenDetail(detail(), 120);

  return (
    <div class="pf-chat-line" classList={{ "pf-chat-line--open": open() }}>
      <button
        type="button"
        class="pf-chat-line-toggle"
        aria-expanded={open()}
        aria-label={open() ? "Hide MCP call details" : "Show MCP call details"}
        disabled={!canExpand()}
        onClick={() => canExpand() && setOpen((v) => !v)}
      >
        <span class="pf-chat-line-chevron" aria-hidden="true">
          <Show when={canExpand()} fallback={<span class="pf-chat-line-chevron-spacer" />}>
            <IconChevronRight size={12} />
          </Show>
        </span>
        <span class="pf-chat-line-tag">mcp</span>
        <code class="pf-chat-line-name" title={`${props.server}/${props.tool}`}>
          {props.server}
          <span class="pf-chat-line-sep">/</span>
          {props.tool}
        </code>
        <Show when={detail()}>
          <span class="pf-chat-line-detail" title={detail()}>
            {compactInline(detail(), 120)}
          </span>
        </Show>
      </button>
      <Disclosure open={open()}>
        <Show when={detail()}>
          <div class="pf-chat-line-body">
            <pre class="pf-chat-tail">{detail()}</pre>
          </div>
        </Show>
      </Disclosure>
    </div>
  );
}
