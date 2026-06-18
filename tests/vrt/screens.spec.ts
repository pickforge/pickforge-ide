import { test, expect } from "@playwright/test";

// One screenshot per route. Baselines: `npm run vrt -- --update-snapshots`.
const ROUTES = ["onboarding", "workbench", "history", "run-history", "settings"];

for (const route of ROUTES) {
  test(`route: ${route}`, async ({ page }) => {
    await page.goto(`/#/${route}`);
    // Let stores load + the ember sweep animation settle.
    await page.waitForTimeout(900);
    await expect(page).toHaveScreenshot(`${route}.png`, {
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    });
  });
}
