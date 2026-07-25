// Operator preview polish (#195): "what runs where" and "roughly what a fanout will
// cost" for the existing dock preview card. Kept out of previewPayload.ts on purpose —
// that module is a pure function of `intent` alone (asserted with plain object literals
// in tests, no store/localStorage reads); this module reads the persisted per-provider
// model selection, so it's a separate, explicitly impure seam.
import type { OperatorIntent } from "./operatorIntent";
import { loadAgentModels, modelOption, nativeChatModel } from "./agentModels";
import { agentBackendDescriptor, type AgentProvider } from "./agentBackends";
import { providersFor, resolveModel } from "../stores/swarm";
import { estimateCostUsd } from "./agentPricing";

interface RunTarget {
  provider: AgentProvider;
  model: string | null;
}

function providerLabel(provider: AgentProvider): string {
  return agentBackendDescriptor(provider)?.label ?? provider;
}

// Falls back to the raw model id when it isn't in the curated/discovered catalog
// (e.g. a stale or foreign id) — still honest and informative, never a fabricated name.
function modelLabel(provider: AgentProvider, model: string | null): string | null {
  if (!model) return null;
  return modelOption(provider, model)?.label ?? model;
}

function targetLabel(target: RunTarget): string {
  const model = modelLabel(target.provider, target.model);
  return model ? `${providerLabel(target.provider)} · ${model}` : providerLabel(target.provider);
}

function dedupeTargets(targets: RunTarget[]): RunTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.provider}:${target.model ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function agentProviderFromActionProvider(provider: "claude" | "codex"): AgentProvider {
  return provider === "claude" ? "claudeCode" : provider;
}

function swarmProviderPreference(
  provider: "claude" | "codex" | "mixed",
): "claudeCode" | "codex" | "mixed" {
  return provider === "claude" ? "claudeCode" : provider;
}

/** The provider assigned to each swarm lane plus the model each one will actually run,
 * mirroring `dispatchSwarm`'s own resolution (`providersFor` + `resolveModel`, both
 * reused verbatim, not re-derived) so this can never drift from what confirming the
 * proposal actually launches. */
export function swarmWorkerTargets(
  provider: "claude" | "codex" | "mixed",
  count: number,
): RunTarget[] {
  const pref = swarmProviderPreference(provider);
  const models = loadAgentModels();
  return providersFor(pref, count, null).map((workerProvider) => {
    const resolved = resolveModel(workerProvider, null);
    const model = resolved.ok ? resolved.model : (models[workerProvider] ?? null);
    return { provider: workerProvider, model };
  });
}

/** "What runs where" for a preview whose action names an execution target. Returns
 * null for actions with no provider/model concept (most Operator actions are local
 * device commands, not agent dispatch — showing nothing for those is correct, not a
 * gap). */
export function runTargetLabel(intent: OperatorIntent): string | null {
  const action = intent.action;
  if (action.action === "createChat") {
    const provider = agentProviderFromActionProvider(action.provider);
    const model = action.model
      ? action.model
      : nativeChatModel(provider, loadAgentModels()[provider] ?? null);
    return targetLabel({ provider, model });
  }
  if (action.action === "startSwarm") {
    const targets = dedupeTargets(swarmWorkerTargets(action.provider, action.count));
    return targets.map(targetLabel).join(" + ");
  }
  return null;
}

// A rough per-lane token footprint for one swarm worker's first turn (goal + project
// context in, a scout/review summary out) — a directional average, not a per-run
// measurement. It exists only to give the preview a ballpark cost before any tokens are
// actually spent; estimateCostUsd() already carries the "~" / honest-unknown contract
// (see agentPricing.ts and ContextMeter's estimated-cost display), this just supplies
// its usage input for a not-yet-started run.
const SWARM_WORKER_TURN_ESTIMATE = {
  inputTokens: 6_000,
  cachedInputTokens: 0,
  outputTokens: 1_200,
};

export interface FanoutCostEstimate {
  count: number;
  /** null when any assigned lane's model isn't in the pricing table — honest-unknown,
   * never a partial or fabricated total. */
  costUsd: number | null;
}

/** A fanout cost estimate for a startSwarm proposal's inferred worker count, distinct
 * from (and never combined with) the hosted routing charge. */
export function swarmFanoutEstimate(intent: OperatorIntent): FanoutCostEstimate | null {
  if (intent.action.action !== "startSwarm") return null;
  const { provider, count } = intent.action;
  const targets = swarmWorkerTargets(provider, count);
  let total = 0;
  for (const target of targets) {
    const cost = estimateCostUsd(target.model, SWARM_WORKER_TURN_ESTIMATE);
    if (cost === null) return { count, costUsd: null };
    total += cost;
  }
  return { count, costUsd: total };
}
