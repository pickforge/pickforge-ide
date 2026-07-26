import { type JSX, Show, createSignal } from "solid-js";
import { compactInline, hasHiddenDetail } from "../../lib/chatDisplay";
import { IconChevronRight } from "../icons";
import type { ToolCallStatus } from "../../stores/agentChat";
import { Disclosure, StatusPill, type StatusIntent } from "../ui";
import "./chat.css";

const STATUS_INTENT: Record<ToolCallStatus, StatusIntent> = {
  inProgress: "warning",
  completed: "connected",
  failed: "error",
};

export function ToolUseCard(props: {
  name: string;
  detail?: string | null;
  status?: ToolCallStatus;
  /** Hoisted so the toggle survives virtualization remount, the same contract
   *  `CommandCard` and `ThinkingBubble` already use (#362). */
  open?: boolean;
  onToggle?: () => void;
}): JSX.Element {
  const [localOpen, setLocalOpen] = createSignal(false);
  const open = () => props.open ?? localOpen();
  const toggle = () => (props.onToggle ? props.onToggle() : setLocalOpen((v) => !v));
  const detail = () => props.detail ?? "";
  const canExpand = () => hasHiddenDetail(detail(), 120);

  return (
    <div class="pf-chat-line" classList={{ "pf-chat-line--open": open() }}>
      <button
        type="button"
        class="pf-chat-line-toggle"
        aria-expanded={open()}
        aria-label={open() ? "Hide tool details" : "Show tool details"}
        disabled={!canExpand()}
        onClick={() => canExpand() && toggle()}
      >
        <span class="pf-chat-line-chevron" aria-hidden="true">
          <Show when={canExpand()} fallback={<span class="pf-chat-line-chevron-spacer" />}>
            <IconChevronRight size={12} />
          </Show>
        </span>
        <span class="pf-chat-line-tag">tool</span>
        <code class="pf-chat-line-name" title={props.name}>
          {props.name}
        </code>
        <Show when={detail()}>
          <span class="pf-chat-line-detail" title={detail()}>
            {compactInline(detail(), 120)}
          </span>
        </Show>
        <Show when={props.status}>
          {(status) => (
            <span class="pf-chat-line-trail">
              <StatusPill
                label={status() === "inProgress" ? "running" : status()}
                intent={STATUS_INTENT[status()]}
                pulsing={status() === "inProgress"}
              />
            </span>
          )}
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
