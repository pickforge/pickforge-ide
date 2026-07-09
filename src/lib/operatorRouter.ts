import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import {
  operatorActionNames,
  operatorActionSchema,
  parseOperatorIntent,
  type OperatorIntent,
} from "./operatorIntent";
import {
  configuredRouterBackend,
  operatorRouterSettings,
  persistOperatorRouterLatency,
  type OperatorRouterBackend,
} from "../stores/operatorRouterSettings";

export const routerProposalSchema = z.union([
  z.strictObject({
    action: operatorActionSchema,
    confidence: z.number().min(0).max(1),
    projectRef: z.string().nullable().optional(),
  }),
  z.strictObject({
    unclear: z.literal(true),
    reason: z.string().optional(),
  }),
]);

export type RouterProposal = z.infer<typeof routerProposalSchema>;

export type RouteResult =
  | { kind: "proposal"; intent: OperatorIntent; confidence: number; latencyMs: number }
  | { kind: "unclear"; reason: string }
  | { kind: "error"; message: string }
  | { kind: "unconfigured" };

interface RawRouteOutput {
  output: string;
  latencyMs: number;
  exitOk: boolean;
  stderrTail: string;
}

const ROUTER_TIMEOUT_MS = 30_000;

const ACTION_CATALOG = [
  "Return one JSON object for one PickForge developer command.",
  "Use only these v2 action payloads:",
  "- openProject: {\"action\":\"openProject\"}; put the natural project name in projectRef.",
  "- openChat: {\"action\":\"openChat\",\"chat\":string|null}; optional projectRef may disambiguate.",
  "- createChat: {\"action\":\"createChat\",\"provider\":\"claude\"|\"codex\",\"model\":string|null}.",
  "- sendPrompt: {\"action\":\"sendPrompt\",\"prompt\":string,\"chat\":string|null}; never invent project paths.",
  "- startSwarm: {\"action\":\"startSwarm\",\"mode\":\"scout\"|\"review\",\"count\":1-5,\"goal\":string,\"provider\":\"claude\"|\"codex\"|\"mixed\"}.",
  "- swarmStatus: {\"action\":\"swarmStatus\"}.",
  "- interruptRun: {\"action\":\"interruptRun\",\"run\":string|null}.",
  "- steerRun: {\"action\":\"steerRun\",\"run\":string|null,\"instruction\":string}.",
  "- launchEmulator: {\"action\":\"launchEmulator\",\"device\":string|null}.",
  "- launchRun: {\"action\":\"launchRun\",\"target\":string|null}.",
  "- reloadRun: {\"action\":\"reloadRun\"}.",
  "- stopRun: {\"action\":\"stopRun\"}.",
  "- hotRestart: {\"action\":\"hotRestart\"}.",
  "- enterSelectMode: {\"action\":\"enterSelectMode\"}.",
  "- takeScreenshot: {\"action\":\"takeScreenshot\"}.",
  "- selectWidget: {\"action\":\"selectWidget\",\"description\":string}.",
  "The router only proposes; local code handles ids, provenance, approval, cost, audit, and execution.",
  "Confidence is 0..1 and advisory. Use projectRef only as an opaque natural-language hint.",
  "If the command cannot map safely to one action, return {\"unclear\":true,\"reason\":\"short reason\"}.",
  "Output only JSON, no markdown.",
  "",
  "Examples:",
  "open project Billing -> {\"action\":{\"action\":\"openProject\"},\"confidence\":0.95,\"projectRef\":\"Billing\"}",
  "open settings chat in acme -> {\"action\":{\"action\":\"openChat\",\"chat\":\"settings\"},\"confidence\":0.82,\"projectRef\":\"acme\"}",
  "new codex chat with model gpt-5.4 -> {\"action\":{\"action\":\"createChat\",\"provider\":\"codex\",\"model\":\"gpt-5.4\"},\"confidence\":0.9}",
  "send fix the failing tests to chat ci -> {\"action\":{\"action\":\"sendPrompt\",\"prompt\":\"fix the failing tests\",\"chat\":\"ci\"},\"confidence\":0.88}",
  "start review swarm of 3 for the auth diff -> {\"action\":{\"action\":\"startSwarm\",\"mode\":\"review\",\"count\":3,\"goal\":\"review the auth diff\",\"provider\":\"mixed\"},\"confidence\":0.9}",
  "run on Pixel 8 -> {\"action\":{\"action\":\"launchRun\",\"target\":\"Pixel 8\"},\"confidence\":0.86}",
  "take a screenshot -> {\"action\":{\"action\":\"takeScreenshot\"},\"confidence\":0.97}",
  "make it better -> {\"unclear\":true,\"reason\":\"missing target and action\"}",
].join("\n");

