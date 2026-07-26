// Design-system primitives, web port (SolidJS). Phase 0 subset:
// MonoEyebrow, HairlinePanel, StatusPill, Chip, EmberButton.
import { type JSX, Show, createEffect, createSignal, onCleanup, splitProps } from "solid-js";
import { Dynamic } from "solid-js/web";
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

/** Fade + rise pane content whenever `on()` changes (e.g. the active project),
 *  so panes (source control, files, inspector) don't snap between projects the
 *  way the chat list and terminal already animate. Re-mounts the children on
 *  change so the entrance replays; honors reduced motion via .pf-pane-reveal.
 *  Children is a thunk so each change renders fresh content. */
export function PaneReveal(props: {
  on: () => string | null | undefined;
  children: () => JSX.Element;
}): JSX.Element {
  // Key on a never-falsy value so the keyed block always renders (no eager
  // fallback instantiation) and re-creates whenever `on()` changes — including
  // to/from "no project" — replaying the entrance each time.
  return (
    <Show when={props.on() ?? "∅"} keyed>
      {(_key) => <div class="pf-pane-reveal">{props.children()}</div>}
    </Show>
  );
}

/** Uppercase, wide-tracked monospace section label with optional ember tick.
 *  Renders as a bare `<span>` by default (unchanged for existing callers).
 *  Pass `as="h2"`/`"h3"` where this label is a real content heading (e.g. a
 *  settings section title) so assistive tech gets heading-navigable
 *  structure; `pf-eyebrow-row--heading` strips the browser's default heading
 *  margin so the visual result stays identical to the span form. */
export function MonoEyebrow(props: {
  text: string;
  tick?: boolean;
  class?: string;
  as?: "span" | "h2" | "h3";
}): JSX.Element {
  const tag = () => props.as ?? "span";
  return (
    <Dynamic
      component={tag()}
      class={`pf-eyebrow-row ${tag() === "span" ? "" : "pf-eyebrow-row--heading "}${props.class ?? ""}`}
    >
      <Show when={props.tick}>
        <span class="pf-eyebrow-tick" />
      </Show>
      <span class="pf-eyebrow">{props.text}</span>
    </Dynamic>
  );
}

/** Height-animated wrapper for collapsible content. Uses the grid-rows 0fr↔1fr
 * trick so unknown-height (auto) content animates open/closed; honors reduced
 * motion via the duration tokens. For flex-filled pane bodies the dock animates
 * the slot instead — this is for auto-height content (nested chats, sub-lists). */
export function Collapse(props: { open: boolean; children: JSX.Element }): JSX.Element {
  return (
    <div class="pf-collapse" classList={{ "pf-collapse--closed": !props.open }}>
      <div class="pf-collapse-body">{props.children}</div>
    </div>
  );
}

/** Longest transition on `element`, in ms. Read from computed style rather than
 *  hardcoded so the duration stays a token: `prefers-reduced-motion` collapses
 *  `--pf-dur-*` to `0ms`, and this reads that as 0 and unmounts on the next
 *  tick instead of waiting on a `transitionend` that will never fire. */
function transitionMs(element: HTMLElement): number {
  const raw = getComputedStyle(element).transitionDuration;
  if (!raw) return 0;
  return raw
    .split(",")
    .reduce((longest, part) => {
      const value = part.trim();
      const seconds = value.endsWith("ms") ? parseFloat(value) / 1000 : parseFloat(value);
      return Number.isFinite(seconds) ? Math.max(longest, seconds) : longest;
    }, 0) * 1000;
}

/** `Collapse`'s mount-aware sibling: the body is absent from the DOM while
 *  closed, mounts when opened, and stays mounted only long enough for the
 *  collapse to play out.
 *
 *  `Collapse` keeps its content mounted always, which is right for the small,
 *  known-size bodies it wraps. Transcript disclosure bodies are neither — a
 *  command's output tail or a lane list can be large, and they live inside a
 *  virtualized timeline where every mounted row carries a ResizeObserver. So
 *  the DOM cost is paid only while a row is actually open or closing (#372). */
