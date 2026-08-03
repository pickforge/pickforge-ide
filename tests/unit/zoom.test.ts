// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setZoom: vi.fn<(zoom: number) => Promise<void>>(),
  applyTrafficLights: vi.fn<(zoom: number) => Promise<void>>(),
  calls: [] as string[],
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: mocks.setZoom }),
}));
vi.mock("../../src/lib/trafficLights", () => ({
  applyTrafficLightBarHeight: mocks.applyTrafficLights,
}));

const stored = new Map<string, string>();
const storage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
  clear: () => stored.clear(),
  key: () => null,
  get length() {
    return stored.size;
  },
} satisfies Storage;

describe("interface zoom", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    localStorage.clear();
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    mocks.calls.length = 0;
    mocks.setZoom.mockReset().mockImplementation(async (zoom) => {
      mocks.calls.push(`webview:${zoom}`);
    });
    mocks.applyTrafficLights.mockReset().mockImplementation(async (zoom) => {
      mocks.calls.push(`traffic:${zoom}`);
    });
  });

  it("updates native traffic lights after the webview reaches 125%", async () => {
    const { zoomIn } = await import("../../src/lib/zoom");

    zoomIn();
    await vi.waitFor(() => expect(mocks.applyTrafficLights).toHaveBeenCalledWith(1.25));

    expect(mocks.calls).toEqual(["webview:1.25", "traffic:1.25"]);
  });

  it("applies persisted zoom to both surfaces on startup", async () => {
    localStorage.setItem("pickforge.zoom", "1.5");
    const { applyPersistedZoom } = await import("../../src/lib/zoom");

    applyPersistedZoom();
    await vi.waitFor(() => expect(mocks.applyTrafficLights).toHaveBeenCalledWith(1.5));

    expect(mocks.calls).toEqual(["webview:1.5", "traffic:1.5"]);
  });
});
