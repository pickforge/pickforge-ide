import { type JSX, Show, createSignal } from "solid-js";
import { compactInline, hasHiddenDetail } from "../../lib/chatDisplay";
import { IconChevronRight } from "../icons";
import { Disclosure } from "../ui";
import "./chat.css";

export function WebSearchCard(props: { query: string }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const canExpand = () => hasHiddenDetail(props.query, 120);

  return (
    <div class="pf-chat-line" classList={{ "pf-chat-line--open": open() }}>
      <button
        type="button"
        class="pf-chat-line-toggle"
        aria-expanded={open()}
        aria-label={open() ? "Hide search query" : "Show full search query"}
        disabled={!canExpand()}
        onClick={() => canExpand() && setOpen((v) => !v)}
      >
        <span class="pf-chat-line-chevron" aria-hidden="true">
          <Show when={canExpand()} fallback={<span class="pf-chat-line-chevron-spacer" />}>
            <IconChevronRight size={12} />
          </Show>
        </span>
        <span class="pf-chat-line-tag">web</span>
        <code class="pf-chat-line-name" title={props.query}>
          {compactInline(props.query, 120)}
        </code>
      </button>
      <Disclosure open={open()}>
        <div class="pf-chat-line-body">
          <pre class="pf-chat-tail">{props.query}</pre>
        </div>
      </Disclosure>
    </div>
  );
}
