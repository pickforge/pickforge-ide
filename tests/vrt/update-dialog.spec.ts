import { expect, test, type Page } from "@playwright/test";

// Shared updater dialog (@pickforge/tauri-updater, pickforge/pickforge-platform#36):
// deterministic fixture states rendered through the real flag + mount path,
// bypassing the packaged-build/window-eligibility gate via the VRT-only
// controller fixture (src/lib/studioUpdateFixture.ts).
const SIZES = [
  { name: "wide", width: 1280, height: 820 },
  { name: "narrow", width: 880, height: 600 },
];

async function openWithFixture(page: Page, fixtureName: "available" | "downloading") {
  await page.addInitScript((name) => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ studioUpdateDialog: true }));
    localStorage.setItem("pickforge.vrt.updateFixture", name);
  }, fixtureName);
  await page.goto("/#/workbench");
  // The host custom element has no box of its own — its shadow <dialog>
  // renders in the top layer via showModal(), so assert on its content
  // rather than the host element's own visibility.
  await expect(page.locator("pickforge-update-dialog dialog[open]")).toHaveCount(1);
}

test.describe("update dialog", () => {
  for (const size of SIZES) {
    test(`visual: available with release notes (${size.name})`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openWithFixture(page, "available");

      await expect(page.getByRole("heading", { name: "A new version is ready" })).toBeVisible();
      await expect(page.getByText("0.2.0")).toBeVisible();
      await expect(page.getByText("Faster device pairing", { exact: false })).toBeVisible();
      await expect(page.getByRole("button", { name: "Update & restart" })).toBeFocused();

      await expect(page).toHaveScreenshot(`update-dialog-available-${size.name}.png`, {
        animations: "disabled",
      });
    });

    test(`visual: downloading (${size.name})`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openWithFixture(page, "downloading");

      await expect(page.getByRole("heading", { name: "Updating your app" })).toBeVisible();
      await expect(page.getByText("Downloading… 44%")).toBeVisible();

      await expect(page).toHaveScreenshot(`update-dialog-downloading-${size.name}.png`, {
        animations: "disabled",
      });
    });
  }
});
