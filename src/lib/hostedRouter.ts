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
export const HOSTED_REQUEST_TIMEOUT_MS = 20_000;

// The shared routing sanitizer strips paths, host:port, serials, and .local
// hosts; the hosted lane additionally strips BARE public IPs and domains
// (no scheme/port) so a display name like "deploy prod.example.com" never
// leaves the machine and never trips the server's boundary check.
const BARE_IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const BARE_DOMAIN = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi;

function redactBareNetwork(value: string): string {
  return value.replace(BARE_IPV4, "…").replace(BARE_DOMAIN, "…");
}

function sanitizeContextValue(value: string | null): string | null {
  const base = sanitizeRoutedText(value);
  if (!base) return null;
  const redacted = redactBareNetwork(base).trim();
  return redacted || null;
}

class HostedTimeoutError extends Error {}

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
    const clean = sanitizeContextValue(value);
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
  const projectName = sanitizeContextValue(input.projectName ?? null);
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
    // The model still ran and billed, so an unclear answer carries its cost too.
    return { kind: "unclear", reason: proposal.reason ?? "hosted router could not map this command", costCents };
  }
  // Defense in depth: widget selection has no hosted transport, so never accept a
  // selectWidget proposal even if the model returns one. It was billed, so treat
  // it as unclear-with-cost rather than dispatching it.
  if ((proposal.action as { action?: unknown }).action === "selectWidget") {
    return { kind: "unclear", reason: "hosted routing does not support widget selection", costCents };
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
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new HostedTimeoutError());
    }, HOSTED_REQUEST_TIMEOUT_MS);
  });

  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await Promise.race([
      getProSupabaseClient().functions.invoke(HOSTED_ROUTER_FUNCTION, {
        body,
        headers: { "x-idempotency-key": key },
        signal: controller.signal,
      }),
      timeout,
    ]));
  } finally {
    if (timer) clearTimeout(timer);
  }

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

  // Past this point the reply is billed (costCents is valid), so a malformed or
  // schema-invalid proposal still carries its cost — the dock refreshes the
  // balance on any billed reply so the ledger reconciles.
  let value: unknown;
  try {
    value = JSON.parse(record.proposalJson);
  } catch (error) {
    return { kind: "error", message: `hosted router returned invalid JSON: ${errorMessage(error)}`, costCents };
  }
  const parsed = routerProposalSchema.safeParse(value);
  if (!parsed.success) return { kind: "error", message: parsed.error.message, costCents };
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
    if (error instanceof HostedTimeoutError) {
      return { kind: "error", message: "routing timed out — try again" };
    }
    return { kind: "error", message: errorMessage(error) };
  }
}
