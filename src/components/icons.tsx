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

export function IconRefresh(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12.5 7a4.5 4.5 0 1 0-.6 3.3" />
      <path d="M12.7 3.6v3h-3" />
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

// The split-affordance trigger: two panes with a seam, no direction implied.
export function IconSplitTrigger(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.4" />
      <path d="M8 2.8v10.4" />
    </Svg>
  );
}
