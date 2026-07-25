import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** Real shape captured from `codex debug models --bundled` on codex-cli
 * 0.144.6, trimmed to the fields the parser reads. Includes a "hide"
 * visibility entry (codex-auto-review) to exercise the filter. */
function codexCatalogFixture(): string {
  return JSON.stringify({
    models: [
      {
        slug: "gpt-5.6-sol",
        display_name: "GPT-5.6-Sol",
        description: "Latest frontier agentic coding model.",
        default_reasoning_level: "low",
        supported_reasoning_levels: [
          { effort: "low", description: "Fast responses with lighter reasoning" },
          { effort: "medium", description: "Balances speed and reasoning depth for everyday tasks" },
          { effort: "high", description: "Greater reasoning depth for complex problems" },
          { effort: "xhigh", description: "Extra high reasoning depth for complex problems" },
        ],
        visibility: "list",
        supported_in_api: true,
      },
      {
        slug: "gpt-5.4-mini",
        display_name: "GPT-5.4-Mini",
        default_reasoning_level: "medium",
        supported_reasoning_levels: [
          { effort: "low" },
          { effort: "medium" },
          { effort: "high" },
          { effort: "xhigh" },
        ],
        visibility: "list",
        supported_in_api: true,
      },
      {
        slug: "codex-auto-review",
        display_name: "Codex Auto Review",
        default_reasoning_level: "medium",
        supported_reasoning_levels: [{ effort: "medium" }],
        visibility: "hide",
        supported_in_api: true,
      },
    ],
  });
}

/** `codexCatalogFixture` plus a hypothetical model id not in the curated
 * static table, to exercise the "genuinely new discovery" merge path
 * distinct from ids the curated table already knows about. */
function codexCatalogFixtureWithNovelModel(): string {
  const parsed = JSON.parse(codexCatalogFixture()) as { models: unknown[] };
  parsed.models.push({
    slug: "gpt-5.7-preview",
    display_name: "GPT-5.7 Preview",
    default_reasoning_level: "medium",
    supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
    visibility: "list",
    supported_in_api: true,
  });
  return JSON.stringify(parsed);
}

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

