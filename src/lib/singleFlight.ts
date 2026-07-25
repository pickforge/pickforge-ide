// Single-flight async coalescing (#333 review P2): at most one `run` in
// flight at a time. A `trigger()` call while one is already running never
// starts a second, overlapping run — it coalesces into exactly ONE queued
// rerun after the current one finishes, and marks the current run STALE (via
// the `isStale` callback passed to it) so its eventual result can never win
// a race against the newer trigger that superseded it. Without this, two
// overlapping triggers (e.g. a filesystem-watch burst and an agent-turn
// completion arriving close together) could let an OLDER, slower run commit
// its state AFTER a newer one already did.
//
// Solid-free and side-effect-free beyond calling `run` — unit-testable
// directly with fake promises, independent of any component or store.
export interface SingleFlightRunner {
  /** Start a run now, or — if one is already in flight — mark it stale and
   *  queue exactly one rerun for after it completes. Coalesces any number of
   *  calls made while a run is in flight into that single queued rerun. */
  trigger: () => void;
  /** Marks the in-flight run (if any) stale and cancels any queued rerun,
   *  without starting a new one — for a caller that needs to synchronously
   *  invalidate everything itself (e.g. "no active project", which clears
   *  state directly rather than running a scan). */
  invalidate: () => void;
}

export function createSingleFlightRunner(run: (isStale: () => boolean) => Promise<void>): SingleFlightRunner {
  let generation = 0;
  let inFlight = false;
  let queuedRerun = false;

  const start = () => {
    const gen = ++generation;
    inFlight = true;
    const isStale = () => gen !== generation;
    void run(isStale).finally(() => {
      inFlight = false;
      if (queuedRerun) {
        queuedRerun = false;
        start();
      }
    });
  };

  return {
    trigger: () => {
      if (inFlight) {
        generation++; // the run in flight is superseded — its result must not commit
        queuedRerun = true;
        return;
      }
      start();
    },
    invalidate: () => {
      generation++;
      queuedRerun = false;
    },
  };
}
