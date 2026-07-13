import { createEffect, createSignal } from "solid-js";
import type { AgentProvider } from "../lib/agentChat";
import {
  agentBackendDescriptor,
  isNativeAgentProvider,
  nativeChatUnavailableReason,
  normalizeAgentProvider,
} from "../lib/agentBackends";
import {
  mcpSwarmStatus,
  mcpTakeSwarmRequests,
  mcpUpdateSwarmRun,
  type SwarmLaneSnapshot,
  type SwarmRequest,
  type SwarmRunSnapshot,
} from "../lib/mcp";
import { loadAgentModels, modelOption, ompNativeChatAvailable } from "../lib/agentModels";
import { swarmWorkerLabels } from "../lib/chatLabels";
import { SWARM_SYNTHESIS_PROMPT_PREFIX } from "../lib/swarmSynthesis";
import { ensureAgentChat, agentChat, sendAgentMessage } from "./agentChat";
import { addChat, ensureChatsLoaded, findChat, workspace } from "./workspace";
import { loadAgentEngine } from "../lib/chatDefaults";
import { modeOverrides } from "../lib/agentModes";

const POLL_MS = 1200;
const MAX_GOAL_CHARS = 8000;

const [runs, setRuns] = createSignal<SwarmRunSnapshot[]>([]);
const dispatching = new Set<string>();
const synthesizing = new Set<string>();
let bridgeStarted = false;
let bridgeDispatchChain: Promise<void> = Promise.resolve();
let localRunCounter = 0;

export const swarmRuns = runs;

function now(): number {
  return Date.now();
}

function clipped(text: string, max = 1400): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function activeRuns(): SwarmRunSnapshot[] {
  return runs();
}

function isRunSnapshot(value: unknown): value is SwarmRunSnapshot {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as SwarmRunSnapshot).runId === "string" &&
    typeof (value as SwarmRunSnapshot).status === "string"
  );
}

function isRunList(value: unknown): value is { runs: SwarmRunSnapshot[] } {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as { runs?: unknown }).runs)
  );
}

function isTerminalOnlyModelRequest(requested: string | null): boolean {
  const text = requested?.trim().toLowerCase() ?? "";
  return text.includes("ollama") || text.includes("glm-5.2") || text.includes(":cloud");
}

function terminalOnlyModelError(requested: string): string {
  return (
    `Requested model "${requested}" is terminal-only. ` +
    "Start it from a Pickforge terminal with the Ollama Cloud launch profile; " +
    "structured swarms only support native Claude Code and Codex chat models."
  );
}

function rememberRun(run: SwarmRunSnapshot) {
  const next = [run, ...activeRuns().filter((item) => item.runId !== run.runId)].slice(0, 24);
  setRuns(next);
  void mcpUpdateSwarmRun(run).catch(() => undefined);
}

function updateRun(runId: string, patch: Partial<SwarmRunSnapshot>) {
  const current = activeRuns().find((run) => run.runId === runId);
  if (!current) return;
  rememberRun({ ...current, ...patch, updatedAt: now() });
}

function updateLane(runId: string, laneId: string, patch: Partial<SwarmLaneSnapshot>) {
  const run = activeRuns().find((item) => item.runId === runId);
  if (!run) return;
  const lanes = run.lanes.map((lane) =>
    lane.id === laneId ? { ...lane, ...patch, updatedAt: now() } : lane,
  );
  rememberRun({ ...run, lanes, status: aggregateStatus(lanes), updatedAt: now() });
}

function aggregateStatus(lanes: SwarmLaneSnapshot[]): SwarmRunSnapshot["status"] {
  if (!lanes.length) return "queued";
  if (lanes.every((lane) => lane.status === "cancelled")) return "cancelled";
  if (lanes.every((lane) => lane.status === "completed")) return "completed";
  if (lanes.every((lane) => lane.status === "completed" || lane.status === "failed")) {
    return lanes.some((lane) => lane.status === "failed") ? "failed" : "completed";
  }
  if (lanes.some((lane) => lane.status === "running" || lane.status === "starting")) {
    return "running";
  }
  return "queued";
}

