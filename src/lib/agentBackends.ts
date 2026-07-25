import { flagEnabled } from "../stores/flags";

export type AgentEngine = "v1" | "v2";
export type AgentBackendId = "claudeCode" | "codex" | "omp" | "pi";
export type AgentProvider = "claudeCode" | "codex" | "omp" | "pi";
export type AgentBackendKind = "claudeAgentSdk" | "codexAppServer" | "ompAcp" | "piRpc" | "terminal";
export type AgentBackendProtocol = "native" | "acp" | "rpc";
export type AgentProtocolAvailability = "integrated" | "availableNotIntegrated";
export type AgentCapabilitySupport = "supported" | "unsupported" | "unknown";
export type AgentCapabilitySurface = "nativeChat" | "terminal";

export const AGENT_BACKEND_CAPABILITY_KEYS = Object.freeze([
  "nativeChat",
  "terminal",
  "startSession",
  "streamEvents",
  "sessionEvents",
  "interruptTurn",
  "closeSession",
  "resumeSession",
  "steerTurn",
  "followUpTurn",
  "textInput",
  "imageInput",
  "modelSelection",
  "modelSwitching",
  "effortSelection",
  "effortSwitching",
  "modeSelection",
  "modeSwitching",
  "planEvents",
  "toolEvents",
  "fileEvents",
  "approvalEvents",
  "mcpConfiguration",
  "usageReporting",
  "contextReporting",
  "rateLimitReporting",
  "titleEvents",
  "authDiscovery",
  "remoteExecution",
  "errorEvents",
  "processCleanup",
] as const);

export type AgentBackendCapabilityKey = (typeof AGENT_BACKEND_CAPABILITY_KEYS)[number];

export interface AgentBackendCapability {
  readonly support: AgentCapabilitySupport;
  readonly surfaces: readonly AgentCapabilitySurface[];
  readonly engines: readonly AgentEngine[];
  readonly reason: string | null;
  readonly engineReason: string | null;
}

export type AgentBackendCapabilityMatrix = Readonly<
  Record<AgentBackendCapabilityKey, AgentBackendCapability>
>;

export type AgentControlTiming =
  | "liveSession"
  | "nextTurn"
  | "perTurnPayload"
  | "newSession"
  | "unsupported"
  | "unknown";

export interface AgentBackendDescriptor {
  readonly id: AgentBackendId;
  readonly label: string;
  readonly backendKind: AgentBackendKind;
  readonly protocol: Readonly<{
    kind: AgentBackendProtocol;
    availability: AgentProtocolAvailability;
  }>;
  readonly capabilities: AgentBackendCapabilityMatrix;
  readonly lifecycle: Readonly<{
    start: Readonly<
      Record<
        AgentEngine,
        | "oneShotProcess"
        | "residentBridgeChat"
        | "appServerThread"
        | "acpSession"
        | "residentRpc"
        | "unsupported"
      >
    >;
    close: Readonly<
      Record<
        AgentEngine,
        | "killActiveProcess"
        | "closeBridgeChat"
        | "unsubscribeThread"
        | "closeAcpSession"
        | "closeRpcProcess"
        | "unsupported"
      >
    >;
    resume: Readonly<Record<AgentEngine, "providerSessionId" | "unsupported">>;
    remote: "v1SshProcess" | "unknown";
  }>;
  readonly controls: Readonly<{
    model: Readonly<Record<AgentEngine, AgentControlTiming>>;
    effort: Readonly<Record<AgentEngine, AgentControlTiming>>;
    mode: Readonly<Record<AgentEngine, AgentControlTiming>>;
  }>;
  readonly nativePayload: Readonly<{
    model: "sessionState" | "turn" | "unsupported";
    effort: "sessionState" | "turn" | "unsupported";
    mode: "sessionState" | "unsupported";
  }>;
  readonly effortDefaultSource: "modelCatalog" | "codexConfig" | "unknown";
  readonly modeControlLabel: string;
}

const BOTH_ENGINES = Object.freeze(["v1", "v2"] as const);
const V1_ENGINE = Object.freeze(["v1"] as const);
const V2_ENGINE = Object.freeze(["v2"] as const);
const NATIVE_SURFACE = Object.freeze(["nativeChat"] as const);
const TERMINAL_SURFACE = Object.freeze(["terminal"] as const);
const BOTH_SURFACES = Object.freeze(["nativeChat", "terminal"] as const);
const NO_ENGINES = Object.freeze([] as const);
const NO_SURFACES = Object.freeze([] as const);