export function buildRouterPrompt(commandText: string): string {
  return `${ACTION_CATALOG}\n\nCommand text as JSON string:\n${JSON.stringify(commandText)}\n`;
}

export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fence ? fence[1].trim() : trimmed;
}

export function extractClaudeProposalJson(output: string): string {
  const parsed = JSON.parse(output) as { result?: unknown };
  if (typeof parsed.result !== "string") {
    throw new Error("Claude router output did not include result text");
  }
  return stripJsonFences(parsed.result);
}

export function extractCodexProposalJson(output: string): string {
  let last: string | null = null;
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const event = value as { type?: unknown; item?: unknown };
    if (
      event.type !== "item.completed" ||
      !event.item ||
      typeof event.item !== "object"
    ) {
      continue;
    }
    const item = event.item as { type?: unknown; text?: unknown };
    if (item.type === "agent_message" && typeof item.text === "string") {
      last = item.text;
    }
  }
  if (last === null) throw new Error("Codex router output had no final agent_message");
  return stripJsonFences(last);
}

export function extractOllamaProposalJson(output: string): string {
  const parsed = JSON.parse(output) as { response?: unknown };
  if (typeof parsed.response !== "string") {
    throw new Error("Ollama router output did not include response text");
  }
  return stripJsonFences(parsed.response);
}

function extractProposalJson(backend: OperatorRouterBackend, output: string): string {
  switch (backend) {
    case "claudeCode":
      return extractClaudeProposalJson(output);
    case "codex":
      return extractCodexProposalJson(output);
    case "ollama":
      return extractOllamaProposalJson(output);
  }
}

function composeIntent(
  action: unknown,
  confidence: number,
  projectRef: string | null | undefined,
): OperatorIntent {
  const parsed = parseOperatorIntent(JSON.stringify({
    v: 2,
    id: crypto.randomUUID(),
    provenance: "typed",
    confidence,
    projectRef: projectRef ?? null,
    action,
  }));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.intent;
}

function parseProposal(rawJson: string): RouterProposal {
  let value: unknown;
  try {
    value = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(`router returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = routerProposalSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  return parsed.data;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function persistLatencyBestEffort(backend: OperatorRouterBackend, latencyMs: number): void {
  try {
    persistOperatorRouterLatency(backend, latencyMs);
  } catch {
    return;
  }
}

export async function routeCommand(text: string): Promise<RouteResult> {
  const backend = configuredRouterBackend();
  if (!backend) return { kind: "unconfigured" };
  const model = operatorRouterSettings().models[backend].trim();
  if (!model) return { kind: "unconfigured" };

  try {
    const raw = await invoke<RawRouteOutput>("operator_route_raw", {
      backend,
      model,
      prompt: buildRouterPrompt(text),
      timeoutMs: ROUTER_TIMEOUT_MS,
    });
    persistLatencyBestEffort(backend, raw.latencyMs);
    if (!raw.exitOk) {
      return {
        kind: "error",
        message: raw.stderrTail.trim() || "router command exited unsuccessfully",
      };
    }
    const proposal = parseProposal(extractProposalJson(backend, raw.output));
    if ("unclear" in proposal) {
      return { kind: "unclear", reason: proposal.reason ?? "router could not map this command" };
    }
    return {
      kind: "proposal",
      intent: composeIntent(proposal.action, proposal.confidence, proposal.projectRef),
      confidence: proposal.confidence,
      latencyMs: raw.latencyMs,
    };
  } catch (error) {
    return { kind: "error", message: errorMessage(error) };
  }
}

export function routerCatalogActionNames(): string[] {
  return operatorActionNames;
}
