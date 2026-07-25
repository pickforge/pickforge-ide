// @vitest-environment jsdom
// @vitest-environment-options {"jsdom":{"customExportConditions":["browser"]}}
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentChatState } from "../../src/stores/agentChat";

const store = vi.hoisted(() => ({
  read: (() => undefined) as () => AgentChatState | undefined,
  ensure: vi.fn(),
  approve: vi.fn(),
  clearSwitched: vi.fn(),
  enqueue: vi.fn(),
  interrupt: vi.fn(),
  removeQueued: vi.fn(),
  retry: vi.fn(),
  send: vi.fn(),
  setEffort: vi.fn(),
  setMode: vi.fn(),
  setModel: vi.fn(),
  steer: vi.fn(),
  switchProvider: vi.fn(),
}));

vi.mock("../../src/stores/agentChat", () => ({
  agentChat: () => store.read(),
  approveAgentRequest: store.approve,
  clearProviderSwitched: store.clearSwitched,
  enqueueAgentMessage: store.enqueue,
  ensureAgentChat: store.ensure,
  interruptAgentChat: store.interrupt,
  removeQueuedMessage: store.removeQueued,
  retryAgentChatConnection: store.retry,
  sendAgentMessage: store.send,
  setAgentChatEffort: store.setEffort,
  setAgentChatMode: store.setMode,
  setAgentChatModel: store.setModel,
  steerAgentChat: store.steer,
  switchAgentChatProvider: store.switchProvider,
}));

vi.mock("../../src/lib/agentBackends", () => ({
  agentBackendDescriptor: (provider: string) => ({ label: provider }),
  backendCapabilityReason: () => null,
  supportsBackendCapability: () => false,
}));
vi.mock("../../src/lib/agentModels", () => ({
  loadAgentEfforts: () => ({}),
  loadAgentModels: () => ({}),
  modelOption: () => undefined,
  nativeChatModel: (_provider: string, model: string | null) => model,
  setAgentEffort: vi.fn(),
  setAgentModel: vi.fn(),
}));
vi.mock("../../src/lib/agentModes", () => ({
  loadAgentModes: () => ({}),
  setAgentMode: vi.fn(),
}));
vi.mock("../../src/lib/chatDefaults", () => ({ loadAgentEngine: () => "v2" }));
vi.mock("../../src/lib/swarmCommand", () => ({ parseSwarmCommand: () => null }));
vi.mock("../../src/stores/swarm", () => ({ startSwarm: vi.fn(), swarmRuns: () => [] }));
vi.mock("../../src/components/chat/ChatTimeline", () => ({ ChatTimeline: () => null }));
vi.mock("../../src/components/chat/SwarmRunCard", () => ({ SwarmRunCard: () => null }));
vi.mock("../../src/components/chat/Composer", () => ({ Composer: () => null }));
vi.mock("../../src/components/chat/QueueDock", () => ({ QueueDock: () => null }));
vi.mock("../../src/components/chat/ImageLightbox", () => ({ ImageLightbox: () => null }));
vi.mock("../../src/components/chat/ApprovalPrompt", () => ({ ApprovalPrompt: () => null }));
vi.mock("../../src/components/chat/ContextMeter", () => ({ ContextMeter: () => null }));

import { AgentChatView } from "../../src/components/chat/AgentChatView";

type Provider = AgentChatState["provider"];

function chatState(provider: Provider, overrides: Partial<AgentChatState> = {}): AgentChatState {
  return {
    sessionId: null,
    projectRoot: "/current-project",
    provider,
    engine: "v2",
    model: `${provider}-model`,
    effort: "high",
    mode: "default",
    providerSwitched: false,
    turnActive: false,
    error: "connection lost",
    timeline: [],
    queue: [],
    approvals: [],
    contextUsed: null,
    contextWindow: null,
    rateLimits: null,
    remoteHost: null,
    totals: {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      estimated: false,
    },
    cumulativeUsage: null,
    historyLoaded: true,
    ...overrides,
  };
}

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let setState: (state: AgentChatState | undefined) => void;

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function mount(state: AgentChatState | undefined): void {
  const signal = createSignal(state);
  store.read = signal[0];
  setState = signal[1];
  dispose = render(
    () => AgentChatView({
      chatId: "chat-1",
      projectRoot: "/prop-project",
      provider: state?.provider ?? "omp",
      model: state?.model,
    }),
    container,
  );
}

