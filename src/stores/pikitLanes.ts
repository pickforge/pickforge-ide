// pi-kit lanes visibility (#274 slice 3, #288): a thin store over the
// `list_pi_kit_runs` / `abandon_pi_kit_lane` Tauri commands, which read only
// pi-kit's redacted `<run>.status.json` files — never the raw journals.
import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { errorText } from "../lib/errors";
import { abandonPiKitLane, listPiKitRunPage, listPiKitRuns, type PiKitRunEntry } from "../lib/process";

// Modest refresh cadence while the Lanes panel is open; polling stops the
// moment it's closed (see stopPiKitLanesPolling). pi-kit rewrites the status
// file on every lane update, so a few seconds of lag is an acceptable
// tradeoff against constant background disk reads.
const POLL_MS = 4000;

// A store rather than a signal so a poll can DIFF the run list instead of
// replacing it (#363). Every poll deserializes fresh `PiKitRunEntry` objects,
// so a plain signal handed `<For>` an array in which no entry was ever
// reference-equal to the last one — `For` reconciles by identity, so it
// disposed and recreated every row on a 4s cadence, resetting each card's
// local expansion state and re-mounting lane rows that had only changed a
// number. `reconcile` keyed by the run id keeps unchanged entries at their
// existing reference and mutates changed ones in place, so rows survive the
// poll and lane values update without a remount.
//
// The key applies to the WHOLE tree, and lanes carry no `run` property, so
// nested lane items match by position rather than by lane id. Harmless today —
// the final state always equals the payload, and pi-kit emits lanes in stable
// order — but if lanes ever reorder mid-run, a row keeps its identity while its
// contents become a different lane's. Anything that later attaches per-lane
// local state (expansion, focus, animation) must key it explicitly.
/** How much ENDED history the panel keeps on screen. Active runs are never
 *  capped. A starting value, not a measured one — revisit against how many runs
 *  are typically live at once (#363). */
export const PIKIT_RUN_PAGE_LIMIT = 5;

const [state, setState] = createStore<{ runs: PiKitRunEntry[] }>({ runs: [] });
const [total, setTotal] = createSignal(0);
const [loading, setLoading] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

export const pikitRuns = (): PiKitRunEntry[] => state.runs;
/** Every run on disk, including those this page omits — so "view all N" tells
 *  the truth rather than counting what happens to be rendered. */
export const pikitRunsTotal = total;
export const pikitRunsLoading = loading;
export const pikitRunsError = error;

export async function loadPiKitRuns(): Promise<void> {
  setLoading(true);
  try {
    const page = await listPiKitRunPage(PIKIT_RUN_PAGE_LIMIT);
    setState("runs", reconcile(page.runs, { key: "run" }));
    setTotal(page.total);
    setError(null);
  } catch (err) {
    setError(errorText(err));
  } finally {
    setLoading(false);
  }
}

let pollHandle: number | undefined;

/** Starts refresh-on-open + interval polling. Idempotent — a second call
 * while already polling is a no-op, so a panel can call this unconditionally
 * on mount. */
export function startPiKitLanesPolling(): void {
  if (pollHandle !== undefined) return;
  void loadPiKitRuns();
  pollHandle = window.setInterval(() => void loadPiKitRuns(), POLL_MS);
}

/** Stops interval polling. Call from the panel's cleanup so nothing polls
 * while the surface isn't visible. */
export function stopPiKitLanesPolling(): void {
  if (pollHandle === undefined) return;
  window.clearInterval(pollHandle);
  pollHandle = undefined;
}

export type AbandonResult = { ok: true; consumed: boolean } | { ok: false; error: string };

/** Writes the abandon request and refreshes the run list either way, so a
 * caller sees the latest lane states immediately after. */
/** The complete run list, for the "view all" dialog. Deliberately a separate
 *  one-shot read rather than widening the poll: the whole point of the page is
 *  that the 4s cadence stops scaling with history. */
export async function loadAllPiKitRuns(): Promise<PiKitRunEntry[]> {
  return await listPiKitRuns();
}

export async function requestPiKitAbandon(
  run: string,
  lane: string | null,
  reason: string | null,
): Promise<AbandonResult> {
  try {
    const outcome = await abandonPiKitLane(run, lane, reason);
    await loadPiKitRuns();
    return { ok: true, consumed: outcome.consumed };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}
