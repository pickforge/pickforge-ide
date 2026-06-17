// A single live terminal pane: xterm.js (WebGL renderer + fit) bound to a
// Rust `$SHELL` pty over a Tauri channel. Shell-first — never an agent.
import { onCleanup, onMount } from "solid-js";
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
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_LINE_HEIGHT,
} from "../lib/terminal-theme";
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
      theme: buildTerminalTheme(),
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
      macOptionIsMeta: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    // WebGL is the proven heavy-output renderer; under WebKitGTK it can fail to
    // get a context — fall back to the DOM renderer rather than crash.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch (err) {
      console.warn("[pickforge] WebGL renderer unavailable; using DOM", err);
    }

    fit.fit();

    let sessionId: number | null = null;
    let disposed = false;

    ptySpawn({
      cwd: props.cwd ?? null,
      rows: term.rows,
      cols: term.cols,
      onMessage: (message) => {
        if (message.type === "output") {
          term.write(toBytes(message.data));
        } else if (message.type === "exit") {
          props.onExit?.(message.data);
        }
      },
    })
      .then((id) => {
        if (disposed) {
          void ptyKill(id);
          return;
        }
        sessionId = id;
      })
      .catch((err) => console.error("[pickforge] pty_spawn failed", err));

    const dataSub = term.onData((data) => {
      if (sessionId !== null) void ptyWrite(sessionId, encoder.encode(data));
    });
    const resizeSub = term.onResize(({ rows, cols }) => {
      if (sessionId !== null) void ptyResize(sessionId, rows, cols);
    });

    const observer = new ResizeObserver(() => {
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

    onCleanup(() => {
      disposed = true;
      observer.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
      if (sessionId !== null) void ptyKill(sessionId);
      term.dispose();
    });
  });

  return <div class="pf-terminal" ref={container} />;
}