describe("OMP rollout gating and Pi commands", () => {
  it("keeps Pi unconditionally available while OMP is off", async () => {
    const { flags, models, quickLaunch } = await loadModules();
    flags.setFlagOverride("ompAgents", false);

    expect(models.agentProfiles().map((agent) => agent.id)).toEqual([
      ...models.AGENTS.map((agent) => agent.id),
      "pi",
    ]);
    expect(models.launchCommand("claudeCode")).toBe("claude --model claude-haiku-4-5 ");
    expect(models.launchCommand("codex")).toBe("codex --model gpt-5.3-codex-spark ");
    expect(models.launchCommand("omp")).toBe("");
    expect(models.launchBinary("pi")).toBe("pi");
    expect(quickLaunch.quickLaunchItems().map((item) => item.id)).toEqual([
      "agent-claude",
      "agent-codex",
      "tool-flutter-doctor",
      "tool-adb-devices",
    ]);
    expect(quickLaunch.optionalQuickLaunchChoices().map((item) => item.agentId)).toEqual(["pi"]);
  });

  it("uses supported terminal flags without implying deferred MCP wiring", async () => {
    const { flags, models } = await loadModules();
    flags.setFlagOverride("ompAgents", true);

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
    const { models } = await loadModules();
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
    const { models } = await loadModules();
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
    const { models } = await loadModules();
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
      "OMP models unavailable: catalog query failed or returned nothing",
    ]);
  });

  it("parses omp's JSON model catalog into provider/selector options", async () => {
    const { models } = await loadModules();
    const raw = JSON.stringify({
      models: [
        {
          provider: "ollama-cloud",
          id: "cogito-2.1:671b",
          selector: "ollama-cloud/cogito-2.1:671b",
          name: "cogito-2.1:671b",
          contextWindow: 163840,
        },
        {
          provider: "openai-codex",
          id: "gpt-5.4",
          selector: "openai-codex/gpt-5.4",
          name: "GPT-5.4",
          contextWindow: 1000000,
        },
      ],
    });

    expect(models.parseOmpModelCatalog(raw)).toEqual([
      { id: "ollama-cloud/cogito-2.1:671b", label: "cogito-2.1:671b · ollama-cloud" },
      { id: "openai-codex/gpt-5.4", label: "GPT-5.4 · openai-codex" },
    ]);
  });

  it("falls back to the selector as the label when omp omits a model name", async () => {
    const { models } = await loadModules();
    const raw = JSON.stringify({
      models: [
        { provider: "ollama-cloud", id: "m", selector: "ollama-cloud/m" },
      ],
    });

    expect(models.parseOmpModelCatalog(raw)).toEqual([
      { id: "ollama-cloud/m", label: "ollama-cloud/m · ollama-cloud" },
    ]);
  });

  it("dedupes omp catalog entries that share a selector", async () => {
    const { models } = await loadModules();
    const raw = JSON.stringify({
      models: [
        { provider: "ollama-cloud", id: "m", selector: "ollama-cloud/m", name: "M" },
        { provider: "ollama-cloud", id: "m", selector: "ollama-cloud/m", name: "M" },
      ],
    });

    expect(models.parseOmpModelCatalog(raw)).toEqual([
      { id: "ollama-cloud/m", label: "M · ollama-cloud" },
    ]);
  });

  it("returns an empty omp catalog for empty input without throwing", async () => {
    const { models } = await loadModules();
    expect(models.parseOmpModelCatalog("")).toEqual([]);
    expect(models.parseOmpModelCatalog("   ")).toEqual([]);
  });

  it("throws on unparseable non-empty omp catalog output", async () => {
    const { models } = await loadModules();
    expect(() => models.parseOmpModelCatalog("not json")).toThrow(
      "OMP returned an unsupported model catalog",
    );
    expect(() => models.parseOmpModelCatalog(JSON.stringify({ models: "nope" }))).toThrow(
      "OMP returned an unsupported model catalog",
    );
    expect(() => models.parseOmpModelCatalog(JSON.stringify({ models: [] }))).toThrow(
      "OMP returned an unsupported model catalog",
    );
    expect(() => models.parseOmpModelCatalog(JSON.stringify({ models: [{}] }))).toThrow(
      "OMP returned an unsupported model catalog",
    );
  });

  it("populates the omp diagnostic catalog from a successful probe", async () => {
    const { flags, models } = await loadModules();
    flags.setFlagOverride("ompAgents", true);
    const raw = JSON.stringify({
      models: [
        {
          provider: "ollama-cloud",
          id: "cogito-2.1:671b",
          selector: "ollama-cloud/cogito-2.1:671b",
          name: "cogito-2.1:671b",
        },
      ],
    });

    const diagnostic = models.diagnosticFromProbe("omp", {
      installed: true,
      versionOutput: "omp 17.1.1",
      helpOutput: "acp --no-extensions",
      modelsOutput: raw,
      errors: [],
    });

    expect(diagnostic.models).toEqual([
      { id: "ollama-cloud/cogito-2.1:671b", label: "cogito-2.1:671b · ollama-cloud" },
    ]);
    expect(diagnostic.capabilities.dynamicModels).toBe(true);
    expect(diagnostic.errors).toEqual([]);
  });

  it("advises when the omp probe returns output that fails to parse", async () => {
    const { models } = await loadModules();
    const diagnostic = models.diagnosticFromProbe("omp", {
      installed: true,
      versionOutput: "omp 17.1.1",
      helpOutput: "acp --no-extensions",
      modelsOutput: "not json",
      errors: [],
    });

    expect(diagnostic.models).toEqual([]);
    expect(diagnostic.capabilities.dynamicModels).toBe(false);
    expect(diagnostic.errors).toEqual([models.OMP_MODEL_CATALOG_ADVISORY]);
  });

  it("keeps native chat available when only the model-discovery probe step fails (#285)", async () => {
    const { models } = await loadModules();
    const diagnostic = models.diagnosticFromProbe("omp", {
      installed: true,
      versionOutput: "omp 17.1.1",
      helpOutput: "acp --no-extensions",
      modelsOutput: "",
      errors: ["model discovery failed (1): omp exited unexpectedly"],
    });

    expect(diagnostic.capabilities.nativeChat).toBe(true);
    expect(diagnostic.capabilities.dynamicModels).toBe(false);
    expect(diagnostic.errors).toContain(models.OMP_MODEL_CATALOG_ADVISORY);
    expect(diagnostic.errors).toContain("model discovery failed (1): omp exited unexpectedly");
  });

  it("still withholds native chat when a non-catalog probe step fails", async () => {
    const { models } = await loadModules();
    const diagnostic = models.diagnosticFromProbe("omp", {
      installed: true,
      versionOutput: "omp 17.1.1",
      helpOutput: "acp --no-extensions",
      modelsOutput: "",
      errors: ["capability check failed (1): omp exited unexpectedly"],
    });

    expect(diagnostic.capabilities.nativeChat).toBe(false);
  });
});

