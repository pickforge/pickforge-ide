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
  type RemotePty,
} from "../lib/pty";
import { resolvePtyRemote } from "../lib/remoteContext";
import {
  remotePtyExit,
  startPtyWithLocalFallback,
  type PtyExit,
} from "../lib/remoteTerminal";
import {
  buildConsoleTheme,
  buildTerminalTheme,
  ensureTerminalFontLoaded,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_LINE_HEIGHT,
} from "../lib/terminal-theme";
import { appTheme } from "../stores/theme";
import {
  registerTerminalSession,
  unregisterTerminalSession,
} from "../stores/terminalHarnesses";
import "./Terminal.css";

const TERMINAL_FIT_INTERVAL_MS = 80;
const TERMINAL_WINDOW_RESIZE_FIT_INTERVAL_MS = 120;

/** Imperative handle so the shell can be driven from outside (chips, focus). */
export interface TerminalHandle {
  /** Type text into the shell without executing it (no trailing newline). */
  typeText: (text: string) => void;
  /** Wipe the terminal's scrollback (the view-only console's Clear action). */
  clear: () => void;
  focus: () => void;
}

type TerminalPaneProps = {
  cwd?: string;
  projectRoot?: string;
  remote?: RemotePty | null;
  /** When set, the pty runs this command once instead of an interactive shell
   *  (the Debug Console's view-only run output). */
  runCommand?: string;
  /** Extra `PICKFORGE_*` env for the spawned shell (MCP endpoint discovery). */
  env?: Record<string, string> | null;
  onSpawn?: (remote: RemotePty | null) => void;
  fallbackToLocal?: boolean;
  onReady?: (handle: TerminalHandle) => void;
  onExit?: (exit: PtyExit) => void;
  /** Fires with each non-empty line the user types and submits (Enter).
   *  Reconstructed from real keystrokes only — injected typeText is invisible
   *  here, so it never includes chip-launched command prefixes. */
  onUserSubmit?: (line: string) => void;
  /** Fires with each decoded chunk of shell OUTPUT (e.g. to scrape a VM service
   *  URL from `flutter run`). Streaming-decoded, so multi-byte chars are safe.
   *  Only set this when the TEXT is needed — decoding runs per chunk. */
  onOutput?: (chunk: string) => void;
  /** Fires when the pty rings the terminal bell. */
  onBell?: () => void;
  /** Fires for terminal notification OSC sequences (OSC 9 / 777 notify). */
  onNotification?: (message: string) => void;
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
    /** Reports the resolved session id (and whether recovery degraded to raw,
     *  or an existing live session was re-attached) so the host can persist it
     *  and re-mark a recovered agent pane. */
    onSession?: (info: {
      sessionId: string | null;
      backend: string;
      degraded: boolean;
      attached: boolean;
    }) => void;
  };
};

function timeNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** A tiny line-editor mirror over real keystrokes, so callers can surface
 *  each line the user submits (Enter) without parsing the shell/agent's TUI.
 *  Escape sequences (arrow keys etc.) are consumed, not appended. A factory
 *  (not a composable — no signals of its own) owning its own line-buffer
 *  state, returning the per-chunk tracking function. */
