export const CHAT_BOTTOM_PROXIMITY_PX = 96;

const SCROLL_DELTA_EPSILON_PX = 1;
const PROGRAMMATIC_SCROLL_TOLERANCE_PX = 2;
// A clamp lands *exactly* on the bottom edge, so this allows only the slack
// between an integer `scrollHeight`/`clientHeight` and a fractional `scrollTop`.
// It must stay below the smallest upward gesture we still honor — a sub-2px
// nudge near a pin target detaches (see the interleaved-scroll case).
const BOTTOM_EDGE_TOLERANCE_PX = 1;

/** True when this event's upward movement needs live scroller geometry to be
 *  judged (see `decideTimelineScroll`'s clamp rule). The caller reads
 *  `scrollHeight`/`clientHeight` only when this says so: while following the
 *  tail, the common case is a downward event, and a layout read on every one of
 *  those is the kind of per-frame forced reflow WebKitGTK pays for. */
export function timelineScrollNeedsGeometry(top: number, lastTop: number): boolean {
  return top < lastTop - SCROLL_DELTA_EPSILON_PX;
}

export type TimelineScrollDecision = {
  stick: boolean;
  programmatic: boolean;
};

export function decideTimelineScroll({
  stick,
  top,
  lastTop,
  programmaticTarget,
  scrollHeight,
  viewportHeight,
}: {
  stick: boolean;
  top: number;
  lastTop: number;
  programmaticTarget: number | null;
  scrollHeight: number;
  viewportHeight: number;
}): TimelineScrollDecision {
  // Upward movement wins over target proximity: a real user scroll can land
  // inside the tolerance while a programmatic scroll event is still pending.
  if (timelineScrollNeedsGeometry(top, lastTop)) {
    // …except when it lands *on* the bottom edge. Then it is the browser
    // clamping scrollTop into a range that just shrank — the working row
    // leaving at end of turn, or a row settling to a smaller measured height —
    // not a gesture. A real scroll-up always ends strictly above the edge.
    // Misreading the clamp detached the follow exactly as the turn closed, so
    // the usage row (tokens, cost) that lands right after was never pinned
    // (#352). Report it as programmatic: it is our own layout settling, and it
    // must not mark the user as scrolling.
    if (scrollHeight - top - viewportHeight <= BOTTOM_EDGE_TOLERANCE_PX) {
      return { stick, programmatic: true };
    }
    return { stick: false, programmatic: false };
  }
  if (
    programmaticTarget !== null &&
    Math.abs(top - programmaticTarget) < PROGRAMMATIC_SCROLL_TOLERANCE_PX
  ) {
    return { stick, programmatic: true };
  }
  if (scrollHeight - top - viewportHeight < CHAT_BOTTOM_PROXIMITY_PX) {
    return { stick: true, programmatic: false };
  }
  return { stick, programmatic: false };
}
