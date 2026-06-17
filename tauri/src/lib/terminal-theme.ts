// Branded xterm theme. The semantic anchors are pulled from the CSS design
// tokens (Rule 1 — tokens only) so the terminal stays in lock-step with the
// palette; the bright variants extend those anchors. Mirrors
// `lib/core/terminal/terminal_themes.dart` (_pickforgeEmber).
import type { ITheme } from "@xterm/xterm";

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

export function buildTerminalTheme(): ITheme {
  const surface = token("--pf-surface", "#0a0a0b");
  const textHi = token("--pf-text-hi", "#f2f2f3");
  const ember = token("--pf-ember", "#ff7a1a");
  const textLow = token("--pf-text-low", "#6e6e75");
  const textMed = token("--pf-text-med", "#a0a0a6");
  const surface3 = token("--pf-surface-3", "#1b1b1f");

  return {
    background: surface,
    foreground: textHi,
    cursor: ember,
    cursorAccent: surface,
    selectionBackground: "rgba(255, 122, 26, 0.2)",

    black: surface3,
    red: token("--pf-error", "#ff6b5c"),
    green: token("--pf-connected", "#3dd68c"),
    yellow: token("--pf-warning", "#f2b53a"),
    blue: token("--pf-info", "#7aa2ff"),
    magenta: "#c792ea",
    cyan: "#56b6c2",
    white: textMed,

    brightBlack: textLow,
    brightRed: "#ff8a7c",
    brightGreen: "#5ee0a4",
    brightYellow: "#ffd06a",
    brightBlue: "#9ab8ff",
    brightMagenta: "#d9a8ff",
    brightCyan: "#7fd3dd",
    brightWhite: textHi,
  };
}

export const TERMINAL_FONT_FAMILY =
  'GeistMono, ui-monospace, "SF Mono", Menlo, monospace';
export const TERMINAL_FONT_SIZE = 13;
export const TERMINAL_LINE_HEIGHT = 1.25;
