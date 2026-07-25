import { createSignal } from "solid-js";
// Agent profiles + per-agent model selection. Ports agent_model_settings.dart
// (Claude→Haiku, Codex→GPT-5.3 Codex Spark defaults). Selection persists in
// localStorage (global, like the Flutter SharedPreferences store).
import { flagEnabled } from "../stores/flags";
import { errorText } from "./errors";
import {
  probeAgentCli,
  type AgentAuthProbe,
  type AgentCliProbe,
  type AuthPresenceUnknownReason,
} from "./process";
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
        id: "claude-opus-5",
        label: "Opus 5",
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
 * stable for native-chat callers, which only support Claude and Codex.
 * Codex's models are the curated static table merged with whatever
 * `discoverCodexModels` has found this session (see below) — every caller of
 * `agentProfiles()` (the Settings picker, quick-launch, effort lookups) sees
 * one merged list. */
export function agentProfiles(): AgentProfile[] {
  return [
    ...AGENTS.map((agent) => (
      agent.id === "codex"
        ? profileWithDiscoveredModels(
          agent,
          mergeModelCatalogs("codex", agent.models, codexDiscoveredModels()),
        )
        : agent
    )),
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
  "OMP models unavailable: catalog query failed or returned nothing";
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

// Codex model discovery (`codex debug models --bundled`) merges into the
// curated static table so the picker/quick-launch composer see one list
// (`agentProfiles()`), without a PickForge release per model launch. Claude
// Code has no stable model-listing command (see `probe_spec` in
// process_commands.rs) and is intentionally never probed here — its models
// stay the curated static table only.
const CODEX_MODEL_CATALOG_TTL_MS = 5 * 60 * 1000;
const [codexDiscoveredModels, setCodexDiscoveredModels] = createSignal<AgentModelOption[]>([]);
let codexModelsCacheAt = 0;
let codexModelsProbe: Promise<AgentModelOption[]> | null = null;

/** Refreshes the discovered Codex model catalog, session-cached for
 * `CODEX_MODEL_CATALOG_TTL_MS`. Never throws: a probe/parse failure is
 * advisory-only and leaves the previously discovered set (or the initial
 * empty set) untouched — `agentProfiles()`'s merge with the curated table
 * means this never empties the picker, only forgoes newly discovered
 * entries. Pass `force` to bypass the TTL (e.g. an explicit user refresh). */
export function discoverCodexModels(force = false): Promise<AgentModelOption[]> {
  const now = Date.now();
  if (!force && now - codexModelsCacheAt < CODEX_MODEL_CATALOG_TTL_MS) {
    return Promise.resolve(codexDiscoveredModels());
  }
  if (!force && codexModelsProbe) return codexModelsProbe;
  codexModelsProbe = probeAgentCli("codex")
    .then((probe) => {
      if (probe.installed && probe.modelsOutput.trim()) {
        setCodexDiscoveredModels(parseCodexModelCatalog(probe.modelsOutput));
      }
    })
    .catch(() => {
      // Advisory-only: leave the previously discovered set as-is.
    })
    .then(() => {
      codexModelsCacheAt = Date.now();
      return codexDiscoveredModels();
    })
    .finally(() => {
      codexModelsProbe = null;
    });
  return codexModelsProbe;
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

function ompModelFromEntry(entry: unknown): AgentModelOption | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const selector = record.selector;
  const provider = record.provider;
  if (typeof selector !== "string" || !selector) return null;
  if (typeof provider !== "string" || !provider) return null;
  const name = typeof record.name === "string" && record.name ? record.name : selector;
  return { id: selector, label: `${name} · ${provider}` };
}

/** Parse the JSON catalog emitted by `omp models --json --no-extensions`, e.g.
 * `{"models":[{"provider":"ollama-cloud","id":"...","selector":"provider/id",
 * "name":"...","contextWindow":...},...]}`. */
export function parseOmpModelCatalog(raw: string): AgentModelOption[] {
  let models: AgentModelOption[] = [];
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as { models?: unknown };
      if (Array.isArray(parsed.models)) {
        models = parsed.models
          .map(ompModelFromEntry)
          .filter((model): model is AgentModelOption => model !== null);
      }
    } catch {
      // Falls through to the empty-catalog check below, which throws.
    }
  }
  if (models.length === 0 && raw.trim()) {
    throw new Error("OMP returned an unsupported model catalog");
  }
  return uniqueModels(models);
}

