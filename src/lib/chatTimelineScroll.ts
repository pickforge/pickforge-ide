export const CHAT_BOTTOM_PROXIMITY_PX = 96;

const SCROLL_DELTA_EPSILON_PX = 1;
const PROGRAMMATIC_SCROLL_TOLERANCE_PX = 2;

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
  if (top < lastTop - SCROLL_DELTA_EPSILON_PX) {
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
