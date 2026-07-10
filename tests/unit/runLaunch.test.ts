import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  remote: { host: "mac-mini", remoteRoot: "/srv/app" } as { host: string; remoteRoot: string } | null,
  status: "idle",
}));

const deps = vi.hoisted(() => ({
  openConsole: vi.fn(),
  startRun: vi.fn(),
  refreshDevices: vi.fn(),
  armVm: vi.fn(),
  disconnectVm: vi.fn(),
  ensureMcp: vi.fn(),
  mcpStarted: vi.fn(),
  setRunDevice: vi.fn(),
}));

const target = {
  id: "flutter",
  label: "Flutter",
  command: "flutter --color run",
  capabilities: ["launch", "hotReload", "hotRestart"],
  needsDevice: true,
  deviceConvention: "arg" as const,
  inspectorKind: "vmService" as const,
  logSource: "pty" as const,
  source: "detected" as const,
};

vi.mock("../../src/stores/runTargets", () => ({
  activeTarget: () => target,
}));

vi.mock("../../src/stores/deviceList", () => ({
  deviceList: () => [],
  refreshDevices: deps.refreshDevices,
}));

vi.mock("../../src/stores/runDevice", () => ({
  selectedDevice: () => null,
  setRunDevice: deps.setRunDevice,
}));

vi.mock("../../src/stores/runConsole", () => ({
  openConsole: deps.openConsole,
  runConsole: { status: () => state.status, target: () => null },
  startRun: deps.startRun,
}));

vi.mock("../../src/stores/vmService", () => ({
  armVmAutoConnect: deps.armVm,
  disconnectVm: deps.disconnectVm,
}));

vi.mock("../../src/stores/mcp", () => ({
  ensureMcpRunning: deps.ensureMcp,
  mcpRunStarted: deps.mcpStarted,
}));

vi.mock("../../src/stores/workspace", () => ({
  workspace: { activeRoot: "/local/app" },
}));

vi.mock("../../src/lib/device", () => ({
  androidLaunchAvd: vi.fn(),
  iosBootDevice: vi.fn(),
}));

vi.mock("../../src/lib/runTargets", () => ({
  hasCapability: () => false,
  isCompatibleDevice: () => true,
  withDevice: (value: typeof target) => value.command,
}));

vi.mock("../../src/lib/remoteContext", () => ({
  remotePtyFor: () => state.remote,
}));

import { launchActiveTarget } from "../../src/stores/runLaunch";

describe("launchActiveTarget remote routing", () => {
  beforeEach(() => {
    state.remote = { host: "mac-mini", remoteRoot: "/srv/app" };
    state.status = "idle";
    deps.openConsole.mockReset();
    deps.startRun.mockReset().mockReturnValue({ key: 9 });
    deps.refreshDevices.mockReset();
    deps.armVm.mockReset();
    deps.disconnectVm.mockReset();
    deps.ensureMcp.mockReset().mockResolvedValue(undefined);
    deps.mcpStarted.mockReset();
    deps.setRunDevice.mockReset();
  });

  it("uses the captured remote PTY and skips local device resolution", async () => {
    await launchActiveTarget();

    expect(deps.refreshDevices).not.toHaveBeenCalled();
    expect(deps.setRunDevice).not.toHaveBeenCalled();
    expect(deps.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ command: "flutter --color run" }),
      "/local/app",
      expect.objectContaining({ serial: null }),
      state.remote,
    );
    expect(deps.armVm).toHaveBeenCalledWith({
      remote: state.remote,
      projectRoot: "/local/app",
      runId: "run-9",
    });
  });
});
