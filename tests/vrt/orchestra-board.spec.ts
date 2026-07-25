import { expect, test, type Page } from "@playwright/test";

// #319 (#196 PR1): Orchestra board scaffold behind `orchestraBoard` (default
// off). A view toggle inside the ledger's Tasks card swaps the existing flat
// task list for a column-per-status board — same STATUS_ORDER (5 statuses,
// unchanged), cards built from existing OrchestraTask fields only. Fixture:
// src/lib/tauriMock.ts (ORCHESTRA_BOARD_FIXTURE_TASKS) +
// src/lib/orchestraBoardFixture.ts, all on acme-app (the default active
// project): one task per status — planned (unassigned), building (chat-1,
// busy), reviewing (unassigned, has a note), fixing (chat-2, needs-you),
// done (unassigned).

async function openOrchestra(page: Page) {
  await page.goto("/#/workbench");
  await page.locator(".pf-orch-tab").click();
}

test("orchestraBoard off: no toggle, the flat task list renders as before", async ({ page }) => {
  await openOrchestra(page);
  await page.waitForTimeout(300);

  await expect(page.locator(".pf-orch-tasks-head")).toHaveCount(0);
  await expect(page.locator(".pf-board")).toHaveCount(0);
  await expect(page.locator(".pf-orch-tasks")).toBeVisible();
});

test("orchestraBoard on, toggle left on list: the flat task list stays the default view", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ orchestraBoard: true }));
    localStorage.setItem("pickforge.vrt.orchestraBoardFixture", "1");
  });
  await openOrchestra(page);
  await page.getByText("Sidebar waiting state polish").waitFor();

  await expect(page.locator(".pf-orch-tasks-head")).toBeVisible();
  await expect(page.locator(".pf-board")).toHaveCount(0);
  await expect(page.locator(".pf-orch-tasks .pf-orch-task")).toHaveCount(5);
  await expect(page.locator(".pf-orch-tasks-head").getByTitle("List view")).toHaveClass(
    /pf-orch-layout-btn--on/,
  );
});

test("orchestraBoard on, board toggled: columns follow STATUS_ORDER, cards carry only existing task fields, subset rule holds", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ orchestraBoard: true }));
    localStorage.setItem("pickforge.vrt.orchestraBoardFixture", "1");
  });
  await openOrchestra(page);
  await page.getByText("Sidebar waiting state polish").waitFor();

  await page.locator(".pf-orch-tasks-head").getByTitle("Board view").click();
  await expect(page.locator(".pf-orch-tasks")).toHaveCount(0);
  await expect(page.locator(".pf-orch-tasks-head").getByTitle("Board view")).toHaveClass(
    /pf-orch-layout-btn--on/,
  );

  const columns = page.locator(".pf-board-col");
  await expect(columns).toHaveCount(5);
  expect(await columns.evaluateAll((els) => els.map((el) => el.getAttribute("data-status")))).toEqual([
    "planned",
    "building",
    "reviewing",
    "fixing",
    "done",
  ]);

  const cards = page.locator(".pf-board-card");
  await expect(cards).toHaveCount(5);
  await expect(page.locator(".pf-board-card-title")).toHaveText([
    "Wire up settings sync",
    "Sidebar waiting state polish",
    "Login screen review",
    "Settings polish follow-up",
    "Onboarding copy pass",
  ]);

  // Busy (chat-1, "building") and needs-you (chat-2, "fixing") render off the
  // same primitives #306's flat sidebar uses — never a fabricated new signal.
  await expect(page.locator(".pf-board-card--busy")).toHaveCount(1);
  await expect(page.locator(".pf-board-card--attention")).toHaveCount(1);

  // The subset rule: a card's meta line resolves a linked chat's title only
  // from the task-linked filter, never an arbitrary chat — an unassigned
  // task reads "unassigned", never a stray title.
  const metas = page.locator(".pf-board-card-meta");
  await expect(metas.nth(0).locator("span").first()).toHaveText("unassigned"); // planned, no builder/reviewer
  await expect(metas.nth(2).locator("span").first()).toHaveText("unassigned"); // reviewing, note only, no chat

  // Note-as-brief: only the "reviewing" task carries a note; no empty chips
  // render for the other four cards.
  await expect(page.locator(".pf-board-card-note")).toHaveCount(1);
  await expect(page.locator(".pf-board-card-note")).toHaveText("Waiting on a reviewer lane");
});

test("orchestraBoard mixed-status board (visual)", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ orchestraBoard: true }));
    localStorage.setItem("pickforge.vrt.orchestraBoardFixture", "1");
  });
  await openOrchestra(page);
  await page.getByText("Sidebar waiting state polish").waitFor();
  await page.locator(".pf-orch-tasks-head").getByTitle("Board view").click();
  await page.locator(".pf-board-card").first().waitFor();
  await page.waitForTimeout(300);

  await expect(page.locator(".pf-board").first()).toHaveScreenshot("orchestra-board-mixed.png", {
    maxDiffPixelRatio: 0.025,
    animations: "disabled",
  });
});