function codexModelFromEntry(entry: unknown): AgentModelOption | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const slug = record.slug;
  if (typeof slug !== "string" || !slug) return null;
  // "hide" visibility entries (e.g. "codex-auto-review") aren't meant for
  // interactive model selection; only "list" (or an unspecified visibility,
  // for forward compatibility) surfaces in the picker.
  if (record.visibility !== undefined && record.visibility !== "list") return null;
  const label = typeof record.display_name === "string" && record.display_name
    ? record.display_name
    : slug;
  const levels = Array.isArray(record.supported_reasoning_levels)
    ? record.supported_reasoning_levels
    : [];
  const efforts = levels
    .map((level) =>
      level && typeof level === "object" ? (level as Record<string, unknown>).effort : undefined)
    .filter((effort): effort is string => typeof effort === "string" && effort.length > 0);
  const defaultEffort = typeof record.default_reasoning_level === "string"
    ? record.default_reasoning_level
    : undefined;
  const option: AgentModelOption = { id: slug, label };
  if (efforts.length > 0) option.efforts = efforts;
  if (defaultEffort && efforts.includes(defaultEffort)) option.defaultEffort = defaultEffort;
  return option;
}

/** Parse the JSON catalog emitted by `codex debug models --bundled`, e.g.
 * `{"models":[{"slug":"gpt-5.6-sol","display_name":"GPT-5.6-Sol",
 * "visibility":"list","supported_reasoning_levels":[{"effort":"low",...},
 * ...],"default_reasoning_level":"low"},...]}`. Verified on codex-cli
 * 0.144.6. */
export function parseCodexModelCatalog(raw: string): AgentModelOption[] {
  let models: AgentModelOption[] = [];
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as { models?: unknown };
      if (Array.isArray(parsed.models)) {
        models = parsed.models
          .map(codexModelFromEntry)
          .filter((model): model is AgentModelOption => model !== null);
      }
    } catch {
      // Falls through to the empty-catalog check below, which throws.
    }
  }
  if (models.length === 0 && raw.trim()) {
    throw new Error("Codex returned an unsupported model catalog");
  }
  return uniqueModels(models);
}

/** Generic effort set applied to a discovered-only model when its own
 * catalog entry carries no per-model effort metadata (OMP/Pi today). Codex
 * catalog entries already carry real `supported_reasoning_levels`, so this
 * fallback rarely applies to them in practice — it exists for forward
 * compatibility with a leaner catalog shape. */
const GENERIC_PROVIDER_EFFORTS: Partial<Record<string, { efforts: string[]; defaultEffort: string }>> = {
  claudeCode: { efforts: CLAUDE_EFFORTS, defaultEffort: "high" },
  codex: { efforts: CODEX_EFFORTS, defaultEffort: "medium" },
};

/** Merge a curated static catalog with a freshly discovered one: curated
 * entries always keep their hand-tuned label/effort metadata (a discovered
 * entry sharing their id is dropped in favor of the curated one), and
 * discovered-only entries are appended — with the discovered effort
 * metadata when the source provided it, else a generic per-provider effort
 * set. Pure so precedence/ordering/dedupe are unit-testable without IPC. */
export function mergeModelCatalogs(
  agentId: string,
  curated: AgentModelOption[],
  discovered: AgentModelOption[],
): AgentModelOption[] {
  const curatedIds = new Set(curated.map((model) => model.id));
  const generic = GENERIC_PROVIDER_EFFORTS[agentId];
  const discoveredOnly = discovered
    .filter((model) => !curatedIds.has(model.id))
    .map((model) => (
      model.efforts && model.efforts.length > 0
        ? model
        : { ...model, efforts: generic?.efforts, defaultEffort: generic?.defaultEffort }
    ));
  return uniqueModels([...curated, ...discoveredOnly]);
}

function versionFromOutput(raw: string): string | null {
  return raw.match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/)?.[1] ?? null;
}

/** Parses the model catalog for an installed CLI, pushing an advisory (OMP)
 * or the raw error text (Pi) into `errors` on failure/empty output instead
 * of throwing. */
function parseAgentModelCatalog(
  agentId: "omp" | "pi",
  probe: AgentCliProbe,
  errors: string[],
): AgentModelOption[] {
  if (!probe.installed) return [];
  if (agentId === "omp") {
    if (!probe.modelsOutput.trim()) {
      errors.push(OMP_MODEL_CATALOG_ADVISORY);
      return [];
    }
    try {
      return parseOmpModelCatalog(probe.modelsOutput);
    } catch {
      errors.push(OMP_MODEL_CATALOG_ADVISORY);
      return [];
    }
  }
  if (!probe.modelsOutput.trim()) return [];
  try {
    return parsePiModelCatalog(probe.modelsOutput);
  } catch (error) {
    errors.push(errorText(error));
    return [];
  }
}

