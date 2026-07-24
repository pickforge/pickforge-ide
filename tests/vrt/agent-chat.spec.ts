import { test, expect } from "@playwright/test";

test("agent chat fixture", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.vrt.agentChatFixture", "1");
  });

  await page.goto("/#/workbench");
  await page.getByText("Built a deterministic VRT fixture").waitFor();
  await page.getByRole("button", { name: "Show command details" }).click();
  await expect(page.getByText("No visual diffs found")).toBeVisible();

  // The plan fixture carries pending, in-progress, and completed steps —
  // pin coverage for #233's [ ] / [>] / [x] contract.
  const planCard = page.locator(".pf-chat-plan");
  await expect(planCard.locator(".pf-chat-plan-mark")).toHaveText(["[x]", "[x]", "[>]", "[ ]"]);
  await expect(planCard.locator(".pf-chat-plan-actions .pf-chat-meta")).toHaveText("2/4");
  await expect(planCard.locator('.pf-chat-plan-item[aria-current="step"]')).toHaveCount(1);
  await expect(planCard.locator(".pf-chat-plan-item--active")).toHaveCount(1);

  const pinButton = planCard.locator(".pf-chat-plan-pin");
  await expect(pinButton).toHaveAttribute("aria-pressed", "false");
  await pinButton.click();
  await expect(pinButton).toHaveAttribute("aria-pressed", "true");
  await pinButton.click();
  await expect(pinButton).toHaveAttribute("aria-pressed", "false");
  const timeline = page.locator(".pf-chat-timeline");
  const settledTimeline = await timeline.evaluate(async (element) => {
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const snapshot = () => {
      const firstRow = element.querySelector<HTMLElement>(".pf-chat-timeline-inner > *");
      return {
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        firstRowTop: firstRow?.getBoundingClientRect().top,
      };
    };

    element.scrollTop = element.scrollHeight;
    await nextFrame();
    await nextFrame();
    element.scrollTop = 0;
    await nextFrame();
    await nextFrame();
    // ChatTimeline releases deferred ResizeObserver updates after 120 ms of scroll idle.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 121));
    await nextFrame();

    const before = snapshot();
    await nextFrame();
    const after = snapshot();
    if (
      before.scrollTop !== after.scrollTop
      || before.scrollHeight !== after.scrollHeight
      || before.firstRowTop !== after.firstRowTop
    ) {
      throw new Error("Agent chat timeline did not settle before screenshot capture");
    }
    return after;
  });
  expect(settledTimeline.scrollTop).toBe(0);


  await expect(page.locator(".pf-chat-view")).toHaveScreenshot("agent-chat.png", {
    maxDiffPixelRatio: 0.025,
    animations: "disabled",
  });
});