const SCOUT_FOCI = [
  ["Code map", "Find relevant files, modules, and ownership boundaries."],
  ["Implementation path", "Trace the likely change path and existing patterns."],
  ["Risk pass", "Look for behavioral, security, and integration risks."],
  ["Test plan", "Identify the narrowest useful validation and missing coverage."],
  ["UX/API pass", "Check product, API, and workflow clarity."],
];

const REVIEW_FOCI = [
  ["Correctness", "Check logic, contracts, edge cases, and regressions."],
  ["Safety", "Check permissions, data boundaries, concurrency, and failure paths."],
  ["Tests", "Check coverage, fixtures, and validation blind spots."],
  ["UX/API", "Check user-facing behavior, wording, and affordances."],
  ["Integration", "Check cross-module wiring, defaults, and rollout risk."],
];

function laneFocus(mode: SwarmRequest["mode"], index: number): [string, string] {
  const list = mode === "review" ? REVIEW_FOCI : SCOUT_FOCI;
  return list[index % list.length] as [string, string];
}

function providerForRequestedModel(requested: string | null): AgentProvider | null {
  const text = requested?.trim().toLowerCase() ?? "";
  if (!text || isTerminalOnlyModelRequest(requested)) return null;
  const claudeOption = modelOption("claudeCode", requested);
  if (claudeOption && !claudeOption.terminalOnly) return "claudeCode";
  const codexOption = modelOption("codex", requested);
  if (codexOption && !codexOption.terminalOnly) return "codex";
  if (
    (text.includes("opus") && text.includes("4.8")) ||
    (text.includes("sonnet") && text.includes("5")) ||
    text.includes("haiku")
  ) {
    return "claudeCode";
  }
  if (
    text.includes("gpt-5.5") ||
    text.includes("gpt-5.4") ||
    text.includes("spark")
  ) {
    return "codex";
  }
  return null;
}

const MODEL_ALIASES: Readonly<
  Record<AgentProvider, readonly Readonly<{ terms: readonly string[]; model: string }>[]>
> = Object.freeze({
  claudeCode: Object.freeze([
    { terms: ["opus", "4.8"], model: "claude-opus-4-8" },
    { terms: ["sonnet", "5"], model: "claude-sonnet-5" },
    { terms: ["haiku"], model: "claude-haiku-4-5" },
  ]),
  codex: Object.freeze([
    { terms: ["gpt-5.5"], model: "gpt-5.5" },
    { terms: ["gpt-5.4-mini"], model: "gpt-5.4-mini" },
    { terms: ["gpt-5.4"], model: "gpt-5.4" },
    { terms: ["spark"], model: "gpt-5.3-codex-spark" },
  ]),
  omp: Object.freeze([]),
});

const READ_ONLY_MODE: Readonly<Record<AgentProvider, string>> = Object.freeze({
  claudeCode: "plan",
  codex: "read-only",
  omp: "plan",
});

function providersFor(
  pref: SwarmRequest["providerPreference"],
  count: number,
  requestedModel: string | null,
): AgentProvider[] {
  if (isNativeAgentProvider(pref)) {
    return Array.from({ length: count }, () => pref);
  }
  const modelProvider = providerForRequestedModel(requestedModel);
  if (modelProvider) return Array.from({ length: count }, () => modelProvider);
  return Array.from({ length: count }, (_, index) =>
    index % 2 === 0 ? "claudeCode" : "codex",
  );
}

type ModelResolution =
  | { ok: true; model: string | null }
  | { ok: false; error: string };

