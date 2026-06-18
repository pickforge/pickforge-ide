// Agent profiles + per-agent model selection. Ports agent_model_settings.dart
// (Claude→Haiku, Codex→GPT-5.3 Codex Spark defaults). Selection persists in
// localStorage (global, like the Flutter SharedPreferences store).

export interface AgentModelOption {
  id: string;
  label: string;
}

export interface AgentProfile {
  id: string;
  label: string;
  binary: string;
  defaultModel: string | null;
  models: AgentModelOption[];
}

export const AGENTS: AgentProfile[] = [
  {
    id: "claudeCode",
    label: "Claude Code",
    binary: "claude",
    defaultModel: "claude-haiku-4-5",
    models: [
      { id: "claude-haiku-4-5", label: "Haiku 4.5" },
      { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
      { id: "claude-opus-4-8", label: "Opus 4.8" },
    ],
  },
  {
    id: "codex",
    label: "Codex",
    binary: "codex",
    defaultModel: "gpt-5.3-codex-spark",
    models: [
      { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
      { id: "gpt-5.5", label: "GPT-5.5" },
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

/** The shell command to launch an agent, pinned to its selected model. */
export function launchCommand(agentId: string): string {
  const agent = AGENTS.find((a) => a.id === agentId);
  if (!agent) return "";
  const model = loadAgentModels()[agentId];
  return model ? `${agent.binary} --model ${model} ` : `${agent.binary} `;
}
