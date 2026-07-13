import {
  isNativeAgentProvider,
  type AgentEngine,
  type AgentProvider,
} from "./agentBackends";

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
    if (value && isNativeAgentProvider(value)) return value;
  } catch {
    // fall through to default
  }
  return "claudeCode";
}

export function setLastAgentProvider(provider: AgentProvider) {
  localStorage.setItem(PROVIDER_KEY, provider);
}

const ASK_TITLE_KEY = "pickforge.askChatTitle";

/** Whether the new-chat flow asks for a title up front (default on). An empty
 *  title falls back to the default name + auto-naming from the first message. */
export function loadAskChatTitle(): boolean {
  try {
    return localStorage.getItem(ASK_TITLE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setAskChatTitle(on: boolean) {
  localStorage.setItem(ASK_TITLE_KEY, on ? "true" : "false");
}
