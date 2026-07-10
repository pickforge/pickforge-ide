import { getProSupabaseClient } from "./proAuth";
import {
  composeIntent,
  routerProposalSchema,
  type RouteResult,
  type RouterProposal,
} from "./operatorRouter";
import { sanitizeRoutedText } from "./widgetMatch";
import { isPrimaryChat } from "./chatLabels";
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
        .filter((chat) => !isChatArchived(chat.chatId) && isPrimaryChat(chat))
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

interface HostedCall {
  record: Record<string, unknown> | null;
  transportError: string | null;
}

// A non-2xx status (402 insufficient_credits, 429 rate_limited, other 4xx)
// surfaces as a FunctionsHttpError whose response body carries the structured
// { error, ... } payload; read it so those signals survive the HTTP status.
async function readErrorRecord(error: unknown): Promise<Record<string, unknown> | null> {
  const context = (error as { context?: unknown }).context;
  if (context && typeof (context as { json?: unknown }).json === "function") {
    try {
      const body = await (context as { json: () => Promise<unknown> }).json();
      return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function callHostedRouter(body: HostedRouteRequestBody, key: string): Promise<HostedCall> {
  const { data, error } = await getProSupabaseClient().functions.invoke(HOSTED_ROUTER_FUNCTION, {
    body,
    headers: { "x-idempotency-key": key },
  });
  if (error) {
    const record = await readErrorRecord(error);
    return record ? { record, transportError: null } : { record: null, transportError: errorMessage(error) };
  }
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  return { record, transportError: null };
}

function interpretRecord(record: Record<string, unknown> | null, latencyMs: number): HostedRouteResult {
  if (!record) return { kind: "error", message: "hosted router returned no data" };

  if (record.error === "insufficient_credits") {
    return { kind: "needsCredits", balance: toNumber(record.balance) };
  }
  if (record.error === "rate_limited") {
    // A per-user 429; never auto-retry, or the app would hammer the limiter.
    return { kind: "error", message: "routing rate limit — try again in a moment" };
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
  // The function always bills a routed command, so a success without a real
  // cost is malformed; never dispatch a "0¢" route from a suspicious response.
  const costCents = record.costCents;
  if (typeof costCents !== "number" || !Number.isFinite(costCents) || costCents < 0) {
    return { kind: "error", message: "hosted router response missing a valid cost" };
  }

  let value: unknown;
  try {
    value = JSON.parse(record.proposalJson);
  } catch (error) {
    return { kind: "error", message: `hosted router returned invalid JSON: ${errorMessage(error)}` };
  }
  const parsed = routerProposalSchema.safeParse(value);
  if (!parsed.success) return { kind: "error", message: parsed.error.message };
  return proposalToResult(parsed.data, latencyMs, costCents);
}

export async function hostedRoute(commandText: string): Promise<HostedRouteResult> {
  if (!accountSession()) return { kind: "unconfigured" };

  const body: HostedRouteRequestBody = { commandText };
  const context = currentRoutingContext();
  if (context) body.context = context;

  const start = Date.now();
  try {
    const call = await callHostedRouter(body, crypto.randomUUID());
    if (call.transportError) return { kind: "error", message: call.transportError };
    return interpretRecord(call.record, Date.now() - start);
  } catch (error) {
    return { kind: "error", message: errorMessage(error) };
  }
}
