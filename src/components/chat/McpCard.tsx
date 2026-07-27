import { type JSX, Show, createSignal } from "solid-js";
import { compactInline, hasHiddenDetail } from "../../lib/chatDisplay";
import { IconChevronRight } from "../icons";
import type { ToolCallStatus } from "../../stores/agentChat";
import { Disclosure, StatusPill, type StatusIntent } from "../ui";
import { pikitRowIsLive, pikitRunRef } from "../../lib/pikitRunRef";
import { PiKitRunLanes } from "../pikit/PiKitRunLanes";
import "./chat.css";

const STATUS_INTENT: Record<ToolCallStatus, StatusIntent> = {
  inProgress: "warning",
  completed: "connected",
  failed: "error",
};

export function McpCard(props: {
  server: string;
  tool: string;
  detail?: string | null;
  status?: ToolCallStatus;
  open?: boolean;
  onToggle?: () => void;
}): JSX.Element {
  const [localOpen, setLocalOpen] = createSignal(false);
  const open = () => props.open ?? localOpen();
  const toggle = () => (props.onToggle ? props.onToggle() : setLocalOpen((v) => !v));
  const detail = () => props.detail ?? "";
  const row = () => ({
    server: props.server,
    tool: props.tool,
    detail: props.detail,
    status: props.status,
  });
  const runRef = () => pikitRunRef(row());
  const live = () => pikitRowIsLive(row());
  const canExpand = () => hasHiddenDetail(detail(), 120) || runRef() !== null;

  return (
    <div class="pf-chat-line" classList={{ "pf-chat-line--open": open() }}>
      <button
        type="button"
        class="pf-chat-line-toggle"
        aria-expanded={open()}
        aria-label={open() ? "Hide MCP call details" : "Show MCP call details"}
        disabled={!canExpand()}
        onClick={() => canExpand() && toggle()}
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
        <div class="pf-chat-line-body">
          {/* A pickforge-lanes call renders the run's lanes the way Settings
              does — same component, so the two cannot drift (#362). Live while
              the call is in flight, frozen afterwards, so a replayed row does
              not quietly rewrite itself from a run that has moved on. */}
          <Show when={runRef()}>
            {(run) => <PiKitRunLanes run={run()} live={live()} />}
          </Show>
          <Show when={detail()}>
            <pre class="pf-chat-tail">{detail()}</pre>
          </Show>
        </div>
      </Disclosure>
    </div>
  );
}
