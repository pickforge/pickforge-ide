import { expect, test } from "@playwright/test";

// Override the suite's steady-state storage so this one spec exercises the
// first v0.2.1 launch before the retirement notice has been dismissed.
test.use({ storageState: { cookies: [], origins: [] } });

test("retirement notice: first launch only", async ({ page }) => {
  await page.goto("/#/workbench");

  await expect(page.getByRole("status", { name: "PickForge retirement notice" })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss retirement notice" }).click();
  await expect(page.getByRole("status", { name: "PickForge retirement notice" })).toBeHidden();

  await page.reload();
  await expect(page.getByRole("status", { name: "PickForge retirement notice" })).toBeHidden();
});
