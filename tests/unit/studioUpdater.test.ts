import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateAdapter, UpdateEligibility } from "@pickforge/tauri-updater";

const win = vi.hoisted(() => ({
  label: "main",
  visible: false,
  focused: false,
  focusListeners: [] as ((event: { payload: boolean }) => void)[],
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: win.label,
    isVisible: () => Promise.resolve(win.visible),
    isFocused: () => Promise.resolve(win.focused),
    onFocusChanged: (listener: (event: { payload: boolean }) => void) => {
      win.focusListeners.push(listener);
      return Promise.resolve(() => {
        win.focusListeners = win.focusListeners.filter((l) => l !== listener);
      });
    },
  }),
}));

function resetWin() {
  win.label = "main";
  win.visible = false;
  win.focused = false;
  win.focusListeners = [];
}

async function loadModule() {
  vi.resetModules();
  return import("../../src/lib/studioUpdater");
}

describe("isPackagedTauriBuild", () => {
  const originalTauriInternals = (globalThis as { window?: Record<string, unknown> }).window;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalTauriInternals) {
      (globalThis as { window?: Record<string, unknown> }).window = originalTauriInternals;
    }
  });

  it("is false outside the Tauri runtime even in a PROD build", async () => {
    vi.stubEnv("PROD", true);
    const mod = await loadModule();
    expect(mod.isPackagedTauriBuild()).toBe(false);
  });

  it("is false inside Tauri when the build is not PROD (tauri dev)", async () => {
    vi.stubEnv("PROD", false);
    Reflect.set(globalThis, "window", { __TAURI_INTERNALS__: {} });
    const mod = await loadModule();
    expect(mod.isPackagedTauriBuild()).toBe(false);
  });

  it("is true only inside Tauri AND a PROD build", async () => {
    vi.stubEnv("PROD", true);
    Reflect.set(globalThis, "window", { __TAURI_INTERNALS__: {} });
    const mod = await loadModule();
    expect(mod.isPackagedTauriBuild()).toBe(true);
  });
});

describe("createMainWindowEligibility", () => {
  beforeEach(() => {
    resetWin();
    Reflect.set(globalThis, "window", { __TAURI_INTERNALS__: {} });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves false immediately when not a packaged Tauri build (dev)", async () => {
    vi.stubEnv("PROD", false);
    const mod = await loadModule();
    const eligibility = mod.createMainWindowEligibility();
    await expect(eligibility.whenEligible()).resolves.toBe(false);
  });

  it("resolves true immediately when the main window is already visible and focused", async () => {
    vi.stubEnv("PROD", true);
    win.visible = true;
    win.focused = true;
    const mod = await loadModule();
    const eligibility = mod.createMainWindowEligibility();
    await expect(eligibility.whenEligible()).resolves.toBe(true);
  });

  it("resolves false for a non-main window label", async () => {
    vi.stubEnv("PROD", true);
    win.label = "tray";
    win.visible = true;
    win.focused = true;
    const mod = await loadModule();
    const eligibility = mod.createMainWindowEligibility();
    await expect(eligibility.whenEligible()).resolves.toBe(false);
  });

  it("waits for a focus-changed event to report the window visible and focused", async () => {
    vi.stubEnv("PROD", true);
    const mod = await loadModule();
    const eligibility = mod.createMainWindowEligibility();

    const pending = eligibility.whenEligible();
    await vi.waitFor(() => expect(win.focusListeners.length).toBeGreaterThan(0));

    win.visible = true;
    win.focused = true;
    for (const listener of win.focusListeners) listener({ payload: true });

    await expect(pending).resolves.toBe(true);
  });
});

describe("createStudioUpdateController", () => {
  it("assembles a working controller from injected adapter/eligibility fakes", async () => {
    const mod = await loadModule();
    const adapter: UpdateAdapter = {
      check: vi.fn().mockResolvedValue({ version: "9.9.9" }),
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
      relaunch: vi.fn().mockResolvedValue(undefined),
    };
    const eligibility: UpdateEligibility = { whenEligible: () => Promise.resolve(true) };

    const controller = mod.createStudioUpdateController({ adapter, eligibility });
    expect(controller.getState()).toEqual({ status: "idle" });

    await controller.start();
    expect(adapter.check).toHaveBeenCalledOnce();
    expect(controller.getState()).toEqual({ status: "available", update: { version: "9.9.9" } });
  });
});
