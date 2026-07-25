// "Review changes" action for a completed-turn chat receipt (#231 PR3).
// Kept as one small, independently testable function rather than inlined in
// the card/timeline component, so the store-wiring behavior (which scope
// gets selected, which pane gets focused, in what order) has a single seam
// both a component test and a future PR4 retarget can each reason about
// without touching SolidJS render code.
import { openChangesReviewForTurn } from "../stores/changes";
import { focusChangesReviewSurface } from "../stores/workbenchLayout";
import { navigate } from "../router";
import type { ChangeSet } from "./changes";

/** Selects `changeSet` as the active `thisTurn` review target and focuses
 *  today's Source Control pane. `changeSet.turnSeq` is null only for
 *  workingTree-scope sets, which a chat receipt (always turn-scoped) never
 *  produces — a null turnSeq here is defensive, not an expected path. */
export function reviewTurnChanges(chatId: string, projectRoot: string, changeSet: ChangeSet): void {
  if (changeSet.turnSeq === null) return;
  openChangesReviewForTurn(chatId, projectRoot, changeSet.turnSeq);
  navigate("workbench");
  focusChangesReviewSurface();
}
