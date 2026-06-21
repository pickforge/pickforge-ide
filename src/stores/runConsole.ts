// Run session state for the bottom Debug Console. The Run controls drive a
// dedicated, view-only console terminal that runs the chosen command DIRECTLY
// (`$SHELL -c <command>`) — never the user's shell — so a finished run leaves
// its output behind instead of dropping to a live shell prompt. Each launch
// mounts a fresh pty (keyed by `current`); reload/restart/stop are bytes written
// to the running process, and stop is a real SIGINT (Ctrl-C) via the pty.
import { createSignal } from "solid-js";
import type { TerminalHandle } from "../components/Terminal";
import { type RunTarget } from "../lib/runTargets";
import { watchDartChanges, type WatchHandle } from "../lib/fsWatch";
import { newSessionId, recordRunFinish, recordRunStart } from "../lib/runRecord";
import { autoReloadEnabled } from "./autoReload";
import { disarmVmAutoConnect } from "./vmService";

/** Device + connection context the run-history row captures at launch. The
 *  caller (launchActiveTarget) supplies what it resolved; everything is
 *  optional so a launch with no device still records a row. */
export interface RunRecordContext {
  serial?: string | null;
  avdId?: string | null;
  avdName?: string | null;
  connectionMode?: string;
}

export type RunStatus = "idle" | "running" | "stopped";

/** The currently-mounted run. A fresh `key` each launch remounts the console
 *  pane (new pty) so output never bleeds between runs. */
export type RunSession = { key: number; command: string; cwd: string | null };

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
const [status, setStatus] = createSignal<RunStatus>("idle");
const [target, setTarget] = createSignal<RunTarget | null>(null);
const [current, setCurrent] = createSignal<RunSession | null>(null);

let handle: TerminalHandle | null = null;
let runKey = 0;
// A stop requested before the console pane attached its handle, tagged with the
// run key it targeted so it's delivered to THAT run (not a newer one) on attach.
let pendingStopKey: number | null = null;
// The persisted run-history session for the live run, and whether its finish has
// been recorded yet — so a run logs exactly one insert + one finish even if
// stopRun and consoleExited both fire (stop, then the process exits).
let runSessionId: string | null = null;
let runFinishRecorded = false;

function persist() {
  localStorage.setItem(KEY, JSON.stringify({ open: open(), height: height() }));
}

/** Write a control byte to the running process's stdin (reload/restart). Stop is
 *  handled separately so it can survive the pre-attach window. */
function send(text: string) {
  handle?.typeText(text);
}

/** Read-only signals for views. */
export const runConsole = { open, height, status, target, current };

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
  // A stop clicked before this pane attached (font load / pty spawn still
  // pending) would otherwise be dropped, leaving the run alive. Deliver it now,
  // but only for the run it targeted — never a newer run mounted since.
  if (pendingStopKey !== null && pendingStopKey === current()?.key) {
    pendingStopKey = null;
    h.typeText("\x03");
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

/** Wipe the console's scrollback. Safe at any time; never kills the run. */
export function clearConsole() {
  handle?.clear();
}

/** Record the run's end exactly once. `consoleExited` and `stopRun` can both
 *  fire (a stop, then the process exits); only the first writes a finish. */
function finishRunRecord(exitReason: string) {
  if (runFinishRecorded || !runSessionId) return;
  runFinishRecorded = true;
  void recordRunFinish(runSessionId, Date.now(), exitReason, null);
}

/** Launch a target: open the console and mount a fresh pty that runs the
 *  command directly. Guards against stacking a run on top of a live one. */
export function startRun(t: RunTarget, projectRoot: string | null, ctx: RunRecordContext = {}) {
  if (status() === "running") return;
  setTarget(t);
  // The target carries its own run dir (derived from its program's pubspec, or
  // an explicit launch.json cwd); fall back to the project root.
  const base = t.cwd ?? projectRoot;
  setOpen(true);
  persist();
  setStatus("running");
  pendingStopKey = null; // a fresh run is never pre-stopped
  // A new key remounts the console pane, spawning a fresh pty that runs THIS
  // command in `base` — output never carries over from a previous run.
  setCurrent({ key: ++runKey, command: t.command, cwd: base });
  runBase = base; // watch THIS run's dir, not just the first console's cwd
  syncAutoReloadWatch();
  // Persist the launch as a run-history row (best effort — a write failure must
  // never block the run). A fresh session id per launch, finished on exit/stop.
  runFinishRecorded = false;
  runSessionId = projectRoot ? newSessionId() : null;
  if (runSessionId && projectRoot) {
    void recordRunStart({
      sessionId: runSessionId,
      projectRoot,
      startedAt: Date.now(),
      endedAt: null,
      avdId: ctx.avdId ?? null,
      avdName: ctx.avdName ?? null,
      serial: ctx.serial ?? null,
      vmServiceUrl: null,
      // The target has no entry-file field; its label ("Flutter", "Config 1") is
      // the readable identifier RunHistory shows in the target_file slot.
      targetFile: t.label || null,
      connectionMode: ctx.connectionMode ?? "auto",
      exitReason: null,
      exitCode: null,
      hotReloadCount: 0,
      hotRestartCount: 0,
      errorCount: 0,
      lastError: null,
    });
  }
}

/** The run process exited (finished, crashed, or stopped): mark stopped and
 *  stop the watcher, but KEEP the pane mounted so its output stays visible. */
export function consoleExited() {
  setStatus("stopped");
  stopWatch();
  // Process ended on its own (finished or crashed). If a stop already recorded
  // the finish, the idempotency guard keeps that "stopped" reason.
  finishRunRecord("exited");
  // A run that ended before its VM URL printed must not let a later/unrelated
  // chunk of output auto-connect the inspector to a dead/wrong VM.
  disarmVmAutoConnect();
}

/** Hot reload / restart are keystrokes the running tool reads from stdin. */
export function reloadRun() {
  send("r");
}
export function restartRun() {
  send("R");
}
/** Stop = Ctrl-C: the pty line discipline raises SIGINT on the foreground run
 *  process. Reliable at any startup stage, unlike sending Flutter's "q" before
 *  it is reading stdin (which used to garble into the shell). */
export function stopRun() {
  // Ctrl-C → SIGINT via the pty line discipline. If the pane hasn't attached its
  // handle yet, remember the request against this run's key so attachConsole can
  // deliver it the moment the pty exists (otherwise the stop is silently lost).
  if (handle) handle.typeText("\x03");
  else pendingStopKey = current()?.key ?? null;
  setStatus("stopped");
  stopWatch();
  finishRunRecord("stopped"); // user-initiated SIGINT
  disarmVmAutoConnect(); // stop scanning output for a VM URL once the run is done
}
