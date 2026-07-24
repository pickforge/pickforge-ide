// pi-kit lanes visibility (#274 slice 3, #288): a thin store over the
// `list_pi_kit_runs` / `abandon_pi_kit_lane` Tauri commands, which read only
// pi-kit's redacted `<run>.status.json` files — never the raw journals.
import { createSignal } from "solid-js";
import { errorText } from "../lib/errors";
import { abandonPiKitLane, listPiKitRuns, type PiKitRunEntry } from "../lib/process";

// Modest refresh cadence while the Lanes panel is open; polling stops the
// moment it's closed (see stopPiKitLanesPolling). pi-kit rewrites the status
// file on every lane update, so a few seconds of lag is an acceptable
// tradeoff against constant background disk reads.
const POLL_MS = 4000;

const [runs, setRuns] = createSignal<PiKitRunEntry[]>([]);
const [loading, setLoading] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

export const pikitRuns = runs;
export const pikitRunsLoading = loading;
export const pikitRunsError = error;

export async function loadPiKitRuns(): Promise<void> {
  setLoading(true);
  try {
    const next = await listPiKitRuns();
    setRuns(next);
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
