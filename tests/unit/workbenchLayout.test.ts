// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

// This repo's own localStorage-backed stores stub `globalThis.localStorage`
// rather than rely on jsdom's — see tests/unit/forgeContext.test.ts / the
// agentChat.test.ts `settings` fixture for the same pattern.
const mem = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage;

async function loadStore() {
  mem.clear();
  const mod = await import("../../src/stores/workbenchLayout");
  mod.resetLayout();
  return mod;
}

describe("revealPane / focusChangesReviewSurface (#231 PR3)", () => {
  beforeEach(() => {
    mem.clear();
  });

  it("reveals a hidden dock and un-collapses the pane", async () => {
    const { layout, setDockVisible, togglePaneCollapsed, revealPane } = await loadStore();

    setDockVisible("right", false);
    togglePaneCollapsed("sourceControl");
    expect(layout().rightVisible).toBe(false);
    expect(layout().collapsed.sourceControl).toBe(true);

    revealPane("sourceControl");

    expect(layout().rightVisible).toBe(true);
    expect(layout().collapsed.sourceControl).toBeFalsy();
  });

  it("is a no-op when the pane is already visible and expanded", async () => {
    const { layout, revealPane } = await loadStore();

    const before = layout();
    revealPane("sourceControl");

    expect(layout()).toEqual(before);
  });

  it("focusChangesReviewSurface reveals the Source Control pane specifically", async () => {
    const { layout, setDockVisible, focusChangesReviewSurface } = await loadStore();

    setDockVisible("right", false);
    focusChangesReviewSurface();

    expect(layout().rightVisible).toBe(true);
  });

  // #231 PR4 retarget: SourceControl's local "changes"/"graph" toggle watches
  // this epoch to force itself back onto the Changes review surface — a
  // receipt's "Review changes" click must win even if the pane was last left
  // showing the commit graph.
  it("focusChangesReviewSurface bumps changesReviewFocusEpoch on every call", async () => {
    const { focusChangesReviewSurface, changesReviewFocusEpoch } = await loadStore();

    const before = changesReviewFocusEpoch();
    focusChangesReviewSurface();
    expect(changesReviewFocusEpoch()).toBe(before + 1);
    focusChangesReviewSurface();
    expect(changesReviewFocusEpoch()).toBe(before + 2);
  });
});