function capability(
  support: AgentCapabilitySupport,
  surfaces: readonly AgentCapabilitySurface[],
  engines: readonly AgentEngine[],
  reason: string | null = null,
  engineReason: string | null = null,
): AgentBackendCapability {
  return Object.freeze({ support, surfaces, engines, reason, engineReason });
}

const NATIVE = capability("supported", NATIVE_SURFACE, BOTH_ENGINES);
const NATIVE_V2 = capability(
  "supported",
  NATIVE_SURFACE,
  V2_ENGINE,
  null,
  "This control requires the v2 agent engine",
);
const NATIVE_V1 = capability(
  "supported",
  NATIVE_SURFACE,
  V1_ENGINE,
  null,
  "Remote execution requires the v1 agent engine",
);
const TERMINAL = capability("supported", TERMINAL_SURFACE, NO_ENGINES);
const BOTH = capability("supported", BOTH_SURFACES, BOTH_ENGINES);

function unsupported(reason: string): AgentBackendCapability {
  return capability("unsupported", NO_SURFACES, NO_ENGINES, reason);
}



const NO_FOLLOW_UP = "Only Pi RPC accepts a follow-up into the turn that is already running";
const NO_CLAUDE_STEER = "Claude Code steering is unavailable until the Agent SDK exposes it";
const NO_CLAUDE_EFFORT_SWITCH = "Changing Claude effort requires starting a new session";
const NO_SESSION_MCP = "PickForge does not pass per-session MCP configuration to this native backend";
const NO_TITLE_EVENTS = "This backend does not emit session title events";
const NO_AUTH_DISCOVERY = "Authentication discovery is not exposed through this backend";

function frozenLifecycle(
  start: AgentBackendDescriptor["lifecycle"]["start"],
  close: AgentBackendDescriptor["lifecycle"]["close"],
  resume: AgentBackendDescriptor["lifecycle"]["resume"],
  remote: AgentBackendDescriptor["lifecycle"]["remote"],
): AgentBackendDescriptor["lifecycle"] {
  return Object.freeze({
    start: Object.freeze(start),
    close: Object.freeze(close),
    resume: Object.freeze(resume),
    remote,
  });
}

function frozenControls(
  model: Readonly<Record<AgentEngine, AgentControlTiming>>,
  effort: Readonly<Record<AgentEngine, AgentControlTiming>>,
  mode: Readonly<Record<AgentEngine, AgentControlTiming>>,
): AgentBackendDescriptor["controls"] {
  return Object.freeze({
    model: Object.freeze(model),
    effort: Object.freeze(effort),
    mode: Object.freeze(mode),
  });
}

function frozenPayload(
  model: AgentBackendDescriptor["nativePayload"]["model"],
  effort: AgentBackendDescriptor["nativePayload"]["effort"],
  mode: AgentBackendDescriptor["nativePayload"]["mode"],
): AgentBackendDescriptor["nativePayload"] {
  return Object.freeze({ model, effort, mode });
}

const CLAUDE_CAPABILITIES = Object.freeze({
  nativeChat: NATIVE,
  terminal: TERMINAL,
  startSession: NATIVE,
  streamEvents: NATIVE,
  sessionEvents: NATIVE,
  interruptTurn: NATIVE,
  closeSession: NATIVE,
  resumeSession: NATIVE,
  steerTurn: unsupported(NO_CLAUDE_STEER),
  followUpTurn: unsupported(NO_FOLLOW_UP),
  textInput: BOTH,
  imageInput: NATIVE_V2,
  modelSelection: BOTH,
  modelSwitching: NATIVE,
  effortSelection: NATIVE,
  effortSwitching: unsupported(NO_CLAUDE_EFFORT_SWITCH),
  modeSelection: NATIVE,
  modeSwitching: NATIVE,
  planEvents: NATIVE,
  toolEvents: NATIVE,
  fileEvents: NATIVE,
  approvalEvents: NATIVE_V2,
  mcpConfiguration: capability("supported", TERMINAL_SURFACE, NO_ENGINES, NO_SESSION_MCP),
  usageReporting: NATIVE,
  contextReporting: NATIVE,
  rateLimitReporting: unsupported("Claude Code does not emit normalized rate-limit events"),
  titleEvents: unsupported(NO_TITLE_EVENTS),
  authDiscovery: unsupported(NO_AUTH_DISCOVERY),
  remoteExecution: NATIVE_V1,
  errorEvents: NATIVE,
  processCleanup: NATIVE,
} satisfies AgentBackendCapabilityMatrix);