function retryButton(): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Retry"),
  ) ?? null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  store.ensure.mockReset().mockResolvedValue(undefined);
  store.retry.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  container.remove();
});

describe("AgentChatView connection recovery", () => {
  it("handles a rejected mount ensure without an unhandled promise", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    store.ensure.mockRejectedValue(new Error("mount failed"));

    try {
      mount(undefined);
      await flush();

      expect(store.ensure).toHaveBeenCalledWith("chat-1", "/prop-project", "omp", null, {
        engine: "v2",
        effort: null,
        mode: null,
      });
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("retries with the current OMP connection settings and clears a successful error", async () => {
    const current = chatState("omp");
    mount(current);
    await flush();
    store.retry.mockImplementation(async () => {
      setState({ ...current, sessionId: "session-2", error: null });
    });

    retryButton()?.click();
    await flush();

    expect(store.retry).toHaveBeenCalledTimes(1);
    expect(store.retry).toHaveBeenCalledWith("chat-1");
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(retryButton()).toBeNull();
    const status = container.querySelector<HTMLElement>("[role=status]");
    expect(status?.textContent).toBe("Connection restored");
    expect(document.activeElement).toBe(status);

    setState({ ...current, sessionId: null, error: "connection lost again" });
    await flush();
    expect(container.querySelector("[role=status]")).toBeNull();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("connection lost again");
    expect(retryButton()?.textContent).toBe("Retry connection");
  });

  it("preserves the Pi retry error and re-enables the action after failure", async () => {
    const current = chatState("pi");
    mount(current);
    await flush();
    store.retry.mockImplementation(async () => {
      setState({ ...current, error: "Pi is still unavailable" });
      throw new Error("Pi is still unavailable");
    });

    retryButton()?.click();
    await flush();

    expect(store.retry).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[role=alert]")?.textContent).toContain(
      "Pi is still unavailable",
    );
    expect(retryButton()?.disabled).toBe(false);
    expect(retryButton()?.textContent).toBe("Retry connection");
  });

  it("bounds duplicate retries while a connection attempt is pending", async () => {
    let resolveRetry!: () => void;
    const retry = new Promise<void>((resolve) => {
      resolveRetry = resolve;
    });
    mount(chatState("omp"));
    await flush();
    store.retry.mockReturnValue(retry);

    const button = retryButton();
    button?.click();
    button?.click();

    expect(store.retry).toHaveBeenCalledTimes(1);
    expect(retryButton()?.disabled).toBe(true);
    expect(retryButton()?.getAttribute("aria-busy")).toBe("true");
    expect(retryButton()?.textContent).toBe("Retrying…");

    resolveRetry();
    await flush();
    expect(retryButton()?.disabled).toBe(false);
  });

  it.each(["claudeCode", "codex"] as const)(
    "does not offer native transport retry for %s",
    async (provider) => {
      mount(chatState(provider));
      await flush();
      expect(retryButton()).toBeNull();
    },
  );

  it.each(["omp", "pi"] as const)(
    "replaces a failed live %s session",
    async (provider) => {
      const current = chatState(provider, { sessionId: "session-live" });
      mount(current);
      await flush();
      store.retry.mockImplementation(async () => {
        setState({ ...current, sessionId: "session-recovered", error: null });
      });

      retryButton()?.click();
      await flush();

      expect(store.retry).toHaveBeenCalledWith("chat-1");
      expect(container.querySelector("[role=status]")?.textContent).toBe("Connection restored");
    },
  );

  it("ignores a retry completion after the provider changes", async () => {
    const current = chatState("omp", { sessionId: "session-dead" });
    let resolveRetry!: () => void;
    store.retry.mockReturnValue(new Promise<void>((resolve) => {
      resolveRetry = resolve;
    }));
    mount(current);
    await flush();

    retryButton()?.click();
    setState(chatState("pi", { sessionId: "pi-session", error: null }));
    resolveRetry();
    await flush();

    expect(container.querySelector("[role=status]")).toBeNull();
  });
});
