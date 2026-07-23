import { expect, test } from "@playwright/test";

test("title-less dropdown labels and keyboard dismissal", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ operator: true }));
  });
  await page.goto("/#/settings/agentModels");
  const trigger = page.locator(".pf-settings-dropdown .pf-dropdown-trigger:not(:disabled)").first();

  await expect(trigger).toBeVisible();
  expect(await trigger.getAttribute("aria-label")).not.toMatch(/^undefined:/);

  await trigger.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("listbox")).toBeHidden();
});

test("manual chat title menu offers automatic-title resume", async ({ page }) => {
  await page.goto("/#/workbench");

  const row = page.locator(".pf-chat-row").filter({ hasText: "Login screen" });
  await row.getByTitle("Chat options").click();
  const menu = page.locator(".pf-floating-menu");
  await expect(menu.getByRole("button", { name: "Resume automatic titles" })).toBeVisible();
});
