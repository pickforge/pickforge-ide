import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpPublishedState, McpStartResult } from "../../src/lib/mcp";

const state = vi.hoisted(() => ({
  targetLabel: "Initial",
  workspace: { activeRoot: "/project/a" as string | null, activeChatId: null as string | null },
}));

const deps = vi.hoisted(() => ({
  mcpStart: vi.fn(),
  mcpPublishState: vi.fn(),
  mcpPushLog: vi.fn(),
  mcpRunStarted: vi.fn(),
}));

vi.mock("../../src/lib/mcp", () => ({
  mcpStart: deps.mcpStart,
  mcpPublishState: deps.mcpPublishState,
  mcpPushLog: deps.mcpPushLog,
  mcpRunStarted: deps.mcpRunStarted,
}));

vi.mock("../../src/stores/runTargets", () => ({
  activeTarget: () => ({
    id: "flutter",
    label: state.targetLabel,
    capabilities: ["streamLogs"],
    inspectorKind: "vmService",
  }),
}));

vi.mock("../../src/stores/runDevice", () => ({ selectedDevice: () => "emulator-5554" }));
vi.mock("../../src/stores/deviceList", () => ({ deviceList: () => [] }));
vi.mock("../../src/stores/runConsole", () => ({
  runConsole: { status: () => "idle", target: () => null },
}));
vi.mock("../../src/stores/workspace", () => ({ workspace: state.workspace }));
vi.mock("../../src/lib/runTargets", () => ({ supportTier: () => "deep" }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function startResult(projectRoot: string): McpStartResult {
  return {
    endpoint: "/tmp/pickforge.sock",
    contextDir: `${projectRoot}/.pickforge/context`,
    runsDir: `${projectRoot}/.pickforge/runs`,
    chatsDir: `${projectRoot}/.pickforge/chats`,
    mcpConfigPath: `${projectRoot}/.pickforge/mcp.json`,
    mcpCommand: "pickforge-mcp",
  };
}

async function loadMcpStore() {
  vi.resetModules();
  return import("../../src/stores/mcp");
}

beforeEach(() => {
  state.targetLabel = "Initial";
  state.workspace.activeRoot = "/project/a";
  state.workspace.activeChatId = null;
  deps.mcpStart.mockReset();
  deps.mcpPublishState.mockReset().mockResolvedValue(true);
  deps.mcpPushLog.mockReset().mockResolvedValue(true);
  deps.mcpRunStarted.mockReset().mockResolvedValue(true);
});

describe("MCP projection epochs", () => {
  it("keeps the newer project binding when starts complete out of order", async () => {
    const first = deferred<McpStartResult>();
    const second = deferred<McpStartResult>();
    deps.mcpStart
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const store = await loadMcpStore();

    const projectA = store.ensureMcpRunning("/project/a");
    const projectB = store.ensureMcpRunning("/project/b");

    expect(deps.mcpStart.mock.calls).toEqual([
      ["/project/a", 1],
      ["/project/b", 2],
    ]);

    second.resolve(startResult("/project/b"));
    const activeSession = await projectB;
    first.resolve(startResult("/project/a"));

    expect(await projectA).toBeNull();
    expect(activeSession).toEqual({ projectRoot: "/project/b", generation: 2 });
    expect(store.mcpBinding()).toMatchObject({ projectRoot: "/project/b", generation: 2 });

    store.mcpRunStarted({ projectRoot: "/project/a", generation: 1 });
    expect(deps.mcpRunStarted).not.toHaveBeenCalled();
  });

  it("resumes the live run epoch after an A-B-A project rebind", async () => {
    deps.mcpStart.mockImplementation(async (projectRoot: string) => startResult(projectRoot));
    const store = await loadMcpStore();

    const firstSession = await store.ensureMcpRunning("/project/a");
    store.mcpRunStarted(firstSession);
    store.pushMcpLogs(["a-before-switch"]);

    await store.ensureMcpRunning("/project/b");
    store.pushMcpLogs(["a-while-b-active"]);

    await store.ensureMcpRunning("/project/a");
    store.pushMcpLogs(["a-after-return"]);

    expect(deps.mcpPushLog.mock.calls).toEqual([
      [1, 1, ["a-before-switch"]],
      [3, 1, ["a-after-return"]],
    ]);
  });

  it("rejects an older publication completion after a newer revision", async () => {
    deps.mcpStart.mockResolvedValue(startResult("/project/a"));
    const store = await loadMcpStore();
    await store.ensureMcpRunning("/project/a");
    deps.mcpPublishState.mockClear();

    const older = deferred<void>();
    const newer = deferred<void>();
    let acceptedRevision = 0;
    let acceptedLabel = "";
    deps.mcpPublishState.mockImplementation(
      (generation: number, revision: number, snapshot: McpPublishedState) => {
        const gate = snapshot.targetLabel === "Older" ? older : newer;
        return gate.promise.then(() => {
          if (generation !== 1 || revision <= acceptedRevision) return false;
          acceptedRevision = revision;
          acceptedLabel = snapshot.targetLabel;
          return true;
        });
      },
    );

    state.targetLabel = "Older";
    const olderPublish = store.publishSnapshot();
    state.targetLabel = "Newer";
    const newerPublish = store.publishSnapshot();

    const olderCall = deps.mcpPublishState.mock.calls[0];
    const newerCall = deps.mcpPublishState.mock.calls[1];
    expect(olderCall[0]).toBe(1);
    expect(newerCall[0]).toBe(1);
    expect(olderCall[1]).toBeLessThan(newerCall[1]);

    newer.resolve();
    await newerPublish;
    older.resolve();
    await olderPublish;

    expect(acceptedLabel).toBe("Newer");
    expect(acceptedRevision).toBe(newerCall[1]);
    expect(store.mcpBinding()).toMatchObject({ projectRoot: "/project/a", generation: 1 });
  });

  it("rejects a delayed log flush after run-again advances the epoch", async () => {
    deps.mcpStart.mockResolvedValue(startResult("/project/a"));
    const store = await loadMcpStore();
    const session = await store.ensureMcpRunning("/project/a");
    expect(session).not.toBeNull();

    let acceptedEpoch = 0;
    const acceptedLogs: string[] = [];
    deps.mcpRunStarted.mockImplementation(async (generation: number, runEpoch: number) => {
      if (generation !== 1 || runEpoch < acceptedEpoch) return false;
      if (runEpoch > acceptedEpoch) {
        acceptedEpoch = runEpoch;
        acceptedLogs.length = 0;
      }
      return true;
    });

    const delayed = deferred<void>();
    deps.mcpPushLog.mockImplementation(
      (generation: number, runEpoch: number, lines: string[]) => {
        const gate = lines[0] === "run-1-late" ? delayed.promise : Promise.resolve();
        return gate.then(() => {
          if (generation !== 1 || runEpoch < acceptedEpoch) return false;
          if (runEpoch > acceptedEpoch) {
            acceptedEpoch = runEpoch;
            acceptedLogs.length = 0;
          }
          acceptedLogs.push(...lines);
          return true;
        });
      },
    );

    store.mcpRunStarted(session);
    store.pushMcpLogs(["run-1-late"]);
    store.mcpRunStarted(session);
    store.pushMcpLogs(["run-2"]);

    await vi.waitFor(() => expect(acceptedLogs).toEqual(["run-2"]));
    delayed.resolve();
    await deps.mcpPushLog.mock.results[0].value;

    expect(deps.mcpRunStarted.mock.calls).toEqual([
      [1, 1],
      [1, 2],
    ]);
    expect(deps.mcpPushLog.mock.calls).toEqual([
      [1, 1, ["run-1-late"]],
      [1, 2, ["run-2"]],
    ]);
    expect(acceptedLogs).toEqual(["run-2"]);
    expect(acceptedEpoch).toBe(2);
  });
});