describe("retired model migration", () => {
  it("migrates a persisted claude-opus-4-8 selection to claude-opus-5", async () => {
    memory.set(
      "pickforge.agentModels",
      JSON.stringify({ claudeCode: "claude-opus-4-8" }),
    );
    const { models } = await loadModules();
    expect(models.loadAgentModels().claudeCode).toBe("claude-opus-5");
  });
});

describe("Codex/Claude auth-presence diagnostics mapping", () => {
  it("reports loading and probe-failure states before any probe result exists", async () => {
    const { models } = await loadModules();

    expect(models.agentAuthFact("codex", true, undefined, undefined)).toMatchObject({
      label: "Checking…",
      intent: "neutral",
    });
    expect(
      models.agentAuthFact("codex", false, "spawn failed: ENOENT", undefined),
    ).toMatchObject({
      label: "Auth status unavailable",
      intent: "error",
      reason: "The local probe failed: spawn failed: ENOENT",
    });
    expect(models.agentAuthFact("claudeCode", false, undefined, undefined)).toMatchObject({
      label: "Not checked",
      intent: "neutral",
    });
  });

  it("surfaces an authenticated probe as connected, never leaking probe internals", async () => {
    const { models } = await loadModules();

    expect(
      models.agentAuthFact("codex", false, undefined, { state: "authenticated" }),
    ).toMatchObject({ label: "Authenticated", intent: "connected" });
    expect(
      models.agentAuthFact("claudeCode", false, undefined, { state: "authenticated" }),
    ).toMatchObject({ label: "Authenticated", intent: "connected" });
  });

  it("gives each CLI its own login hint when not authenticated", async () => {
    const { models } = await loadModules();

    expect(
      models.agentAuthFact("codex", false, undefined, { state: "notAuthenticated" }),
    ).toMatchObject({
      label: "Not authenticated",
      intent: "warning",
      reason: "Run `codex login` to authenticate.",
    });
    expect(
      models.agentAuthFact("claudeCode", false, undefined, { state: "notAuthenticated" }),
    ).toMatchObject({
      label: "Not authenticated",
      intent: "warning",
      reason: "Run `claude auth login` to authenticate.",
    });
  });

  it("explains every unknown-reason honestly instead of guessing a state", async () => {
    const { models } = await loadModules();

    expect(
      models.agentAuthFact("codex", false, undefined, {
        state: "unknown",
        unknownReason: "notInstalled",
      }),
    ).toMatchObject({
      label: "Unknown",
      intent: "neutral",
      reason: "Sign-in status is unknown: the CLI is not installed on PATH.",
    });
    expect(
      models.agentAuthFact("codex", false, undefined, {
        state: "unknown",
        unknownReason: "commandFailed",
      }),
    ).toMatchObject({ reason: "Sign-in status is unknown: the status command failed to run." });
    expect(
      models.agentAuthFact("codex", false, undefined, {
        state: "unknown",
        unknownReason: "timeout",
      }),
    ).toMatchObject({ reason: "Sign-in status is unknown: the status command timed out." });
    expect(
      models.agentAuthFact("codex", false, undefined, {
        state: "unknown",
        unknownReason: "unrecognizedOutput",
      }),
    ).toMatchObject({
      reason: "Sign-in status is unknown: the status command returned an unrecognized result.",
    });
    expect(models.agentAuthFact("codex", false, undefined, { state: "unknown" })).toMatchObject({
      label: "Unknown",
      intent: "neutral",
      reason: "Sign-in status is unknown: sign-in status could not be determined.",
    });
  });
});

