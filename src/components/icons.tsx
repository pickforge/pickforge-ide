// Hairline icon set — 1.5px stroked geometric glyphs on a 16px grid, drawn in
// the brand's line-art language (same DNA as the selection bracket). currentColor
// throughout so they inherit text tokens. These replace every emoji glyph in the
// chrome; emoji read as cheap and off-brand on a cinematic dark canvas.
import { type JSX, createUniqueId, mergeProps } from "solid-js";

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

export function IconPin(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <path d="M6.4 9.6l-3.4 3.4" />
      <path d="M10.6 3.2l2.2 2.2-1.7 1a3 3 0 0 0-1 .7l-1.9 1.9-2.2-2.2 1.9-1.9a3 3 0 0 0 .7-1z" />
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

/* Third-party harness marks — official brand assets that identify each
 * integrated coding agent (issue #300). Brand color lives on the mark itself:
 * this is identity semantics, the same exemption status colors get (see
 * "Status / semantic" in docs/design-system/color.md), not a second app
 * accent, so it does not count against the one-ember rule (Rule 2). Every
 * mark below is used solely to identify the harness it represents — it is
 * not an endorsement by, or affiliation with, the mark's owner. */

// Anthropic's Claude "spark" mark. Source: https://claude.ai/favicon.svg
// (retrieved 2026-07-24). Fill #D97757 is verbatim from the served asset —
// Anthropic's coral/orange brand color for Claude.
export function IconClaude(props: IconProps): JSX.Element {
  return (
    <Svg {...props} viewBox="0 0 248 248">
      <path
        fill="#D97757"
        stroke="none"
        d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z"
      />
    </Svg>
  );
}

// OpenAI's mark for Codex. Source: https://openai.com/favicon.svg (retrieved
// 2026-07-24) — served with fill="currentColor" itself: OpenAI's mark is
// monochrome by design, and white-on-dark chrome IS its official usage, so
// this stays currentColor rather than a fixed brand color.
export function IconOpenAI(props: IconProps): JSX.Element {
  return (
    <Svg {...props} viewBox="0 0 41 41">
      <path
        fill="currentColor"
        stroke="none"
        d="M37.5324 16.8707C37.9808 15.5241 38.1363 14.0974 37.9886 12.6859C37.8409 11.2744 37.3934 9.91076 36.676 8.68622C35.6126 6.83404 33.9882 5.3676 32.0373 4.4985C30.0864 3.62941 27.9098 3.40259 25.8215 3.85078C24.8796 2.7893 23.7219 1.94125 22.4257 1.36341C21.1295 0.785575 19.7249 0.491269 18.3058 0.500197C16.1708 0.495044 14.0893 1.16803 12.3614 2.42214C10.6335 3.67624 9.34853 5.44666 8.6917 7.47815C7.30085 7.76286 5.98686 8.3414 4.8377 9.17505C3.68854 10.0087 2.73073 11.0782 2.02839 12.312C0.956464 14.1591 0.498905 16.2988 0.721698 18.4228C0.944492 20.5467 1.83612 22.5449 3.268 24.1293C2.81966 25.4759 2.66413 26.9026 2.81182 28.3141C2.95951 29.7256 3.40701 31.0892 4.12437 32.3138C5.18791 34.1659 6.8123 35.6322 8.76321 36.5013C10.7141 37.3704 12.8907 37.5973 14.9789 37.1492C15.9208 38.2107 17.0786 39.0587 18.3747 39.6366C19.6709 40.2144 21.0755 40.5087 22.4946 40.4998C24.6307 40.5054 26.7133 39.8321 28.4418 38.5772C30.1704 37.3223 31.4556 35.5506 32.1119 33.5179C33.5027 33.2332 34.8167 32.6547 35.9659 31.821C37.115 30.9874 38.0728 29.9178 38.7752 28.684C39.8458 26.8371 40.3023 24.6979 40.0789 22.5748C39.8556 20.4517 38.9639 18.4544 37.5324 16.8707ZM22.4978 37.8849C20.7443 37.8874 19.0459 37.2733 17.6994 36.1501C17.7601 36.117 17.8666 36.0586 17.936 36.0161L25.9004 31.4156C26.1003 31.3019 26.2663 31.137 26.3813 30.9378C26.4964 30.7386 26.5563 30.5124 26.5549 30.2825V19.0542L29.9213 20.998C29.9389 21.0068 29.9541 21.0198 29.9656 21.0359C29.977 21.052 29.9842 21.0707 29.9867 21.0902V30.3889C29.9842 32.375 29.1946 34.2791 27.7909 35.6841C26.3872 37.0892 24.4838 37.8806 22.4978 37.8849ZM6.39227 31.0064C5.51397 29.4888 5.19742 27.7107 5.49804 25.9832C5.55718 26.0187 5.66048 26.0818 5.73461 26.1244L13.699 30.7248C13.8975 30.8408 14.1233 30.902 14.3532 30.902C14.583 30.902 14.8088 30.8408 15.0073 30.7248L24.731 25.1103V28.9979C24.7321 29.0177 24.7283 29.0376 24.7199 29.0556C24.7115 29.0736 24.6988 29.0893 24.6829 29.1012L16.6317 33.7497C14.9096 34.7416 12.8643 35.0097 10.9447 34.4954C9.02506 33.9811 7.38785 32.7263 6.39227 31.0064ZM4.29707 13.6194C5.17156 12.0998 6.55279 10.9364 8.19885 10.3327C8.19885 10.4013 8.19491 10.5228 8.19491 10.6071V19.808C8.19351 20.0378 8.25334 20.2638 8.36823 20.4629C8.48312 20.6619 8.64893 20.8267 8.84863 20.9404L18.5723 26.5542L15.206 28.4979C15.1894 28.5089 15.1703 28.5155 15.1505 28.5173C15.1307 28.5191 15.1107 28.516 15.0924 28.5082L7.04046 23.8557C5.32135 22.8601 4.06716 21.2235 3.55289 19.3046C3.03862 17.3858 3.30624 15.3413 4.29707 13.6194ZM31.955 20.0556L22.2312 14.4411L25.5976 12.4981C25.6142 12.4872 25.6333 12.4805 25.6531 12.4787C25.6729 12.4769 25.6928 12.4801 25.7111 12.4879L33.7631 17.1364C34.9967 17.849 36.0017 18.8982 36.6606 20.1613C37.3194 21.4244 37.6047 22.849 37.4832 24.2684C37.3617 25.6878 36.8382 27.0432 35.9743 28.1759C35.1103 29.3086 33.9415 30.1717 32.6047 30.6641C32.6047 30.5947 32.6047 30.4733 32.6047 30.3889V21.188C32.6066 20.9586 32.5474 20.7328 32.4332 20.5338C32.319 20.3348 32.154 20.1698 31.955 20.0556ZM35.3055 15.0128C35.2464 14.9765 35.1431 14.9142 35.069 14.8717L27.1045 10.2712C26.906 10.1554 26.6803 10.0943 26.4504 10.0943C26.2206 10.0943 25.9948 10.1554 25.7963 10.2712L16.0726 15.8858V11.9982C16.0715 11.9783 16.0753 11.9585 16.0837 11.9405C16.0921 11.9225 16.1048 11.9068 16.1207 11.8949L24.1719 7.25025C25.4053 6.53903 26.8158 6.19376 28.2383 6.25482C29.6608 6.31589 31.0364 6.78077 32.2044 7.59508C33.3723 8.40939 34.2842 9.53945 34.8334 10.8531C35.3826 12.1667 35.5464 13.6095 35.3055 15.0128ZM14.2424 21.9419L10.8752 19.9981C10.8576 19.9893 10.8423 19.9763 10.8309 19.9602C10.8195 19.9441 10.8122 19.9254 10.8098 19.9058V10.6071C10.8107 9.18295 11.2173 7.78848 11.9819 6.58696C12.7466 5.38544 13.8377 4.42659 15.1275 3.82264C16.4173 3.21869 17.8524 2.99464 19.2649 3.1767C20.6775 3.35876 22.0089 3.93941 23.1034 4.85067C23.0427 4.88379 22.937 4.94215 22.8668 4.98473L14.9024 9.58517C14.7025 9.69878 14.5366 9.86356 14.4215 10.0626C14.3065 10.2616 14.2466 10.4877 14.2479 10.7175L14.2424 21.9419ZM16.071 17.9991L20.4018 15.4978L24.7325 17.9975V22.9985L20.4018 25.4983L16.071 22.9985V17.9991Z"
      />
    </Svg>
  );
}

// Pi's official mark — a stacked "P" with an "i" dot. Source:
// https://pi.dev/logo.svg (retrieved 2026-07-24). Pi ships no distinct brand
// color: the site's own logo-auto.svg switches this same path between solid
// black and solid white by prefers-color-scheme, so it stays monochrome /
// currentColor — the same treatment as Codex, for the same reason.
export function IconPi(props: IconProps): JSX.Element {
  return (
    <Svg {...props} viewBox="0 0 800 800">
      <path
        fill="currentColor"
        stroke="none"
        fill-rule="evenodd"
        d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"
      />
      <path fill="currentColor" stroke="none" d="M517.36 400 H634.72 V634.72 H517.36 Z" />
    </Svg>
  );
}

// Oh My Pi (OMP)'s official mark. Source: https://omp.sh/favicon.svg
// (retrieved 2026-07-24). Gradient stops (#ed4abf -> #9b4dff -> #5ad8e6) are
// verbatim from the served asset — OMP's brand gradient. The source's dark
// rounded-square backdrop is dropped (no colored pills per app convention),
// leaving only the gradient glyph.
export function IconOmp(props: IconProps): JSX.Element {
  const gradientId = `pf-omp-mark-${createUniqueId()}`;
  return (
    <Svg {...props} viewBox="0 0 64 64">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ed4abf" />
          <stop offset=".5" stop-color="#9b4dff" />
          <stop offset="1" stop-color="#5ad8e6" />
        </linearGradient>
      </defs>
      <path fill={`url(#${gradientId})`} stroke="none" d="M14 16h36v8H40v32h-8V24h-6v22h-8V24h-4z" />
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

// Dictation mic: a capsule head, a listening arc, and a short stand — the same
// hairline line-art language as the rest of the set.
export function IconMic(props: IconProps): JSX.Element {
  return (
    <Svg {...props}>
      <rect x="6" y="2" width="4" height="7.5" rx="2" />
      <path d="M4.5 8a3.5 3.5 0 0 0 7 0" />
      <path d="M8 11.5v2.25M6.25 13.75h3.5" />
    </Svg>
  );
}
