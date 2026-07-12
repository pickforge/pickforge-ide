import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  root: "/local/app",
  remote: { host: "mac-mini", remoteRoot: "/srv/app" } as { host: string; remoteRoot: string } | null,
  status: "idle",
  selected: "macos",
  remoteDevices: {
    status: "ready",
    devices: [{ id: "macos", name: "macOS", isSupported: true, emulator: false }],
    error: null,
  } as {
    status: "ready" | "error";
    devices: Array<{ id: string; name: string; isSupported: boolean; emulator: boolean }>;
    error: string | null;
  },
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
  refreshRemoteDevices: vi.fn(),
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
  selectedDevice: () => state.selected,
  setRunDevice: deps.setRunDevice,
}));

vi.mock("../../src/stores/remoteDevices", () => ({
  remoteDeviceState: () => state.remoteDevices,
  refreshRemoteDevices: deps.refreshRemoteDevices,
  resolveRemoteDevice: (
    devices: typeof state.remoteDevices.devices,
    storedId: string,
  ) => storedId
    ? devices.find((device) => device.id === storedId) ?? null
    : devices.length === 1 ? devices[0] : null,
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
  workspace: { get activeRoot() { return state.root; } },
}));

vi.mock("../../src/lib/device", () => ({
  androidLaunchAvd: vi.fn(),
  iosBootDevice: vi.fn(),
}));

vi.mock("../../src/lib/runTargets", () => ({
  hasCapability: () => false,
  isCompatibleDevice: () => true,
  withDevice: (value: typeof target, serial: string | null) =>
    serial ? `${value.command} -d '${serial}'` : value.command,
}));

vi.mock("../../src/lib/remoteContext", () => ({
  remotePtyFor: (root: string) => root === "/local/app" ? state.remote : null,
}));

import { launchActiveTarget } from "../../src/stores/runLaunch";

describe("launchActiveTarget remote routing", () => {
  beforeEach(() => {
    state.root = "/local/app";
    state.remote = { host: "mac-mini", remoteRoot: "/srv/app" };
    state.status = "idle";
    state.selected = "macos";
    state.remoteDevices = {
      status: "ready",
      devices: [{ id: "macos", name: "macOS", isSupported: true, emulator: false }],
      error: null,
    };
    deps.openConsole.mockReset();
    deps.startRun.mockReset().mockReturnValue({ key: 9 });
    deps.refreshDevices.mockReset();
    deps.armVm.mockReset();
    deps.disconnectVm.mockReset();
    deps.ensureMcp.mockReset().mockResolvedValue(undefined);
    deps.mcpStarted.mockReset();
    deps.setRunDevice.mockReset();
    deps.refreshRemoteDevices.mockReset().mockImplementation(async () => state.remoteDevices);
  });

  it("launches the selected remote device with a deterministic -d argument", async () => {
    await launchActiveTarget();

    expect(deps.refreshDevices).not.toHaveBeenCalled();
    expect(deps.refreshRemoteDevices).toHaveBeenCalledWith("/local/app", state.remote);
    expect(deps.setRunDevice).toHaveBeenCalledWith("/local/app", "macos", state.remote);
    expect(deps.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ command: "flutter --color run -d 'macos'" }),
      "/local/app",
      expect.objectContaining({ serial: "macos" }),
      state.remote,
    );
    expect(deps.armVm).toHaveBeenCalledWith({
      remote: state.remote,
      projectRoot: "/local/app",
      runId: "run-9",
    });
  });

  it("auto-selects the only supported remote device", async () => {
    state.selected = "";

    await launchActiveTarget();

    expect(deps.setRunDevice).toHaveBeenCalledWith("/local/app", "macos", state.remote);
    expect(deps.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ command: "flutter --color run -d 'macos'" }),
      expect.anything(),
      expect.anything(),
      state.remote,
    );
  });

  it("blocks multiple devices until the user makes an explicit choice", async () => {
    state.selected = "";
    state.remoteDevices.devices.push({ id: "chrome", name: "Chrome", isSupported: true, emulator: false });

    await launchActiveTarget();

    expect(deps.startRun).not.toHaveBeenCalled();
  });

  it("blocks a stale saved device instead of silently switching", async () => {
    state.selected = "chrome";

    await launchActiveTarget();

    expect(deps.startRun).not.toHaveBeenCalled();
  });

  it("surfaces discovery failures without launching bare flutter run", async () => {
    state.remoteDevices = { status: "error", devices: [], error: "SSH unavailable" };

    await launchActiveTarget();

    expect(deps.startRun).not.toHaveBeenCalled();
  });

  it("cancels when the active project changes during remote discovery", async () => {
    let resolveDiscovery!: (value: typeof state.remoteDevices) => void;
    deps.refreshRemoteDevices.mockImplementation(() => new Promise((resolve) => {
      resolveDiscovery = resolve;
    }));

    const launch = launchActiveTarget();
    await vi.waitFor(() => expect(deps.refreshRemoteDevices).toHaveBeenCalledTimes(1));
    state.root = "/other/app";
    resolveDiscovery(state.remoteDevices);
    await launch;

    expect(deps.setRunDevice).not.toHaveBeenCalled();
    expect(deps.disconnectVm).not.toHaveBeenCalled();
    expect(deps.startRun).not.toHaveBeenCalled();
  });

  it("ignores a second Run click while disconnecting the previous inspector", async () => {
    let resolveDisconnect!: () => void;
    deps.disconnectVm.mockImplementation(() => new Promise<void>((resolve) => {
      resolveDisconnect = resolve;
    }));

    const first = launchActiveTarget();
    const second = launchActiveTarget();

    await vi.waitFor(() => expect(deps.disconnectVm).toHaveBeenCalledTimes(1));
    expect(deps.startRun).not.toHaveBeenCalled();
    resolveDisconnect();
    await Promise.all([first, second]);

    expect(deps.startRun).toHaveBeenCalledTimes(1);
  });
});
