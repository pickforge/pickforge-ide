// Data the PR2 live work card renders beyond the lifecycle state PR1 already
// computes (#306): footer lane ticks + cost, the context-edge fraction/color,
// and the task brief. Pure functions, same reasoning as flatChatSort.ts —
// the swarm-run and agent-chat lookups are required parameters (never a
// default reaching into the live stores) so this module carries no runtime
// dependency on swarm.ts/agentChat.ts's own import chains; ProjectsPane.tsx
// passes `swarmRuns`/`agentChat` in directly, and unit tests pin fixtures.
import type { Chat } from "../lib/db";
import type { SwarmLaneSnapshot, SwarmRunSnapshot } from "../lib/mcp";

/** The minimal per-chat agent-chat shape these helpers read — matches
 *  AgentChatState's `contextUsed`/`contextWindow`/`totals` fields without
 *  importing agentChat.ts for its type alone. */
export interface CardAgentChatLike {
  contextUsed: number | null;
  contextWindow: number | null;
  totals: { costUsd: number; estimated: boolean };
}

export type CardEdgeColor = "ember" | "amber";

export interface CardEdge {
  fraction: number;
  color: CardEdgeColor;
}

export interface CardCost {
  amount: number;
  estimated: boolean;
}

export interface CardLanes {
  lanes: readonly SwarmLaneSnapshot[];
  /** Terminal lanes (completed + failed + cancelled), for the "N/total"
   *  footer count — matches swarm.ts's own isTerminalLane rule. */
  doneCount: number;
  total: number;
}

export type LaneTickTone = "run" | "done" | "fail" | null;

const TERMINAL_LANE_STATUSES = new Set<SwarmLaneSnapshot["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

/** The swarm run this chat DISPATCHED (its originChatId), never a run this
 *  chat is merely a worker LANE of — the footer principle names this
 *  explicitly: lane ticks appear only on the chat that dispatched the swarm.
 *  `runsOf()` is expected newest-first (swarmRuns() already is, see swarm.ts's
 *  rememberRun), so the first match is the most recent run for this origin. */
export function cardSwarmRun(
  chatId: string,
  projectRoot: string,
  runsOf: () => readonly SwarmRunSnapshot[],
): SwarmRunSnapshot | null {
  return (
    runsOf().find((run) => run.projectRoot === projectRoot && run.originChatId === chatId) ?? null
  );
}

/** Footer lane data — present only when the run actually has lanes (footer
 *  principle: no placeholder ticks for a run that hasn't dispatched any). */
export function cardLanes(run: SwarmRunSnapshot | null): CardLanes | null {
  if (!run || run.lanes.length === 0) return null;
  const doneCount = run.lanes.filter((lane) => TERMINAL_LANE_STATUSES.has(lane.status)).length;
  return { lanes: run.lanes, doneCount, total: run.lanes.length };
}

/** Which tint (if any) a single lane tick renders — unlit (no tone) for a
 *  lane that hasn't started yet. */
export function laneTickTone(status: SwarmLaneSnapshot["status"]): LaneTickTone {
  if (status === "completed") return "done";
  if (status === "failed") return "fail";
  if (status === "running" || status === "starting") return "run";
  return null;
}

/** Footer cost item — present only when nonzero (footer principle: no
 *  zeros-as-present placeholders). */
export function cardCost(
  chatId: string,
  agentChatOf: (id: string) => CardAgentChatLike | undefined,
): CardCost | null {
  const totals = agentChatOf(chatId)?.totals;
  if (!totals || totals.costUsd <= 0) return null;
  return { amount: totals.costUsd, estimated: totals.estimated };
}

/** Context-edge fill fraction + color: ember while working, amber while
 *  waiting on you — the locked context-edge rule. Fraction mirrors
 *  ContextMeter's own clamp (0 while no window is known yet, e.g. before the
 *  chat's first usage event). Not defined for `justFinished` — the linger
 *  state has no edge (see FlatWorkCard: the card is settling, not working or
 *  waiting, so neither edge color would be honest). */
export function cardContextEdge(
  chatId: string,
  state: "working" | "needsYou",
  agentChatOf: (id: string) => CardAgentChatLike | undefined,
): CardEdge {
  const chat = agentChatOf(chatId);
  const used = chat?.contextUsed ?? 0;
  const contextWindow = chat?.contextWindow ?? 0;
  const fraction = contextWindow > 0 ? Math.min(1, Math.max(0, used / contextWindow)) : 0;
  return { fraction, color: state === "working" ? "ember" : "amber" };
}

/** Task brief line — present only when the chat carries real brief text (no
 *  placeholder copy for a chat that hasn't been given one; taskBriefText has
 *  no writer yet as of #306 PR2, so this is always null today and lights up
 *  once one lands). */
export function cardBrief(chat: Chat): string | null {
  const text = chat.taskBriefText?.trim();
  return text ? text : null;
}
