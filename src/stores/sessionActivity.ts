// Per-chat agent SESSION ACTIVITY — drives the sidebar's ember "live session"
// glow. Two levels, derived from the chat's session-backed (primary/agent) pane:
//
//   * running  — the agent pane has a live PTY (the agent terminal exists);
//                a calm, steady ember glow on the chat row.
//   * working  — output has flowed within the last ~2s (the agent is actively
//                producing); a livelier ember pulse.
//
// This is the EMBER signal in the rail. It's distinct from the AMBER
// needs-attention dot (see notifications.ts): a chat can be both working and
// flagged, so the two coexist and must read clearly together.
//
// The state machine is pure and exported (computeRunLevel) so it's unit-tested
// without a DOM or timers. The reactive store wraps it: it records output
// timestamps (throttled — never per byte) and schedules a single trailing
// re-evaluation so "working" relaxes back to "running" after the window.
import { createSignal } from "solid-js";

export type RunLevel = "idle" | "running" | "working";

/** How long after the last output chunk a chat still reads as "working". */
export const WORKING_WINDOW_MS = 2000;
/** Throttle for output notes: at most one store touch per chat per interval, so
 *  a heavy output burst can't thrash reactivity on every byte. */
const OUTPUT_THROTTLE_MS = 250;

/** Per-chat activity record. `running` tracks whether the agent PTY is live;
 *  `lastOutputAt` is the timestamp of the most recent output chunk (null when
 *  none has flowed yet this session). */
export interface ActivityState {
  running: boolean;
  lastOutputAt: number | null;
}

/** Pure: resolve a chat's run level from its activity record. Exported for unit
 *  testing — no store, no timers. A chat that isn't running is always idle; a
 *  running chat is "working" while output flowed within the window, else a calm
 *  "running". */
export function computeRunLevel(
  state: ActivityState | undefined,
  now: number,
  windowMs = WORKING_WINDOW_MS,
): RunLevel {
  if (!state || !state.running) return "idle";
  if (state.lastOutputAt !== null && now - state.lastOutputAt < windowMs) return "working";
  return "running";
}

// ---- reactive store ----
// A single Record signal keyed by chatId. We bump it via a fresh object on each
// transition so SolidJS reactions re-run; a `tick` signal forces re-evaluation
// when only the passage of time (the working window elapsing) changes the level.
const [states, setStates] = createSignal<Record<string, ActivityState>>({});
const [tick, setTick] = createSignal(0);

// Per-chat trailing timer that re-evaluates once the working window elapses, and
// per-chat throttle stamp so output notes coalesce.
const relaxTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastNoteAt = new Map<string, number>();

function clearRelaxTimer(chatId: string) {
  const t = relaxTimers.get(chatId);
  if (t !== undefined) {
    clearTimeout(t);
    relaxTimers.delete(chatId);
  }
}

/** The chat's agent pane has a live PTY — mark it running (idempotent). Keeps any
 *  existing output timestamp so a respawn doesn't drop a fresh "working" cue. */
export function markRunning(chatId: string) {
  const cur = states()[chatId];
  if (cur?.running) return;
  setStates((s) => ({ ...s, [chatId]: { running: true, lastOutputAt: cur?.lastOutputAt ?? null } }));
}

/** The chat's agent PTY exited (or the host was torn down) — clear all activity.
 *  Drops the record entirely so the row returns to idle (no lingering glow). */
export function clearRunning(chatId: string) {
  clearRelaxTimer(chatId);
  lastNoteAt.delete(chatId);
  setStates((s) => {
    if (!(chatId in s)) return s;
    const next = { ...s };
    delete next[chatId];
    return next;
  });
}

/** Output flowed in the chat's agent pane — bump it to "working". Throttled: at
 *  most one store touch per OUTPUT_THROTTLE_MS so a byte storm doesn't thrash.
 *  Schedules a single trailing re-evaluation so the level relaxes back to
 *  "running" once the window passes with no further output. No-op if the chat
 *  isn't marked running (only the agent/primary pane reports output). */
export function noteOutput(chatId: string, now: number = Date.now()) {
  const cur = states()[chatId];
  if (!cur?.running) return;
  const last = lastNoteAt.get(chatId) ?? 0;
  const fresh = now - last >= OUTPUT_THROTTLE_MS;
  // Always remember the latest timestamp (so the relax timer below measures from
  // the real last byte), but only touch the reactive store on the throttle edge.
  lastNoteAt.set(chatId, now);
  if (fresh) {
    setStates((s) => {
      const c = s[chatId];
      if (!c) return s;
      return { ...s, [chatId]: { ...c, lastOutputAt: now } };
    });
  } else {
    // Within the throttle window: keep the stored timestamp moving so the level
    // stays "working", without re-rendering on every chunk.
    const c = states()[chatId];
    if (c) c.lastOutputAt = now; // mutate in place — no reaction (intentional)
  }
  // (Re)arm the trailing relax: one timer that fires WORKING_WINDOW_MS after the
  // latest output, dropping the row from "working" back to a calm "running".
  clearRelaxTimer(chatId);
  relaxTimers.set(
    chatId,
    setTimeout(() => {
      relaxTimers.delete(chatId);
      setTick((n) => n + 1); // force readers to re-evaluate computeRunLevel
    }, WORKING_WINDOW_MS),
  );
}

/** Reactive: this chat's current run level (idle / running / working). */
export function chatRunLevel(chatId: string): RunLevel {
  tick(); // subscribe to the relax tick so "working" can fall back to "running"
  return computeRunLevel(states()[chatId], Date.now());
}

/** Reactive: is this chat running at all (running OR working)? */
export function chatRunning(chatId: string): boolean {
  return chatRunLevel(chatId) !== "idle";
}

/** Reactive: how many of a project's chats are running (rail rollup, mirrors
 *  projectAttentionCount). */
export function projectRunningCount(chatIds: string[]): number {
  let n = 0;
  for (const id of chatIds) if (chatRunning(id)) n++;
  return n;
}

/** Test-only: wipe all activity + timers. */
export function __resetSessionActivity() {
  relaxTimers.forEach((t) => clearTimeout(t));
  relaxTimers.clear();
  lastNoteAt.clear();
  setStates({});
  setTick(0);
}
