// Agent profiles + per-agent model selection. Ports agent_model_settings.dart
// (Claude→Haiku, Codex→GPT-5.3 Codex Spark defaults). Selection persists in
// localStorage (global, like the Flutter SharedPreferences store).

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
    label: "Claude Code",
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
    label: "Codex",
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

const STORE_KEY = "pickforge.agentModels";

function defaults(): Record<string, string | null> {
  return Object.fromEntries(AGENTS.map((a) => [a.id, a.defaultModel]));
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
  const agent = AGENTS.find((a) => a.id === agentId);
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

/** The shell command to launch an agent, pinned to its selected model. */
export function launchCommand(agentId: string, context: AgentLaunchContext = {}): string {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) return "";
  const model = loadAgentModels()[agentId];
  const option = selectedModelOption(agentId);
  if (model && option?.launch) {
    return `${option.launch.binary} ${option.launch.argsBeforeModel.join(" ")} ${model} `;
  }
  const modelArg = model ? `--model ${model} ` : "";
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
  return model ? `${agent.binary} --model ${model} ` : `${agent.binary} `;
}

export function launchBinary(agentId: string): string | null {
  const option = selectedModelOption(agentId);
  if (option?.launch) return option.launch.binary;
  return AGENTS.find((a) => a.id === agentId)?.binary ?? null;
}

export function nativeChatModel(agentId: string, modelId: string | null): string | null {
  const option = modelOption(agentId, modelId);
  return option?.terminalOnly ? null : modelId;
}