function resolveModel(provider: AgentProvider, requested: string | null): ModelResolution {
  const text = requested?.trim().toLowerCase() ?? "";
  if (!text) {
    const selected = loadAgentModels()[provider] ?? null;
    const selectedOption = modelOption(provider, selected);
    return { ok: true, model: selectedOption?.terminalOnly ? null : selected };
  }
  if (isTerminalOnlyModelRequest(requested)) {
    return { ok: false, error: terminalOnlyModelError(requested!.trim()) };
  }
  const native = modelOption(provider, requested);
  if (native && !native.terminalOnly) return { ok: true, model: native.id };
  const alias = MODEL_ALIASES[provider].find((candidate) =>
    candidate.terms.every((term) => text.includes(term))
  );
  if (alias) return { ok: true, model: alias.model };
  const model = requested?.trim() ?? "";
  return {
    ok: false,
    error: `Requested model "${model}" is not available for ${providerLabel(provider)} swarm lanes.`,
  };
}

function readOnlyOptions(provider: AgentProvider) {
  const mode = READ_ONLY_MODE[provider];
  return {
    engine: loadAgentEngine(),
    mode,
    ...modeOverrides(provider, mode),
  };
}

function providerLabel(provider: string): string {
  return agentBackendDescriptor(provider)?.label ?? provider;
}

function workerPrompt(
  req: SwarmRequest,
  index: number,
  total: number,
  provider: AgentProvider,
  focus: [string, string],
): string {
  const mode = req.mode === "review" ? "review" : "scout";
  const requestedModel = req.model ? `\nRequested model: ${req.model}` : "";
  return [
    `You are Pickforge swarm worker ${index} of ${total}.`,
    `Mode: read-only ${mode}.`,
    `Lane focus: ${focus[0]} - ${focus[1]}`,
    "Do not edit files, stage, commit, push, open PRs, or dispatch more sub-agents.",
    "Do not use provider-native subagents for this same request; Pickforge is the orchestrator.",
    `Provider lane: ${providerLabel(provider)}.${requestedModel}`,
    "",
    "Goal:",
    req.goal.trim().slice(0, MAX_GOAL_CHARS),
    "",
    "Return concise findings with file paths, evidence, risks, and one concrete next action.",
  ].join("\n");
}

function lastAssistantText(chatId: string): string | null {
  const timeline = agentChat(chatId)?.timeline ?? [];
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const item = timeline[i];
    if (item.type === "assistantText" && item.text.trim()) return clipped(item.text);
  }
  return null;
}

function runFromRequest(req: SwarmRequest): SwarmRunSnapshot {
  return {
    runId: req.runId,
    projectRoot: req.projectRoot,
    goal: req.goal,
    requestedCount: req.count,
    model: req.model,
    providerPreference: req.providerPreference,
    mode: req.mode,
    source: req.source,
    originChatId: req.originChatId ?? null,
    status: "queued",
    synthesisStatus: "idle",
    synthesisError: null,
    synthesizedAt: null,
    lanes: [],
    error: null,
    createdAt: req.createdAt,
    updatedAt: now(),
  };
}

async function currentRunSnapshot(req: SwarmRequest): Promise<SwarmRunSnapshot | null> {
  try {
    const status = await mcpSwarmStatus(req.projectRoot, req.runId);
    return isRunSnapshot(status) ? status : null;
  } catch {
    return null;
  }
}

