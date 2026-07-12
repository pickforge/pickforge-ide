import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => {
  const values = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return values;
});

vi.mock("../../src/lib/process", () => ({
  probeAgentCli: vi.fn(),
}));

async function loadModules() {
  vi.resetModules();
  const flags = await import("../../src/stores/flags");
  const models = await import("../../src/lib/agentModels");
  const quickLaunch = await import("../../src/stores/quickLaunch");
  return { flags, models, quickLaunch };
}

beforeEach(() => {
  memory.clear();
});

describe("OMP/Pi rollout gating and commands", () => {
  it("keeps profiles, commands, and quick launch unchanged while the flag is off", async () => {
    const { models, quickLaunch } = await loadModules();

    expect(models.agentProfiles()).toEqual(models.AGENTS);
    expect(models.launchCommand("claudeCode")).toBe("claude --model claude-haiku-4-5 ");
    expect(models.launchCommand("codex")).toBe("codex --model gpt-5.3-codex-spark ");
    expect(models.launchCommand("omp")).toBe("");
    expect(models.launchBinary("pi")).toBeNull();
    expect(quickLaunch.quickLaunchItems().map((item) => item.id)).toEqual([
      "agent-claude",
      "agent-codex",
      "tool-flutter-doctor",
      "tool-adb-devices",
    ]);
    expect(quickLaunch.optionalQuickLaunchChoices()).toEqual([]);
  });

  it("uses supported terminal flags without implying deferred MCP wiring", async () => {
    const { flags, models } = await loadModules();
    flags.setFlagOverride("ompPiAgents", true);

    expect(models.agentProfiles().slice(-2).map((agent) => ({
      id: agent.id,
      terminalOnly: agent.terminalOnly,
    }))).toEqual([
      { id: "omp", terminalOnly: true },
      { id: "pi", terminalOnly: true },
    ]);

    models.setAgentModel("omp", "openai/model; echo unsafe");
    expect(models.launchCommand("omp", { agentBrief: "PickForge's context" })).toBe(
      "omp --model 'openai/model; echo unsafe' ",
    );
    expect(models.nativeChatModel("omp", "openai/model")).toBeNull();

    models.setAgentModel("pi", "anthropic/claude-sonnet-4-6");
    expect(models.launchCommand("pi", {
      mcpConfigPath: "/tmp/pick forge/mcp.json",
      agentBrief: "Use selected widget",
    })).toBe(
      "pi --model anthropic/claude-sonnet-4-6 ",
    );
  });

  it("offers optional chips without changing defaults or duplicating an agent", async () => {
    const { flags, quickLaunch } = await loadModules();
    flags.setFlagOverride("ompPiAgents", true);

    expect(quickLaunch.optionalQuickLaunchChoices().map((item) => item.agentId)).toEqual([
      "omp",
      "pi",
    ]);
    quickLaunch.addOptionalQuickLaunch("omp");
    quickLaunch.addOptionalQuickLaunch("omp");

    expect(quickLaunch.quickLaunchItems().filter((item) => item.agentId === "omp")).toHaveLength(1);
    expect(quickLaunch.optionalQuickLaunchChoices().map((item) => item.agentId)).toEqual(["pi"]);
    expect(quickLaunch.quickLaunchItems().find((item) => item.agentId === "omp")).toMatchObject({
      hotkey: null,
      ai: true,
    });

    flags.setFlagOverride("ompPiAgents", false);
    expect(quickLaunch.quickLaunchItems().some((item) => item.agentId === "omp")).toBe(false);
    expect(quickLaunch.allQuickLaunchItems().some((item) => item.agentId === "omp")).toBe(true);
    flags.setFlagOverride("ompPiAgents", true);
    expect(quickLaunch.quickLaunchItems().some((item) => item.agentId === "omp")).toBe(true);
  });
});

describe("OMP/Pi discovery parsing and failures", () => {

  it("parses Pi's provider/model table into unambiguous selectors", async () => {
    const { models } = await loadModules();
    const raw = [
      "provider      model                    context  max-out  thinking  images",
      "anthropic     claude-sonnet-4-6        200K     64K      yes       yes",
      "openai-codex gpt-5.5 272K 128K yes yes",
    ].join("\n");

    expect(models.parsePiModelCatalog(raw)).toEqual([
      { id: "anthropic/claude-sonnet-4-6", label: "claude-sonnet-4-6 · anthropic", terminalOnly: true },
      { id: "openai-codex/gpt-5.5", label: "gpt-5.5 · openai-codex", terminalOnly: true },
    ]);
  });

  it("reports missing binaries without claiming terminal support", async () => {
    const { models } = await loadModules();
    const diagnostic = models.diagnosticFromProbe("pi", {
      installed: false,
      versionOutput: "",
      helpOutput: "",
      modelsOutput: "",
      errors: [],
    });

    expect(diagnostic).toMatchObject({
      installed: false,
      version: null,
      models: [],
      capabilities: {
        terminal: false,
        dynamicModels: false,
      },
      errors: [],
    });
  });

  it("reports OMP models unavailable without parsing an online-capable catalog", async () => {
    const { models } = await loadModules();
    const diagnostic = models.diagnosticFromProbe("omp", {
      installed: true,
      versionOutput: "omp v16.4.8",
      helpOutput: "--provider=<value>  --profile=<value>  --mode=text|rpc\n  acp  Run ACP server",
      modelsOutput: "",
      errors: [],
    });

    expect(diagnostic.version).toBe("16.4.8");
    expect(diagnostic.models).toEqual([]);
    expect(diagnostic.capabilities).toMatchObject({
      terminal: true,
      dynamicModels: false,
      profiles: true,
      providerSelection: true,
    });
    expect(diagnostic.capabilities).not.toHaveProperty("acp");
    expect(diagnostic.capabilities).not.toHaveProperty("rpc");
    expect(diagnostic.capabilities).not.toHaveProperty("nativeChat");
    expect(diagnostic.errors).toEqual([
      "OMP models unavailable: no enforced offline/cache-only catalog probe",
    ]);
  });
});
