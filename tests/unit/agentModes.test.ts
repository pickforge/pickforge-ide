import { beforeEach, describe, expect, it } from "vitest";

const store = new Map<string, string>();
const localStorageStub = {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
};
(globalThis as { localStorage?: unknown }).localStorage = localStorageStub;

import {
  defaultMode,
  isDangerMode,
  loadAgentModes,
  modeOverrides,
  setAgentMode,
} from "../../src/lib/agentModes";

beforeEach(() => {
  store.clear();
});

describe("modeOverrides", () => {
  it("maps every claudeCode mode to its permission mode", () => {
    for (const mode of ["default", "plan", "acceptEdits", "bypassPermissions"]) {
      expect(modeOverrides("claudeCode", mode)).toEqual({ permissionMode: mode });
    }
  });

  it("maps every codex mode to sandbox + approval policy", () => {
    expect(modeOverrides("codex", "auto")).toEqual({
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
    });
    expect(modeOverrides("codex", "read-only")).toEqual({
      sandbox: "read-only",
      approvalPolicy: "on-request",
    });
    expect(modeOverrides("codex", "full-access")).toEqual({
      sandbox: "danger-full-access",
      approvalPolicy: "never",
    });
  });

  it("falls back to the provider default for null or unknown modes", () => {
    expect(modeOverrides("claudeCode", null)).toEqual({ permissionMode: "default" });
    expect(modeOverrides("claudeCode", "nonsense")).toEqual({ permissionMode: "default" });
    expect(modeOverrides("codex", null)).toEqual({
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
    });
  });
});

describe("isDangerMode", () => {
  it("flags only the dangerous modes", () => {
    expect(isDangerMode("claudeCode", "bypassPermissions")).toBe(true);
    expect(isDangerMode("codex", "full-access")).toBe(true);
    expect(isDangerMode("claudeCode", "default")).toBe(false);
    expect(isDangerMode("codex", "read-only")).toBe(false);
    expect(isDangerMode("claudeCode", null)).toBe(false);
  });
});

describe("loadAgentModes / setAgentMode", () => {
  it("returns provider defaults when nothing is stored", () => {
    expect(loadAgentModes()).toEqual({ claudeCode: "default", codex: "auto" });
    expect(defaultMode("claudeCode")).toBe("default");
    expect(defaultMode("codex")).toBe("auto");
  });

  it("round-trips a persisted mode", () => {
    setAgentMode("codex", "read-only");
    setAgentMode("claudeCode", "plan");
    expect(loadAgentModes()).toEqual({ claudeCode: "plan", codex: "read-only" });
  });

  it("drops invalid stored values back to the default", () => {
    store.set("pickforge.agentModes", JSON.stringify({ codex: "bogus", claudeCode: "plan" }));
    expect(loadAgentModes()).toEqual({ claudeCode: "plan", codex: "auto" });
  });

  it("falls back to defaults on malformed json", () => {
    store.set("pickforge.agentModes", "{not json");
    expect(loadAgentModes()).toEqual({ claudeCode: "default", codex: "auto" });
  });
});