async function dispatchSwarm(req: SwarmRequest) {
  const existing = activeRuns().find((run) => run.runId === req.runId);
  if (dispatching.has(req.runId) || (existing && existing.status !== "queued")) return;
  dispatching.add(req.runId);
  try {
    const latest = await currentRunSnapshot(req);
    if (latest?.status === "cancelled") {
      rememberRun(latest);
      return;
    }
    rememberRun({ ...runFromRequest(req), status: "starting" });
    await ensureChatsLoaded(req.projectRoot);

    if (req.model && isTerminalOnlyModelRequest(req.model)) {
      throw new Error(terminalOnlyModelError(req.model));
    }
    const providers = providersFor(req.providerPreference, req.count, req.model);
    const resolvedModels = providers.map((provider) => resolveModel(provider, req.model));
    const failedModel = resolvedModels.find((resolution) => !resolution.ok);
    if (failedModel && !failedModel.ok) throw new Error(failedModel.error);
    const lanes = providers.map<SwarmLaneSnapshot>((provider, index) => ({
      id: `${req.runId}-lane-${index + 1}`,
      chatId: null,
      provider,
      model: resolvedModels[index].ok ? resolvedModels[index].model : null,
      title: `${laneFocus(req.mode, index)[0]} - ${providerLabel(provider)}`,
      status: "queued",
      summary: null,
      error: null,
      updatedAt: now(),
    }));
    rememberRun({ ...runFromRequest(req), status: "starting", lanes });

    for (let i = 0; i < lanes.length; i += 1) {
      const lane = lanes[i];
      const focus = laneFocus(req.mode, i);
      updateLane(req.runId, lane.id, { status: "starting" });
      const chatId = await addChat(lane.title, lane.provider, req.projectRoot, "agent", {
        activate: false,
        labelsJson: swarmWorkerLabels({
          swarmRunId: req.runId,
          swarmLaneId: lane.id,
          originChatId: req.originChatId ?? null,
        }),
      });
      if (!chatId) throw new Error("Could not create swarm chat");
      updateLane(req.runId, lane.id, { chatId });
      await ensureAgentChat(
        chatId,
        req.projectRoot,
        lane.provider as AgentProvider,
        lane.model,
        { ...readOnlyOptions(lane.provider as AgentProvider) },
      );
      await sendAgentMessage(
        chatId,
        workerPrompt(req, i + 1, lanes.length, lane.provider as AgentProvider, focus),
      );
      updateLane(req.runId, lane.id, { status: "running" });
    }
    updateRun(req.runId, { status: "running" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateRun(req.runId, { status: "failed", error: message });
  } finally {
    dispatching.delete(req.runId);
  }
}

function queueBridgeDispatch(request: SwarmRequest) {
  bridgeDispatchChain = bridgeDispatchChain
    .then(() => dispatchSwarm(request))
    .catch(() => undefined);
}

async function hydrateProjectRuns(projectRoot: string) {
  try {
    const status = await mcpSwarmStatus(projectRoot, null);
    if (!isRunList(status)) return;
    for (const run of status.runs) {
      if (isRunSnapshot(run) && run.status !== "queued") rememberRun(run);
    }
  } catch {
    return;
  }
}

export async function startSwarm(
  projectRoot: string,
  goal: string,
  opts: Partial<
    Pick<SwarmRequest, "count" | "model" | "providerPreference" | "mode" | "originChatId">
  > = {},
): Promise<string> {
  const createdAt = now();
  localRunCounter += 1;
  const runId = `swarm-local-${createdAt}-${localRunCounter}`;
  await dispatchSwarm({
    runId,
    projectRoot,
    goal,
    count: Math.min(5, Math.max(1, opts.count ?? 3)),
    model: opts.model ?? null,
    providerPreference: opts.providerPreference ?? "mixed",
    mode: opts.mode ?? "scout",
    source: "pickforge",
    originChatId: opts.originChatId ?? null,
    createdAt,
  });
  return runId;
}

async function pollSwarmRequests() {
  let requests: SwarmRequest[] = [];
  try {
    requests = await mcpTakeSwarmRequests();
  } catch {
    return;
  }
  for (const request of requests) queueBridgeDispatch(request);
}

function isTerminalLane(lane: SwarmLaneSnapshot): boolean {
  return lane.status === "completed" || lane.status === "failed" || lane.status === "cancelled";
}

function shouldSynthesize(run: SwarmRunSnapshot): boolean {
  return (
    !!run.originChatId &&
    run.lanes.length > 0 &&
    run.status !== "cancelled" &&
    run.lanes.every(isTerminalLane) &&
    run.synthesisStatus !== "sent" &&
    run.synthesisStatus !== "failed"
  );
}

function synthesisPrompt(run: SwarmRunSnapshot): string {
  const lanes = run.lanes.map((lane, index) => {
    const result = lane.summary ?? lane.error ?? "No result captured.";
    return [
      `${index + 1}. ${lane.title}`,
      `   Status: ${lane.status}`,
      `   Provider/model: ${providerLabel(lane.provider)} / ${lane.model ?? "default"}`,
      `   Result: ${clipped(result, 2200)}`,
    ].join("\n");
  });
  return [
    SWARM_SYNTHESIS_PROMPT_PREFIX,
    "",
    "Original request:",
    run.goal,
    "",
    "Worker lane results:",
    ...lanes,
    "",
    "Synthesize these worker results into the answer I need now.",
    "Use the evidence and file paths from the lanes, call out disagreement or uncertainty, and give the concrete next action.",
    "Do not start another swarm or use provider-native subagents for this synthesis.",
  ].join("\n");
}

export async function dispatchSynthesis(run: SwarmRunSnapshot) {
  if (!shouldSynthesize(run) || synthesizing.has(run.runId)) return;
  const originChatId = run.originChatId;
  if (!originChatId) return;
  const origin = findChat(originChatId);
  if (!origin || origin.kind !== "agent") {
    updateRun(run.runId, {
      synthesisStatus: "failed",
      synthesisError: "Origin chat is not an active structured agent chat.",
    });
    return;
  }
  const provider = normalizeAgentProvider(origin.agentId);
  if (!provider) {
    updateRun(run.runId, {
      synthesisStatus: "failed",
      synthesisError:
        nativeChatUnavailableReason(origin.agentId) ?? "Origin backend cannot run native chat.",
    });
    return;
  }
  if (provider === "omp" && !ompNativeChatAvailable()) {
    updateRun(run.runId, {
      synthesisStatus: "failed",
      synthesisError: "OMP native chat requires the ompPiAgents flag and compatible OMP 16.4.8 probe.",
    });
    return;
  }
  const current = agentChat(originChatId);
  if (current?.turnActive) {
    if (run.synthesisStatus !== "pending") {
      updateRun(run.runId, { synthesisStatus: "pending", synthesisError: null });
    }
    return;
  }
  synthesizing.add(run.runId);
  try {
    if (run.synthesisStatus !== "pending") {
      updateRun(run.runId, { synthesisStatus: "pending", synthesisError: null });
    }
    if (!agentChat(originChatId)) {
      await ensureAgentChat(originChatId, origin.projectRoot, provider, null, {
        engine: loadAgentEngine(),
      });
    }
    if (agentChat(originChatId)?.turnActive) return;
    await sendAgentMessage(originChatId, synthesisPrompt(run), [], { hidden: true });
    updateRun(run.runId, {
      synthesisStatus: "sent",
      synthesisError: null,
      synthesizedAt: now(),
    });
  } catch (error) {
    updateRun(run.runId, {
      synthesisStatus: "failed",
      synthesisError: error instanceof Error ? error.message : String(error),
    });
  } finally {
    synthesizing.delete(run.runId);
  }
}

function trackCompletions() {
  createEffect(() => {
    for (const run of runs()) {
      if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
        void dispatchSynthesis(run);
        continue;
      }
      for (const lane of run.lanes) {
        if (!lane.chatId || lane.status === "completed" || lane.status === "failed") continue;
        const chat = agentChat(lane.chatId);
        if (!chat) continue;
        if (chat.error) {
          updateLane(run.runId, lane.id, { status: "failed", error: chat.error });
          continue;
        }
        const summary = lastAssistantText(lane.chatId);
        if (summary && !chat.turnActive && lane.status === "running") {
          updateLane(run.runId, lane.id, { status: "completed", summary });
        }
      }
      void dispatchSynthesis(run);
    }
  });
}

export function startSwarmBridge() {
  if (bridgeStarted) return;
  bridgeStarted = true;
  trackCompletions();
  createEffect(() => {
    const root = workspace.activeRoot;
    if (root) void hydrateProjectRuns(root);
  });
  void pollSwarmRequests();
  window.setInterval(() => void pollSwarmRequests(), POLL_MS);
}
