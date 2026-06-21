// Persistence side-effects for the audit log (RunHistory). Every call here is
// fire-and-forget: a DB write must NEVER throw into the run lifecycle or the
// forge dispatch, so failures are swallowed (logged once) instead of propagated.
import * as db from "./db";

/** A stable, collision-resistant run session id. crypto.randomUUID is available
 *  in the webview and under Vitest's runtime; a timestamp+random fallback keeps
 *  it working anywhere it isn't. */
export function newSessionId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `run-${c.randomUUID()}`;
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function swallow(label: string, e: unknown) {
  console.warn(`[runRecord] ${label} failed (ignored):`, e);
}

/** Record a launched run. Resolves whether or not the write succeeded. */
export async function recordRunStart(run: db.RunSessionLog): Promise<void> {
  try {
    await db.runInsert(run);
  } catch (e) {
    swallow("runInsert", e);
  }
}

/** Record a run's end. No-op-safe if the start row never persisted. */
export async function recordRunFinish(
  sessionId: string,
  endedAt: number,
  exitReason: string | null,
  exitCode: number | null,
): Promise<void> {
  try {
    await db.runFinish(sessionId, endedAt, exitReason, exitCode);
  } catch (e) {
    swallow("runFinish", e);
  }
}

/** Record a forge dispatch as a pick + the agent run keyed to it. Returns
 *  silently on any failure so the dispatch the user triggered still goes out. */
export async function recordForgeDispatch(
  pick: db.PickHistory,
  command: string,
): Promise<void> {
  try {
    const now = Date.now();
    const pickId = await db.pickInsert(pick);
    await db.agentRunInsert({
      id: 0,
      pickId,
      startedAt: now,
      finishedAt: null,
      exitCode: null,
      hotReloadCount: 0,
      wrapperScriptPath: command,
    });
  } catch (e) {
    swallow("recordForgeDispatch", e);
  }
}