const CODEX_CAPABILITIES = Object.freeze({
  nativeChat: NATIVE,
  terminal: TERMINAL,
  startSession: NATIVE,
  streamEvents: NATIVE,
  sessionEvents: NATIVE,
  interruptTurn: NATIVE,
  closeSession: NATIVE,
  resumeSession: NATIVE,
  steerTurn: NATIVE_V2,
  followUpTurn: unsupported(NO_FOLLOW_UP),
  textInput: BOTH,
  imageInput: NATIVE_V2,
  modelSelection: BOTH,
  modelSwitching: NATIVE,
  effortSelection: NATIVE,
  effortSwitching: NATIVE,
  modeSelection: NATIVE,
  modeSwitching: NATIVE,
  planEvents: NATIVE,
  toolEvents: NATIVE,
  fileEvents: NATIVE,
  approvalEvents: NATIVE_V2,
  mcpConfiguration: capability("supported", TERMINAL_SURFACE, NO_ENGINES, NO_SESSION_MCP),
  usageReporting: NATIVE,
  contextReporting: NATIVE,
  rateLimitReporting: NATIVE_V2,
  titleEvents: unsupported(NO_TITLE_EVENTS),
  authDiscovery: unsupported(NO_AUTH_DISCOVERY),
  remoteExecution: NATIVE_V1,
  errorEvents: NATIVE,
  processCleanup: NATIVE,
} satisfies AgentBackendCapabilityMatrix);

const OMP_NATIVE = capability(
  "supported",
  NATIVE_SURFACE,
  V2_ENGINE,
  null,
  "OMP ACP requires the local v2 agent engine",
);
const OMP_BOTH = capability(
  "supported",
  BOTH_SURFACES,
  V2_ENGINE,
  null,
  "OMP ACP native chat requires the local v2 agent engine",
);
const OMP_CAPABILITIES = Object.freeze({
  nativeChat: OMP_NATIVE,
  terminal: TERMINAL,
  startSession: OMP_NATIVE,
  streamEvents: OMP_NATIVE,
  sessionEvents: OMP_NATIVE,
  interruptTurn: OMP_NATIVE,
  closeSession: OMP_NATIVE,
  resumeSession: OMP_NATIVE,
  steerTurn: unsupported("OMP ACP does not advertise turn steering"),
  followUpTurn: unsupported(NO_FOLLOW_UP),
  textInput: OMP_BOTH,
  imageInput: OMP_NATIVE,
  modelSelection: OMP_BOTH,
  modelSwitching: OMP_NATIVE,
  effortSelection: unsupported("OMP ACP does not advertise reasoning-effort controls"),
  effortSwitching: unsupported("OMP ACP does not advertise reasoning-effort controls"),
  modeSelection: unsupported(
    "OMP plan mode is disabled because safe form elicitation is not integrated",
  ),
  modeSwitching: unsupported(
    "OMP plan mode is disabled because safe form elicitation is not integrated",
  ),
  planEvents: OMP_NATIVE,
  toolEvents: OMP_NATIVE,
  fileEvents: OMP_NATIVE,
  approvalEvents: OMP_NATIVE,
  mcpConfiguration: OMP_NATIVE,
  usageReporting: OMP_NATIVE,
  contextReporting: OMP_NATIVE,
  rateLimitReporting: unsupported("OMP ACP does not emit rate-limit updates"),
  titleEvents: OMP_NATIVE,
  authDiscovery: unsupported(
    "OMP ACP authentication callbacks are not exposed until PickForge can handle them safely",
  ),
  remoteExecution: unsupported("OMP ACP is local-only in this connector"),
  errorEvents: OMP_NATIVE,
  processCleanup: OMP_NATIVE,
} satisfies AgentBackendCapabilityMatrix);


