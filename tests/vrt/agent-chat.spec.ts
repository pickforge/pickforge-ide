import { test, expect } from "@playwright/test";

test("agent chat fixture", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.vrt.agentChatFixture", "1");
  });

  await page.goto("/#/workbench");
  await page.getByText("Built a deterministic VRT fixture").waitFor();
  await page.getByRole("button", { name: "Show output" }).click();
  await expect(page.getByText("No visual diffs found")).toBeVisible();

  await expect(page.locator(".pf-chat-view")).toHaveScreenshot("agent-chat.png", {
    maxDiffPixelRatio: 0.025,
    animations: "disabled",
  });
});
