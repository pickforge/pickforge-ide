import { expect, test } from "@playwright/test";

test("title-less dropdown labels and keyboard dismissal", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ operator: true }));
  });
  await page.goto("/#/settings");
  const trigger = page.locator(".pf-settings-dropdown .pf-dropdown-trigger:not(:disabled)").first();

  await expect(trigger).toBeVisible();
  expect(await trigger.getAttribute("aria-label")).not.toMatch(/^undefined:/);

  await trigger.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("listbox")).toBeHidden();
});
