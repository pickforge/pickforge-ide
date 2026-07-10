import { getProSupabaseClient } from "./proAuth";
import {
  composeIntent,
  routerProposalSchema,
  type RouteResult,
  type RouterProposal,
} from "./operatorRouter";
import { sanitizeRoutedText } from "./widgetMatch";
import { accountSession } from "../stores/account";
import { isChatArchived } from "../stores/chatArchive";
import { activeProject, chatsFor, workspace } from "../stores/workspace";

export const HOSTED_ROUTER_FUNCTION = "operator-router";
export const HOSTED_CONTEXT_MAX_CHATS = 12;
export const HOSTED_CONTEXT_MAX_WIDGET_LABELS = 12;

export type HostedRouteResult = RouteResult | { kind: "needsCredits"; balance: number };

export interface HostedRoutingContextInput {
  projectName?: string | null;
  chatTitles?: readonly string[];
  widgetLabels?: readonly string[];
}

export interface HostedRoutingContext {
  projectName?: string;
  chatNames?: string[];
  widgetLabels?: string[];
}

export interface HostedRouteRequestBody {
  commandText: string;
  context?: HostedRoutingContext;
}

function cappedLabels(values: readonly string[] | undefined, max: number): string[] {
  if (!values) return [];
  const out: string[] = [];
  for (const value of values) {
    const clean = sanitizeRoutedText(value);
    if (clean) out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

// Only the three allowlisted keys ever reach the wire, each redacted through the
// same routing sanitizer used for widget selection so a display name that hides a
// path, hostname, or serial collapses before it leaves the machine.
export function buildHostedRoutingContext(
  input: HostedRoutingContextInput,
): HostedRoutingContext | undefined {
  const context: HostedRoutingContext = {};
  const projectName = sanitizeRoutedText(input.projectName ?? null);
  if (projectName) context.projectName = projectName;
  const chatNames = cappedLabels(input.chatTitles, HOSTED_CONTEXT_MAX_CHATS);
  if (chatNames.length) context.chatNames = chatNames;
  const widgetLabels = cappedLabels(input.widgetLabels, HOSTED_CONTEXT_MAX_WIDGET_LABELS);
  if (widgetLabels.length) context.widgetLabels = widgetLabels;
  return Object.keys(context).length ? context : undefined;
}

function currentRoutingContext(): HostedRoutingContext | undefined {
  const root = workspace.activeRoot;
  const chatTitles = root
    ? chatsFor(root)
        .filter((chat) => !isChatArchived(chat.chatId))
        .map((chat) => chat.title)
    : [];
  return buildHostedRoutingContext({
    projectName: activeProject()?.displayName ?? null,
    chatTitles,
  });
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "hosted router request failed";
}

function proposalToResult(proposal: RouterProposal, latencyMs: number, costCents: number): HostedRouteResult {
  if ("unclear" in proposal) {
    return { kind: "unclear", reason: proposal.reason ?? "hosted router could not map this command" };
  }
  return {
    kind: "proposal",
    intent: composeIntent(proposal.action, proposal.confidence, proposal.projectRef),
    confidence: proposal.confidence,
    latencyMs,
    costCents,
  };
}

function interpretResponse(data: unknown, latencyMs: number): HostedRouteResult {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!record) return { kind: "error", message: "hosted router returned no data" };

  if (record.error === "insufficient_credits") {
    return { kind: "needsCredits", balance: toNumber(record.balance) };
  }
  if (typeof record.error === "string") {
    return { kind: "error", message: record.error };
  }
  if (record.duplicate === true) {
    return { kind: "error", message: "hosted router replayed a duplicate request" };
  }
  if (typeof record.proposalJson !== "string") {
    return { kind: "error", message: "hosted router response missing proposalJson" };
  }

  let value: unknown;
  try {
    value = JSON.parse(record.proposalJson);
  } catch (error) {
    return { kind: "error", message: `hosted router returned invalid JSON: ${errorMessage(error)}` };
  }
  const parsed = routerProposalSchema.safeParse(value);
  if (!parsed.success) return { kind: "error", message: parsed.error.message };
  return proposalToResult(parsed.data, latencyMs, toNumber(record.costCents));
}

export async function hostedRoute(commandText: string): Promise<HostedRouteResult> {
  if (!accountSession()) return { kind: "unconfigured" };

  const body: HostedRouteRequestBody = { commandText };
  const context = currentRoutingContext();
  if (context) body.context = context;

  const start = Date.now();
  try {
    const { data, error } = await getProSupabaseClient().functions.invoke(HOSTED_ROUTER_FUNCTION, {
      body,
      headers: { "x-idempotency-key": crypto.randomUUID() },
    });
    if (error) return { kind: "error", message: errorMessage(error) };
    return interpretResponse(data, Date.now() - start);
  } catch (error) {
    return { kind: "error", message: errorMessage(error) };
  }
}
