import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mocks.getVersion,
}));

describe("app info", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getVersion.mockReset();
  });

  it("loads the runtime app version once", async () => {
    mocks.getVersion.mockResolvedValue("0.1.7-performance");
    const { appVersion, loadAppVersion } = await import("../../src/lib/appInfo");

    expect(appVersion()).toBe("0.1.0");
    await loadAppVersion();
    await loadAppVersion();

    expect(appVersion()).toBe("0.1.7-performance");
    expect(mocks.getVersion).toHaveBeenCalledTimes(1);
  });

  it("keeps the bundled fallback when the runtime version is unavailable", async () => {
    mocks.getVersion.mockRejectedValue(new Error("not in tauri"));
    const { appVersion, loadAppVersion } = await import("../../src/lib/appInfo");

    await loadAppVersion();

    expect(appVersion()).toBe("0.1.0");
  });
});
