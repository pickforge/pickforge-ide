// Boot-epoch gating for the emulator auto-boot path (see stores/runLaunch.ts).
// A single counter discriminates one boot attempt from the next: each launch
// takes the next epoch, and a cancel/supersede bumps it. Any async work captured
// under an epoch checks `isCurrent` before acting, so a stale boot (cancelled or
// overtaken by a newer launch) can never clear booting state or latch a run.
// Pure and runtime-free so it can be unit-tested in isolation.

export class BootEpoch {
  private current = 0;

  /** Claim the next epoch for a new boot attempt and return its token. */
  next(): number {
    return ++this.current;
  }

  /** Supersede the active boot (cancel) so its captured token goes stale. */
  bump(): void {
    this.current++;
  }

  /** True only while `epoch` is still the active one (not cancelled/superseded). */
  isCurrent(epoch: number): boolean {
    return epoch === this.current;
  }
}
