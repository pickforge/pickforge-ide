// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { route, settingsSection } from "../../src/router";

function applyHash(hash: string): void {
  window.history.replaceState(null, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

afterEach(() => applyHash("#/workbench"));

describe("settings hash routing", () => {
  it("parses suffixes only for Settings routes", () => {
    applyHash("#/settings/quickLaunch");
    expect(route()).toBe("settings");
    expect(settingsSection()).toBe("quickLaunch");

    applyHash("#/history/quickLaunch");
    expect(route()).toBe("workbench");
    expect(settingsSection()).toBeNull();

    applyHash("#/settings/quickLaunch/trailing");
    expect(route()).toBe("workbench");
    expect(settingsSection()).toBeNull();
  });

  it("decodes valid Settings suffixes", () => {
    applyHash("#/settings/quick%20launch");

    expect(route()).toBe("settings");
    expect(settingsSection()).toBe("quick launch");
  });

  it("keeps malformed Settings suffixes invalid without throwing", () => {
    expect(() => applyHash("#/settings/%E0%A4%A")).not.toThrow();
    expect(route()).toBe("settings");
    expect(settingsSection()).toBe("%E0%A4%A");
  });
});
