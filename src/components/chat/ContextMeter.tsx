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
  const rawUsed = () => props.contextUsed ?? 0;
  const window = () => props.contextWindow ?? 0;
  // A raw reading above the reported window means used/window disagreed
  // upstream (e.g. a provider's own usage and window telemetry aren't backed
  // by the same invariant) — surface it rather than silently clamping it away.
  const overflow = () => hasContext() && rawUsed() > window();
  const fraction = () => {
    if (window() <= 0) return 0;
    return Math.min(1, Math.max(0, rawUsed() / window()));
  };
  // The label clamps visually like the bar, but overflow() drives a distinct
  // warning state (see pf-chat-context--warn) so the inconsistency is never
  // silently hidden — just not spelled out in raw, confusing digits either.
  const displayedUsed = () => (overflow() ? window() : rawUsed());
  const overflowTitle = () =>
    `Context reads ${rawUsed().toLocaleString()} / ${window().toLocaleString()} tokens — ` +
    "usage exceeds the reported window, which means the accounting is " +
    "inconsistent upstream, not that the session is truly over budget.";
  const hasCost = () => props.totals.costUsd > 0;
  const visible = () => hasContext() || hasCost();

  return (
    <Show when={visible()}>
      <div class="pf-chat-context" classList={{ "pf-chat-context--warn": overflow() }}>
        <Show when={hasContext()}>
          <span
            class="pf-chat-context-frac"
            title={overflow() ? overflowTitle() : undefined}
            role={overflow() ? "img" : undefined}
            aria-label={overflow() ? overflowTitle() : undefined}
          >
            {compact(displayedUsed())} / {compact(window())}
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