function createUserInputTracker(onSubmit: ((line: string) => void) | undefined): (data: string) => void {
  let inputLine = "";
  let inEscape = false;
  let escCSI = false; // the escape is a CSI/SS3 (\x1b[ or \x1bO) multi-char seq

  const stepEscapeByte = (ch: string, code: number): void => {
    if (escCSI) {
      if (code >= 0x40 && code <= 0x7e) inEscape = escCSI = false; // final byte
    } else if (ch === "[" || ch === "O") {
      escCSI = true;
    } else {
      inEscape = false; // single-char escape
    }
  };

  const stepPlainByte = (ch: string, code: number): void => {
    switch (code) {
      case 0x1b: inEscape = true; escCSI = false; break; // ESC
      case 0x0d: // CR (Enter)
      case 0x0a: // LF
        if (inputLine.trim()) onSubmit?.(inputLine);
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
  };

  return (data: string) => {
    for (const ch of data) {
      const code = ch.codePointAt(0)!;
      if (inEscape) stepEscapeByte(ch, code);
      else stepPlainByte(ch, code);
    }
  };
}

/** Debounced viewport-resize → xterm fit, plus the RAF-batched pty-resize
 *  notification once fit settles. A factory (not a composable — no signals
 *  of its own) so the pane's mount setup can keep this cluster out of its
 *  own body. */
function createFitScheduler(deps: {
  term: Terminal;
  fit: FitAddon;
  container: HTMLDivElement;
  isDisposed: () => boolean;
  getSessionId: () => number | null;
}) {
  let fitFrame: number | null = null;
  let fitTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFitAt = 0;
  let lastFitWidth = -1;
  let lastFitHeight = -1;
  let ptyResizeFrame: number | null = null;
  let pendingPtyResize: { rows: number; cols: number } | null = null;
  let lastPtyRows = 0;
  let lastPtyCols = 0;

  const flushPtyResize = () => {
    ptyResizeFrame = null;
    const sessionId = deps.getSessionId();
    if (sessionId === null || !pendingPtyResize) return;
    const { rows, cols } = pendingPtyResize;
    pendingPtyResize = null;
    if (rows === lastPtyRows && cols === lastPtyCols) return;
    lastPtyRows = rows;
    lastPtyCols = cols;
    void ptyResize(sessionId, rows, cols);
  };

  const queuePtyResize = (rows: number, cols: number) => {
    pendingPtyResize = { rows, cols };
    if (ptyResizeFrame !== null) return;
    ptyResizeFrame = requestAnimationFrame(flushPtyResize);
  };

  const runFit = () => {
    fitFrame = null;
    if (deps.isDisposed() || !deps.container.isConnected) return;
    const width = deps.container.clientWidth;
    const height = deps.container.clientHeight;
    if (width <= 0 || height <= 0) return;
    if (width === lastFitWidth && height === lastFitHeight) return;
    const dims = deps.fit.proposeDimensions();
    if (!dims) return;
    lastFitWidth = width;
    lastFitHeight = height;
    if (dims.cols === deps.term.cols && dims.rows === deps.term.rows) return;
    try {
      lastFitAt = timeNow();
      deps.fit.fit();
    } catch {
      /* container detached mid-resize — ignore */
    }
  };

  const scheduleFit = (immediate = false) => {
    if (fitFrame !== null || fitTimer !== null) return;
    const interval =
      typeof document !== "undefined" &&
      document.body.classList.contains("pf-window-resizing")
        ? TERMINAL_WINDOW_RESIZE_FIT_INTERVAL_MS
        : TERMINAL_FIT_INTERVAL_MS;
    const delay = immediate ? 0 : Math.max(0, interval - (timeNow() - lastFitAt));
    const scheduleFrame = () => {
      fitTimer = null;
      fitFrame = requestAnimationFrame(runFit);
    };
    if (delay > 0) fitTimer = setTimeout(scheduleFrame, delay);
    else scheduleFrame();
  };

  // Called once after the initial post-font-load `fit.fit()` so the very
  // first resize observation has a real baseline to diff against.
  const recordFitBaseline = () => {
    lastFitAt = timeNow();
    lastFitWidth = deps.container.clientWidth;
    lastFitHeight = deps.container.clientHeight;
  };

  const dispose = () => {
    if (fitFrame !== null) cancelAnimationFrame(fitFrame);
    if (fitTimer !== null) clearTimeout(fitTimer);
    if (ptyResizeFrame !== null) cancelAnimationFrame(ptyResizeFrame);
  };

  return { scheduleFit, queuePtyResize, recordFitBaseline, dispose };
}

// The shell/agent's OSC 2 window title — agents emit a short live summary
// here. Forward it so the host can adopt it as the chat name (filtered +
// debounced downstream). Read-only run consoles never name a chat.
function wireTerminalTitle(
  term: Terminal,
  subs: Array<{ dispose: () => void }>,
  onTitle: TerminalPaneProps["onTitle"],
  readOnly: boolean | undefined,
): void {
  if (!onTitle || readOnly) return;
  subs.push(term.onTitleChange((title) => onTitle(title)));
}

function wireTerminalBellAndNotifications(
  term: Terminal,
  subs: Array<{ dispose: () => void }>,
  onBell: TerminalPaneProps["onBell"],
  onNotification: TerminalPaneProps["onNotification"],
  readOnly: boolean | undefined,
): void {
  if (readOnly) return;
  if (onBell) subs.push(term.onBell(() => onBell()));
  if (!onNotification) return;
  subs.push(
    term.parser.registerOscHandler(9, (data) => {
      // ConEmu-family OSC 9 subcommands (9;4 taskbar progress — also
      // systemd 257+ —, 9;9 cwd reporting, …) are numeric protocol
      // traffic, not notifications; only free-text payloads alert.
      if (/^\d{1,2}(;|$)/.test(data)) return true;
      const message = data.trim();
      if (message) onNotification(message);
      return true;
    }),
    term.parser.registerOscHandler(777, (data) => {
      const parts = data.split(";");
      if (parts[0]?.toLowerCase() !== "notify") return false;
      const message = parts.slice(1).join(" ").trim();
      if (message) onNotification(message);
      return true;
    }),
  );
}

// Report text selections (anchored near the pointer release) so the host can
// offer an "Ask AI" action on the selected text; clear (null) when the
// selection drops. Works in read-only consoles too (selection is allowed).
function wireTerminalSelection(
  term: Terminal,
  container: HTMLDivElement,
  subs: Array<{ dispose: () => void }>,
  isDisposed: () => boolean,
  onSelectionChange: TerminalPaneProps["onSelectionChange"],
): void {
  if (!onSelectionChange) return;
  // Track drags that START in this terminal, and listen for the release on
  // the WINDOW — a tall selection often releases outside the container, so a
  // container-only pointerup would miss it and the menu never appears.
  let dragInside = false;
  const onPointerDown = () => {
    dragInside = true;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!dragInside) return;
    dragInside = false;
    // Defer so xterm has finalized the selection for this gesture.
    setTimeout(() => {
      if (isDisposed()) return;
      const text = term.getSelection();
      if (text.trim()) onSelectionChange({ text, x: e.clientX, y: e.clientY });
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
      if (!term.hasSelection()) onSelectionChange(null);
    }),
  );
}

