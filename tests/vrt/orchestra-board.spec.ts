import { expect, test, type Page } from "@playwright/test";

// #319 (#196 PR1): Orchestra board scaffold behind `orchestraBoard` (default
// off). A view toggle inside the ledger's Tasks card swaps the existing flat
// task list for a column-per-status board — same STATUS_ORDER (5 statuses,
// unchanged), cards built from existing OrchestraTask fields only. Fixture:
// src/lib/tauriMock.ts (ORCHESTRA_BOARD_FIXTURE_TASKS) +
// src/lib/orchestraBoardFixture.ts, all on acme-app (the default active
// project): one task per status — planned (unassigned, no note), building
// (chat-1, busy), reviewing (BOTH a builder + reviewer link — chat-board-
// builder/-reviewer, quiet), fixing (chat-2, needs-you), done (unassigned,
// has a note). None of these chats are ever mounted as a live lane in this
// fixture, so every card also exercises the P2-2 stale-link focus guard.

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
  // "reviewing"'s two links are deliberately quiet, so neither tint applies
  // to it.
  await expect(page.locator(".pf-board-card--busy")).toHaveCount(1);
  await expect(page.locator(".pf-board-card--attention")).toHaveCount(1);

  // The subset rule: a card's meta line resolves a linked chat's title only
  // from the task-linked filter, never an arbitrary chat — an unassigned
  // task reads "unassigned", never a stray title.
  const metas = page.locator(".pf-board-card-meta");
  await expect(metas.nth(0).locator("span").first()).toHaveText("unassigned"); // planned, no builder/reviewer
  await expect(metas.nth(4).locator("span").first()).toHaveText("unassigned"); // done, no builder/reviewer

  // Note-as-brief: only the "done" task carries a note; no empty chips render
  // for the other four cards.
  await expect(page.locator(".pf-board-card-note")).toHaveCount(1);
  await expect(page.locator(".pf-board-card-note")).toHaveText("Ready to close out");

  // P2-1: a task with BOTH a builder and reviewer link ("reviewing") shows
  // both marks — neither role is collapsed away in favor of the other.
  const cardMarks = page.locator(".pf-board-card .pf-board-card-marks .pf-board-card-mark");
  await expect(cardMarks).toHaveCount(4); // building(1) + reviewing(2) + fixing(1)
  await expect(cards.nth(2).locator(".pf-board-card-mark")).toHaveCount(2);
  await expect(cards.nth(2).locator(".pf-board-card-mark").first()).toHaveAttribute(
    "title",
    "Builder · Review pass — build side",
  );
  await expect(cards.nth(2).locator(".pf-board-card-mark").nth(1)).toHaveAttribute(
    "title",
    "Reviewer · Review pass — review side",
  );
});

test("orchestraBoard: a persisted link whose lane isn't mounted this session degrades honestly (P2-2)", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ orchestraBoard: true }));
    localStorage.setItem("pickforge.vrt.orchestraBoardFixture", "1");
  });
  await openOrchestra(page);
  await page.getByText("Sidebar waiting state polish").waitFor();
  await page.locator(".pf-orch-tasks-head").getByTitle("Board view").click();

  // No lane is live in this fixture — every card's link is a stale/unmounted
  // assignment, so every card reads as unfocusable rather than offering a
  // click it can't honor.
  const cards = page.locator(".pf-board-card");
  await expect(cards).toHaveCount(5);
  await expect(page.locator(".pf-board-card--unfocusable")).toHaveCount(5);

  // Clicking a card whose builder link (chat-1) isn't a live lane must not
  // throw or open/scroll to a lane that doesn't exist.
  await page.getByText("Sidebar waiting state polish").click();
  await expect(page.locator(".pf-orch-lane-frame--flash")).toHaveCount(0);
  await expect(page.locator(".pf-orch-lane-frame")).toHaveCount(0); // no lanes exist at all
  expect(pageErrors).toEqual([]);
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
