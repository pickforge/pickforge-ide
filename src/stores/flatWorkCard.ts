// Data the live work card renders beyond the lifecycle state PR1 already
// computes (#306): footer lane ticks + cost + branch + plan M/N, the
// context-edge fraction/color, and the task brief. Pure functions, same
// reasoning as flatChatSort.ts — the swarm-run, agent-chat, branch-cache and
// plan lookups are required parameters (never a default reaching into the
// live stores) so this module carries no runtime dependency on
// swarm.ts/agentChat.ts/projectBranch.ts's own import chains; ProjectsPane.tsx
// passes `swarmRuns`/`agentChat`/`projectBranchOf`/`latestPlanForChat` in
// directly, and unit tests pin fixtures.
import type { PlanItemStatus } from "../lib/agentChat";
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

/** How long a brief may be before it is cut. The line is single-line-ellipsis
 *  in CSS anyway, so anything past this is invisible — capping here keeps a
 *  persisted value from being longer than anything that can ever be read. */
const BRIEF_MAX_CHARS = 120;

/** Task brief line — the active plan step, falling back to a model-written
 *  one-liner, then to nothing (decided on #361, 2026-07-25).
 *
 *  The plan step wins on purpose: the card says *step 2 of 5* in its footer and
 *  *what step 2 is* on this line, both read from `latestPlanForChat`, so the
 *  two can never disagree. `taskBriefText` is the fallback slot — it has no
 *  writer outside fixtures today and lights up when #210's producer lands.
 *
 *  No placeholder when there is nothing to say, per the locked footer rule. */
export function cardBrief(
  chat: Chat,
  latestPlanOf?: (id: string) => CardPlanLike | null,
): string | null {
  const step = activePlanStep(chat, latestPlanOf);
  if (step) return step;
  const text = chat.taskBriefText?.trim();
  return text ? clipBrief(text) : null;
}

function activePlanStep(
  chat: Chat,
  latestPlanOf?: (id: string) => CardPlanLike | null,
): string | null {
  if (!latestPlanOf) return null;
  const plan = latestPlanOf(chat.chatId);
  if (!plan) return null;
  // An all-complete plan has no `inProgress` item, so it falls through to the
  // one-liner and then to nothing rather than showing a stale final step.
  const active = plan.items.find((item) => item.status === "inProgress");
  const text = active?.text?.trim();
  return text ? clipBrief(text) : null;
}

function clipBrief(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > BRIEF_MAX_CHARS ? `${flat.slice(0, BRIEF_MAX_CHARS - 1)}…` : flat;
}

/** Footer branch item (#306 PR3) — present only when the chat's project root
 *  resolves to a real git branch (footer principle: no slot for a project
 *  that isn't a git repo, or whose branch hasn't resolved yet). `branchOf`
 *  reads `stores/projectBranch.ts`'s cache rather than spawning git directly
 *  — same DI shape as the other card helpers, keyed by projectRoot (not
 *  chatId) since every chat sharing a project shares its branch. */
export function cardBranch(
  projectRoot: string,
  branchOf: (root: string) => string | null | undefined,
): string | null {
  return branchOf(projectRoot) ?? null;
}

/** The minimal plan shape these helpers read — matches
 *  `Extract<AgentTimelineItem, { type: "plan" }>`'s `items` field without
 *  importing agentChat.ts's own timeline type for it alone (same reasoning
 *  as `CardAgentChatLike` above). */
export interface CardPlanLike {
  items: readonly { status: PlanItemStatus; text?: string }[];
}

export interface CardPlanProgress {
  completed: number;
  total: number;
}

/** Footer plan-progress item (#306 PR3) — present only when the chat has an
 *  active plan with steps (footer principle: no M/N for a chat that never
 *  got one). "Active" means "has plan items", not "has incomplete items": an
 *  all-complete plan (M === N) still renders its final tally, same as a
 *  zero-complete one just getting started — the mockup shows a finished
 *  plan's tally (`3/3`) the same way as an in-progress one. Derived from the
 *  chat's EXISTING plan-step status (`latestPlanForChat`/the timeline's
 *  `plan` item), never a new plan store. */
export function cardPlanProgress(
  chatId: string,
  latestPlanOf: (id: string) => CardPlanLike | null,
): CardPlanProgress | null {
  const plan = latestPlanOf(chatId);
  if (!plan || plan.items.length === 0) return null;
  const completed = plan.items.filter((item) => item.status === "completed").length;
  return { completed, total: plan.items.length };
}
