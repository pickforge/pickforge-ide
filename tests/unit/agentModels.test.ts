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
    const { flags, models, quickLaunch } = await loadModules();
    // piAgents ships default-on; this test pins the explicit opt-out state.
    flags.setFlagOverride("piAgents", false);

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
    flags.setFlagOverride("ompAgents", true);
    flags.setFlagOverride("piAgents", true);

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

  it("selects OMP native chat only after a compatible bounded-range probe", async () => {
    const { flags, models } = await loadModules();
    flags.setFlagOverride("ompAgents", true);

    expect(models.ompNativeChatUnavailableReason()).toBe(
      `Checking for compatible OMP ${models.OMP_ACP_VERSION_RANGE}`,
    );
    expect(models.isOmpNativeCompatibilityPending()).toBe(true);
    expect(models.defaultNativeAgentProvider("omp")).toBe("claudeCode");

    expect(models.nativeAgentProfiles().map((profile) => profile.id)).toEqual([
      "claudeCode",
      "codex",
    ]);
    expect(models.nativeChatModel("omp", "openai/gpt-test")).toBeNull();

    const incompatible = models.diagnosticFromProbe("omp", {
      installed: true,
      versionOutput: "omp 17.1.0",
      helpOutput: "acp --no-extensions",
      modelsOutput: "",
      errors: [],
    });
    models.recordAgentCliDiagnostic(incompatible);
    expect(models.nativeAgentProfiles().some((profile) => profile.id === "omp")).toBe(false);
    expect(models.ompNativeChatUnavailableReason()).toBe(
      `OMP native chat requires an installed OMP ${models.OMP_ACP_VERSION_RANGE}`,
    );
    expect(models.isOmpNativeCompatibilityPending()).toBe(false);
    models.recordAgentCliDiagnostic({
      ...incompatible,
      capabilities: { ...incompatible.capabilities, nativeChat: true },
    });
    expect(models.nativeAgentProfile("omp")).toBeNull();

    const compatible = models.diagnosticFromProbe("omp", {
      installed: true,
      versionOutput: "omp 17.1.1",
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
    expect(models.isOmpNativeCompatibilityPending()).toBe(false);
    expect(models.defaultNativeAgentProvider("omp")).toBe("omp");
    expect(models.launchCommand("omp")).toBe("omp ");

    flags.setFlagOverride("ompAgents", false);
    expect(models.nativeAgentProfiles().some((profile) => profile.id === "omp")).toBe(false);
    expect(models.nativeChatModel("omp", "openai/gpt-test")).toBeNull();
    expect(models.launchCommand("omp")).toBe("");
    expect(models.nativeAgentProfile("omp")).toBeNull();
    expect(models.defaultNativeAgentProvider("omp")).toBe("claudeCode");
    expect(models.ompNativeChatUnavailableReason()).toBe(
      "OMP native chat is disabled by the ompAgents feature flag",
    );
    expect(models.isOmpNativeCompatibilityPending()).toBe(false);
  });

  it("gates Orchestra menu and persisted default through the reactive native registry", async () => {
    const { flags, models, chatDefaults } = await loadModules();
    flags.setFlagOverride("ompAgents", true);
    chatDefaults.setLastAgentProvider("omp");

    expect(chatDefaults.loadLastAgentProvider()).toBe("omp");
    expect(models.nativeAgentProfiles().map(({ id }) => id)).toEqual(["claudeCode", "codex"]);
    expect(
      models.defaultNativeAgentProvider(chatDefaults.loadLastAgentProvider()),
    ).toBe("claudeCode");

    models.recordAgentCliDiagnostic(models.diagnosticFromProbe("omp", {
      installed: true,
      versionOutput: "omp 17.1.1",
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

    flags.setFlagOverride("ompAgents", false);
    expect(chatDefaults.loadLastAgentProvider()).toBe("claudeCode");
    expect(
      models.defaultNativeAgentProvider(chatDefaults.loadLastAgentProvider()),
    ).toBe("claudeCode");
  });

  it("accepts only the certified OMP ACP version range", async () => {
    const { models } = await loadModules();

    for (const version of ["17.1.1", "17.999.999", "17.2.0-rc.1+build"]) {
      expect(models.isCompatibleOmpAcpVersion(version), version).toBe(true);
    }
    for (const version of ["17.1.0", "18.0.0", "18.0.0-rc.1", "16.4.8"]) {
      expect(models.isCompatibleOmpAcpVersion(version), version).toBe(false);
    }
  });

  it("offers optional chips without changing defaults or duplicating an agent", async () => {
    const { flags, quickLaunch } = await loadModules();
    flags.setFlagOverride("ompAgents", true);
    flags.setFlagOverride("piAgents", true);

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

    flags.setFlagOverride("ompAgents", false);
    expect(quickLaunch.quickLaunchItems().some((item) => item.agentId === "omp")).toBe(false);
    expect(quickLaunch.allQuickLaunchItems().some((item) => item.agentId === "omp")).toBe(true);
    flags.setFlagOverride("ompAgents", true);
    expect(quickLaunch.quickLaunchItems().some((item) => item.agentId === "omp")).toBe(true);
  });

  it("keeps UI profile labels aligned with the backend registry", async () => {
    const { flags, models, backends } = await loadModules();
    flags.setFlagOverride("ompAgents", true);
    flags.setFlagOverride("piAgents", true);

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
      { id: "anthropic/claude-sonnet-4-6", label: "claude-sonnet-4-6 · anthropic" },
      { id: "openai-codex/gpt-5.5", label: "gpt-5.5 · openai-codex" },
    ]);
  });

  it("attaches Pi probe models to the native picker and preserves provider/model selection", async () => {
    const { flags, models } = await loadModules();
    flags.setFlagOverride("piAgents", true);
    expect(models.isPiNativeCompatibilityPending()).toBe(true);
    models.recordAgentCliDiagnostic(models.diagnosticFromProbe("pi", {
      installed: true,
      versionOutput: "pi 0.79.10",
      helpOutput: "",
      modelsOutput: [
        "provider model context max-out thinking images",
        "openai-codex gpt-5.5 272K 128K yes yes",
      ].join("\n"),
      errors: [],
    }));
    expect(models.isPiNativeCompatibilityPending()).toBe(false);
    const pi = models.agentProfiles().find((profile) => profile.id === "pi");
    expect(pi).toBeDefined();
    const catalog = [
      { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "openai-codex/gpt-5.5", label: "GPT-5.5" },
    ];

    const nativeProfile = models.profileWithDiscoveredModels(pi!, catalog);
    expect(nativeProfile.models).toEqual(catalog);
    expect(nativeProfile.defaultModel).toBeNull();

    models.setAgentModel("pi", catalog[1].id);
    expect(models.loadAgentModels().pi).toBe("openai-codex/gpt-5.5");
    expect(models.nativeChatModel("pi", catalog[1].id)).toBe("openai-codex/gpt-5.5");
  });

  it("rejects a bare Claude/Codex catalog id bleeding into Pi's model slot (#272)", async () => {
    const { flags, models } = await loadModules();
    flags.setFlagOverride("piAgents", true);
    models.recordAgentCliDiagnostic(models.diagnosticFromProbe("pi", {
      installed: true,
      versionOutput: "pi 0.79.10",
      helpOutput: "",
      modelsOutput: [
        "provider model context max-out thinking images",
        "openai-codex gpt-5.6-sol 272K 128K yes yes",
      ].join("\n"),
      errors: [],
    }));

    // A Codex-shaped bare id (no "provider/model" prefix) is unambiguously
    // another provider's catalog entry, even though it happens to share
    // wording with a legitimate Pi-discovered "openai-codex/..." selector.
    expect(models.nativeChatModel("pi", "gpt-5.6-sol")).toBeNull();
    expect(models.nativeChatModel("pi", "claude-sonnet-5")).toBeNull();
    // The Pi-shaped selector for the same underlying model stays valid.
    expect(models.nativeChatModel("pi", "openai-codex/gpt-5.6-sol")).toBe(
      "openai-codex/gpt-5.6-sol",
    );
  });

  it("gives an agent's own catalog membership priority over foreign-id rejection", async () => {
    const { flags, models } = await loadModules();
    flags.setFlagOverride("piAgents", true);
    models.recordAgentCliDiagnostic(models.diagnosticFromProbe("pi", {
      installed: true,
      versionOutput: "pi 0.79.10",
      helpOutput: "",
      modelsOutput: [
        "provider model context max-out thinking images",
        "openai-codex gpt-5.6-sol 272K 128K yes yes",
      ].join("\n"),
      errors: [],
    }));

    // "glm-5.2:cloud" is a real id shared by BOTH claudeCode's and codex's
    // static catalogs today, but it is terminal-only in both, so it alone
    // can't distinguish "rejected as foreign" from "rejected as terminal
    // -only" through the public nativeChatModel API. Simulate the general
    // case a shared, natively-selectable id would hit: own-catalog
    // membership must win over foreign-id rejection, not be short-circuited
    // by it.
    const claudeCode = models.AGENTS.find((agent) => agent.id === "claudeCode")!;
    const codex = models.AGENTS.find((agent) => agent.id === "codex")!;
    claudeCode.models.push({ id: "shared-native-model", label: "Shared" });
    codex.models.push({ id: "shared-native-model", label: "Shared" });

    expect(models.nativeChatModel("claudeCode", "shared-native-model")).toBe(
      "shared-native-model",
    );
    expect(models.nativeChatModel("codex", "shared-native-model")).toBe("shared-native-model");
    // A truly foreign, provider-exclusive id is still rejected under Pi.
    expect(models.nativeChatModel("pi", "gpt-5.6-sol")).toBeNull();
    // The real terminal-only shared id keeps being excluded by that gate,
    // independent of the foreign-id check.
    expect(models.nativeChatModel("claudeCode", "glm-5.2:cloud")).toBeNull();
    expect(models.nativeChatModel("codex", "glm-5.2:cloud")).toBeNull();
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

  it("distinguishes OMP 17.1.1 root help from launch-subcommand help", async () => {
    const { flags, models } = await loadModules();
    flags.setFlagOverride("ompAgents", true);
    const rootHelp = [
      "Usage: omp [options] [command] [prompt...]",
      "      --no-extensions                 Disable extension discovery",
      "  acp           Run Oh My Pi as an ACP (Agent Client Protocol) server over stdio",
    ].join("\n");
    const launchHelp = [
      "Usage: omp [options] [prompt...]",
      "      --no-extensions                 Disable extension discovery",
    ].join("\n");

    const compatible = models.diagnosticFromProbe("omp", {
      installed: true,
      versionOutput: "omp 17.1.1",
      helpOutput: rootHelp,
      modelsOutput: "",
      errors: [],
    });
    const launchOnly = models.diagnosticFromProbe("omp", {
      installed: true,
      versionOutput: "omp 17.1.1",
      helpOutput: launchHelp,
      modelsOutput: "",
      errors: [],
    });

    expect(compatible.capabilities.nativeChat).toBe(true);
    expect(launchOnly.capabilities.nativeChat).toBe(false);
    models.recordAgentCliDiagnostic(launchOnly);
    expect(models.ompNativeChatUnavailableReason()).toBe(
      `OMP native chat requires an installed OMP ${models.OMP_ACP_VERSION_RANGE}`,
    );
  });

  it("reports OMP models unavailable without parsing an online-capable catalog", async () => {
    const { models } = await loadModules();
    const diagnostic = models.diagnosticFromProbe("omp", {
      installed: true,
      versionOutput: "omp v17.2.0-rc.1+build",
      helpOutput: "--no-extensions  Disable extensions\n--provider=<value>  --profile=<value>\n  acp  Run ACP server",
      modelsOutput: "",
      errors: [],
    });

    expect(diagnostic.version).toBe("17.2.0-rc.1+build");
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
