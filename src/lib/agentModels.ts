import { createSignal } from "solid-js";
// Agent profiles + per-agent model selection. Ports agent_model_settings.dart
// (Claude→Haiku, Codex→GPT-5.3 Codex Spark defaults). Selection persists in
// localStorage (global, like the Flutter SharedPreferences store).
import { flagEnabled } from "../stores/flags";
import { errorText } from "./errors";
import { probeAgentCli, type AgentCliProbe } from "./process";
import {
  AGENT_BACKENDS,
  isCompatiblePiRpcVersion,
  isNativeAgentProvider,
} from "./agentBackends";

export interface AgentModelOption {
  id: string;
  label: string;
  terminalOnly?: boolean;
  launch?: {
    binary: string;
    argsBeforeModel: string[];
  };
  /** Effort levels the model accepts; absent/empty = no effort control. */
  efforts?: string[];
  /** Effort applied when none is selected (the model's own default). */
  defaultEffort?: string;
}

export interface AgentProfile {
  id: string;
  label: string;
  binary: string;
  defaultModel: string | null;
  models: AgentModelOption[];
  /** This profile launches in a terminal; it is not a native chat backend. */
  terminalOnly?: boolean;
}

export interface AgentLaunchContext {
  mcpConfigPath?: string | null;
  mcpCommand?: string | null;
  agentBrief?: string | null;
}

const CLAUDE_EFFORTS = ["low", "medium", "high", "max"];
const CLAUDE_EFFORTS_XHIGH = ["low", "medium", "high", "xhigh", "max"];
const CODEX_EFFORTS = ["low", "medium", "high", "xhigh"];

export const AGENTS: AgentProfile[] = [
  {
    id: "claudeCode",
    label: AGENT_BACKENDS.claudeCode.label,
    binary: "claude",
    defaultModel: "claude-haiku-4-5",
    models: [
      { id: "claude-haiku-4-5", label: "Haiku 4.5" },
      {
        id: "claude-sonnet-4-6",
        label: "Sonnet 4.6",
        efforts: CLAUDE_EFFORTS,
        defaultEffort: "high",
      },
      {
        id: "claude-sonnet-5",
        label: "Sonnet 5",
        efforts: CLAUDE_EFFORTS_XHIGH,
        defaultEffort: "high",
      },
      {
        id: "claude-opus-4-8",
        label: "Opus 4.8",
        efforts: CLAUDE_EFFORTS_XHIGH,
        defaultEffort: "high",
      },
      {
        id: "claude-fable-5",
        label: "Fable 5",
        efforts: CLAUDE_EFFORTS_XHIGH,
        defaultEffort: "high",
      },
      {
        id: "glm-5.2:cloud",
        label: "GLM-5.2 Cloud (Ollama)",
        terminalOnly: true,
        launch: { binary: "ollama", argsBeforeModel: ["launch", "claude", "--model"] },
      },
    ],
  },
  {
    id: "codex",
    label: AGENT_BACKENDS.codex.label,
    binary: "codex",
    defaultModel: "gpt-5.3-codex-spark",
    models: [
      {
        id: "gpt-5.3-codex-spark",
        label: "GPT-5.3 Codex Spark",
        efforts: CODEX_EFFORTS,
        defaultEffort: "high",
      },
      {
        id: "gpt-5.4-mini",
        label: "GPT-5.4 Mini",
        efforts: CODEX_EFFORTS,
        defaultEffort: "medium",
      },
      { id: "gpt-5.4", label: "GPT-5.4", efforts: CODEX_EFFORTS, defaultEffort: "medium" },
      { id: "gpt-5.5", label: "GPT-5.5", efforts: CODEX_EFFORTS, defaultEffort: "medium" },
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", efforts: CODEX_EFFORTS, defaultEffort: "medium" },
      {
        id: "glm-5.2:cloud",
        label: "GLM-5.2 Cloud (Ollama)",
        terminalOnly: true,
        launch: { binary: "ollama", argsBeforeModel: ["launch", "codex", "--model"] },
      },
    ],
  },
  { id: "opencode", label: "OpenCode", binary: "opencode", defaultModel: null, models: [] },
  { id: "cursor", label: "Cursor", binary: "cursor-agent", defaultModel: null, models: [] },
  { id: "gemini", label: "Gemini", binary: "gemini", defaultModel: null, models: [] },
];

