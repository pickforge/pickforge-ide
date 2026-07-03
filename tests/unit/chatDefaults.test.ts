import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => {
  const m = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return m;
});

import {
  loadAgentEngine,
  loadDefaultChatKind,
  loadLastAgentProvider,
  setAgentEngine,
  setDefaultChatKind,
  setLastAgentProvider,
} from "../../src/lib/chatDefaults";

beforeEach(() => {
  mem.clear();
});

describe("default chat kind", () => {
  it("defaults to ask when unset", () => {
    expect(loadDefaultChatKind()).toBe("ask");
  });

  it("round-trips terminal and agent", () => {
    setDefaultChatKind("terminal");
    expect(loadDefaultChatKind()).toBe("terminal");
    setDefaultChatKind("agent");
    expect(loadDefaultChatKind()).toBe("agent");
    setDefaultChatKind("ask");
    expect(loadDefaultChatKind()).toBe("ask");
  });

  it("falls back to ask on a bogus stored value", () => {
    localStorage.setItem("pickforge.defaultChatKind", "nonsense");
    expect(loadDefaultChatKind()).toBe("ask");
  });
});

describe("agent chat engine", () => {
  it("defaults to v2 when unset", () => {
    expect(loadAgentEngine()).toBe("v2");
  });

  it("round-trips v1 and v2", () => {
    setAgentEngine("v1");
    expect(loadAgentEngine()).toBe("v1");
    setAgentEngine("v2");
    expect(loadAgentEngine()).toBe("v2");
  });

  it("falls back to v2 on a bogus stored value", () => {
    localStorage.setItem("pickforge.agentChatEngine", "v9");
    expect(loadAgentEngine()).toBe("v2");
  });
});

describe("last agent provider", () => {
  it("defaults to claudeCode when unset", () => {
    expect(loadLastAgentProvider()).toBe("claudeCode");
  });

  it("round-trips codex and claudeCode", () => {
    setLastAgentProvider("codex");
    expect(loadLastAgentProvider()).toBe("codex");
    setLastAgentProvider("claudeCode");
    expect(loadLastAgentProvider()).toBe("claudeCode");
  });

  it("falls back to claudeCode on a bogus stored value", () => {
    localStorage.setItem("pickforge.lastAgentProvider", "gemini");
    expect(loadLastAgentProvider()).toBe("claudeCode");
  });
});
