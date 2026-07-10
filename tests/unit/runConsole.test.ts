import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  transportLive: true,
  remote: { host: "mac-mini", remoteRoot: "/srv/app" } as { host: string; remoteRoot: string } | null,
}));

const deps = vi.hoisted(() => ({
  disarm: vi.fn(),
  reattach: vi.fn(),
  recordStart: vi.fn(),
  recordFinish: vi.fn(),
}));

vi.mock("../../src/lib/remoteContext", () => ({
  remotePtyFor: () => state.remote,
}));

vi.mock("../../src/stores/vmService", () => ({
  disarmVmAutoConnect: deps.disarm,
  hasVmTransport: () => state.transportLive,
  reattachVm: deps.reattach,
}));

vi.mock("../../src/lib/runRecord", () => ({
  newSessionId: () => "session-1",
  recordRunStart: deps.recordStart,
  recordRunFinish: deps.recordFinish,
}));

vi.mock("../../src/lib/fsWatch", () => ({
  watchDartChanges: vi.fn(),
}));

vi.mock("../../src/stores/autoReload", () => ({
  autoReloadEnabled: () => false,
}));

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: vi.fn(),
});

import { consoleExited, reattachRun, runConsole, startRun } from "../../src/stores/runConsole";

const target = {
  id: "flutter",
  label: "Flutter",
  command: "flutter --color run",
  capabilities: [],
  needsDevice: false,
  deviceConvention: "arg" as const,
  inspectorKind: "vmService" as const,
  logSource: "pty" as const,
  source: "detected" as const,
};

describe("remote run reattach state", () => {
  beforeEach(() => {
    state.transportLive = true;
    state.remote = { host: "mac-mini", remoteRoot: "/srv/app" };
    deps.disarm.mockReset();
    deps.reattach.mockReset().mockResolvedValue(undefined);
    deps.recordStart.mockReset().mockResolvedValue(undefined);
    deps.recordFinish.mockReset().mockResolvedValue(undefined);
  });

  it("keeps a live-tunnel SSH 255 exit disconnected and reattaches only the inspector", async () => {
    const run = startRun(target, "/local/app");
    expect(run).toMatchObject({ cwd: "/srv/app", remote: state.remote });

    consoleExited({ code: 255, notice: "ssh exit", preserveBuffer: true });

    expect(runConsole.status()).toBe("disconnected");
    expect(deps.disarm).not.toHaveBeenCalled();
    await reattachRun();
    expect(deps.reattach).toHaveBeenCalledOnce();
  });

  it("runs a remote monorepo app from its detected pubspec directory", () => {
    state.remote = { host: "mac-mini", remoteRoot: "/srv/repo" };
    const run = startRun(
      { ...target, cwd: "/srv/repo/apps/app" },
      "/local/app",
    );

    expect(run).toMatchObject({
      cwd: "/srv/repo/apps/app",
      remote: { host: "mac-mini", remoteRoot: "/srv/repo/apps/app" },
    });
  });

  it("stops normally when no remote VM transport was live", () => {
    state.transportLive = false;
    startRun(target, "/local/app");

    consoleExited({ code: 255, notice: "ssh exit", preserveBuffer: true });

    expect(runConsole.status()).toBe("stopped");
    expect(deps.disarm).toHaveBeenCalledOnce();
  });
});