// Tear down a pty on unmount/dispose. A session-backed chat pane DETACHES so
// the dtach/tmux session + agent shell live on for the next attach — UNLESS
// its chat is being deleted (marked for kill), where a detach would strand a
// live shell (the socket/session is destroyed right after): then we KILL it
// (full process-group teardown) so the shell dies with the chat. A raw /
// one-shot pane is always killed.
function teardownPtySession(chat: TerminalPaneProps["chat"], id: number): void {
  if (chat && !isChatMarkedForKill(chat.chatId)) void ptyDetach(id);
  else void ptyKill(id);
}

/** Mutable bookkeeping for the pane's live pty session, shared across the
 *  drop-target write callback (registered before the async spawn), the spawn
 *  flow, the onData/onResize wiring, and the imperative `onReady` handle —
 *  a single object by reference so every reader always sees the current
 *  value, matching the original inline `let`s' semantics exactly. */
interface PtyMountState {
  sessionId: number | null;
  pendingInput: string; // typed before the pty spawn resolves (e.g. open-in-pane)
  ptyClosed: boolean;
  disposed: boolean;
  activeRemote: RemotePty | null;
}

// A chat pane spawns a SESSION-BACKED shell (dtach/tmux, attach-or-create) so
// its agent survives; every other pane (interactive or one-shot run console)
// spawns the raw shell exactly as before.
function startPtyForPane(
  term: Terminal,
  props: TerminalPaneProps,
  projectRoot: string | undefined,
  spawnRemote: RemotePty | null,
  onOutput: (data: PtyBytes) => void,
  onExit: (code: number | null) => void,
): Promise<number> {
  if (!props.chat) {
    return ptySpawn({
      cwd: props.cwd ?? null,
      projectRoot,
      command: props.runCommand ?? null,
      env: props.env ?? null,
      remote: spawnRemote,
      rows: term.rows,
      cols: term.cols,
      onOutput,
      onExit,
    });
  }
  const chat = props.chat;
  return ptySpawnChat({
    chatId: chat.chatId,
    projectRoot: chat.projectRoot,
    cwd: props.cwd ?? null,
    env: props.env ?? null,
    remote: spawnRemote,
    backend: chat.backend,
    sessionId: chat.sessionId ?? null,
    rows: term.rows,
    cols: term.cols,
    onOutput,
    onExit,
  }).then((res) => {
    // Report the resolved session so the host can persist it.
    chat.onSession?.({
      sessionId: res.sessionId,
      backend: res.backend,
      degraded: res.degraded,
      attached: res.status === "attached",
    });
    return res.ptyId;
  });
}

