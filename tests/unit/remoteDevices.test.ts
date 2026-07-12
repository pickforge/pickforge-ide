import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("../../src/lib/remoteHost", () => ({
  remoteFlutterDevices: deps.list,
}));

const remote = { host: "mac-mini", remoteRoot: "/srv/app" };

describe("remote Flutter devices", () => {
  beforeEach(() => {
    deps.list.mockReset();
    vi.resetModules();
  });

  it("filters unsupported devices and sorts stable labels", async () => {
    deps.list.mockResolvedValue([
      { id: "macos", name: "macOS", isSupported: true },
      { id: "android", name: "Android", isSupported: false },
      { id: "chrome", name: "Chrome", isSupported: true },
    ]);
    const store = await import("../../src/stores/remoteDevices");

    const state = await store.refreshRemoteDevices("/local/app", remote);

    expect(deps.list).toHaveBeenCalledWith("/local/app", "mac-mini", "/srv/app");
    expect(state.devices.map((device) => device.id)).toEqual(["chrome", "macos"]);
    expect(store.remoteDeviceState("/local/app", remote).status).toBe("ready");
  });

  it("deduplicates concurrent discovery for one binding", async () => {
    let resolve!: (value: unknown[]) => void;
    deps.list.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const store = await import("../../src/stores/remoteDevices");

    const first = store.refreshRemoteDevices("/local/app", remote);
    const second = store.refreshRemoteDevices("/local/app", remote);

    expect(first).toBe(second);
    expect(deps.list).toHaveBeenCalledTimes(1);
    resolve([]);
    await first;
  });

  it("keeps bindings isolated and exposes discovery errors", async () => {
    deps.list
      .mockResolvedValueOnce([{ id: "macos", name: "macOS", isSupported: true }])
      .mockRejectedValueOnce(new Error("SSH unavailable"));
    const store = await import("../../src/stores/remoteDevices");
    const other = { host: "linux-box", remoteRoot: "/srv/app" };

    await store.refreshRemoteDevices("/local/app", remote);
    await store.refreshRemoteDevices("/local/app", other);

    expect(store.remoteDeviceState("/local/app", remote).devices[0]?.id).toBe("macos");
    expect(store.remoteDeviceState("/local/app", other)).toEqual({
      status: "error",
      devices: [],
      error: "SSH unavailable",
    });
  });

  it("resolves a saved match or an unsaved singleton without replacing stale choices", async () => {
    const { resolveRemoteDevice } = await import("../../src/stores/remoteDevices");
    const devices = [
      { id: "chrome", name: "Chrome", isSupported: true },
      { id: "macos", name: "macOS", isSupported: true },
    ];

    expect(resolveRemoteDevice(devices, "macos")?.id).toBe("macos");
    expect(resolveRemoteDevice(devices, "missing")).toBeNull();
    expect(resolveRemoteDevice(devices, "")).toBeNull();
    expect(resolveRemoteDevice([devices[0]], "")?.id).toBe("chrome");
  });
});