function nativeChatCapable(
  agentId: "omp" | "pi",
  installed: boolean,
  nativeChatErrorCount: number,
  version: string | null,
  help: string,
): boolean {
  if (!installed || nativeChatErrorCount !== 0) return false;
  if (agentId === "omp") {
    return (
      isCompatibleOmpAcpVersion(version) &&
      /\bacp\b/.test(help) &&
      /--no-extensions(?:\s|$|,)/.test(help)
    );
  }
  return isCompatiblePiRpcVersion(version);
}

/** Convert the native probe into UI-safe diagnostics. Exported as the pure test
 * seam for malformed output and partial-command failures. */
export function diagnosticFromProbe(
  agentId: "omp" | "pi",
  probe: AgentCliProbe,
): AgentCliDiagnostic {
  const errors = [...probe.errors];
  // The model-discovery probe step is catalog-only: a failure there degrades
  // to the advisory below and must not withhold native chat, which only
  // needs the CLI to be installed with a compatible version and help output.
  const nativeChatErrorCount = agentId === "omp"
    ? probe.errors.filter((error) => !error.startsWith("model discovery")).length
    : probe.errors.length;
  const version = versionFromOutput(probe.versionOutput);
  if (probe.installed && probe.versionOutput.trim() && !version) {
    errors.push("Version output was not recognized");
  }

  const models = parseAgentModelCatalog(agentId, probe, errors);

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
      nativeChat: nativeChatCapable(agentId, installed, nativeChatErrorCount, version, help),
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

/** Intent subset actually used by auth-presence facts, kept independent of
 * the UI's `StatusIntent` so this module stays IPC/UI-agnostic. Every value
 * here is also a valid `StatusIntent`. */
export type AgentAuthIntent = "neutral" | "connected" | "warning" | "error";

export interface AgentAuthFact {
  label: string;
  intent: AgentAuthIntent;
  reason: string;
}

const AGENT_AUTH_LOGIN_HINTS: Record<"codex" | "claudeCode", string> = {
  codex: "Run `codex login` to authenticate.",
  claudeCode: "Run `claude auth login` to authenticate.",
};

const AGENT_AUTH_UNKNOWN_REASONS: Record<AuthPresenceUnknownReason, string> = {
  notInstalled: "the CLI is not installed on PATH",
  commandFailed: "the status command failed to run",
  timeout: "the status command timed out",
  unrecognizedOutput: "the status command returned an unrecognized result",
};

/** Maps a raw auth-presence probe (or its absence/failure) to a UI-safe
 * label/intent/reason, honest-degrade style like `piKitFactLabel`: an
 * inconclusive probe reports "Unknown" and why, never a guessed
 * authenticated/not-authenticated state. Pure so it is unit-testable without
 * IPC or a mounted Settings screen. */
export function agentAuthFact(
  agentId: "codex" | "claudeCode",
  loading: boolean,
  failure: string | undefined,
  probe: AgentAuthProbe | undefined,
): AgentAuthFact {
  if (loading) {
    return {
      label: "Checking…",
      intent: "neutral",
      reason: "Checking sign-in status via the CLI's own status command.",
    };
  }
  if (failure) {
    return {
      label: "Auth status unavailable",
      intent: "error",
      reason: `The local probe failed: ${failure}`,
    };
  }
  if (!probe) {
    return {
      label: "Not checked",
      intent: "neutral",
      reason: "Refresh connector status to check sign-in.",
    };
  }
  if (probe.state === "authenticated") {
    return {
      label: "Authenticated",
      intent: "connected",
      reason: "Signed in, per the CLI's own status command. PickForge never reads credential files.",
    };
  }
  if (probe.state === "notAuthenticated") {
    return {
      label: "Not authenticated",
      intent: "warning",
      reason: AGENT_AUTH_LOGIN_HINTS[agentId],
    };
  }
  const why = probe.unknownReason
    ? AGENT_AUTH_UNKNOWN_REASONS[probe.unknownReason]
    : "sign-in status could not be determined";
  return {
    label: "Unknown",
    intent: "neutral",
    reason: `Sign-in status is unknown: ${why}.`,
  };
}

const STORE_KEY = "pickforge.agentModels";

function defaults(): Record<string, string | null> {
  return Object.fromEntries(agentProfiles().map((a) => [a.id, a.defaultModel]));
}

/** Saved selections of retired model ids migrate to their replacement. */
const RETIRED_MODELS: Record<string, string> = {
  "claude-opus-4-8": "claude-opus-5",
};

export function loadAgentModels(): Record<string, string | null> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
    for (const [agentId, model] of Object.entries(saved)) {
      if (typeof model === "string" && RETIRED_MODELS[model]) {
        saved[agentId] = RETIRED_MODELS[model];
      }
    }
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