const PI_CAPABILITIES = Object.freeze({
  nativeChat: NATIVE_V2,
  terminal: TERMINAL,
  startSession: NATIVE_V2,
  streamEvents: NATIVE_V2,
  sessionEvents: NATIVE_V2,
  interruptTurn: NATIVE_V2,
  closeSession: NATIVE_V2,
  resumeSession: NATIVE_V2,
  steerTurn: NATIVE_V2,
  followUpTurn: NATIVE_V2,
  textInput: BOTH,
  imageInput: unsupported("PickForge does not translate stashed image paths to Pi RPC image payloads"),
  modelSelection: BOTH,
  modelSwitching: NATIVE_V2,
  effortSelection: unsupported(
    "PickForge does not expose Pi thinking-level selection or live switching in this release",
  ),
  effortSwitching: unsupported(
    "PickForge does not expose Pi thinking-level selection or live switching in this release",
  ),
  modeSelection: unsupported("Pi RPC exposes thinking level, not a native sandbox or approval mode"),
  modeSwitching: unsupported("Pi RPC exposes thinking level, not a native sandbox or approval mode"),
  planEvents: unsupported("Pi RPC does not emit typed plan or todo events (assumption verified through 0.81)"),
  toolEvents: NATIVE_V2,
  fileEvents: capability(
    "supported",
    NATIVE_SURFACE,
    V2_ENGINE,
    "File activity is inferred from successful mutating tool arguments; Pi has no typed file event",
  ),
  approvalEvents: unsupported("Pi RPC has no native approval protocol (assumption verified through 0.81)"),
  mcpConfiguration: unsupported(
    "PickForge does not inject per-session MCP configuration; native Pi sessions still load the user's installed extensions and tools",
  ),
  usageReporting: NATIVE_V2,
  contextReporting: unsupported("Pi context usage requires explicit session-stat polling"),
  rateLimitReporting: unsupported("Pi RPC does not emit rate-limit events (assumption verified through 0.81)"),
  titleEvents: unsupported(
    "Pi session names are not connected to durable PickForge chat title ownership",
  ),
  authDiscovery: unsupported("Pi authentication is owned by provider configuration outside RPC"),
  remoteExecution: unsupported("PickForge Pi RPC is a local process-group connector"),
  errorEvents: NATIVE_V2,
  processCleanup: NATIVE_V2,
} satisfies AgentBackendCapabilityMatrix);

const CLAUDE_BACKEND = Object.freeze({
  id: "claudeCode",
  label: "Claude Code",
  backendKind: "claudeAgentSdk",
  protocol: Object.freeze({ kind: "native", availability: "integrated" }),
  capabilities: CLAUDE_CAPABILITIES,
  lifecycle: frozenLifecycle(
    { v1: "oneShotProcess", v2: "residentBridgeChat" },
    { v1: "killActiveProcess", v2: "closeBridgeChat" },
    { v1: "providerSessionId", v2: "providerSessionId" },
    "v1SshProcess",
  ),
  controls: frozenControls(
    { v1: "nextTurn", v2: "liveSession" },
    { v1: "newSession", v2: "newSession" },
    { v1: "nextTurn", v2: "liveSession" },
  ),
  nativePayload: frozenPayload("sessionState", "sessionState", "sessionState"),
  effortDefaultSource: "modelCatalog",
  modeControlLabel: "Permission mode",
} satisfies AgentBackendDescriptor);

const CODEX_BACKEND = Object.freeze({
  id: "codex",
  label: "Codex",
  backendKind: "codexAppServer",
  protocol: Object.freeze({ kind: "native", availability: "integrated" }),
  capabilities: CODEX_CAPABILITIES,
  lifecycle: frozenLifecycle(
    { v1: "oneShotProcess", v2: "appServerThread" },
    { v1: "killActiveProcess", v2: "unsubscribeThread" },
    { v1: "providerSessionId", v2: "providerSessionId" },
    "v1SshProcess",
  ),
  controls: frozenControls(
    { v1: "nextTurn", v2: "perTurnPayload" },
    { v1: "perTurnPayload", v2: "perTurnPayload" },
    { v1: "nextTurn", v2: "perTurnPayload" },
  ),
  nativePayload: frozenPayload("turn", "turn", "sessionState"),
  effortDefaultSource: "codexConfig",
  modeControlLabel: "Sandbox & approvals",
} satisfies AgentBackendDescriptor);

const OMP_BACKEND = Object.freeze({
  id: "omp",
  label: "Oh My Pi (OMP)",
  backendKind: "ompAcp",
  protocol: Object.freeze({ kind: "acp", availability: "integrated" }),
  capabilities: OMP_CAPABILITIES,
  lifecycle: frozenLifecycle(
    { v1: "unsupported", v2: "acpSession" },
    { v1: "unsupported", v2: "closeAcpSession" },
    { v1: "unsupported", v2: "providerSessionId" },
    "unknown",
  ),
  controls: frozenControls(
    { v1: "unsupported", v2: "liveSession" },
    { v1: "unsupported", v2: "unsupported" },
    { v1: "unsupported", v2: "unsupported" },
  ),
  nativePayload: frozenPayload("sessionState", "unsupported", "unsupported"),
  effortDefaultSource: "unknown",
  modeControlLabel: "Mode",
} satisfies AgentBackendDescriptor);