export function Disclosure(props: { open: boolean; children: JSX.Element }): JSX.Element {
  const [mounted, setMounted] = createSignal(props.open);
  let frame!: HTMLDivElement;
  let timer: number | undefined;

  const clearTimer = () => {
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timer = undefined;
  };

  createEffect(() => {
    if (props.open) {
      // Re-opening mid-collapse cancels the pending unmount, so a fast
      // toggle never drops the body out from under its own animation.
      clearTimer();
      setMounted(true);
      return;
    }
    if (!mounted()) return;
    clearTimer();
    timer = window.setTimeout(() => {
      timer = undefined;
      setMounted(false);
    }, transitionMs(frame));
  });

  onCleanup(clearTimer);

  return (
    <div ref={frame} class="pf-collapse" classList={{ "pf-collapse--closed": !props.open }}>
      <div class="pf-collapse-body">
        <Show when={mounted()}>{props.children}</Show>
      </div>
    </div>
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

/** Semantic status tag: mono uppercase text behind a leading `[` bracket, never a filled chip. */
export function StatusPill(props: {
  label: string;
  intent?: StatusIntent;
  pulsing?: boolean;
  compact?: boolean;
}): JSX.Element {
  const intent = () => props.intent ?? "neutral";
  return (
    <span
      class="pf-pill"
      classList={{ "pf-pill--dot": props.compact }}
      title={props.compact ? props.label : undefined}
      role={props.compact ? "img" : undefined}
      aria-label={props.compact ? props.label : undefined}
    >
      <span
        class={`pf-dot ${props.pulsing ? "pf-dot--pulsing" : ""}`}
        style={{ "--pf-intent": INTENT_VAR[intent()] }}
      />
      {props.compact ? null : props.label}
    </span>
  );
}

/** Quick-launch chip — types an agent command into the focused shell. */
export function Chip(props: {
  label: string;
  hint?: string;
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
      <span class="pf-chip-label">{props.label}</span>
      <Show when={props.hint}>
        <span class="pf-chip-hint">{props.hint}</span>
      </Show>
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

/** Four L-corner marks framing a child; top-right corner is ember by default. */
export function SelectionBracket(props: {
  children: JSX.Element;
  active?: boolean;
  armLength?: number;
  inset?: number;
  color?: string;
  emberCorner?: boolean;
  radius?: number;
}): JSX.Element {
  const arm = () => `${props.armLength ?? 10}px`;
  const off = () => `${-(props.inset ?? 3)}px`; // negative = outside the box
  const pos = (corner: string): Record<string, string> => {
    const base: Record<string, string> = { width: arm(), height: arm() };
    if (corner === "tl") return { ...base, top: off(), left: off() };
    if (corner === "tr") return { ...base, top: off(), right: off() };
    if (corner === "bl") return { ...base, bottom: off(), left: off() };
    return { ...base, bottom: off(), right: off() };
  };
  return (
    <span
      class="pf-bracket"
      style={{
        opacity: (props.active ?? true) ? 1 : 0,
        "--pf-bracket-color": props.color ?? "var(--pf-text-hi)",
        "--pf-bracket-corner-color": (props.emberCorner ?? true)
          ? "var(--pf-ember)"
          : (props.color ?? "var(--pf-text-hi)"),
        "--pf-bracket-radius": `${props.radius ?? 10}px`,
      }}
    >
      {props.children}
      <span class="pf-bracket-corner tl" style={pos("tl")} />
      <span class="pf-bracket-corner tr" style={pos("tr")} />
      <span class="pf-bracket-corner bl" style={pos("bl")} />
      <span class="pf-bracket-corner br" style={pos("br")} />
    </span>
  );
}

/** Faint blueprint grid backdrop with optional vignette fade + ember halo. */
export function BlueprintGrid(props: {
  children?: JSX.Element;
  cell?: number;
  lineColor?: string;
  halo?: boolean;
  fade?: boolean;
}): JSX.Element {
  return (
    <div
      class="pf-blueprint"
      style={{
        "--pf-blueprint-cell": `${props.cell ?? 32}px`,
        "--pf-blueprint-line": props.lineColor ?? "var(--pf-hairline)",
      }}
    >
      <div class={`pf-blueprint-bg ${(props.fade ?? true) ? "fade" : ""}`} />
      <Show when={props.halo}>
        <div class="pf-blueprint-halo" />
      </Show>
      <div class="pf-blueprint-content">{props.children}</div>
    </div>
  );
}

/** Rounded frame with a slow ember sweep when active; quiet hairline otherwise. */
export function EmberSweepBorder(props: {
  children: JSX.Element;
  active?: boolean;
  borderRadius?: number;
  strokeWidth?: number;
}): JSX.Element {
  return (
    <div
      class={`pf-sweep-frame ${(props.active ?? true) ? "active" : ""}`}
      style={{
        "--pf-sweep-radius": `${props.borderRadius ?? 10}px`,
        "--pf-sweep-stroke": `${props.strokeWidth ?? 1.5}px`,
      }}
    >
      <div class="pf-sweep-inner">{props.children}</div>
    </div>
  );
}

export function Spinner(props: { class?: string; label?: string }): JSX.Element {
  return (
    <span
      class={`pf-spinner ${props.class ?? ""}`}
      role={props.label ? "status" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
    />
  );
}

/** Branded empty state — bracket-framed glyph + eyebrow + title + hint. Ember-free. */
export function ForgeEmptyState(props: {
  glyph: JSX.Element;
  title: string;
  eyebrow?: string;
  hint?: string;
  action?: JSX.Element;
}): JSX.Element {
  return (
    <div class="pf-empty">
      <SelectionBracket active emberCorner={false} inset={6} armLength={9}>
        <span class="pf-empty-glyph">{props.glyph}</span>
      </SelectionBracket>
      <Show when={props.eyebrow}>
        <MonoEyebrow text={props.eyebrow!} />
      </Show>
      <div class="pf-empty-title">{props.title}</div>
      <Show when={props.hint}>
        <div class="pf-empty-hint">{props.hint}</div>
      </Show>
      <Show when={props.action}>{props.action}</Show>
    </div>
  );
}
