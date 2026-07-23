import { expect, test, type Page } from "@playwright/test";

// Linux-only graphics compatibility mode (#238). src/lib/platform.ts's
// hostPlatform() sniffs navigator.userAgent for a "linux" host (no
// Macintosh/Windows markers) — on a Linux CI runner that's already true of
// plain default Chromium, but pinning it explicitly here makes this spec's
// premise (the section renders) deterministic on any runner, including a
// developer's non-Linux machine. See src/lib/tauriMock.ts for the
// deterministic linux_graphics_* fixture data backing the section.
//
// This is a *focused* spec on top of the whole-page "general" category
// screenshot in settings-navigation.spec.ts: the section sits below that
// screenshot's viewport, so it needs its own scoped baseline rather than
// only ever being covered incidentally by a full-page diff.
test.use({
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
});

const SETTINGS_FLAGS = { settingsNavigation: true };

async function openSettings(page: Page, flags: Record<string, boolean> = SETTINGS_FLAGS) {
  await page.addInitScript((enabledFlags) => {
    localStorage.setItem("pickforge.flags", JSON.stringify(enabledFlags));
  }, flags);
  await page.goto("/#/settings/linuxGraphics");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test.describe("Linux graphics compatibility mode", () => {
  test("defaults to Auto with no restart notice", async ({ page }) => {
    await openSettings(page);

    const section = page.locator("[data-settings-section=linuxGraphics]");
    await expect(section.getByRole("button", { name: "Auto" })).toHaveClass(/active/);
    await expect(section.getByRole("button", { name: "Compatibility" })).not.toHaveClass(/active/);
    await expect(section.getByRole("button", { name: "Native Wayland" })).not.toHaveClass(/active/);
    await expect(section.getByText("Restart PickForge", { exact: false })).toHaveCount(0);

    await expect(section).toHaveScreenshot("linux-graphics-auto.png", {
      animations: "disabled",
    });
  });

  test("selecting Compatibility shows the restart-required notice and action", async ({ page }) => {
    await openSettings(page);

    const section = page.locator("[data-settings-section=linuxGraphics]");
    await section.getByRole("button", { name: "Compatibility" }).click();

    await expect(section.getByRole("button", { name: "Compatibility" })).toHaveClass(/active/);
    await expect(section.getByText("Restart PickForge", { exact: false })).toBeVisible();
    await expect(section.getByRole("button", { name: "Restart now" })).toBeVisible();

    await expect(section).toHaveScreenshot("linux-graphics-compatibility-restart-required.png", {
      animations: "disabled",
    });
  });

  test("switching back to the boot-active mode clears the restart notice", async ({ page }) => {
    await openSettings(page);

    const section = page.locator("[data-settings-section=linuxGraphics]");
    await section.getByRole("button", { name: "Compatibility" }).click();
    await expect(section.getByText("Restart PickForge", { exact: false })).toBeVisible();

    // Auto is the mock's boot-applied mode (src/lib/tauriMock.ts) — an
    // A→B→A round trip must clear the notice, not leave it "stuck" (#238 P2).
    await section.getByRole("button", { name: "Auto" }).click();
    await expect(section.getByText("Restart PickForge", { exact: false })).toHaveCount(0);
  });
});
