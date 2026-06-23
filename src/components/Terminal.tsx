// A single live terminal pane: xterm.js (WebGL renderer + fit) bound to a
// Rust `$SHELL` pty over a Tauri channel. Shell-first — never an agent.
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { registerDropTarget } from "../lib/terminalDrop";
import {
  isChatMarkedForKill,
  ptyDetach,
  ptyKill,
  ptyResize,
  ptySpawn,
  ptySpawnChat,
  ptyWrite,
  toBytes,
  type PtyBytes,
} from "../lib/pty";
import {
  buildConsoleTheme,
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
  /** Wipe the terminal's scrollback (the view-only console's Clear action). */
  clear: () => void;
  focus: () => void;
}

export function TerminalPane(props: {
  cwd?: string;
  /** When set, the pty runs this command once instead of an interactive shell
   *  (the Debug Console's view-only run output). */
  runCommand?: string;
  /** Extra `PICKFORGE_*` env for the spawned shell (MCP endpoint discovery). */
  env?: Record<string, string> | null;
  onReady?: (handle: TerminalHandle) => void;
  onExit?: (code: number | null) => void;
  /** Fires with each non-empty line the user types and submits (Enter).
   *  Reconstructed from real keystrokes only — injected typeText is invisible
   *  here, so it never includes chip-launched command prefixes. */
  onUserSubmit?: (line: string) => void;
  /** Fires with each decoded chunk of shell OUTPUT (e.g. to scrape a VM service
   *  URL from `flutter run`). Streaming-decoded, so multi-byte chars are safe.
   *  Only set this when the TEXT is needed — decoding runs per chunk. */
  onOutput?: (chunk: string) => void;
  /** Fires when the user selects text (anchored near the pointer release), or
   *  null when the selection clears — drives the terminal "Ask AI" popup. */
  onSelectionChange?: (sel: { text: string; x: number; y: number } | null) => void;
  /** Fires with the shell/agent's OSC 2 terminal title (the window-title escape).
   *  Agents emit a short summary here; the host maps it to the chat name. */
  onTitle?: (title: string) => void;
  /** View-only: the user can't type into it (the toolbar still drives it via
   *  typeText). For the Debug Console run output. */
  readOnly?: boolean;
  /** Use the readable Debug Console theme variant instead of the shell theme. */
  consoleTheme?: boolean;
  /** When set, this is a CHAT pane: spawn a SESSION-BACKED shell (dtach/tmux)
   *  keyed off this chat so a running agent survives pane-close + app-restart.
   *  On unmount we DETACH (not kill). Unset → today's raw interactive shell. */
  chat?: {
    chatId: string;
    projectRoot: string;
    /** The session id stored on the chat (preserved on a raw fallback). */
    sessionId?: string | null;
    backend: "dtach" | "tmux" | "raw";
    /** Reports the resolved session id (and whether recovery degraded to raw)
     *  so the host can persist it. */
    onSession?: (info: { sessionId: string | null; backend: string; degraded: boolean }) => void;
  };
}) {
  let container!: HTMLDivElement;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const pickTheme = () => (props.consoleTheme ? buildConsoleTheme() : buildTerminalTheme());
  // Lit while an OS file drag hovers this pane (the subtle drop highlight).
  const [dropHover, setDropHover] = createSignal(false);

  onMount(() => {
    const term = new Terminal({
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      lineHeight: TERMINAL_LINE_HEIGHT,
      letterSpacing: 0,
      theme: pickTheme(),
      cursorBlink: !props.readOnly,
      disableStdin: props.readOnly ?? false,
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
      term.options.theme = pickTheme();
    });

    let sessionId: number | null = null;
    let pendingInput = ""; // typed before the pty spawn resolves (e.g. open-in-pane)
    let disposed = false;
    let observer: ResizeObserver | undefined;
    const subs: Array<{ dispose: () => void }> = [];

    // A tiny line-editor mirror over real keystrokes, so we can surface each line
    // the user submits (onUserSubmit) without parsing the agent's TUI. Escape
    // sequences (arrow keys etc.) are consumed, not appended.
    let inputLine = "";
    let inEscape = false;
    let escCSI = false; // the escape is a CSI/SS3 (\x1b[ or \x1bO) multi-char seq
    const trackUserInput = (data: string) => {
      for (const ch of data) {
        const code = ch.codePointAt(0)!;
        if (inEscape) {
          if (escCSI) {
            if (code >= 0x40 && code <= 0x7e) inEscape = escCSI = false; // final byte
          } else if (ch === "[" || ch === "O") {
            escCSI = true;
          } else {
            inEscape = false; // single-char escape
          }
          continue;
        }
        switch (code) {
          case 0x1b: inEscape = true; escCSI = false; break; // ESC
          case 0x0d: // CR (Enter)
          case 0x0a: // LF
            if (inputLine.trim()) props.onUserSubmit?.(inputLine);
            inputLine = "";
            break;
          case 0x7f: // DEL (backspace)
          case 0x08: inputLine = inputLine.slice(0, -1); break;
          case 0x03: // Ctrl-C
          case 0x15: // Ctrl-U (kill line)
          case 0x1a: inputLine = ""; break; // Ctrl-Z
          case 0x17: inputLine = inputLine.replace(/\s*\S+\s*$/, ""); break; // Ctrl-W
          default:
            if (code >= 0x20 && inputLine.length < 256) inputLine += ch;
            break;
        }
      }
    };

    // Tear down a pty on unmount/dispose. A session-backed chat pane DETACHES so
    // the dtach/tmux session + agent shell live on for the next attach — UNLESS
    // its chat is being deleted (marked for kill), where a detach would strand a
    // live shell (the socket/session is destroyed right after): then we KILL it
    // (full process-group teardown) so the shell dies with the chat. A raw /
    // one-shot pane is always killed.
    const teardownPty = (id: number) => {
      if (props.chat && !isChatMarkedForKill(props.chat.chatId)) void ptyDetach(id);
      else void ptyKill(id);
    };

    // Register cleanup synchronously so it binds to this owner even though the
    // terminal opens after an async font wait.
    onCleanup(() => {
      disposed = true;
      observer?.disconnect();
      subs.forEach((s) => s.dispose());
      if (sessionId !== null) teardownPty(sessionId);
      term.dispose();
    });

    // OS file/image drop INTO this pane: a dropped path is written into the pty
    // (no newline) exactly like a paste, so an agent like Claude Code receives
    // it. Read-only consoles don't take typed input, so they don't register.
    // Registered synchronously (binds cleanup to this owner); the `write`
    // closure reads the live `sessionId`, which is null until the pty spawns —
    // a drop during startup buffers into `pendingInput` (the same queue typeText
    // uses) so the spawn flush sends it instead of dropping it silently.
    if (!props.readOnly) {
      const unregister = registerDropTarget({
        el: container,
        write: (text) => {
          if (sessionId === null) {
            pendingInput += text;
            term.focus();
            return true;
          }
          void ptyWrite(sessionId, encoder.encode(text));
          term.focus();
          return true;
        },
        setHover: setDropHover,
      });
      onCleanup(unregister);
    }

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

      // Channel callbacks can fire after onCleanup but before the spawn promise
      // resolves — guard against writing to a disposed terminal.
      const onOutput = (data: PtyBytes) => {
        if (disposed) return;
        const bytes = toBytes(data);
        term.write(bytes);
        if (props.onOutput) props.onOutput(decoder.decode(bytes, { stream: true }));
      };
      const onExit = (code: number | null) => {
        if (!disposed) props.onExit?.(code);
      };

      // A chat pane spawns a SESSION-BACKED shell (dtach/tmux, attach-or-create)
      // so its agent survives; every other pane (interactive or one-shot run
      // console) spawns the raw shell exactly as before.
      const spawn = props.chat
        ? ptySpawnChat({
            chatId: props.chat.chatId,
            projectRoot: props.chat.projectRoot,
            cwd: props.cwd ?? null,
            env: props.env ?? null,
            backend: props.chat.backend,
            sessionId: props.chat.sessionId ?? null,
            rows: term.rows,
            cols: term.cols,
            onOutput,
            onExit,
          }).then((res) => {
            // Report the resolved session so the host can persist it.
            props.chat?.onSession?.({
              sessionId: res.sessionId,
              backend: res.backend,
              degraded: res.degraded,
            });
            return res.ptyId;
          })
        : ptySpawn({
            cwd: props.cwd ?? null,
            command: props.runCommand ?? null,
            env: props.env ?? null,
            rows: term.rows,
            cols: term.cols,
            onOutput,
            onExit,
          });

      spawn
        .then((id) => {
          if (disposed) {
            // The pane went away before the spawn resolved: detach a chat session
            // so it survives for the next attach, kill a raw pty — or, if the
            // chat is being deleted, kill the session so it doesn't outlive it.
            teardownPty(id);
            return;
          }
          sessionId = id;
          // Flush anything typed (via typeText) before the spawn resolved.
          if (pendingInput) {
            void ptyWrite(id, encoder.encode(pendingInput));
            pendingInput = "";
          }
        })
        .catch((err) => {
          if (disposed) return;
          // The spawn was rejected before any pty exists — e.g. the run cwd
          // resolved outside the approved roots. Surface it honestly in the
          // pane and drive the SAME exit path a real exit would, so the run
          // console leaves "running" instead of hanging half-mounted.
          console.error("[pickforge] pty_spawn failed", err);
          const msg = typeof err === "string" ? err : (err as Error)?.message ?? String(err);
          term.write(`\r\n\x1b[31mFailed to start: ${msg}\x1b[0m\r\n`);
          props.onExit?.(null);
        });

      subs.push(
        term.onData((data) => {
          // View-only consoles never forward keystrokes to the pty (the toolbar
          // drives it via typeText, which writes directly).
          if (props.readOnly) return;
          if (sessionId !== null) void ptyWrite(sessionId, encoder.encode(data));
          if (props.onUserSubmit) trackUserInput(data);
        }),
        term.onResize(({ rows, cols }) => {
          if (sessionId !== null) void ptyResize(sessionId, rows, cols);
        }),
      );

      // The shell/agent's OSC 2 window title — agents emit a short live summary
      // here. Forward it so the host can adopt it as the chat name (filtered +
      // debounced downstream). Read-only run consoles never name a chat.
      if (props.onTitle && !props.readOnly) {
        const onTitle = props.onTitle;
        subs.push(term.onTitleChange((title) => onTitle(title)));
      }

      // Report text selections (anchored near the pointer release) so the host
      // can offer an "Ask AI" action on the selected text; clear (null) when the
      // selection drops. Works in read-only consoles too (selection is allowed).
      if (props.onSelectionChange) {
        const emit = props.onSelectionChange;
        // Track drags that START in this terminal, and listen for the release on
        // the WINDOW — a tall selection often releases outside the container, so
        // a container-only pointerup would miss it and the menu never appears.
        let dragInside = false;
        const onPointerDown = () => {
          dragInside = true;
        };
        const onPointerUp = (e: PointerEvent) => {
          if (!dragInside) return;
          dragInside = false;
          // Defer so xterm has finalized the selection for this gesture.
          setTimeout(() => {
            if (disposed) return;
            const text = term.getSelection();
            if (text.trim()) emit({ text, x: e.clientX, y: e.clientY });
          }, 0);
        };
        container.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointerup", onPointerUp);
        subs.push(
          {
            dispose: () => {
              container.removeEventListener("pointerdown", onPointerDown);
              window.removeEventListener("pointerup", onPointerUp);
            },
          },
          term.onSelectionChange(() => {
            if (!term.hasSelection()) emit(null);
          }),
        );
      }

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
          else pendingInput += text; // buffer until the spawn resolves
          term.focus();
        },
        clear: () => term.clear(),
        focus: () => term.focus(),
      });
    })();
  });

  return (
    <div
      class="pf-terminal"
      classList={{ "pf-terminal--drop": dropHover() }}
      ref={container}
    />
  );
}
