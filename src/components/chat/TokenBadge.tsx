import { type JSX, Show } from "solid-js";
import "./chat.css";

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function TokenBadge(props: {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  estimatedCostUsd?: number | null;
}): JSX.Element {
  const cost = () => (props.costUsd !== null ? props.costUsd : props.estimatedCostUsd ?? null);
  const estimated = () => props.costUsd === null && (props.estimatedCostUsd ?? null) !== null;
  return (
    <div class="pf-chat-tokens">
      <span class="pf-chat-tokens-part">{fmt(props.inputTokens)} in</span>
      <Show when={props.cachedInputTokens > 0}>
        <span class="pf-chat-tokens-part">{fmt(props.cachedInputTokens)} cached</span>
      </Show>
      <span class="pf-chat-tokens-part">{fmt(props.outputTokens)} out</span>
      <Show when={cost() !== null}>
        <span class="pf-chat-tokens-part pf-chat-tokens-cost">
          {estimated() ? "~" : ""}${cost()!.toFixed(4)}
        </span>
      </Show>
    </div>
  );
}
