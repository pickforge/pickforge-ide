import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => {
  const m = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return m;
});

import {
  clampStep,
  endTour,
  markTourDone,
  startTour,
  TOUR_STEPS,
  tourActive,
  tourNext,
  tourPrev,
  tourSeen,
  tourStep,
} from "../../src/stores/tour";

beforeEach(() => {
  mem.clear();
  endTour(); // reset active + step state
  mem.clear(); // endTour marks done; clear again for a clean slate
});

describe("clampStep — never leaves the valid step range", () => {
  it("clamps below 0 and above the last index", () => {
    expect(clampStep(-3)).toBe(0);
    expect(clampStep(0)).toBe(0);
    expect(clampStep(TOUR_STEPS.length + 5)).toBe(TOUR_STEPS.length - 1);
  });
});

describe("tour navigation", () => {
  it("advances and steps back within bounds", () => {
    startTour();
    expect(tourStep()).toBe(0);
    tourNext();
    expect(tourStep()).toBe(1);
    tourPrev();
    expect(tourStep()).toBe(0);
    tourPrev(); // already first — stays put
    expect(tourStep()).toBe(0);
  });

  it("finishing the last step ends the tour and marks it done", () => {
    startTour();
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) tourNext();
    expect(tourStep()).toBe(TOUR_STEPS.length - 1);
    expect(tourActive()).toBe(true);
    tourNext(); // past the last step
    expect(tourActive()).toBe(false);
    expect(tourSeen()).toBe(true);
  });
});

describe("tourSeen / markTourDone", () => {
  it("is unseen until marked", () => {
    expect(tourSeen()).toBe(false);
    markTourDone();
    expect(tourSeen()).toBe(true);
  });
});
