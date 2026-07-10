import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  vmConnect: vi.fn(),
  vmDisconnect: vi.fn(),
  vmStatus: vi.fn(),
  tunnelOpen: vi.fn(),
  tunnelClose: vi.fn(),
  tunnelClosed: null as ((event: {
    tunnelId: string;
    host: string;
    localPort: number;
    runId: string;
    exitCode: number | null;
  }) => void) | null,
  unlisten: vi.fn(),
}));

vi.mock("../../src/lib/vm", () => ({
  vmConnect: mocks.vmConnect,
  vmDisconnect: mocks.vmDisconnect,
  vmStatus: mocks.vmStatus,
}));

vi.mock("../../src/lib/remoteHost", () => ({
  remoteTunnelOpen: mocks.tunnelOpen,
  remoteTunnelClose: mocks.tunnelClose,
  onRemoteTunnelClosed: vi.fn((callback) => {
    mocks.tunnelClosed = callback;
    return Promise.resolve(mocks.unlisten);
  }),
}));

import {
  armVmAutoConnect,
  detectVmUrl,
  disarmVmAutoConnect,
  ingestRunOutput,
  resetVmServiceForTest,
  rewriteVmServiceUrlForTunnel,
  vmService,
} from "../../src/stores/vmService";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("remote VM-service flow", () => {
  beforeEach(() => {
    resetVmServiceForTest();
    mocks.vmConnect.mockReset().mockResolvedValue(undefined);
    mocks.vmDisconnect.mockReset().mockResolvedValue(undefined);
    mocks.vmStatus.mockReset().mockResolvedValue("ws://127.0.0.1:43123/token/ws");
    mocks.tunnelOpen.mockReset();
    mocks.tunnelOpen
      .mockResolvedValueOnce({ tunnelId: "tunnel-1", localPort: 43123 })
      .mockResolvedValueOnce({ tunnelId: "tunnel-2", localPort: 43124 });
    mocks.tunnelClose.mockReset().mockResolvedValue(undefined);
    mocks.tunnelClosed = null;
    mocks.unlisten.mockReset();
  });

  afterEach(() => resetVmServiceForTest());

  it("rewrites only the host and port, preserving the VM auth path", () => {
    expect(
      rewriteVmServiceUrlForTunnel("ws://localhost:8181/abc_DEF-123=/ws?foo=bar", 43123),
    ).toBe("ws://127.0.0.1:43123/abc_DEF-123=/ws?foo=bar");
    expect(detectVmUrl("service ws://127.0.0.1:8181/abc_DEF-123=/ws ready")).toBe(
      "ws://127.0.0.1:8181/abc_DEF-123=/ws",
    );
  });

  it("opens a tunnel for remote run output and connects only through loopback", async () => {
    armVmAutoConnect({
      remote: { host: "mac-mini", remoteRoot: "/srv/app" },
      projectRoot: "/local/app",
      runId: "run-9",
    });
    ingestRunOutput("Dart VM Service: ws://127.0.0.1:8181/abc_DEF-123=/ws\n");
    await flush();
    await flush();

    expect(mocks.tunnelOpen).toHaveBeenCalledWith("/local/app", "mac-mini", 8181, "run-9");
    expect(mocks.vmConnect).toHaveBeenCalledWith("ws://127.0.0.1:43123/abc_DEF-123=/ws");
    expect(vmService.connected()).toBe(true);
  });

  it("surfaces a tunnel-open rejection with the remote connection pointer", async () => {
    mocks.tunnelOpen.mockReset().mockRejectedValue(new Error("host is offline"));
    armVmAutoConnect({
      remote: { host: "mac-mini", remoteRoot: "/srv/app" },
      projectRoot: "/local/app",
      runId: "run-9",
    });
    ingestRunOutput("ws://127.0.0.1:8181/token/ws");
    await flush();
    await flush();

    expect(mocks.vmConnect).not.toHaveBeenCalled();
    expect(vmService.error()).toContain("ssh:mac-mini unavailable");
    expect(vmService.error()).toContain("Test connection");
    expect(vmService.error()).toContain("host is offline");
  });

  it("closes a tunnel that resolves after its run stops", async () => {
    let resolveTunnel!: (tunnel: { tunnelId: string; localPort: number }) => void;
    mocks.tunnelOpen.mockReset().mockImplementation(() => new Promise((resolve) => {
      resolveTunnel = resolve;
    }));
    armVmAutoConnect({
      remote: { host: "mac-mini", remoteRoot: "/srv/app" },
      projectRoot: "/local/app",
      runId: "run-9",
    });
    ingestRunOutput("ws://127.0.0.1:8181/token/ws");
    await flush();

    disarmVmAutoConnect();
    resolveTunnel({ tunnelId: "tunnel-after-stop", localPort: 43123 });
    await flush();
    await flush();

    expect(mocks.tunnelClose).toHaveBeenCalledWith("tunnel-after-stop");
    expect(mocks.vmConnect).not.toHaveBeenCalled();
    expect(vmService.connected()).toBe(false);
  });

  it("reopens once when the SSH tunnel child exits", async () => {
    armVmAutoConnect({
      remote: { host: "mac-mini", remoteRoot: "/srv/app" },
      projectRoot: "/local/app",
      runId: "run-9",
    });
    ingestRunOutput("ws://127.0.0.1:8181/token/ws");
    await flush();
    await flush();

    mocks.tunnelClosed?.({
      tunnelId: "tunnel-1",
      host: "mac-mini",
      localPort: 43123,
      runId: "run-9",
      exitCode: 255,
    });
    await flush();
    await flush();

    expect(mocks.tunnelOpen).toHaveBeenCalledTimes(2);
    expect(mocks.vmConnect).toHaveBeenLastCalledWith("ws://127.0.0.1:43124/token/ws");

    mocks.tunnelClosed?.({
      tunnelId: "tunnel-2",
      host: "mac-mini",
      localPort: 43124,
      runId: "run-9",
      exitCode: 255,
    });
    await flush();

    expect(mocks.tunnelOpen).toHaveBeenCalledTimes(2);
    expect(vmService.error()).toContain("closed again");
  });

  it("does not let an old tunnel-close handler adopt a new run's VM connection", async () => {
    let resolveDisconnect!: () => void;
    mocks.vmDisconnect.mockImplementation(() => new Promise<void>((resolve) => {
      resolveDisconnect = resolve;
    }));
    armVmAutoConnect({
      remote: { host: "mac-mini", remoteRoot: "/srv/app" },
      projectRoot: "/local/app",
      runId: "run-9",
    });
    ingestRunOutput("ws://127.0.0.1:8181/token/ws");
    await flush();
    await flush();

    mocks.tunnelClosed?.({
      tunnelId: "tunnel-1",
      host: "mac-mini",
      localPort: 43123,
      runId: "run-9",
      exitCode: 255,
    });
    await flush();

    armVmAutoConnect({
      remote: { host: "mac-mini", remoteRoot: "/srv/app" },
      projectRoot: "/local/app",
      runId: "run-10",
    });
    ingestRunOutput("ws://127.0.0.1:8181/token/ws");
    await flush();
    await flush();
    resolveDisconnect();
    await flush();

    expect(mocks.tunnelOpen).toHaveBeenCalledTimes(2);
    expect(mocks.tunnelOpen).toHaveBeenLastCalledWith("/local/app", "mac-mini", 8181, "run-10");
    expect(vmService.connected()).toBe(true);
  });
});
