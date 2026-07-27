// Correlating a `pickforge-lanes` MCP row to the pi-kit run it is about (#362).
//
// The row already carries everything needed — the parser attaches a compact
// summary of the tool input, and `lanes_wait`/`lanes_status` take a `run`
// argument. `lanes_spawn` has no run to name going in; its run id only exists
// in the result, which the same summary carries once the call completes.
//
// Kept as a pure function so the correlation is testable without a store, a
// timer, or a chat.

/** The MCP server whose calls render lane cards. */
export const PIKIT_LANES_SERVER = "pickforge-lanes";

/** pi-kit run ids are `run-<compact timestamp>-<suffix>`; matching that shape
 *  rather than "any token" keeps a stray word in a result from being read as a
 *  run id. */
const RUN_ID = /\brun-[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*\b/;

export interface PiKitRowLike {
  server: string;
  tool: string;
  detail?: string | null;
  status?: "inProgress" | "completed" | "failed";
}

/** The run a `pickforge-lanes` row is about, or null when the row is not one
 *  of ours or has not named a run yet.
 *
 *  A `lanes_spawn` row names no run until its result lands, so an in-flight
 *  spawn correctly resolves to null rather than guessing. */
export function pikitRunRef(row: PiKitRowLike): string | null {
  if (row.server !== PIKIT_LANES_SERVER) return null;
  const detail = row.detail?.trim();
  if (!detail) return null;
  return RUN_ID.exec(detail)?.[0] ?? null;
}

/** Whether this row should poll for live lane state, or render the snapshot it
 *  captured when the call finished.
 *
 *  Live while the call is in flight — that is what makes `lanes_wait` worth
 *  watching. Frozen once it completes, because a replayed row must not quietly
 *  rewrite itself from a run that has since moved on or been pruned. */
export function pikitRowIsLive(row: PiKitRowLike): boolean {
  return pikitRunRef(row) !== null && row.status === "inProgress";
}