const PI_BACKEND = Object.freeze({
  id: "pi",
  label: "Pi",
  backendKind: "piRpc",
  protocol: Object.freeze({ kind: "rpc", availability: "integrated" }),
  capabilities: PI_CAPABILITIES,
  lifecycle: frozenLifecycle(
    { v1: "unsupported", v2: "residentRpc" },
    { v1: "unsupported", v2: "closeRpcProcess" },
    { v1: "unsupported", v2: "providerSessionId" },
    "unknown",
  ),
  controls: frozenControls(
    { v1: "unsupported", v2: "liveSession" },
    { v1: "unsupported", v2: "unsupported" },
    { v1: "unsupported", v2: "unsupported" },
  ),
  nativePayload: frozenPayload("sessionState", "unsupported", "unsupported"),
  effortDefaultSource: "unknown",
  modeControlLabel: "Thinking level",
} satisfies AgentBackendDescriptor);

export const AGENT_BACKENDS = Object.freeze({
  claudeCode: CLAUDE_BACKEND,
  codex: CODEX_BACKEND,
  omp: OMP_BACKEND,
  pi: PI_BACKEND,
} satisfies Readonly<Record<AgentBackendId, AgentBackendDescriptor>>);

const AGENT_BACKEND_IDS = new Set<string>(Object.keys(AGENT_BACKENDS));
export const NATIVE_AGENT_BACKENDS = Object.freeze([CLAUDE_BACKEND, CODEX_BACKEND]);

/** Pi RPC's wire protocol was certified as a compatible superset from 0.79.10
 * (the original adapter contract) through 0.81 (empirically verified). */
export function isCompatiblePiRpcVersion(version: string | null | undefined): boolean {
  if (!version) return false;
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (major !== 0 || minor < 79 || minor > 81) return false;
  return minor > 79 || patch >= 10;
}

/** Pi is selectable only after the installed version gate passes.
 * Claude/Codex remain unchanged. */
export function selectableNativeAgentBackends(
  piVersion: string | null | undefined,
): readonly AgentBackendDescriptor[] {
  return isCompatiblePiRpcVersion(piVersion)
    ? Object.freeze([...NATIVE_AGENT_BACKENDS, PI_BACKEND])
    : NATIVE_AGENT_BACKENDS;
}

export function isAgentBackendId(value: string): value is AgentBackendId {
  return AGENT_BACKEND_IDS.has(value);
}

/** Native-provider predicate. OMP's exact probe compatibility is additionally
 * enforced by `nativeAgentProfiles`/`nativeChatModel`. */
export function isNativeAgentProvider(value: string): value is AgentProvider {
  return value === "claudeCode"
    || value === "codex"
    || value === "pi"
    || (value === "omp" && flagEnabled("ompAgents"));
}

export function normalizeAgentProvider(value: string): AgentProvider | null {
  if (value === "claude") return "claudeCode";
  return value === "omp" || isNativeAgentProvider(value) ? value : null;
}

export function agentBackendDescriptor(id: AgentBackendId): AgentBackendDescriptor;
export function agentBackendDescriptor(id: string): AgentBackendDescriptor | undefined;
export function agentBackendDescriptor(id: string): AgentBackendDescriptor | undefined {
  return isAgentBackendId(id) ? AGENT_BACKENDS[id] : undefined;
}


export function supportsBackendCapability(
  id: AgentBackendId,
  key: AgentBackendCapabilityKey,
  surface: AgentCapabilitySurface = "nativeChat",
  engine: AgentEngine = "v2",
): boolean {
  const capability = AGENT_BACKENDS[id].capabilities[key];
  if (capability.support !== "supported" || !capability.surfaces.includes(surface)) return false;
  return surface === "terminal" || capability.engines.includes(engine);
}

export function backendCapabilityReason(
  id: AgentBackendId,
  key: AgentBackendCapabilityKey,
  surface: AgentCapabilitySurface = "nativeChat",
  engine: AgentEngine = "v2",
): string | null {
  const descriptor = AGENT_BACKENDS[id];
  const capability = descriptor.capabilities[key];
  if (capability.support !== "supported") return capability.reason;
  if (!capability.surfaces.includes(surface)) {
    if (capability.reason) return capability.reason;
    if (surface === "nativeChat") {
      return descriptor.capabilities.nativeChat.reason ?? "This capability is not available in native chat";
    }
    return "This capability is not available in terminal sessions";
  }
  if (surface === "nativeChat" && !capability.engines.includes(engine)) {
    return capability.engineReason ?? `This capability is not available with the ${engine} agent engine`;
  }
  return null;
}

export function nativeChatUnavailableReason(id: string, engine: AgentEngine = "v2"): string | null {
  const descriptor = agentBackendDescriptor(id);
  if (!descriptor) return "Unknown agent backend";
  return backendCapabilityReason(descriptor.id, "nativeChat", "nativeChat", engine);
}
