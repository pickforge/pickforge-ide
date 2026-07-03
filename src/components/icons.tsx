// Hairline icon set — 1.5px stroked geometric glyphs on a 16px grid, drawn in
// the brand's line-art language (same DNA as the selection bracket). currentColor
// throughout so they inherit text tokens. These replace every emoji glyph in the
// chrome; emoji read as cheap and off-brand on a cinematic dark canvas.
import { type JSX, mergeProps } from "solid-js";

type IconProps = {
  size?: number;
  class?: string;
  "stroke-width"?: number;
};

function Svg(
  props: IconProps & { children: JSX.Element; viewBox?: string },
): JSX.Element {
  const p = mergeProps({ size: 16, "stroke-width": 1.5 }, props);
  return (
    <svg
      class={`pf-icon ${p.class ?? ""}`}
      width={p.size}
      height={p.size}
      viewBox={p.viewBox ?? "0 0 16 16"}
      fill="none"
      stroke="currentColor"
      stroke-width={p["stroke-width"]}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {p.children}
    </svg>
  );
}

export function IconPlus(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </Svg>
  );
}

export function IconClose(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  );
}

// Clear console: a circle struck through — the dev-console "clear output" glyph.
export function IconClear(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="5" />
      <path d="M4.5 4.5l7 7" />
    </Svg>
  );
}

export function IconRefresh(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12.5 7a4.5 4.5 0 1 0-.6 3.3" />
      <path d="M12.7 3.6v3h-3" />
    </Svg>
  );
}

export function IconCheck(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M3.5 8.5l3 3 6-7" />
    </Svg>
  );
}

// Drag grip: two short columns of dots, the universal "grab to move" affordance.
export function IconGrip(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="6" cy="5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10" cy="5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="6" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="6" cy="11" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10" cy="11" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

// Collapse-all: two chevrons converging on a centre seam (expand = diverging).
export function IconCollapseAll(
  props: IconProps & { expand?: boolean },
): JSX.Element {
  return (
    <Svg {...props}>
      {props.expand ? (
        <path d="M5 6.4l3-2.4 3 2.4M5 9.6l3 2.4 3-2.4" />
      ) : (
        <path d="M5 4l3 2.4L11 4M5 12l3-2.4 3 2.4" />
      )}
    </Svg>
  );
}

export function IconArchive(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <rect x="2.75" y="3.5" width="10.5" height="2.6" rx="0.6" />
      <path d="M3.75 6.1v5.5a.9.9 0 0 0 .9.9h6.7a.9.9 0 0 0 .9-.9V6.1" />
      <path d="M6.5 8.6h3" />
    </Svg>
  );
}

export function IconChevronRight(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M6 4l4 4-4 4" />
    </Svg>
  );
}

export function IconChevronDown(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 6l4 4 4-4" />
    </Svg>
  );
}

export function IconDot(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="1.35" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconGear(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7L3.5 3.5" />
    </Svg>
  );
}

// Split-preview glyph: a rounded frame divided along an axis, with the half the
// NEW pane will occupy filled ember. dir encodes where the new pane lands.
export function IconSplit(
  props: IconProps & { dir: "left" | "right" | "up" | "down" },
): JSX.Element {
  // Fill is driven by the host (default quiet, ember on hover) so only the
  // hovered split option glows — preserving "one ember per composition".
  const fill = "var(--pf-split-fill, var(--pf-text-low))";
  const cells: Record<string, JSX.Element> = {
    left: <rect x="2.5" y="2.5" width="5" height="11" rx="1" fill={fill} stroke="none" opacity="0.9" />,
    right: <rect x="8.5" y="2.5" width="5" height="11" rx="1" fill={fill} stroke="none" opacity="0.9" />,
    up: <rect x="2.5" y="2.5" width="11" height="5" rx="1" fill={fill} stroke="none" opacity="0.9" />,
    down: <rect x="2.5" y="8.5" width="11" height="5" rx="1" fill={fill} stroke="none" opacity="0.9" />,
  };
  return (
    <Svg {...props}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.4" />
      {cells[props.dir]}
      {props.dir === "left" || props.dir === "right" ? (
        <path d="M8 2.8v10.4" stroke="currentColor" />
      ) : (
        <path d="M2.8 8h10.4" stroke="currentColor" />
      )}
    </Svg>
  );
}

export function IconTerminal(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <path d="M4.8 6.4l2 1.6-2 1.6M8.4 10h2.8" />
    </Svg>
  );
}

export function IconList(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5.5 4.5h8M5.5 8h8M5.5 11.5h8M2.6 4.5h.01M2.6 8h.01M2.6 11.5h.01" />
    </Svg>
  );
}

export function IconGrid(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <rect x="2.5" y="2.5" width="4.4" height="4.4" rx="1" />
      <rect x="9.1" y="2.5" width="4.4" height="4.4" rx="1" />
      <rect x="2.5" y="9.1" width="4.4" height="4.4" rx="1" />
      <rect x="9.1" y="9.1" width="4.4" height="4.4" rx="1" />
    </Svg>
  );
}

export function IconFolderPlus(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M2.5 4.2a1 1 0 0 1 1-1h2.8l1.2 1.4h5a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
      <path d="M8 7v3.2M6.4 8.6h3.2" />
    </Svg>
  );
}

export function IconMore(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="8" cy="3.6" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="8" cy="12.4" r="1.05" fill="currentColor" stroke="none" />
    </Svg>
  );
}

// The split-affordance trigger: two panes with a seam, no direction implied.
export function IconSplitTrigger(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.4" />
      <path d="M8 2.8v10.4" />
    </Svg>
  );
}

export function IconPlay(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5.5 4 L12 8 L5.5 12 Z" fill="currentColor" />
    </Svg>
  );
}

export function IconStop(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.4" fill="currentColor" stroke="none" />
    </Svg>
  );
}

// Hot restart — a clockwise full-cycle arrow (distinct from IconRefresh's reload).
export function IconRestart(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.25" />
      <path d="M3 3.4v3h3" />
    </Svg>
  );
}

// Model picker: a cast ingot — the metal being worked. The inner line is the
// top facet of the cast.
export function IconIngot(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5 5h6l2.25 6H2.75z" />
      <path d="M5.6 7.4h4.8" />
    </Svg>
  );
}

const FLAME_PATH =
  "M8 2.6C6.1 5.1 4.7 6.9 4.7 9.2a3.3 3.3 0 0 0 6.6 0C11.3 6.9 9.9 5.1 8 2.6Z";

// Effort picker: forge heat. The outline is the flame; the solid core rises
// with the effort level (0..1), anchored at the flame's base.
export function IconForgeFlame(
  props: IconProps & { level?: number },
): JSX.Element {
  const level = () => Math.max(0, Math.min(1, props.level ?? 0.5));
  const scale = () => 0.28 + 0.62 * level();
  return (
    <Svg {...props}>
      <path d={FLAME_PATH} />
      <path
        d={FLAME_PATH}
        fill="currentColor"
        stroke="none"
        transform={`translate(8 12.1) scale(${scale()}) translate(-8 -12.1)`}
      />
    </Svg>
  );
}
