// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  platform: "macos",
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../src/lib/platform", () => ({ hostPlatform: () => mocks.platform }));

describe("macOS traffic-light geometry", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invoke.mockReset().mockResolvedValue(undefined);
    mocks.platform = "macos";
    document.documentElement.style.setProperty("--pf-titlebar-h", "38px");
  });

  it("reports the zoomed titlebar height to the native positioner", async () => {
    const { applyTrafficLightBarHeight } = await import("../../src/lib/trafficLights");

    await applyTrafficLightBarHeight(1.25);

    expect(mocks.invoke).toHaveBeenCalledWith("set_traffic_light_bar_height", {
      barHeight: 47.5,
    });
  });

  it("leaves non-macOS window controls untouched", async () => {
    mocks.platform = "linux";
    const { applyTrafficLightBarHeight } = await import("../../src/lib/trafficLights");

    await applyTrafficLightBarHeight(1.5);

    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
