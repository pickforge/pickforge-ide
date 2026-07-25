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

test("the app shell remains locked to the viewport with a portaled menu open", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pickforge.tourDone", "1"));
  await page.goto("/#/workbench");

  const row = page.locator(".pf-chat-row").filter({ hasText: "Login screen" });
  await row.getByTitle("Chat options").click();
  await expect(page.locator(".pf-floating-menu")).toBeVisible();

  const documentSize = await page.evaluate(() => {
    const scrollingElement = document.scrollingElement!;
    return {
      scrollHeight: scrollingElement.scrollHeight,
      clientHeight: scrollingElement.clientHeight,
      scrollWidth: scrollingElement.scrollWidth,
      clientWidth: scrollingElement.clientWidth,
    };
  });
  expect(documentSize.scrollHeight).toBe(documentSize.clientHeight);
  expect(documentSize.scrollWidth).toBe(documentSize.clientWidth);

  // The root lock above would also hide a mispositioned menu by clipping it,
  // so pin the placement itself: the menu must land fully inside the viewport.
  const menuBox = await page.locator(".pf-floating-menu").boundingBox();
  const viewport = page.viewportSize()!;
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height);
});
