import { test, expect } from "@playwright/test";

test("agent chat fixture", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.vrt.agentChatFixture", "1");
    // #231 PR3 renders behind the default-off `changesReview` flag.
    localStorage.setItem("pickforge.flags", JSON.stringify({ changesReview: true }));
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

  // #231 PR3: the completed turn's file changes render as one compact,
  // collapsed-by-default receipt instead of a raw inline diff card. The
  // fixture's two files both carry no diff body, so their line counts are
  // honestly unknown — never a fabricated "+0 −0" per file.
  const receipt = page.locator(".pf-chat-receipt");
  await expect(receipt.locator(".pf-chat-meta").first()).toHaveText("2 files changed");
  await expect(receipt.locator(".pf-chat-receipt-stat--add")).toHaveText("+0");
  await expect(receipt.locator(".pf-chat-receipt-stat--del")).toHaveText("−0");
  await expect(receipt.locator(".pf-chat-receipt-unknown-flag")).toBeVisible();
  await expect(receipt.locator(".pf-chat-receipt-counts")).toHaveText("1 added · 1 modified");
  await expect(receipt.locator(".pf-chat-receipt-review")).toHaveText("Review changes");

  const receiptToggle = receipt.locator(".pf-chat-receipt-toggle");
  await expect(receiptToggle).toHaveAttribute("aria-expanded", "false");
  await receiptToggle.click();
  await expect(receiptToggle).toHaveAttribute("aria-expanded", "true");
  const receiptRows = receipt.locator(".pf-chat-receipt-row");
  await expect(receiptRows).toHaveCount(2);
  await expect(receiptRows.nth(0).locator(".pf-chat-receipt-path")).toHaveText("src/lib/tauriMock.ts");
  await expect(receiptRows.nth(0).locator(".pf-chat-receipt-status")).toHaveText("M");
  await expect(receiptRows.nth(1).locator(".pf-chat-receipt-path")).toHaveText("tests/vrt/agent-chat.spec.ts");
  await expect(receiptRows.nth(1).locator(".pf-chat-receipt-status")).toHaveText("A");
  await expect(receiptRows.first().locator(".pf-chat-receipt-unknown")).toHaveText("unknown");
  // Collapse back to the default state before pinning the screenshot.
  await receiptToggle.click();
  await expect(receiptToggle).toHaveAttribute("aria-expanded", "false");

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

    // Poll for a settled pair rather than demanding the very first pair of
    // frames match. The layout genuinely does settle, but on a loaded CI runner
    // a single ResizeObserver commit can land between these two frames and the
    // one-shot check reported that as "did not settle" — a flake that reddened
    // unrelated PRs (observed 4/4 on a branch that passed 6/6 locally). Waiting
    // longer is not weaker: the assertion is still "two consecutive frames are
    // identical", it just gets more than one chance to observe it, and it still
    // fails loudly if the timeline never stops moving.
    let before = snapshot();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await nextFrame();
      const after = snapshot();
      if (
        before.scrollTop === after.scrollTop
        && before.scrollHeight === after.scrollHeight
        && before.firstRowTop === after.firstRowTop
      ) {
        return after;
      }
      before = after;
    }
    throw new Error("Agent chat timeline did not settle before screenshot capture");
  });
  expect(settledTimeline.scrollTop).toBe(0);


  await expect(page.locator(".pf-chat-view")).toHaveScreenshot("agent-chat.png", {
    maxDiffPixelRatio: 0.025,
    animations: "disabled",
  });
});

// #231 PR3 is gated behind `changesReview` (default off). With the flag off,
// the fixture's turn keeps rendering the pre-existing raw per-event
// FileChangeCard exactly as on main, and the chat view never fetches
// `changes_list_turn_change_sets` at all.
test("agent chat fixture with changesReview off renders the legacy file-change card", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.vrt.agentChatFixture", "1");
  });

  await page.goto("/#/workbench");
  await page.getByText("Built a deterministic VRT fixture").waitFor();

  await expect(page.locator(".pf-chat-receipt")).toHaveCount(0);
  const filesCard = page.locator(".pf-chat-files");
  await expect(filesCard).toBeVisible();
  await expect(filesCard.locator(".pf-chat-file")).toHaveCount(2);
  await expect(filesCard.locator(".pf-chat-file-path").first()).toHaveText("src/lib/tauriMock.ts");

  const fetchCount = await page.evaluate(
    () => (window as unknown as Record<string, unknown>).__PICKFORGE_VRT_CHANGES_LIST_CALLS__ ?? 0,
  );
  expect(fetchCount).toBe(0);
});

// #307: contextUsed > contextWindow must not render an unclamped >100%
// label — the meter clamps the label like the bar and surfaces a distinct,
// assistive-tech-visible warning instead of silently hiding the disagreement.
test("agent chat context meter overflow warning", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.vrt.agentChatFixture", "1");
    localStorage.setItem("pickforge.vrt.agentChatContextOverflow", "1");
  });

  await page.goto("/#/workbench");
  await page.getByText("Built a deterministic VRT fixture").waitFor();

  const meter = page.locator(".pf-chat-context");
  await expect(meter).toHaveClass(/pf-chat-context--warn/);

  const label = meter.locator(".pf-chat-context-frac");
  await expect(label).toHaveText("1M / 1M");
  await expect(label).toHaveAttribute("role", "img");
  await expect(label).toHaveAttribute("aria-label", /1,230,000.*1,000,000/);
  await expect(label).toHaveAttribute("title", /1,230,000.*1,000,000/);

  const fill = meter.locator(".pf-chat-context-fill");
  await expect(fill).toHaveAttribute("style", /width:\s*100%/);

  await expect(meter).toHaveScreenshot("agent-chat-context-overflow.png", {
    maxDiffPixelRatio: 0.025,
    animations: "disabled",
  });
});
