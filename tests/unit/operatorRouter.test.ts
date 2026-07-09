import { beforeEach, describe, expect, it, vi } from "vitest";
import { operatorActionSchema } from "../../src/lib/operatorIntent";

const env = vi.hoisted(() => {
  const storage = new Map<string, string>();
  const state = { setItemError: null as Error | null };
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (state.setItemError) throw state.setItemError;
      storage.set(key, value);
    },
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  };
  (globalThis as { localStorage?: unknown }).localStorage = localStorage;
  return { invoke: vi.fn(), storage, state };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: env.invoke }));

async function loadRouter() {
  vi.resetModules();
  return import("../../src/lib/operatorRouter");
}

async function configure(backend: "claudeCode" | "codex" | "ollama", model = "model-1") {
  const settings = await import("../../src/stores/operatorRouterSettings");
  settings.setOperatorRouterBackend(backend);
  settings.setOperatorRouterModel(backend, model);
  return settings;
}

beforeEach(() => {
  env.storage.clear();
  env.state.setItemError = null;
  env.invoke.mockReset();
});

describe("operator router proposals", () => {
  it("rejects extra fields, bad confidence, and unknown actions", async () => {
    const { routerProposalSchema } = await loadRouter();

    expect(routerProposalSchema.safeParse({
      action: { action: "swarmStatus" },
      confidence: 0.8,
      extra: true,
    }).success).toBe(false);
    expect(routerProposalSchema.safeParse({
      action: { action: "swarmStatus" },
      confidence: 1.2,
    }).success).toBe(false);
    expect(routerProposalSchema.safeParse({
      action: { action: "deleteProject" },
      confidence: 0.8,
    }).success).toBe(false);
  });

  it("extracts Claude, Codex, and Ollama proposal JSON", async () => {
    const r = await loadRouter();
    const proposal = "{\"action\":{\"action\":\"swarmStatus\"},\"confidence\":0.8}";

    expect(r.extractClaudeProposalJson(JSON.stringify({
      result: `\`\`\`json\n${proposal}\n\`\`\``,
    }))).toBe(proposal);

    expect(r.extractCodexProposalJson([
      JSON.stringify({ type: "thread.started", thread_id: "t1" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "m1", type: "agent_message", text: "{\"unclear\":true}" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "m2", type: "agent_message", text: `\`\`\`json\n${proposal}\n\`\`\`` },
      }),
    ].join("\n"))).toBe(proposal);

    expect(r.extractOllamaProposalJson(JSON.stringify({
      response: `\`\`\`\n${proposal}\n\`\`\``,
    }))).toBe(proposal);
  });

  it("keeps the prompt catalog in sync with every v2 action name", async () => {
    const { buildRouterPrompt } = await loadRouter();
    const prompt = buildRouterPrompt("open project App");
    const names = operatorActionSchema.options.flatMap((option) =>
      [...option.shape.action.values].map(String),
    );

    for (const name of names) {
      expect(prompt).toContain(name);
    }
  });

  it("returns unconfigured when the router is off", async () => {
    const { routeCommand } = await loadRouter();

    await expect(routeCommand("open project App")).resolves.toEqual({ kind: "unconfigured" });
    expect(env.invoke).not.toHaveBeenCalled();
  });

  it("routes a configured backend, validates the proposal, and stores latency", async () => {
    const { routeCommand } = await loadRouter();
    const settings = await configure("ollama", "qwen2.5:3b");
    env.invoke.mockResolvedValue({
      output: JSON.stringify({
        response: "{\"action\":{\"action\":\"openProject\"},\"confidence\":0.72,\"projectRef\":\"App\"}",
      }),
      latencyMs: 1_800,
      exitOk: true,
      stderrTail: "",
    });

    const result = await routeCommand("open App");

    expect(env.invoke).toHaveBeenCalledWith("operator_route_raw", expect.objectContaining({
      backend: "ollama",
      model: "qwen2.5:3b",
      timeoutMs: 30_000,
    }));
    expect(result).toMatchObject({
      kind: "proposal",
      confidence: 0.72,
      latencyMs: 1_800,
      intent: {
        v: 2,
        provenance: "typed",
        confidence: 0.72,
        projectRef: "App",
        action: { action: "openProject" },
      },
    });
    expect(settings.operatorRouterSettings().lastLatencyMs.ollama).toBe(1_800);
  });

  it("keeps successful routes when latency persistence throws", async () => {
    const { routeCommand } = await loadRouter();
    await configure("ollama", "qwen2.5:3b");
    env.state.setItemError = new Error("storage unavailable");
    env.invoke.mockResolvedValue({
      output: JSON.stringify({
        response: "{\"action\":{\"action\":\"openProject\"},\"confidence\":0.72,\"projectRef\":\"App\"}",
      }),
      latencyMs: 1_800,
      exitOk: true,
      stderrTail: "",
    });

    const result = await routeCommand("open App");

    expect(result).toMatchObject({
      kind: "proposal",
      confidence: 0.72,
      latencyMs: 1_800,
      intent: {
        projectRef: "App",
        action: { action: "openProject" },
      },
    });
  });

  it("returns unclear and error states from routed output", async () => {
    const { routeCommand } = await loadRouter();
    await configure("ollama", "qwen2.5:3b");
    env.invoke.mockResolvedValueOnce({
      output: JSON.stringify({ response: "{\"unclear\":true,\"reason\":\"too vague\"}" }),
      latencyMs: 44,
      exitOk: true,
      stderrTail: "",
    });

    await expect(routeCommand("make it nicer")).resolves.toEqual({
      kind: "unclear",
      reason: "too vague",
    });

    env.invoke.mockResolvedValueOnce({
      output: "",
      latencyMs: 55,
      exitOk: false,
      stderrTail: "model not found",
    });

    await expect(routeCommand("open project App")).resolves.toEqual({
      kind: "error",
      message: "model not found",
    });
  });
});
