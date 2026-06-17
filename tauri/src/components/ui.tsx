// Design-system primitives, web port (SolidJS). Phase 0 subset:
// MonoEyebrow, HairlinePanel, StatusPill, Chip, EmberButton.
import { type JSX, Show, splitProps } from "solid-js";
import "./ui.css";

export type StatusIntent =
  | "neutral"
  | "live"
  | "connected"
  | "warning"
  | "error"
  | "info";

const INTENT_VAR: Record<StatusIntent, string> = {
  neutral: "var(--pf-text-med)",
  live: "var(--pf-ember)",
  connected: "var(--pf-connected)",
  warning: "var(--pf-warning)",
  error: "var(--pf-error)",
  info: "var(--pf-info)",
};

/** Uppercase, wide-tracked monospace section label with optional ember tick. */
export function MonoEyebrow(props: {
  text: string;
  tick?: boolean;
  class?: string;
}): JSX.Element {
  return (
    <span class={`pf-eyebrow-row ${props.class ?? ""}`}>
      <Show when={props.tick}>
        <span class="pf-eyebrow-tick" />
      </Show>
      <span class="pf-eyebrow">{props.text}</span>
    </span>
  );
}

/** Base card/panel: hairline border on a surface fill. */
export function HairlinePanel(
  props: {
    children: JSX.Element;
    strong?: boolean;
    glass?: boolean;
  } & JSX.HTMLAttributes<HTMLDivElement>,
): JSX.Element {
  const [local, rest] = splitProps(props, ["children", "strong", "glass", "class"]);
  return (
    <div
      {...rest}
      class={[
        "pf-panel",
        local.strong ? "pf-panel--strong" : "",
        local.glass ? "pf-panel--glass" : "",
        local.class ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {local.children}
    </div>
  );
}

/** Small semantic status chip with a leading dot. */
export function StatusPill(props: {
  label: string;
  intent?: StatusIntent;
  pulsing?: boolean;
}): JSX.Element {
  const intent = () => props.intent ?? "neutral";
  return (
    <span class="pf-pill">
      <span
        class={`pf-dot ${props.pulsing ? "pf-dot--pulsing" : ""}`}
        style={{ "--pf-intent": INTENT_VAR[intent()] }}
      />
      {props.label}
    </span>
  );
}

/** Quick-launch chip — types an agent command into the focused shell. */
export function Chip(props: {
  label: string;
  ember?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      class={`pf-chip ${props.ember ? "pf-chip--ember" : ""}`}
      disabled={props.disabled}
      onClick={() => props.onClick?.()}
    >
      {props.label}
    </button>
  );
}

/** Primary pill CTA with ember glow. */
export function EmberButton(props: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      class="pf-ember-btn"
      disabled={props.disabled}
      onClick={() => props.onClick?.()}
    >
      {props.label}
    </button>
  );
}