/** Spawns the pty (session-backed for a chat pane, raw otherwise), wires its
 *  output/exit channel callbacks, and — once the promise settles — wires
 *  xterm's `onData`/`onResize` to it. A factory (not a composable — no
 *  signals of its own) so the pane's async mount setup can keep this
 *  cluster out of its own body. Mutates `state` in place exactly as the
 *  original inline closures did. */
function runPtySpawnFlow(deps: {
  term: Terminal;
  props: TerminalPaneProps;
  encoder: TextEncoder;
  decoder: TextDecoder;
  projectRoot: string | undefined;
  remote: RemotePty | null;
  state: PtyMountState;
  subs: Array<{ dispose: () => void }>;
  queuePtyResize: (rows: number, cols: number) => void;
  trackUserInput: (data: string) => void;
}): void {
  const { term, props, encoder, decoder, state } = deps;

  // Channel callbacks can fire after onCleanup but before the spawn promise
  // resolves — guard against writing to a disposed terminal.
  const onOutput = (data: PtyBytes) => {
    if (state.disposed) return;
    const bytes = toBytes(data);
    term.write(bytes);
    if (props.onOutput) props.onOutput(decoder.decode(bytes, { stream: true }));
  };
  const onExit = (code: number | null) => {
    if (state.disposed) return;
    state.ptyClosed = true;
    if (props.chat && state.sessionId !== null) {
      unregisterTerminalSession(props.chat.chatId, state.sessionId);
    }
    state.sessionId = null;
    state.pendingInput = "";
    const exit = remotePtyExit(state.activeRemote, code);
    if (exit.notice) term.write(`\r\n\x1b[31m${exit.notice}\x1b[0m\r\n`);
    props.onExit?.(exit);
  };

  const start = (spawnRemote: RemotePty | null) =>
    startPtyForPane(term, props, deps.projectRoot, spawnRemote, onOutput, onExit);

  const spawn = props.fallbackToLocal === false
    ? start(deps.remote).then((value) => ({ remote: deps.remote, value }))
    : startPtyWithLocalFallback(deps.remote, start, (failedRemote) => {
      state.activeRemote = null;
      term.write(
        `\r\n\x1b[2mssh:${failedRemote.host} unavailable; started a local shell. Open the project's Remote panel and choose Test connection.\x1b[0m\r\n`,
      );
    });

  spawn
    .then(({ remote: effectiveRemote, value: id }) => {
      if (state.disposed || state.ptyClosed) {
        // The pane went away before the spawn resolved: detach a chat session
        // so it survives for the next attach, kill a raw pty — or, if the
        // chat is being deleted, kill the session so it doesn't outlive it.
        teardownPtySession(props.chat, id);
        return;
      }
      state.activeRemote = effectiveRemote;
      props.onSpawn?.(effectiveRemote);
      state.sessionId = id;
      if (props.chat) registerTerminalSession(props.chat.chatId, id);
      deps.queuePtyResize(term.rows, term.cols);
      // Flush anything typed (via typeText) before the spawn resolved.
      if (state.pendingInput) {
        void ptyWrite(id, encoder.encode(state.pendingInput));
        state.pendingInput = "";
      }
    })
    .catch((err) => {
      if (state.disposed) return;
      state.ptyClosed = true;
      // The spawn was rejected before any pty exists — e.g. the run cwd
      // resolved outside the approved roots. Surface it honestly in the
      // pane and drive the SAME exit path a real exit would, so the run
      // console leaves "running" instead of hanging half-mounted.
      console.error("[pickforge] pty_spawn failed", err);
      const msg = typeof err === "string" ? err : (err as Error)?.message ?? String(err);
      term.write(`\r\n\x1b[31mFailed to start: ${msg}\x1b[0m\r\n`);
      props.onExit?.({ code: null, notice: null, preserveBuffer: false });
    });

  deps.subs.push(
    term.onData((data) => {
      // View-only consoles never forward keystrokes to the pty (the toolbar
      // drives it via typeText, which writes directly).
      if (props.readOnly || state.ptyClosed) return;
      if (state.sessionId !== null) void ptyWrite(state.sessionId, encoder.encode(data));
      if (props.onUserSubmit) deps.trackUserInput(data);
    }),
    term.onResize(({ rows, cols }) => {
      deps.queuePtyResize(rows, cols);
    }),
  );
}

