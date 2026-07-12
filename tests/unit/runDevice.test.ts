import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
});

describe("run device persistence", () => {
  beforeEach(() => {
    storage.clear();
    vi.resetModules();
  });

  it("keeps the legacy project-root key for local devices", async () => {
    const { selectedDevice, setRunDevice } = await import("../../src/stores/runDevice");

    setRunDevice("/local/app", "emulator-5554");

    expect(selectedDevice("/local/app")).toBe("emulator-5554");
    expect(JSON.parse(storage.get("pickforge.runDevice")!)).toEqual({
      "/local/app": "emulator-5554",
    });
  });

  it("isolates remote choices by host and root without clobbering local choice", async () => {
    const { selectedDevice, setRunDevice } = await import("../../src/stores/runDevice");
    const mac = { host: "mac-mini", remoteRoot: "/srv/app" };
    const web = { host: "linux-box", remoteRoot: "/srv/app" };
    const otherRoot = { host: "mac-mini", remoteRoot: "/srv/other" };

    setRunDevice("/local/app", "emulator-5554");
    setRunDevice("/local/app", "macos", mac);
    setRunDevice("/local/app", "chrome", web);

    expect(selectedDevice("/local/app")).toBe("emulator-5554");
    expect(selectedDevice("/local/app", mac)).toBe("macos");
    expect(selectedDevice("/local/app", web)).toBe("chrome");
    expect(selectedDevice("/local/app", otherRoot)).toBe("");
  });
});
