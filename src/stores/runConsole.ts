// Run session state for the bottom Debug Console. The Run controls drive a
// dedicated console terminal (its own pty) instead of the user's focused shell,
// so a run never hijacks the terminal they're working in. open/height persist;
// status/target are per-session. Commands are buffered until the console
// terminal registers its handle (mirrors TerminalPane's pending-input pattern).
import { createSignal } from "solid-js";
import type { TerminalHandle } from "../components/Terminal";
import { shquote, type RunTarget } from "../lib/runTargets";
import { watchDartChanges, type WatchHandle } from "../lib/fsWatch";
import { autoReloadEnabled } from "./autoReload";

export type RunStatus = "idle" | "running" | "stopped";

const KEY = "pickforge.runConsole";
const MIN_H = 120;
const MAX_H = 720;
const DEFAULT_H = 260;

const clampH = (n: number) => Math.min(MAX_H, Math.max(MIN_H, Math.round(n)));

function load(): { open: boolean; height: number } {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      open: p.open === true,
      height: clampH(Number.isFinite(p.height) ? p.height : DEFAULT_H),
    };
  } catch {
    return { open: false, height: DEFAULT_H };
  }
}

const initial = load();
const [open, setOpen] = createSignal(initial.open);
const [height, setHeight] = createSignal(initial.height);
const [hasRun, setHasRun] = createSignal(false);
const [status, setStatus] = createSignal<RunStatus>("idle");
const [target, setTarget] = createSignal<RunTarget | null>(null);
const [consoleCwd, setConsoleCwd] = createSignal<string | null>(null);

let handle: TerminalHandle | null = null;
let pending = "";

function persist() {
  localStorage.setItem(KEY, JSON.stringify({ open: open(), height: height() }));
}

function send(text: string) {
  if (handle) handle.typeText(text);
  else pending += text; // flushed by attachConsole once the terminal is ready
}

/** Read-only signals for views. */
export const runConsole = { open, height, hasRun, status, target };

// ---- auto hot-reload: watch the run dir for .dart writes → send reload ----
let watch: WatchHandle | null = null;
let watchEpoch = 0; // bumped on stop / each start, to discard stale async starts
let runBase: string | null = null; // the dir of the ACTIVE run (per run, not the first)

function stopWatch() {
  watch?.stop();
  watch = null;
  watchEpoch++; // invalidate any in-flight start so it can't latch on later
}

/** Re-evaluate the auto-reload watch against current state. Called on run
 *  start/stop and when the toggle flips, so it's idempotent. */
export function syncAutoReloadWatch() {
  const canReload = !!target()?.capabilities.includes("hotReload");
  const want = status() === "running" && autoReloadEnabled() && canReload && !!runBase;
  if (!want) {
    stopWatch();
    return;
  }
  if (watch) return; // already watching the active run
  const epoch = ++watchEpoch;
  void watchDartChanges(runBase!, () => {
    if (status() === "running") reloadRun();
  })
    .then((h) => {
      // Discard if superseded (a newer start/stop bumped the epoch) or no
      // longer wanted — so two racing starts never leak one OS watcher.
      if (epoch === watchEpoch && !watch && status() === "running" && autoReloadEnabled()) watch = h;
      else h.stop();
    })
    .catch(() => {});
}

/** The DebugConsole's terminal registers its handle here once spawned. */
export function attachConsole(h: TerminalHandle) {
  handle = h;
  if (pending) {
    h.typeText(pending);
    pending = "";
  }
}
export function detachConsole() {
  handle = null;
}

export function openConsole() {
  setOpen(true);
  persist();
}
export function closeConsole() {
  setOpen(false);
  persist();
}
export function toggleConsole() {
  setOpen(!open());
  persist();
}
export function setConsoleHeight(px: number) {
  setHeight(clampH(px));
  persist();
}

/** Launch a target: open the console, (lazily) mount its terminal, run there. */
export function startRun(t: RunTarget, projectRoot: string | null) {
  setTarget(t);
  // The target carries its own run dir (derived from its program's pubspec, or
  // an explicit launch.json cwd); fall back to the project root.
  const base = t.cwd ?? projectRoot;
  if (!hasRun()) {
    setConsoleCwd(base); // spawn the console shell in the run dir
    setHasRun(true);
  }
  setOpen(true);
  persist();
  setStatus("running");
  // Prefix one absolute cd so each run starts in the right dir regardless of
  // where a previous run left the console shell.
  const cmd = base ? `cd ${shquote(base)} && ${t.command}` : t.command;
  send(cmd + "\r");
  runBase = base; // watch THIS run's dir, not just the first console's cwd
  syncAutoReloadWatch();
}

/** The console shell exited (e.g. user typed `exit`): drop the dead handle and
 * reset so the next run mounts a fresh terminal instead of writing into a void. */
export function consoleExited() {
  detachConsole();
  setStatus("stopped");
  setHasRun(false);
  stopWatch();
}

/** Hot reload / restart are keystrokes the running tool reads from stdin. */
export function reloadRun() {
  send("r");
}
export function restartRun() {
  send("R");
}
export function stopRun() {
  // Flutter quits on "q"; everything else gets Ctrl-C.
  send(target()?.capabilities.includes("hotReload") ? "q" : "\x03");
  setStatus("stopped");
  stopWatch();
}

/** cwd the console terminal should spawn in (set on first run). */
export const consoleSpawnCwd = consoleCwd;