const OMP_AGENTS: AgentProfile[] = [
  {
    id: "omp",
    label: AGENT_BACKENDS.omp.label,
    binary: "omp",
    defaultModel: null,
    models: [],
  },
];

const PI_AGENTS: AgentProfile[] = [
  {
    id: "pi",
    label: AGENT_BACKENDS.pi.label,
    binary: "pi",
    defaultModel: null,
    models: [],
    terminalOnly: true,
  },
];

/** Profiles exposed by the current build flags. The base AGENTS export remains
 * stable for native-chat callers, which only support Claude and Codex. */
export function agentProfiles(): AgentProfile[] {
  return [
    ...AGENTS,
    ...(flagEnabled("ompAgents") ? OMP_AGENTS : []),
    ...PI_AGENTS,
  ];
}

function profileForAgent(agentId: string): AgentProfile | undefined {
  return agentProfiles().find((agent) => agent.id === agentId);
}

export interface AgentCliCapabilities {
  terminal: boolean;
  dynamicModels: boolean;
  profiles: boolean;
  providerSelection: boolean;
  nativeChat: boolean;
}

export interface AgentCliDiagnostic {
  agentId: "omp" | "pi";
  installed: boolean;
  version: string | null;
  models: AgentModelOption[];
  capabilities: AgentCliCapabilities;
  errors: string[];
}

export const OMP_ACP_VERSION_RANGE = ">=17.1.1 and <18.0.0";
export const OMP_MODEL_CATALOG_ADVISORY =
  "OMP models unavailable: no enforced offline/cache-only catalog probe";
export type OmpNativeCompatibility = "unprobed" | "probing" | "compatible" | "incompatible";
const [ompNativeCompatibility, setOmpNativeCompatibility] =
  createSignal<OmpNativeCompatibility>("unprobed");
export type PiNativeCompatibility = "unprobed" | "probing" | "compatible" | "incompatible";
const [piNativeCompatibility, setPiNativeCompatibility] =
  createSignal<PiNativeCompatibility>("unprobed");

export function isCompatibleOmpAcpVersion(version: string | null | undefined): boolean {
  if (!version) return false;
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return major === 17 && (minor > 1 || (minor === 1 && patch >= 1));
}

export function isCompatibleOmpAcpProbe(probe: AgentCliDiagnostic): boolean {
  return probe.agentId === "omp"
    && probe.installed
    && isCompatibleOmpAcpVersion(probe.version)
    && probe.capabilities.nativeChat;
}

export function recordAgentCliDiagnostic(diagnostic: AgentCliDiagnostic) {
  if (diagnostic.agentId === "omp") {
    setOmpNativeCompatibility(
      isCompatibleOmpAcpProbe(diagnostic) ? "compatible" : "incompatible",
    );
  }
  if (diagnostic.agentId === "pi") {
    setPiNativeCompatibility(
      diagnostic.installed
        && isCompatiblePiRpcVersion(diagnostic.version)
        && diagnostic.capabilities.nativeChat
        ? "compatible"
        : "incompatible",
    );
  }
}

export function ompNativeChatAvailable(): boolean {
  return flagEnabled("ompAgents") && ompNativeCompatibility() === "compatible";
}

export function isOmpNativeCompatibilityPending(): boolean {
  if (!flagEnabled("ompAgents")) return false;
  const compatibility = ompNativeCompatibility();
  return compatibility === "unprobed" || compatibility === "probing";
}