describe("parseCodexModelCatalog (#268)", () => {
  it("parses codex debug models --bundled into picker options, filtering hidden entries", async () => {
    const { models } = await loadModules();
    expect(models.parseCodexModelCatalog(codexCatalogFixture())).toEqual([
      {
        id: "gpt-5.6-sol",
        label: "GPT-5.6-Sol",
        efforts: ["low", "medium", "high", "xhigh"],
        defaultEffort: "low",
      },
      {
        id: "gpt-5.4-mini",
        label: "GPT-5.4-Mini",
        efforts: ["low", "medium", "high", "xhigh"],
        defaultEffort: "medium",
      },
    ]);
  });

  it("returns an empty codex catalog for empty input without throwing", async () => {
    const { models } = await loadModules();
    expect(models.parseCodexModelCatalog("")).toEqual([]);
    expect(models.parseCodexModelCatalog("   ")).toEqual([]);
  });

  it("throws on unparseable non-empty codex catalog output", async () => {
    const { models } = await loadModules();
    expect(() => models.parseCodexModelCatalog("not json")).toThrow(
      "Codex returned an unsupported model catalog",
    );
    expect(() => models.parseCodexModelCatalog(JSON.stringify({ models: "nope" }))).toThrow(
      "Codex returned an unsupported model catalog",
    );
    // Every entry filtered out (hidden visibility) still means a non-empty
    // raw response produced nothing usable — that is unsupported, not "no
    // models today".
    expect(() => models.parseCodexModelCatalog(JSON.stringify({
      models: [{ slug: "codex-auto-review", visibility: "hide" }],
    }))).toThrow("Codex returned an unsupported model catalog");
  });

  it("dedupes codex catalog entries that share a slug", async () => {
    const { models } = await loadModules();
    const raw = JSON.stringify({
      models: [
        { slug: "gpt-5.4", display_name: "GPT-5.4", visibility: "list" },
        { slug: "gpt-5.4", display_name: "GPT-5.4", visibility: "list" },
      ],
    });
    expect(models.parseCodexModelCatalog(raw)).toEqual([{ id: "gpt-5.4", label: "GPT-5.4" }]);
  });

  it("falls back to the slug as the label when a display name is missing", async () => {
    const { models } = await loadModules();
    const raw = JSON.stringify({ models: [{ slug: "gpt-5.9", visibility: "list" }] });
    expect(models.parseCodexModelCatalog(raw)).toEqual([{ id: "gpt-5.9", label: "gpt-5.9" }]);
  });
});

