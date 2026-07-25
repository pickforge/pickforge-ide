// The active settings category survives leaving and returning to Settings
// (pickforge#211 acceptance). Focused coverage for the localStorage
// round-trip and its failure mode, split out from the registry's pure
// availability/resolution tests in settingsRegistry.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadRememberedSettingsCategory,
  rememberSettingsCategory,
} from "../../src/screens/settingsRegistry";

const testEnv = vi.hoisted(() => {
  const mem = new Map<string, string>();
  const store: Storage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  globalThis.localStorage = store;
  return { mem, store };
});

const STORAGE_KEY = "pickforge.settings.category";

beforeEach(() => {
  testEnv.mem.clear();
});

describe("settings category persistence", () => {
  it("returns null before any category has been remembered", () => {
    expect(loadRememberedSettingsCategory()).toBeNull();
  });

  it("round-trips a remembered category through localStorage", () => {
    rememberSettingsCategory("developer");
    expect(testEnv.mem.get(STORAGE_KEY)).toBe("developer");
    expect(loadRememberedSettingsCategory()).toBe("developer");
  });

  it("overwrites a previously remembered category", () => {
    rememberSettingsCategory("agents");
    rememberSettingsCategory("remote");
    expect(loadRememberedSettingsCategory()).toBe("remote");
  });

  it("degrades to no memory when localStorage.getItem throws", () => {
    const getItem = vi.spyOn(testEnv.store, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(loadRememberedSettingsCategory()).toBeNull();
    getItem.mockRestore();
  });

  it("stays usable when localStorage.setItem throws", () => {
    const setItem = vi.spyOn(testEnv.store, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => rememberSettingsCategory("account")).not.toThrow();
    setItem.mockRestore();
  });
});