export function ompNativeChatUnavailableReason(): string | null {
  if (!flagEnabled("ompAgents")) {
    return "OMP native chat is disabled by the ompAgents feature flag";
  }
  switch (ompNativeCompatibility()) {
    case "compatible":
      return null;
    case "incompatible":
      return `OMP native chat requires an installed OMP ${OMP_ACP_VERSION_RANGE}`;
    case "unprobed":
    case "probing":
      return `Checking for compatible OMP ${OMP_ACP_VERSION_RANGE}`;
  }
}

let ompCompatibilityProbe: Promise<boolean> | null = null;

export function ensureOmpNativeCompatibility(force = false): Promise<boolean> {
  if (!flagEnabled("ompAgents")) return Promise.resolve(false);
  if (!force && ompNativeCompatibility() === "compatible") return Promise.resolve(true);
  if (!force && ompCompatibilityProbe) return ompCompatibilityProbe;
  setOmpNativeCompatibility("probing");
  ompCompatibilityProbe = discoverAgentCli("omp")
    .then((diagnostic) => isCompatibleOmpAcpProbe(diagnostic))
    .catch(() => {
      setOmpNativeCompatibility("incompatible");
      return false;
    })
    .finally(() => {
      ompCompatibilityProbe = null;
    });
  return ompCompatibilityProbe;
}

export function piNativeChatAvailable(): boolean {
  return piNativeCompatibility() === "compatible";
}

export function isPiNativeCompatibilityPending(): boolean {
  const compatibility = piNativeCompatibility();
  return compatibility === "unprobed" || compatibility === "probing";
}

export function piNativeChatUnavailableReason(): string | null {
  switch (piNativeCompatibility()) {
    case "compatible":
      return null;
    case "incompatible":
      return "Pi native chat requires an installed, compatible Pi >=0.79.10 and <0.82.0";
    case "unprobed":
    case "probing":
      return "Checking for compatible Pi >=0.79.10 and <0.82.0";
  }
}

let piCompatibilityProbe: Promise<boolean> | null = null;

export function ensurePiNativeCompatibility(force = false): Promise<boolean> {
  if (!force && piNativeCompatibility() === "compatible") return Promise.resolve(true);
  if (!force && piCompatibilityProbe) return piCompatibilityProbe;
  setPiNativeCompatibility("probing");
  piCompatibilityProbe = discoverAgentCli("pi")
    .then((diagnostic) => (
      diagnostic.installed
      && isCompatiblePiRpcVersion(diagnostic.version)
      && diagnostic.capabilities.nativeChat
    ))
    .catch(() => {
      setPiNativeCompatibility("incompatible");
      return false;
    })
    .finally(() => {
      piCompatibilityProbe = null;
    });
  return piCompatibilityProbe;
}

export type NativeAgentProfile = AgentProfile & {
  id: "claudeCode" | "codex" | "omp" | "pi";
};

export function nativeAgentProfiles(): NativeAgentProfile[] {
  return agentProfiles().filter(
    (agent): agent is NativeAgentProfile =>
      isNativeAgentProvider(agent.id)
      && (agent.id !== "omp" || ompNativeChatAvailable())
      && (agent.id !== "pi" || piNativeChatAvailable()),
  );
}

export function nativeAgentProfile(provider: string): NativeAgentProfile | null {
  return nativeAgentProfiles().find((profile) => profile.id === provider) ?? null;
}

export function defaultNativeAgentProvider(
  preferred: string,
): NativeAgentProfile["id"] {
  return nativeAgentProfile(preferred)?.id ?? nativeAgentProfiles()[0].id;
}


