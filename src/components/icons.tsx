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

// Mode picker: a crest shield — the permission/sandbox posture guarding a turn.
export function IconShield(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M8 2.4l4.5 1.7v3.4c0 3-2 4.9-4.5 6-2.5-1.1-4.5-3-4.5-6V4.1z" />
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

/* Provider brand marks — monochrome fills in currentColor so they sit in the
 * text-token palette (never brand color; Rule 2). Path data from
 * @lobehub/icons-static-svg. */
export function IconClaude(props: IconProps): JSX.Element {
  return (
    <Svg {...props} viewBox="0 0 24 24">
      <path
        fill="currentColor"
        stroke="none"
        d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
      />
    </Svg>
  );
}

export function IconOpenAI(props: IconProps): JSX.Element {
  return (
    <Svg {...props} viewBox="0 0 24 24">
      <path
        fill="currentColor"
        stroke="none"
        fill-rule="evenodd"
        d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"
      />
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
