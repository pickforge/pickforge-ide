import { type JSX, Show } from "solid-js";
import { type AgentChatTotals } from "../../stores/agentChat";

function compact(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`;
  }
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function formatCost(cost: number, estimated: boolean): string {
  return `${estimated ? "~" : ""}$${cost.toFixed(4)}`;
}

export function ContextMeter(props: {
  contextUsed: number | null;
  contextWindow: number | null;
  totals: AgentChatTotals;
}): JSX.Element {
  const hasContext = () => props.contextWindow !== null && props.contextWindow > 0;
  const fraction = () => {
    const window = props.contextWindow ?? 0;
    if (window <= 0) return 0;
    return Math.min(1, Math.max(0, (props.contextUsed ?? 0) / window));
  };
  const hasCost = () => props.totals.costUsd > 0;
  const visible = () => hasContext() || hasCost();

  return (
    <Show when={visible()}>
      <div class="pf-chat-context">
        <Show when={hasContext()}>
          <span class="pf-chat-context-frac">
            {compact(props.contextUsed ?? 0)} / {compact(props.contextWindow ?? 0)}
          </span>
          <span class="pf-chat-context-track" aria-hidden="true">
            <span class="pf-chat-context-fill" style={{ width: `${fraction() * 100}%` }} />
          </span>
        </Show>
        <Show when={hasCost()}>
          <span class="pf-chat-context-cost">
            {formatCost(props.totals.costUsd, props.totals.estimated)}
          </span>
        </Show>
      </div>
    </Show>
  );
}
