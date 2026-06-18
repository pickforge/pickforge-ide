// A single live terminal pane: xterm.js (WebGL renderer + fit) bound to a
// Rust `$SHELL` pty over a Tauri channel. Shell-first — never an agent.
import { createEffect, onCleanup, onMount } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  ptyKill,
  ptyResize,
  ptySpawn,
  ptyWrite,
  toBytes,
} from "../lib/pty";
import {
  buildTerminalTheme,
  ensureTerminalFontLoaded,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_LINE_HEIGHT,
} from "../lib/terminal-theme";
import { appTheme } from "../stores/theme";
import "./Terminal.css";

/** Imperative handle so the shell can be driven from outside (chips, focus). */
export interface TerminalHandle {
  /** Type text into the shell without executing it (no trailing newline). */
  typeText: (text: string) => void;
  focus: () => void;
}

export function TerminalPane(props: {
  cwd?: string;
  onReady?: (handle: TerminalHandle) => void;
  onExit?: (code: number | null) => void;
}) {
  let container!: HTMLDivElement;
  const encoder = new TextEncoder();

  onMount(() => {
    const term = new Terminal({
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      lineHeight: TERMINAL_LINE_HEIGHT,
      letterSpacing: 0,
      theme: buildTerminalTheme(),
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
      macOptionIsMeta: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);

    // Re-theme live when the app switches dark/light (xterm reads CSS tokens in
    // JS, so it needs an explicit refresh — the attribute flip alone won't reach
    // the canvas). Tracks appTheme; the initial run is the mount theme.
    createEffect(() => {
      appTheme();
      term.options.theme = buildTerminalTheme();
    });

    let sessionId: number | null = null;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    const subs: Array<{ dispose: () => void }> = [];

    // Register cleanup synchronously so it binds to this owner even though the
    // terminal opens after an async font wait.
    onCleanup(() => {
      disposed = true;
      observer?.disconnect();
      subs.forEach((s) => s.dispose());
      if (sessionId !== null) void ptyKill(sessionId);
      term.dispose();
    });

    void (async () => {
      // Wait for Geist Mono before xterm measures glyph width — otherwise it
      // locks onto a system fallback and the whole pane renders in the wrong
      // font with mis-aligned columns.
      await ensureTerminalFontLoaded();
      if (disposed) return;

      term.open(container);

      // WebGL is the proven heavy-output renderer; under WebKitGTK it can fail
      // to get a context — fall back to the DOM renderer rather than crash.
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch (err) {
        console.warn("[pickforge] WebGL renderer unavailable; using DOM", err);
      }

      fit.fit();

      ptySpawn({
        cwd: props.cwd ?? null,
        rows: term.rows,
        cols: term.cols,
        // Channel callbacks can fire after onCleanup but before the spawn
        // promise resolves — guard against writing to a disposed terminal.
        onOutput: (data) => {
          if (!disposed) term.write(toBytes(data));
        },
        onExit: (code) => {
          if (!disposed) props.onExit?.(code);
        },
      })
        .then((id) => {
          if (disposed) {
            void ptyKill(id);
            return;
          }
          sessionId = id;
        })
        .catch((err) => {
          if (!disposed) console.error("[pickforge] pty_spawn failed", err);
        });

      subs.push(
        term.onData((data) => {
          if (sessionId !== null) void ptyWrite(sessionId, encoder.encode(data));
        }),
        term.onResize(({ rows, cols }) => {
          if (sessionId !== null) void ptyResize(sessionId, rows, cols);
        }),
      );

      observer = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* container detached mid-resize — ignore */
        }
      });
      observer.observe(container);

      term.focus();

      props.onReady?.({
        typeText: (text: string) => {
          if (sessionId !== null) void ptyWrite(sessionId, encoder.encode(text));
          term.focus();
        },
        focus: () => term.focus(),
      });
    })();
  });

  return <div class="pf-terminal" ref={container} />;
}
