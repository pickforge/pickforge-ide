import { describe, expect, it } from "vitest";

import { BootEpoch } from "../../src/lib/bootEpoch";

// The emulator auto-boot path gates all async work on a boot epoch so a stale
// boot (cancelled, or overtaken by a newer launch) can never clear booting state
// or latch a run. These cover the three transitions runLaunch.ts relies on.
describe("BootEpoch", () => {
  it("keeps the captured epoch current through a normal boot", () => {
    const e = new BootEpoch();
    const epoch = e.next();
    expect(e.isCurrent(epoch)).toBe(true); // boot succeeds → proceeds to run
  });

  it("invalidates the in-flight boot on cancel (bump)", () => {
    const e = new BootEpoch();
    const epoch = e.next();
    e.bump(); // cancelBoot()
    expect(e.isCurrent(epoch)).toBe(false); // stale → waitForBooted bails, no run
  });

  it("supersedes an earlier boot when a newer launch claims the next epoch", () => {
    const e = new BootEpoch();
    const stale = e.next(); // first launch
    const fresh = e.next(); // second launch supersedes it
    expect(e.isCurrent(stale)).toBe(false); // late resolve of #1 can't latch a run
    expect(e.isCurrent(fresh)).toBe(true); // #2 owns the boot
  });

  it("a late success on a cancelled epoch never reads as current", () => {
    const e = new BootEpoch();
    const epoch = e.next();
    e.bump(); // cancelled mid-boot
    // Even if waitForBootedSerial later resolves a serial, the epoch guard fails:
    expect(e.isCurrent(epoch)).toBe(false);
  });
});
