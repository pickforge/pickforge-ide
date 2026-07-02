import { type AgentEngine, type AgentProvider } from "./agentChat";

export type DefaultChatKind = "ask" | "terminal" | "agent";

const KIND_KEY = "pickforge.defaultChatKind";
const ENGINE_KEY = "pickforge.agentChatEngine";
const PROVIDER_KEY = "pickforge.lastAgentProvider";

export function loadDefaultChatKind(): DefaultChatKind {
  try {
    const value = localStorage.getItem(KIND_KEY);
    if (value === "ask" || value === "terminal" || value === "agent") return value;
  } catch {
    // fall through to default
  }
  return "ask";
}

export function setDefaultChatKind(kind: DefaultChatKind) {
  localStorage.setItem(KIND_KEY, kind);
}

export function loadAgentEngine(): AgentEngine {
  try {
    const value = localStorage.getItem(ENGINE_KEY);
    if (value === "v1" || value === "v2") return value;
  } catch {
    // fall through to default
  }
  return "v2";
}

export function setAgentEngine(engine: AgentEngine) {
  localStorage.setItem(ENGINE_KEY, engine);
}

export function loadLastAgentProvider(): AgentProvider {
  try {
    const value = localStorage.getItem(PROVIDER_KEY);
    if (value === "claudeCode" || value === "codex") return value;
  } catch {
    // fall through to default
  }
  return "claudeCode";
}

export function setLastAgentProvider(provider: AgentProvider) {
  localStorage.setItem(PROVIDER_KEY, provider);
}
