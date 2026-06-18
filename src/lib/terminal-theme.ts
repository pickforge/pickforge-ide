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

// GeistMono first (the machine voice), then a Nerd-Font chain for box-drawing /
// powerline glyphs Geist Mono lacks, then system mono. Size 14 matches the old
// Flutter `EmbeddedTerminalSettings.defaults`.
export const TERMINAL_FONT_FAMILY =
  'GeistMono, "JetBrainsMono Nerd Font", "Symbols Nerd Font", ui-monospace, "SF Mono", Menlo, monospace';
export const TERMINAL_FONT_SIZE = 14;
export const TERMINAL_LINE_HEIGHT = 1.3;

/** xterm measures glyph width on open(); ensure the web font is parsed first so
 *  it never falls back to a system mono. Resolves even if the font is missing. */
export async function ensureTerminalFontLoaded(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`${TERMINAL_FONT_SIZE}px GeistMono`),
      document.fonts.load(`500 ${TERMINAL_FONT_SIZE}px GeistMono`),
      document.fonts.ready,
    ]);
  } catch {
    /* font API hiccup — fall through, xterm still renders with the fallback */
  }
}