function uniqueModels(models: AgentModelOption[]): AgentModelOption[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

/** Attach a probe-owned catalog to the profile rendered by reactive pickers. */
export function profileWithDiscoveredModels<T extends AgentProfile>(
  profile: T,
  models: AgentModelOption[],
): T {
  return { ...profile, models: uniqueModels(models) };
}


/** Parse the stable whitespace table emitted by `pi --list-models`. */
export function parsePiModelCatalog(raw: string): AgentModelOption[] {
  const models: AgentModelOption[] = [];
  let sawHeader = false;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^\s*provider\s+model\s+/i.test(line)) {
      sawHeader = true;
      continue;
    }
    if (!sawHeader) continue;
    const match = line.match(/^\s*(\S+)\s+(\S+)\s+/);
    if (!match) continue;
    const provider = match[1];
    const model = match[2];
    models.push({
      id: `${provider}/${model}`,
      label: `${model} · ${provider}`,
    });
  }
  if (models.length === 0 && raw.trim()) {
    throw new Error("Pi returned an unsupported model catalog");
  }
  return uniqueModels(models);
}

function versionFromOutput(raw: string): string | null {
  return raw.match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/)?.[1] ?? null;
}

/** Convert the native probe into UI-safe diagnostics. Exported as the pure test
 * seam for malformed output and partial-command failures. */
// eslint-disable-next-line complexity -- TODO(#263): reduce legacy function complexity.
export function diagnosticFromProbe(
  agentId: "omp" | "pi",
  probe: AgentCliProbe,
): AgentCliDiagnostic {
  const errors = [...probe.errors];
  const version = versionFromOutput(probe.versionOutput);
  if (probe.installed && probe.versionOutput.trim() && !version) {
    errors.push("Version output was not recognized");
  }

  let models: AgentModelOption[] = [];
  if (agentId === "omp" && probe.installed) {
    errors.push(OMP_MODEL_CATALOG_ADVISORY);
  } else if (probe.installed && probe.modelsOutput.trim()) {
    try {
      models = parsePiModelCatalog(probe.modelsOutput);
    } catch (error) {
      errors.push(errorText(error));
    }
  }

  const help = probe.helpOutput;
  const installed = probe.installed;
  return {
    agentId,
    installed,
    version,
    models,
    capabilities: {
      terminal: installed,
      dynamicModels: installed && models.length > 0,
      profiles: installed && /--profile(?:=|\s|<)/.test(help),
      providerSelection: installed && /--provider(?:=|\s|<)/.test(help),
      nativeChat: installed
        && probe.errors.length === 0
        && (
          (agentId === "omp"
            && isCompatibleOmpAcpVersion(version)
            && /\bacp\b/.test(help)
            && /--no-extensions(?:\s|$|,)/.test(help))
          || (agentId === "pi" && isCompatiblePiRpcVersion(version))
        ),
    },
    errors,
  };
}

export async function discoverAgentCli(
  agentId: "omp" | "pi",
  probe: (id: "omp" | "pi") => Promise<AgentCliProbe> = probeAgentCli,
): Promise<AgentCliDiagnostic> {
  const diagnostic = diagnosticFromProbe(agentId, await probe(agentId));
  recordAgentCliDiagnostic(diagnostic);
  return diagnostic;
}

const STORE_KEY = "pickforge.agentModels";

function defaults(): Record<string, string | null> {
  return Object.fromEntries(agentProfiles().map((a) => [a.id, a.defaultModel]));
}

export function loadAgentModels(): Record<string, string | null> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
    return { ...defaults(), ...saved };
  } catch {
    return defaults();
  }
}

export function setAgentModel(agentId: string, model: string | null) {
  const current = loadAgentModels();
  current[agentId] = model;
  localStorage.setItem(STORE_KEY, JSON.stringify(current));
}

function selectedModelOption(agentId: string): AgentModelOption | undefined {
  return modelOption(agentId, loadAgentModels()[agentId]);
}

/** The catalog entry for a model (falls back to the agent's default model). */
export function modelOption(
  agentId: string,
  modelId: string | null,
): AgentModelOption | undefined {
  const agent = profileForAgent(agentId);
  if (!agent) return undefined;
  const id = modelId ?? agent.defaultModel;
  return agent.models.find((m) => m.id === id);
}

// Per-agent effort selection, persisted like the model selection. An empty
// string means "provider default" (no explicit effort is sent).
const EFFORT_STORE_KEY = "pickforge.agentEfforts";