describe("mergeModelCatalogs: curated/discovered precedence (#268)", () => {
  it("keeps curated label/effort metadata when a discovered entry shares its id", async () => {
    const { models } = await loadModules();
    const curated = [{
      id: "gpt-5.3-codex-spark",
      label: "GPT-5.3 Codex Spark",
      efforts: ["low", "medium"],
      defaultEffort: "high",
    }];
    const discovered = [{
      id: "gpt-5.3-codex-spark",
      label: "GPT-5.3-Codex-Spark (discovered)",
      efforts: ["low"],
      defaultEffort: "low",
    }];
    expect(models.mergeModelCatalogs("codex", curated, discovered)).toEqual(curated);
  });

  it("appends a discovered-only entry with its own effort metadata when the source provided one", async () => {
    const { models } = await loadModules();
    const curated = [{ id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" }];
    const discovered = [{
      id: "gpt-5.6-sol",
      label: "GPT-5.6-Sol",
      efforts: ["low", "medium", "high"],
      defaultEffort: "low",
    }];
    expect(models.mergeModelCatalogs("codex", curated, discovered)).toEqual([
      ...curated,
      discovered[0],
    ]);
  });

  it("falls back to a generic per-provider effort set for a discovered-only entry with no effort metadata", async () => {
    const { models } = await loadModules();
    const curated = [{ id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" }];
    const discovered = [{ id: "gpt-5.9-preview", label: "GPT-5.9 Preview" }];

    const merged = models.mergeModelCatalogs("codex", curated, discovered);

    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({
      id: "gpt-5.9-preview",
      label: "GPT-5.9 Preview",
      efforts: ["low", "medium", "high", "xhigh"],
      defaultEffort: "medium",
    });
  });

  it("uses Claude's own generic effort set for a discovered-only Claude entry", async () => {
    const { models } = await loadModules();
    const merged = models.mergeModelCatalogs(
      "claudeCode",
      [{ id: "claude-haiku-4-5", label: "Haiku 4.5" }],
      [{ id: "claude-opus-6", label: "Opus 6" }],
    );
    expect(merged[1]).toMatchObject({
      id: "claude-opus-6",
      efforts: ["low", "medium", "high", "max"],
      defaultEffort: "high",
    });
  });

  it("preserves curated order, then appends discovered-only entries in catalog order", async () => {
    const { models } = await loadModules();
    const curated = [{ id: "a", label: "A" }, { id: "b", label: "B" }];
    const discovered = [
      { id: "c", label: "C" },
      { id: "a", label: "A (stale discovery)" },
      { id: "d", label: "D" },
    ];
    expect(models.mergeModelCatalogs("codex", curated, discovered).map((m) => m.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("is a no-op merge when discovery finds nothing", async () => {
    const { models } = await loadModules();
    const curated = [{ id: "a", label: "A" }];
    expect(models.mergeModelCatalogs("codex", curated, [])).toEqual(curated);
  });
});

describe("discoverCodexModels: probe-failure fallback and TTL cache (#268)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    const process = await import("../../src/lib/process");
    vi.mocked(process.probeAgentCli).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges a genuinely new discovered model into agentProfiles()'s codex list without displacing curated entries", async () => {
    const { models } = await loadModules();
    const process = await import("../../src/lib/process");
    vi.mocked(process.probeAgentCli).mockResolvedValue({
      installed: true,
      versionOutput: "codex-cli 0.144.6",
      helpOutput: "",
      modelsOutput: codexCatalogFixtureWithNovelModel(),
      errors: [],
    });

    const codexBefore = models.agentProfiles().find((agent) => agent.id === "codex")!;
    expect(codexBefore.models.some((m) => m.id === "gpt-5.7-preview")).toBe(false);

    await models.discoverCodexModels();

    const codexAfter = models.agentProfiles().find((agent) => agent.id === "codex")!;
    expect(codexAfter.models.some((m) => m.id === "gpt-5.7-preview")).toBe(true);
    // Curated entries (e.g. the dogfood default) are never displaced.
    expect(codexAfter.models.some((m) => m.id === "gpt-5.3-codex-spark")).toBe(true);
    expect(codexAfter.defaultModel).toBe("gpt-5.3-codex-spark");
  });

  it("falls back to the static curated table (never an empty picker) when the probe rejects", async () => {
    const { models } = await loadModules();
    const process = await import("../../src/lib/process");
    vi.mocked(process.probeAgentCli).mockRejectedValue(new Error("codex: command not found"));

    await expect(models.discoverCodexModels()).resolves.toEqual([]);

    const codex = models.agentProfiles().find((agent) => agent.id === "codex")!;
    expect(codex.models.length).toBeGreaterThan(0);
    expect(codex.models).toEqual(models.AGENTS.find((a) => a.id === "codex")!.models);
  });

  it("falls back to the static curated table when the probe returns an unparseable catalog", async () => {
    const { models } = await loadModules();
    const process = await import("../../src/lib/process");
    vi.mocked(process.probeAgentCli).mockResolvedValue({
      installed: true,
      versionOutput: "codex-cli 0.144.6",
      helpOutput: "",
      modelsOutput: "not json",
      errors: [],
    });

    await models.discoverCodexModels();

    const codex = models.agentProfiles().find((agent) => agent.id === "codex")!;
    expect(codex.models).toEqual(models.AGENTS.find((a) => a.id === "codex")!.models);
  });

  it("falls back to the static curated table when codex is not installed", async () => {
    const { models } = await loadModules();
    const process = await import("../../src/lib/process");
    vi.mocked(process.probeAgentCli).mockResolvedValue({
      installed: false,
      versionOutput: "",
      helpOutput: "",
      modelsOutput: "",
      errors: [],
    });

    await models.discoverCodexModels();

    const codex = models.agentProfiles().find((agent) => agent.id === "codex")!;
    expect(codex.models).toEqual(models.AGENTS.find((a) => a.id === "codex")!.models);
  });

  it("session-caches a successful discovery for a short TTL, without re-probing", async () => {
    const { models } = await loadModules();
    const process = await import("../../src/lib/process");
    const probe = vi.mocked(process.probeAgentCli).mockResolvedValue({
      installed: true,
      versionOutput: "codex-cli 0.144.6",
      helpOutput: "",
      modelsOutput: codexCatalogFixtureWithNovelModel(),
      errors: [],
    });

    await models.discoverCodexModels();
    expect(probe).toHaveBeenCalledTimes(1);

    await models.discoverCodexModels();
    expect(probe).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6 * 60 * 1000);
    await models.discoverCodexModels();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("bypasses the TTL cache when force is requested", async () => {
    const { models } = await loadModules();
    const process = await import("../../src/lib/process");
    const probe = vi.mocked(process.probeAgentCli).mockResolvedValue({
      installed: true,
      versionOutput: "codex-cli 0.144.6",
      helpOutput: "",
      modelsOutput: codexCatalogFixtureWithNovelModel(),
      errors: [],
    });

    await models.discoverCodexModels();
    expect(probe).toHaveBeenCalledTimes(1);

    await models.discoverCodexModels(true);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
