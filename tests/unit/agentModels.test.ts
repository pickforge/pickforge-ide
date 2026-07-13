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
  const backends = await import("../../src/lib/agentBackends");
  const quickLaunch = await import("../../src/stores/quickLaunch");
  const chatDefaults = await import("../../src/lib/chatDefaults");
  return { flags, models, backends, quickLaunch, chatDefaults };
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
      { id: "omp", terminalOnly: undefined },
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

  it("selects OMP native chat only after the exact compatible probe", async () => {
    const { flags, models } = await loadModules();
    flags.setFlagOverride("ompPiAgents", true);

    expect(models.ompNativeChatUnavailableReason()).toBe(
      `Checking for compatible OMP ${models.SUPPORTED_OMP_ACP_VERSION}`,
    );
    expect(models.defaultNativeAgentProvider("omp")).toBe("claudeCode");

    expect(models.nativeAgentProfiles().map((profile) => profile.id)).toEqual([
      "claudeCode",
      "codex",
    ]);
    expect(models.nativeChatModel("omp", "openai/gpt-test")).toBeNull();

    const incompatible = models.diagnosticFromProbe("omp", {
      installed: true,
      versionOutput: "omp 16.4.9",
      helpOutput: "acp --no-extensions",
      modelsOutput: "",
      errors: [],
    });
    models.recordAgentCliDiagnostic(incompatible);
    expect(models.nativeAgentProfiles().some((profile) => profile.id === "omp")).toBe(false);
    expect(models.ompNativeChatUnavailableReason()).toBe(
      `OMP native chat requires an installed, compatible OMP ${models.SUPPORTED_OMP_ACP_VERSION}`,
    );
    models.recordAgentCliDiagnostic({
      ...incompatible,
      capabilities: { ...incompatible.capabilities, nativeChat: true },
    });
    expect(models.nativeAgentProfile("omp")).toBeNull();

    const compatible = models.diagnosticFromProbe("omp", {
      installed: true,
      versionOutput: `omp ${models.SUPPORTED_OMP_ACP_VERSION}`,
      helpOutput: "acp --no-extensions",
      modelsOutput: "",
      errors: [],
    });
    models.recordAgentCliDiagnostic(compatible);
    expect(models.nativeAgentProfiles().map((profile) => profile.id)).toEqual([
      "claudeCode",
      "codex",
      "omp",
    ]);
    expect(models.nativeChatModel("omp", "openai/gpt-test")).toBe("openai/gpt-test");
    expect(models.ompNativeChatUnavailableReason()).toBeNull();
    expect(models.defaultNativeAgentProvider("omp")).toBe("omp");
    expect(models.launchCommand("omp")).toBe("omp ");

    flags.setFlagOverride("ompPiAgents", false);
    expect(models.nativeAgentProfiles().some((profile) => profile.id === "omp")).toBe(false);
    expect(models.nativeChatModel("omp", "openai/gpt-test")).toBeNull();
    expect(models.launchCommand("omp")).toBe("");
    expect(models.nativeAgentProfile("omp")).toBeNull();
    expect(models.defaultNativeAgentProvider("omp")).toBe("claudeCode");
    expect(models.ompNativeChatUnavailableReason()).toBe(
      "OMP native chat is disabled by the ompPiAgents feature flag",
    );
  });

  it("gates Orchestra menu and persisted default through the reactive native registry", async () => {
    const { flags, models, chatDefaults } = await loadModules();
    flags.setFlagOverride("ompPiAgents", true);
    chatDefaults.setLastAgentProvider("omp");

    expect(chatDefaults.loadLastAgentProvider()).toBe("omp");
    expect(models.nativeAgentProfiles().map(({ id }) => id)).toEqual(["claudeCode", "codex"]);
    expect(
      models.defaultNativeAgentProvider(chatDefaults.loadLastAgentProvider()),
    ).toBe("claudeCode");

    models.recordAgentCliDiagnostic(models.diagnosticFromProbe("omp", {
      installed: true,
      versionOutput: `omp ${models.SUPPORTED_OMP_ACP_VERSION}`,
      helpOutput: "acp --no-extensions",
      modelsOutput: "",
      errors: [],
    }));
    expect(models.nativeAgentProfiles().map(({ id }) => id)).toEqual([
      "claudeCode",
      "codex",
      "omp",
    ]);
    expect(
      models.defaultNativeAgentProvider(chatDefaults.loadLastAgentProvider()),
    ).toBe("omp");

    flags.setFlagOverride("ompPiAgents", false);
    expect(chatDefaults.loadLastAgentProvider()).toBe("claudeCode");
    expect(
      models.defaultNativeAgentProvider(chatDefaults.loadLastAgentProvider()),
    ).toBe("claudeCode");
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

  it("keeps UI profile labels aligned with the backend registry", async () => {
    const { flags, models, backends } = await loadModules();
    flags.setFlagOverride("ompPiAgents", true);

    for (const descriptor of Object.values(backends.AGENT_BACKENDS)) {
      expect(models.agentProfiles().find((profile) => profile.id === descriptor.id)?.label)
        .toBe(descriptor.label);
    }
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

  it("rejects Pi diagnostics that omit the catalog header", async () => {
    const { models } = await loadModules();
    const diagnostic = models.diagnosticFromProbe("pi", {
      installed: true,
      versionOutput: "pi v0.51.3",
      helpOutput: "--provider <provider> --model <model>",
      modelsOutput: "No models available. Configure authentication first.",
      errors: [],
    });

    expect(diagnostic.models).toEqual([]);
    expect(diagnostic.capabilities.dynamicModels).toBe(false);
    expect(diagnostic.errors).toContain("Pi returned an unsupported model catalog");
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
      helpOutput: "--no-extensions  Disable extensions\n--provider=<value>  --profile=<value>\n  acp  Run ACP server",
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
    expect(diagnostic.capabilities.nativeChat).toBe(true);
    expect(diagnostic.errors).toEqual([
      "OMP models unavailable: no enforced offline/cache-only catalog probe",
    ]);
  });
});
