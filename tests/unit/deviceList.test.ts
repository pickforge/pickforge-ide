import { beforeEach, describe, expect, it, vi } from "vitest";

// The store reaches Tauri through ./lib/device (android_device_list /
// ios_device_list). Mock the invoke seam so we can drive each source
// independently and assert the merge is resilient to one failing/empty.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => invokeMock(cmd) }));

import { deviceList, refreshDevices } from "../../src/stores/deviceList";
import type { DeviceEntry } from "../../src/lib/device";

const androidRow: DeviceEntry = {
  serial: "emulator-5554",
  avdId: "Pixel_10",
  displayName: "Pixel 10",
  state: "running",
  kind: "emulator",
};
const iosRow: DeviceEntry = {
  serial: "SIM-9F3A-1D7B",
  avdId: null,
  displayName: "iPhone 17 Pro (iOS 26.5)",
  state: "running",
  kind: "simulator",
};

/** Route each device-list command to a fixed result or a rejection. */
function route(opts: {
  android?: DeviceEntry[] | "throw";
  ios?: DeviceEntry[] | "throw";
}) {
  invokeMock.mockImplementation((cmd: string) => {
    const val = cmd === "android_device_list" ? opts.android : cmd === "ios_device_list" ? opts.ios : null;
    if (val === "throw") return Promise.reject(new Error(`${cmd} failed`));
    return Promise.resolve(val ?? []);
  });
}

describe("deviceList merge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("concatenates both sources (Android first, then iOS)", async () => {
    route({ android: [androidRow], ios: [iosRow] });
    const list = await refreshDevices();
    expect(list).toEqual([androidRow, iosRow]);
    expect(deviceList()).toEqual([androidRow, iosRow]);
  });

  it("keeps one source's devices when the other throws", async () => {
    route({ android: "throw", ios: [iosRow] });
    expect(await refreshDevices()).toEqual([iosRow]);

    route({ android: [androidRow], ios: "throw" });
    expect(await refreshDevices()).toEqual([androidRow]);
  });

  it("keeps one source's devices when the other is empty", async () => {
    route({ android: [], ios: [iosRow] });
    expect(await refreshDevices()).toEqual([iosRow]);
  });

  it("preserves the existing list when BOTH sources are unreachable", async () => {
    // Seed a known-good list.
    route({ android: [androidRow], ios: [iosRow] });
    await refreshDevices();
    // Now both throw (e.g. not in Tauri) — the list must not be clobbered.
    route({ android: "throw", ios: "throw" });
    expect(await refreshDevices()).toEqual([androidRow, iosRow]);
    expect(deviceList()).toEqual([androidRow, iosRow]);
  });
});
