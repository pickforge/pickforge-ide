import { describe, expect, it, vi } from "vitest";
import { createSingleFlightRunner } from "../../src/lib/singleFlight";

/** A controllable "run": resolves only when the test calls `resolve()`, and
 *  records whether it committed (i.e. `isStale()` was false when it tried
 *  to). Mirrors the real caller's pattern (`if (isStale()) return;` before
 *  committing state). */
function deferredRun() {
  let resolveFn!: () => void;
  const committed: boolean[] = [];
  const started: Array<() => boolean> = [];
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  const run = vi.fn((isStale: () => boolean) => {
    started.push(isStale);
    return promise.then(() => {
      committed.push(!isStale());
    });
  });
  return { run, resolve: () => resolveFn(), committed, started };
}

describe("createSingleFlightRunner", () => {
  it("a single trigger runs once and commits", async () => {
    const { run, resolve, committed } = deferredRun();
    const runner = createSingleFlightRunner(run);
    runner.trigger();
    expect(run).toHaveBeenCalledTimes(1);
    resolve();
    await Promise.resolve().then(() => Promise.resolve());
    expect(committed).toEqual([true]);
  });

  it("an older result never wins: a trigger while in flight marks it stale before it resolves", async () => {
    let call = 0;
    const runs: Array<{ resolve: () => void; committed: boolean[] }> = [];
    const run = vi.fn((isStale: () => boolean) => {
      const i = call++;
      let resolveFn!: () => void;
      const committed: boolean[] = [];
      const p = new Promise<void>((r) => (resolveFn = r)).then(() => {
        committed.push(!isStale());
      });
      runs[i] = { resolve: resolveFn, committed };
      return p;
    });
    const runner = createSingleFlightRunner(run);

    runner.trigger(); // starts run #0
    runner.trigger(); // in flight -> marks #0 stale, queues a rerun

    // The OLDER run (#0) resolves LAST (simulating a slow scan overtaken by
    // a newer trigger) — it must see itself as stale and never commit.
    runs[0].resolve();
    await Promise.resolve().then(() => Promise.resolve());
    expect(runs[0].committed).toEqual([false]);

    // Its `.finally` starts the queued rerun (run #1); resolve it too.
    expect(run).toHaveBeenCalledTimes(2);
    runs[1].resolve();
    await Promise.resolve().then(() => Promise.resolve());
    expect(runs[1].committed).toEqual([true]);
  });

  it("a burst of triggers while in flight queues at most one follow-up run", async () => {
    const { run, resolve } = deferredRun();
    const runner = createSingleFlightRunner(run);
    runner.trigger();
    runner.trigger();
    runner.trigger();
    runner.trigger();
    expect(run).toHaveBeenCalledTimes(1); // only the first started a run

    resolve();
    await Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());
    // Exactly ONE follow-up run for the whole burst, not one per extra trigger.
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("invalidate() marks the in-flight run stale and cancels any queued rerun", async () => {
    const { run, resolve, committed } = deferredRun();
    const runner = createSingleFlightRunner(run);
    runner.trigger();
    runner.trigger(); // would have queued a rerun...
    runner.invalidate(); // ...but this cancels it and marks #0 stale too

    resolve();
    await Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());
    expect(committed).toEqual([false]);
    expect(run).toHaveBeenCalledTimes(1); // no rerun was queued after invalidate()
  });
});
