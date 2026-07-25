import { expect, test } from "@playwright/test";

// #306 PR1: flat chat-first sidebar behind `flatChatList` (default off). The
// existing per-route `workbench` screenshot in screens.spec.ts stays flag-off
// and untouched by this file — these scenarios are additive.
//
// Fixture (src/lib/tauriMock.ts + src/lib/flatChatListFixture.ts), two
// projects (acme-app, widgets):
//   acme-app: "Login screen" (quiet, now), "Settings polish" (quiet, now),
//             "Sidebar waiting state" (working)
//   widgets:  "Slider refactor" (quiet, now), "PR monitoring agent flow"
//             (needs-you), "Local usage analytics plan" (quiet, 2d old)

test("flatChatList off renders the legacy project tree, not the flat list", async ({ page }) => {
  await page.goto("/#/workbench");
  await page.waitForTimeout(300);

  await expect(page.locator(".pf-flat-bar")).toHaveCount(0);
  await expect(page.locator(".pf-flat-list")).toHaveCount(0);
  await expect(page.locator(".pf-tree-row").first()).toBeVisible();
});

test("flatChatList on sorts needs-you above working above quiet, quiet by activity, under a divider", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();

  // Old tree is gone entirely when the flag is on.
  await expect(page.locator(".pf-tree-row")).toHaveCount(0);

  const titles = await page.locator(".pf-flat-row .pf-flat-title").allTextContents();
  expect(titles).toEqual([
    "PR monitoring agent flow", // needs-you
    "Sidebar waiting state", // working
    "Login screen", // quiet, tied activity — original order
    "Settings polish", // quiet, tied activity
    "Slider refactor", // quiet, tied activity
    "Local usage analytics plan", // quiet, oldest activity — sorts last
  ]);

  await expect(page.locator(".pf-flat-quiet-divider")).toHaveText("quiet · 4");
  await expect(page.locator(".pf-flat-row--attention")).toHaveCount(1);
  await expect(page.locator(".pf-flat-row--busy")).toHaveCount(1);
});

test("flatChatList project chips single-select filter the list", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();

  const chips = page.locator(".pf-flat-chip");
  await expect(chips).toHaveText(["All projects", "acme-app", "widgets"]);
  await expect(chips.filter({ hasText: "All projects" })).toHaveClass(/pf-flat-chip--on/);

  await chips.filter({ hasText: "acme-app" }).click();
  await expect(chips.filter({ hasText: "acme-app" })).toHaveClass(/pf-flat-chip--on/);

  const titles = await page.locator(".pf-flat-row .pf-flat-title").allTextContents();
  expect(titles).toEqual(["Sidebar waiting state", "Login screen", "Settings polish"]);
  await expect(page.locator(".pf-flat-quiet-divider")).toHaveText("quiet · 2");
});

test("flatChatList mixed-state pane (visual)", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();
  await page.waitForTimeout(600);

  await expect(page.locator(".pf-pane-scroll").first()).toHaveScreenshot("flat-chat-list-mixed.png", {
    maxDiffPixelRatio: 0.025,
    animations: "disabled",
  });
});
