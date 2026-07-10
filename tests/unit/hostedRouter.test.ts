import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const storage = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
  return {
    storage,
    invoke: vi.fn(),
    session: null as { userId: string } | null,
    project: null as { displayName: string } | null,
    root: null as string | null,
    chats: [] as Array<{ chatId: string; title: string; labelsJson?: string | null }>,
    archived: new Set<string>(),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("../../src/lib/proAuth", () => ({
  getProSupabaseClient: () => ({ functions: { invoke: env.invoke } }),
}));

vi.mock("../../src/stores/account", () => ({
  accountSession: () => env.session,
}));

vi.mock("../../src/stores/workspace", () => ({
  activeProject: () => env.project,
  chatsFor: () => env.chats,
  workspace: {
    get activeRoot() {
      return env.root;
    },
  },
}));

vi.mock("../../src/stores/chatArchive", () => ({
  isChatArchived: (chatId: string) => env.archived.has(chatId),
}));

const PROPOSAL = JSON.stringify({
  action: { action: "openProject" },
  confidence: 0.82,
  projectRef: "Billing",
});

async function loadHosted() {
  vi.resetModules();
  return import("../../src/lib/hostedRouter");
}

async function loadRouter() {
  vi.resetModules();
  return import("../../src/lib/operatorRouter");
}

beforeEach(() => {
  env.storage.clear();
  env.invoke.mockReset();
  env.session = { userId: "user-1" };
  env.project = null;
  env.root = null;
  env.chats = [];
  env.archived = new Set();
});

describe("hostedRoute", () => {
  it("short-circuits to unconfigured when signed out", async () => {
    env.session = null;
    const { hostedRoute } = await loadHosted();

    await expect(hostedRoute("open Billing")).resolves.toEqual({ kind: "unconfigured" });
    expect(env.invoke).not.toHaveBeenCalled();
  });

  it("routes a hosted proposal, validates it, and returns cost", async () => {
    env.invoke.mockResolvedValue({
      data: { proposalJson: PROPOSAL, usage: { input: 40, output: 8 }, costCents: 2 },
      error: null,
    });
    const { hostedRoute } = await loadHosted();

    const result = await hostedRoute("open Billing");

    expect(env.invoke).toHaveBeenCalledWith("operator-router", expect.objectContaining({
      body: { commandText: "open Billing" },
      headers: expect.objectContaining({ "x-idempotency-key": expect.any(String) }),
    }));
    expect(result).toMatchObject({
      kind: "proposal",
      confidence: 0.82,
      costCents: 2,
      intent: {
        v: 2,
        provenance: "typed",
        projectRef: "Billing",
        action: { action: "openProject" },
      },
    });
  });

  it("generates a fresh idempotency key per attempt", async () => {
    env.invoke.mockResolvedValue({ data: { proposalJson: PROPOSAL, costCents: 1 }, error: null });
    const { hostedRoute } = await loadHosted();

    await hostedRoute("open Billing");
    await hostedRoute("open Billing");

    const keys = env.invoke.mock.calls.map((call) => call[1].headers["x-idempotency-key"]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("rejects a success response with a missing or non-numeric cost", async () => {
    const { hostedRoute } = await loadHosted();

    env.invoke.mockResolvedValueOnce({ data: { proposalJson: PROPOSAL }, error: null });
    const missing = await hostedRoute("open Billing");
    expect(missing).toMatchObject({ kind: "error", message: expect.stringContaining("cost") });

    env.invoke.mockResolvedValueOnce({ data: { proposalJson: PROPOSAL, costCents: "2" }, error: null });
    const nonNumeric = await hostedRoute("open Billing");
    expect(nonNumeric.kind).toBe("error");

    env.invoke.mockResolvedValueOnce({ data: { proposalJson: PROPOSAL, costCents: -1 }, error: null });
    const negative = await hostedRoute("open Billing");
    expect(negative.kind).toBe("error");
  });

  it("maps insufficient_credits to needsCredits with the balance", async () => {
    env.invoke.mockResolvedValue({
      data: { error: "insufficient_credits", balance: 12 },
      error: null,
    });
    const { hostedRoute } = await loadHosted();

    await expect(hostedRoute("open Billing")).resolves.toEqual({ kind: "needsCredits", balance: 12 });
  });

  it("maps other server errors to error", async () => {
    env.invoke.mockResolvedValue({ data: { error: "internal_error" }, error: null });
    const { hostedRoute } = await loadHosted();

    await expect(hostedRoute("open Billing")).resolves.toEqual({
      kind: "error",
      message: "internal_error",
    });
  });

  it("maps a transport error to error", async () => {
    env.invoke.mockResolvedValue({ data: null, error: new Error("network down") });
    const { hostedRoute } = await loadHosted();

    await expect(hostedRoute("open Billing")).resolves.toEqual({
      kind: "error",
      message: "network down",
    });
  });

  it("rejects an invalid hosted proposal instead of trusting it", async () => {
    env.invoke.mockResolvedValue({
      data: { proposalJson: JSON.stringify({ action: { action: "deleteEverything" }, confidence: 1 }), costCents: 1 },
      error: null,
    });
    const { hostedRoute } = await loadHosted();

    const result = await hostedRoute("nuke it");
    expect(result.kind).toBe("error");
  });

  it("returns unclear with the cost so a billed unclear answer is surfaced", async () => {
    env.invoke.mockResolvedValue({
      data: { proposalJson: JSON.stringify({ unclear: true, reason: "too vague" }), costCents: 1 },
      error: null,
    });
    const { hostedRoute } = await loadHosted();

    await expect(hostedRoute("do the thing")).resolves.toEqual({
      kind: "unclear",
      reason: "too vague",
      costCents: 1,
    });
  });

  it("never accepts a hosted selectWidget proposal, treating it as unclear-with-cost", async () => {
    env.invoke.mockResolvedValue({
      data: {
        proposalJson: JSON.stringify({ action: { action: "selectWidget", description: "login" }, confidence: 0.9 }),
        costCents: 1,
      },
      error: null,
    });
    const { hostedRoute } = await loadHosted();

    const result = await hostedRoute("select the login button");
    expect(result).toMatchObject({ kind: "unclear", costCents: 1 });
    expect(result.kind).not.toBe("proposal");
  });

  it("refreshes reconcilation data on a billed-but-malformed reply", async () => {
    env.invoke.mockResolvedValue({
      data: { proposalJson: "{not json", costCents: 3 },
      error: null,
    });
    const { hostedRoute } = await loadHosted();

    const result = await hostedRoute("open Billing");
    // The reply was billed, so the error carries the cost for the dock to reconcile.
    expect(result).toMatchObject({ kind: "error", costCents: 3 });
  });

  it("times out a stalled request with a friendly error", async () => {
    env.invoke.mockReturnValue(new Promise(() => {}));
    const { hostedRoute, HOSTED_REQUEST_TIMEOUT_MS } = await loadHosted();
    vi.useFakeTimers();
    try {
      const pending = hostedRoute("open Billing");
      await vi.advanceTimersByTimeAsync(HOSTED_REQUEST_TIMEOUT_MS + 1);
      await expect(pending).resolves.toEqual({ kind: "error", message: "routing timed out — try again" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("redacts bare hostnames, domains, and IPs from the context before sending", async () => {
    env.invoke.mockResolvedValue({ data: { proposalJson: PROPOSAL, costCents: 1 }, error: null });
    env.project = { displayName: "Billing" };
    env.root = "/root";
    env.chats = [
      { chatId: "c1", title: "deploy prod.example.com", labelsJson: null },
      { chatId: "c2", title: "ping 8.8.8.8 gateway", labelsJson: null },
    ];
    const { hostedRoute } = await loadHosted();

    await hostedRoute("open");

    const serialized = JSON.stringify(env.invoke.mock.calls[0][1].body);
    expect(serialized).not.toContain("prod.example.com");
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain("8.8.8.8");
  });

  it("only sends commandText plus allowlisted, redacted context (data boundary)", async () => {
    env.invoke.mockResolvedValue({ data: { proposalJson: PROPOSAL, costCents: 1 }, error: null });
    env.project = { displayName: "Billing" };
    env.root = "/home/dev/Projects/Billing";
    env.chats = [
      { chatId: "c1", title: "ci logs" },
      { chatId: "c2", title: "deploy to prod-box.local:8080" },
      { chatId: "c3", title: "archived notes" },
    ];
    env.archived = new Set(["c3"]);
    const { hostedRoute } = await loadHosted();

    await hostedRoute("open ci chat");

    const body = env.invoke.mock.calls[0][1].body;
    expect(Object.keys(body).sort()).toEqual(["commandText", "context"]);
    expect(Object.keys(body.context).sort()).toEqual(["chatNames", "projectName"]);
    expect(body.context.projectName).toBe("Billing");
    expect(body.context.chatNames).toContain("ci logs");
    // The archived chat never ships; the hostname:port is redacted, not sent raw.
    expect(body.context.chatNames).not.toContain("archived notes");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("/home/dev");
    expect(serialized).not.toContain("prod-box.local");
    expect(serialized).not.toContain("8080");
  });

  it("never ships swarm-worker chats in the context payload", async () => {
    env.invoke.mockResolvedValue({ data: { proposalJson: PROPOSAL, costCents: 1 }, error: null });
    env.project = { displayName: "Billing" };
    env.root = "/root";
    env.chats = [
      { chatId: "c1", title: "primary planning", labelsJson: null },
      { chatId: "c2", title: "worker lane one", labelsJson: JSON.stringify({ role: "swarmWorker" }) },
    ];
    const { hostedRoute } = await loadHosted();

    await hostedRoute("open");

    const body = env.invoke.mock.calls[0][1].body;
    expect(body.context.chatNames).toContain("primary planning");
    expect(body.context.chatNames).not.toContain("worker lane one");
  });

  it("maps a 429 rate_limited response to a quiet friendly error without retrying", async () => {
    const httpError = { context: { json: async () => ({ error: "rate_limited" }) } };
    env.invoke.mockResolvedValue({ data: null, error: httpError });
    const { hostedRoute } = await loadHosted();

    const result = await hostedRoute("open Billing");

    expect(result).toEqual({ kind: "error", message: "routing rate limit — try again in a moment" });
    expect(env.invoke).toHaveBeenCalledTimes(1);
  });
});

describe("buildHostedRoutingContext", () => {
  it("keeps only the three allowlisted keys and redacts each value", async () => {
    const { buildHostedRoutingContext } = await loadHosted();

    const context = buildHostedRoutingContext({
      projectName: "acme.internal.io",
      chatTitles: ["ci logs", "ssh 100.101.102.103 box"],
      widgetLabels: ["Sign in", "/Users/me/secret/path"],
    });

    expect(context && Object.keys(context).sort()).toEqual(["chatNames", "projectName", "widgetLabels"]);
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("100.101.102.103");
    expect(serialized).not.toContain("/Users/me");
    // A bare domain in the project name is stripped, not shipped.
    expect(serialized).not.toContain("acme.internal.io");
  });

  it("caps chat and widget label counts", async () => {
    const { buildHostedRoutingContext, HOSTED_CONTEXT_MAX_CHATS } = await loadHosted();
    const titles = Array.from({ length: HOSTED_CONTEXT_MAX_CHATS + 5 }, (_, i) => `chat ${i}`);

    const context = buildHostedRoutingContext({ projectName: "App", chatTitles: titles });
    expect(context?.chatNames).toHaveLength(HOSTED_CONTEXT_MAX_CHATS);
  });

  it("returns undefined when nothing survives redaction", async () => {
    const { buildHostedRoutingContext } = await loadHosted();
    expect(buildHostedRoutingContext({ projectName: null, chatTitles: [] })).toBeUndefined();
  });
});

describe("routeCommand hosted delegation", () => {
  it("delegates to hostedRoute when the backend is hosted and signed in", async () => {
    env.invoke.mockResolvedValue({ data: { proposalJson: PROPOSAL, costCents: 3 }, error: null });
    const router = await loadRouter();
    const settings = await import("../../src/stores/operatorRouterSettings");
    settings.setOperatorRouterBackend("hosted");

    const result = await router.routeCommand("open Billing");

    expect(env.invoke).toHaveBeenCalledWith("operator-router", expect.anything());
    expect(result).toMatchObject({ kind: "proposal", costCents: 3 });
  });

  it("falls through to unconfigured when hosted is selected but signed out", async () => {
    env.session = null;
    const router = await loadRouter();
    const settings = await import("../../src/stores/operatorRouterSettings");
    settings.setOperatorRouterBackend("hosted");

    await expect(router.routeCommand("open Billing")).resolves.toEqual({ kind: "unconfigured" });
    expect(env.invoke).not.toHaveBeenCalled();
  });
});