// OS file/image drop INTO this pane: a dropped path is written into the pty
// (no newline) exactly like a paste, so an agent like Claude Code receives
// it. Read-only consoles don't take typed input, so they don't register.
// Called synchronously from `TerminalPane`'s own mount setup so `onCleanup`
// binds to this owner; the `write` closure reads the live `state`, which has
// no session until the pty spawns — a drop during startup buffers into
// `state.pendingInput` (the same queue typeText uses) so the spawn flush
// sends it instead of dropping it silently.
function wirePaneDropTarget(
  container: HTMLDivElement,
  term: Terminal,
  encoder: TextEncoder,
  state: PtyMountState,
  setDropHover: (v: boolean) => void,
  readOnly: boolean | undefined,
): void {
  if (readOnly) return;
  const unregister = registerDropTarget({
    el: container,
    write: (text) => {
      if (state.ptyClosed) return false;
      if (state.sessionId === null) {
        state.pendingInput += text;
        term.focus();
        return true;
      }
      void ptyWrite(state.sessionId, encoder.encode(text));
      term.focus();
      return true;
    },
    setHover: setDropHover,
  });
  onCleanup(unregister);
}

function openTerminalWithWebgl(term: Terminal, container: HTMLDivElement): void {
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
}

function buildTerminalHandle(term: Terminal, state: PtyMountState, encoder: TextEncoder): TerminalHandle {
  return {
    typeText: (text: string) => {
      if (state.ptyClosed) return;
      if (state.sessionId !== null) void ptyWrite(state.sessionId, encoder.encode(text));
      else state.pendingInput += text; // buffer until the spawn resolves
      term.focus();
    },
    clear: () => term.clear(),
    focus: () => term.focus(),
  };
}

export function TerminalPane(props: TerminalPaneProps) {
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

    const state: PtyMountState = {
      sessionId: null,
      pendingInput: "",
      ptyClosed: false,
      disposed: false,
      activeRemote: null,
    };
    const subs: Array<{ dispose: () => void }> = [];
    const trackUserInput = createUserInputTracker(props.onUserSubmit);
    const fitScheduler = createFitScheduler({
      term,
      fit,
      container,
      isDisposed: () => state.disposed,
      getSessionId: () => state.sessionId,
    });
    let observer: ResizeObserver | undefined;

    // Capture this pane's execution routing at MOUNT (spawn intent), not after
    // the async font wait below: a project's remote binding can change while
    // that wait is in flight (e.g. its remote host/root is edited), and re-
    // reading it post-await would spawn this pane against a binding that was
    // never the one live when the pane was actually opened. Mirrors the
    // pre-await capture discipline `launchTarget` uses for a run's device
    // selection.
    const projectRoot = props.chat?.projectRoot ?? props.projectRoot ?? props.cwd;
    const remote = resolvePtyRemote(props.remote, projectRoot);
    state.activeRemote = remote;

    // Register cleanup synchronously so it binds to this owner even though the
    // terminal opens after an async font wait.
    onCleanup(() => {
      state.disposed = true;
      observer?.disconnect();
      fitScheduler.dispose();
      subs.forEach((s) => s.dispose());
      if (state.sessionId !== null) {
        if (props.chat) unregisterTerminalSession(props.chat.chatId, state.sessionId);
        teardownPtySession(props.chat, state.sessionId);
      }
      term.dispose();
    });

    wirePaneDropTarget(container, term, encoder, state, setDropHover, props.readOnly);

    void (async () => {
      // Wait for Geist Mono before xterm measures glyph width — otherwise it
      // locks onto a system fallback and the whole pane renders in the wrong
      // font with mis-aligned columns.
      await ensureTerminalFontLoaded();
      if (state.disposed) return;

      openTerminalWithWebgl(term, container);

      fit.fit();
      fitScheduler.recordFitBaseline();

      runPtySpawnFlow({
        term,
        props,
        encoder,
        decoder,
        projectRoot,
        remote,
        state,
        subs,
        queuePtyResize: fitScheduler.queuePtyResize,
        trackUserInput,
      });

      wireTerminalTitle(term, subs, props.onTitle, props.readOnly);
      wireTerminalBellAndNotifications(term, subs, props.onBell, props.onNotification, props.readOnly);
      wireTerminalSelection(term, container, subs, () => state.disposed, props.onSelectionChange);

      observer = new ResizeObserver(() => {
        fitScheduler.scheduleFit();
      });
      observer.observe(container);
      fitScheduler.scheduleFit(true);

      term.focus();

      props.onReady?.(buildTerminalHandle(term, state, encoder));
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