export function loadAgentEfforts(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(EFFORT_STORE_KEY) ?? "{}");
    return typeof saved === "object" && saved !== null ? saved : {};
  } catch {
    return {};
  }
}

export function setAgentEffort(agentId: string, effort: string) {
  const current = loadAgentEfforts();
  current[agentId] = effort;
  localStorage.setItem(EFFORT_STORE_KEY, JSON.stringify(current));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : shellQuote(value);
}

/** The shell command to launch an agent, pinned to its selected model. */
export function launchCommand(agentId: string, context: AgentLaunchContext = {}): string {
  const agent = profileForAgent(agentId);
  if (!agent) return "";
  const model = loadAgentModels()[agentId];
  const option = selectedModelOption(agentId);
  if (model && option?.launch) {
    return `${option.launch.binary} ${option.launch.argsBeforeModel.join(" ")} ${model} `;
  }
  const safeModel = agent.id === "omp" || agent.id === "pi"
    ? model && shellArgument(model)
    : model;
  const modelArg = safeModel ? `--model ${safeModel} ` : "";
  if (agent.id === "claudeCode") {
    const mcpArg = context.mcpConfigPath
      ? `--mcp-config ${shellQuote(context.mcpConfigPath)} `
      : "";
    const briefArg = context.agentBrief
      ? `--append-system-prompt ${shellQuote(context.agentBrief)} `
      : "";
    return `${agent.binary} ${mcpArg}${briefArg}${modelArg}`;
  }
  if (agent.id === "codex") {
    const mcpArgs = context.mcpCommand
      ? `-c ${shellQuote(`mcp_servers.pickforge.command=${JSON.stringify(context.mcpCommand)}`)} -c 'mcp_servers.pickforge.args=[]' `
      : "";
    return `${agent.binary} ${mcpArgs}${modelArg}`;
  }
  return `${agent.binary} ${modelArg}`;
}

export function launchBinary(agentId: string): string | null {
  const option = selectedModelOption(agentId);
  if (option?.launch) return option.launch.binary;
  return profileForAgent(agentId)?.binary ?? null;
}

let foreignStaticModelIdsCache: Map<string, Set<string>> | undefined;

/** Model ids that belong to another agent's static catalog (Claude/Codex) and
 * are NOT also present in `agentId`'s own catalog. `modelOption` can only
 * validate against a profile's own static catalog, so it is a no-op for
 * providers whose catalog is discovered at runtime (Pi, OMP) — this closes
 * that gap by rejecting ids that are unambiguously another provider's,
 * guarding against a stale/misrouted id bleeding across providers in the
 * composer's model label. A few ids (e.g. "glm-5.2:cloud") are intentionally
 * shared across catalogs, so ownership of the id by the agent's own catalog
 * always wins over the foreign-set rejection. */
function foreignStaticModelIds(agentId: string): Set<string> {
  if (!foreignStaticModelIdsCache) {
    foreignStaticModelIdsCache = new Map();
  }
  let ids = foreignStaticModelIdsCache.get(agentId);
  if (!ids) {
    const ownIds = new Set(profileForAgent(agentId)?.models.map((option) => option.id) ?? []);
    ids = new Set<string>();
    for (const agent of AGENTS) {
      if (agent.id === agentId) continue;
      for (const option of agent.models) {
        if (!ownIds.has(option.id)) ids.add(option.id);
      }
    }
    foreignStaticModelIdsCache.set(agentId, ids);
  }
  return ids;
}

export function nativeChatModel(agentId: string, modelId: string | null): string | null {
  if (!isNativeAgentProvider(agentId) || (agentId === "omp" && !ompNativeChatAvailable())) {
    return null;
  }
  if (modelId && foreignStaticModelIds(agentId).has(modelId)) return null;
  const option = modelOption(agentId, modelId);
  return option?.terminalOnly ? null : modelId;
}
