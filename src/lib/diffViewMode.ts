// Split-vs-unified view gating (#231 PR5): unified is the default and the
// only option at narrow widths — a two-column split is unreadable squeezed
// into a narrow dock pane, so a narrow pane FORCES unified regardless of the
// user's own preference (persisted in `stores/workbenchPrefs.ts`). Kept as a
// pure function, independent of any DOM/ResizeObserver wiring, so the width
// gating itself is unit-testable without a browser environment — the actual
// live width comes from a `ResizeObserver` in `ChangesReviewSurface.tsx`,
// verified for real in `tests/vrt/changes-review-surface.spec.ts` instead.

export type DiffViewMode = "unified" | "split";

/** Minimum pane width (px) at which a side-by-side split reads better than a
 *  single unified column: each column needs room for a 3ch gutter plus a
 *  readable slice of code, and going narrower squeezes both columns into an
 *  unreadable horizontal scroll. Deliberately inside the dock's own real
 *  range (`stores/workbenchLayout.ts`'s `MIN_W`/`MAX_W`, 180–600px — the
 *  Changes reviewer lives in a DOCKED pane, never a full-width view, so a
 *  threshold above `MAX_W` would make split view literally unreachable) —
 *  near the top of that range, so split is available once a reader widens
 *  the dock toward its max, not at the 320px default. Still a judgment
 *  call, not a measured breakpoint from user data. */
export const SPLIT_VIEW_MIN_WIDTH = 480;

/** Resolves the view mode that should actually render: `preferred` at or
 *  above the split-view width threshold, `"unified"` below it regardless of
 *  what the user asked for (the issue's "narrow panes force unified" rule).
 *  `width <= 0` (not yet measured, or measured in an environment with no
 *  real layout — e.g. a unit test's jsdom mount) degrades to `"unified"`,
 *  never guesses `"split"` from an unknown width. */
export function resolveDiffViewMode(width: number, preferred: DiffViewMode): DiffViewMode {
  if (width < SPLIT_VIEW_MIN_WIDTH) return "unified";
  return preferred;
}
