import { afterEach, describe, expect, it, vi } from "vitest";

// runRecord wraps the db wrappers; stub the Tauri invoke so the db module never
// touches a real runtime. Each test sets the mock's behaviour. `vi.hoisted`
// keeps the spy referenceable from the hoisted factory.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  newSessionId,
  recordForgeDispatch,
  recordRunFinish,
  recordRunStart,
} from "../../src/lib/runRecord";

const pick = {
  id: 0,
  projectRoot: "/p",
  widgetClass: "LoginButton",
  creationFile: "lib/login.dart",
  creationLine: 42,
  skillId: "",
  agentId: "claudeCode",
  terminalId: "pane-1",
  chatId: "chat-1",
  pickedAt: 1,
  widgetContextJson: "{}",
};

afterEach(() => {
  invoke.mockReset();
  vi.restoreAllMocks();
});

describe("newSessionId", () => {
  it("is unique and prefixed", () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a).toMatch(/^run-/);
    expect(a).not.toBe(b);
  });
});

describe("write-failure safety", () => {
  it("recordRunStart swallows a rejected insert", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    invoke.mockRejectedValue(new Error("db locked"));
    await expect(
      recordRunStart({
        sessionId: "run-x",
        projectRoot: "/p",
        startedAt: 1,
        endedAt: null,
        avdId: null,
        avdName: null,
        serial: null,
        vmServiceUrl: null,
        targetFile: null,
        connectionMode: "auto",
        exitReason: null,
        exitCode: null,
        hotReloadCount: 0,
        hotRestartCount: 0,
        errorCount: 0,
        lastError: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("recordRunFinish swallows a rejected update", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    invoke.mockRejectedValue(new Error("boom"));
    await expect(
      recordRunFinish("run-x", 2, "stopped", null),
    ).resolves.toBeUndefined();
  });

  it("recordForgeDispatch swallows a rejected pick insert", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    invoke.mockRejectedValue(new Error("boom"));
    await expect(recordForgeDispatch(pick, "claude 'go'")).resolves.toBeUndefined();
  });
});

describe("recordForgeDispatch happy path", () => {
  it("inserts a pick then an agent run keyed to it (one each)", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "pick_insert") return Promise.resolve(7);
      if (cmd === "agent_run_insert") return Promise.resolve(1);
      return Promise.resolve(null);
    });
    await recordForgeDispatch(pick, "claude 'go'");
    const calls = invoke.mock.calls.map((c) => c[0]);
    expect(calls.filter((c) => c === "pick_insert")).toHaveLength(1);
    expect(calls.filter((c) => c === "agent_run_insert")).toHaveLength(1);
    const agentCall = invoke.mock.calls.find((c) => c[0] === "agent_run_insert");
    expect(agentCall?.[1]).toMatchObject({ run: { pickId: 7, wrapperScriptPath: "claude 'go'" } });
  });
});
