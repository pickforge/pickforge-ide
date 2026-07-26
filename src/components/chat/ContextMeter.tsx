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

/** Composer readout cost format ("~" prefix for an estimated figure, 4dp).
 *  4dp is right here: this is the session's own running total, read
 *  deliberately, where a sub-cent delta is the signal. */
export function formatCost(cost: number, estimated: boolean): string {
  return `${estimated ? "~" : ""}$${cost.toFixed(4)}`;
}

/** Card-scale cost format (2dp, sub-cent collapses to `<$0.01`). The sidebar
 *  work card's footer is scanned, not read — `$1.8884` is four digits of
 *  precision nobody is comparing at a glance, and it crowds the branch and
 *  `plan M/N` items beside it (#361). Deliberately NOT the composer's format:
 *  same number, different job. Exact zero stays `$0.00` rather than `<$0.01`,
 *  which would imply cost that has not been incurred. */
export function formatCardCost(cost: number, estimated: boolean): string {
  const prefix = estimated ? "~" : "";
  if (cost > 0 && cost < 0.01) return `${prefix}<$0.01`;
  return `${prefix}$${cost.toFixed(2)}`;
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

  // Layout note: this renders as the composer field's bottom gutter — tokens at
  // the left inset, cost at the right, and the track as a rule on the field's
  // own bottom edge (#342). The track is a child of this row rather than a
  // free-standing 72px bar, so the gauge is as wide as the input and a low
  // reading (a few % of a 1M window) is still legible.
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
        </Show>
        <Show when={hasCost()}>
          <span class="pf-chat-context-cost">
            {formatCost(props.totals.costUsd, props.totals.estimated)}
          </span>
        </Show>
        <Show when={hasContext()}>
          <span class="pf-chat-context-track" aria-hidden="true">
            <span class="pf-chat-context-fill" style={{ width: `${fraction() * 100}%` }} />
          </span>
        </Show>
      </div>
    </Show>
  );
}
