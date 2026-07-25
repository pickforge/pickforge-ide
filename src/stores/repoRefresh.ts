// Cross-cutting "something happened that should refresh a Git status view"
// trigger (#333), for callers that aren't the `changesReview` flag's own
// per-target store (`stores/changes.ts`). The legacy Source Control pane
// (`SourceControl.tsx`'s `createRepoScanner`) scans by PROJECT ROOT, not by
// chat/turn — unlike `stores/changes.ts`'s "this turn" scope, there is no
// per-chat target to match against, so this generalizes that store's
// notify-only-if-targeting pattern to project-root granularity: any turn
// completing in chat belonging to the active project is a reason to
// re-scan that project's working tree, regardless of the `changesReview`
// flag (this trigger is NOT flag-gated — the legacy panel is the default UI
// with the flag off).
import { createSignal } from "solid-js";

const [epoch, setEpoch] = createSignal(0);
let lastProjectRoot: string | null = null;

/** Call when a chat turn completes, with the PROJECT ROOT that chat belongs
 *  to (not the chat id — this trigger has no per-chat target to match). */
export function notifyProjectTurnCompleted(projectRoot: string): void {
  lastProjectRoot = projectRoot;
  setEpoch((n) => n + 1);
}

/** Bumped on every `notifyProjectTurnCompleted` call — a reactive dependency
 *  for callers that want to re-check `lastTurnCompletedProjectRoot` whenever
 *  a turn completes anywhere. */
export const turnCompletedEpoch = epoch;

/** The project root passed to the most recent `notifyProjectTurnCompleted`
 *  call — read this AFTER depending on `turnCompletedEpoch` to check whether
 *  the just-completed turn belongs to the project a caller cares about. */
export function lastTurnCompletedProjectRoot(): string | null {
  return lastProjectRoot;
}
