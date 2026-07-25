import { expect, test } from "@playwright/test";

// #306 PR1: flat chat-first sidebar behind `flatChatList` (default off). The
// existing per-route `workbench` screenshot in screens.spec.ts stays flag-off
// and untouched by this file — these scenarios are additive.
//
// Fixture (src/lib/tauriMock.ts + src/lib/flatChatListFixture.ts), two
// projects (acme-app, widgets):
//   acme-app: "Login screen" (quiet, now), "Settings polish" (quiet, now),
//             "Sidebar waiting state" (working, real context+cost+3 swarm
//             lanes+plan 2/5 — see FLAT_CHAT_LIST_WORKING_HISTORY/_SWARM_RUN)
//   widgets:  "Slider refactor" (quiet, now), "PR monitoring agent flow"
//             (needs-you, no swarm/usage/plan data), "Local usage analytics
//             plan" (quiet, 2d old)
// The mock `git_status` command (#306 PR3) reports every project root as a
// repo on branch "main" by default, so both projects' cards carry a branch
// footer item regardless of their other live data — override per-test via
// `pickforge.vrt.flatChatListNoBranchRoot` (a projectRoot) to make one
// project report no branch instead.
// The "heavy" fixture (pickforge.vrt.flatChatListHeavyFixture) stacks two
// more live chats on top: "ADB session recovery" (needs-you, acme-app) and
// "Whisper batch tuning" (working, widgets).

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

  // Live chats render as work cards (#306 PR2), quiet chats stay one-liners
  // — both title spots, in the same top-to-bottom document order.
  const titles = await page
    .locator(".pf-flat-list .pf-work-card-title, .pf-flat-list .pf-flat-title")
    .allTextContents();
  expect(titles).toEqual([
    "PR monitoring agent flow", // needs-you
    "Sidebar waiting state", // working
    "Login screen", // quiet, tied activity — original order
    "Settings polish", // quiet, tied activity
    "Slider refactor", // quiet, tied activity
    "Local usage analytics plan", // quiet, oldest activity — sorts last
  ]);

  await expect(page.locator(".pf-flat-quiet-divider")).toHaveText("quiet · 4");
  await expect(page.locator(".pf-work-card--needsyou")).toHaveCount(1);
  await expect(page.locator(".pf-work-card--working")).toHaveCount(1);
});

// #306 PR1 review (P2-3, design decision): the project filter narrows
// working + quiet chats, but a needs-you chat stays visible from EVERY
// project — the flat list's whole point is "everything that needs me across
// projects", so filtering to one project must never hide one that lives in
// another.
test("flatChatList project chips single-select filter working/quiet, never hide needs-you", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();

  const chips = page.locator(".pf-flat-chip");
  await expect(chips).toHaveText(["All projects", "acme-app", "widgets"]);
  await expect(chips.filter({ hasText: "All projects" })).toHaveClass(/pf-flat-chip--on/);

  // "PR monitoring agent flow" is a widgets chat — filtering to acme-app must
  // still show it, above acme-app's own working/quiet chats, while hiding
  // widgets' quiet chats ("Slider refactor", "Local usage analytics plan").
  await chips.filter({ hasText: "acme-app" }).click();
  await expect(chips.filter({ hasText: "acme-app" })).toHaveClass(/pf-flat-chip--on/);

  const titles = await page
    .locator(".pf-flat-list .pf-work-card-title, .pf-flat-list .pf-flat-title")
    .allTextContents();
  expect(titles).toEqual([
    "PR monitoring agent flow", // needs-you, widgets — stays visible despite the acme-app filter
    "Sidebar waiting state", // working, acme-app
    "Login screen", // quiet, acme-app
    "Settings polish", // quiet, acme-app
  ]);
  await expect(page.locator(".pf-flat-quiet-divider")).toHaveText("quiet · 2");
});

// #306 PR1 review (P2-2): the eager cross-project load must not blank the
// whole list or throw an unhandled rejection when one project's fetch fails.
test("flatChatList: a failed project load surfaces retry, other projects still render, no unhandled rejection", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
    localStorage.setItem("pickforge.vrt.flatChatListLoadErrorRoot", "/home/dev/widgets");
  });
  await page.goto("/#/workbench");

  // acme-app's load succeeds and renders even though widgets' fails.
  await page.getByText("Sidebar waiting state").waitFor();
  await expect(page.locator(".pf-flat-load-error-row")).toHaveText(/widgets failed to load/);
  // acme-app's 3 chats: 1 live card + 2 quiet one-liners.
  await expect(page.locator(".pf-work-card")).toHaveCount(1);
  await expect(page.locator(".pf-flat-row")).toHaveCount(2);

  // Clearing the mock failure and retrying recovers widgets' chats.
  await page.evaluate(() => localStorage.removeItem("pickforge.vrt.flatChatListLoadErrorRoot"));
  await page.getByRole("button", { name: "Retry" }).click();
  await page.getByText("PR monitoring agent flow").waitFor();
  await expect(page.locator(".pf-flat-load-error")).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});

// #306 PR2 — card-vs-one-liner selection by state: quiet chats render the
// PR1 one-liner, busy/needs-you chats render the rich work card.
test("flatChatList: live chats render as work cards, quiet chats stay one-liners", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();

  await expect(page.locator(".pf-work-card")).toHaveCount(2); // needs-you + working
  await expect(page.locator(".pf-flat-row")).toHaveCount(4); // the quiet tail

  // A quiet row never carries a card's own markup.
  await expect(page.locator(".pf-flat-row .pf-work-card-status")).toHaveCount(0);
});

// #306 PR2 — LOCKED bracket rule: the four L-corners frame ONLY needs-you
// cards, and bracketed text lives ONLY on the needs-you status label. Pins
// both directions: a working card carries NO bracket markup at all, and the
// needs-you card carries exactly the corner set + the bracketed label class.
test("flatChatList: bracket L-corners appear only on the needs-you card", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();

  const workingCard = page.locator(".pf-work-card--working");
  await expect(workingCard).toHaveCount(1);
  await expect(workingCard.locator(".pf-work-card-corner")).toHaveCount(0);
  await expect(workingCard.locator(".pf-work-card-status--needsyou")).toHaveCount(0);
  await expect(workingCard.locator(".pf-work-card-status")).toHaveText("working");

  const needsYouCard = page.locator(".pf-work-card--needsyou");
  await expect(needsYouCard).toHaveCount(1);
  await expect(needsYouCard.locator(".pf-work-card-corner")).toHaveCount(4);
  await expect(needsYouCard.locator(".pf-work-card-status--needsyou")).toHaveCount(1);
  await expect(needsYouCard.locator(".pf-work-card-status")).toHaveText("needs you");

  // No filled pill chips anywhere in the flat list — the locked rule again.
  await expect(page.locator(".pf-flat-list .pf-pill")).toHaveCount(0);
});

// #306 PR2 review (P2): showBracket previously also depended on
// active/staged, so a needs-you chat you'd just opened (or staged onto the
// orchestra board) silently lost its L-corners — a needs-you card must
// ALWAYS get the bracket, focus/stage never suppress it. The blur here is
// belt-and-suspenders, not load-bearing: since #331, merely opening/staging
// a needs-you chat never clears its attention at all (only sending a
// message / answering a permission prompt does — see chatActivity.ts), so
// "active" is a real reachable state regardless; blurring first just also
// covers the pre-#331 window-focus path for good measure.
test("flatChatList: bracket L-corners survive on an ACTIVE needs-you card (P2 fix)", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.locator(".pf-work-card--needsyou").click();

  const activeNeedsYou = page.locator(".pf-work-card.active.pf-work-card--needsyou");
  await expect(activeNeedsYou).toHaveCount(1);
  await expect(activeNeedsYou.locator(".pf-work-card-corner")).toHaveCount(4);
  await expect(activeNeedsYou.locator(".pf-work-card-status--needsyou")).toHaveCount(1);
  await expect(activeNeedsYou.locator(".pf-work-card-status")).toHaveText("needs you");
});

test("flatChatList: bracket L-corners survive on a STAGED needs-you card (P2 fix)", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => {
    (window as unknown as { __PICKFORGE_VRT_STAGE_NEEDS_YOU__: () => void })
      .__PICKFORGE_VRT_STAGE_NEEDS_YOU__();
  });

  const stagedNeedsYou = page.locator(".pf-work-card.active.pf-work-card--needsyou");
  await expect(stagedNeedsYou).toHaveCount(1);
  await expect(stagedNeedsYou.locator(".pf-work-card-corner")).toHaveCount(4);
  await expect(stagedNeedsYou.locator(".pf-work-card-status--needsyou")).toHaveCount(1);
});

test("flatChatList: a working card shows no bracket markup even when active", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("Sidebar waiting state").waitFor();

  await page.locator(".pf-work-card--working").click();

  const activeWorking = page.locator(".pf-work-card.active.pf-work-card--working");
  await expect(activeWorking).toHaveCount(1);
  await expect(activeWorking.locator(".pf-work-card-corner")).toHaveCount(0);
  await expect(activeWorking.locator(".pf-work-card-status--needsyou")).toHaveCount(0);
});

// #306 PR2/PR3 — footer principle: every footer item is conditional on real
// data, independently of every other item. The working chat has real swarm
// lanes + cost (fixture-seeded) AND (PR3) a real branch + an active plan;
// the needs-you chat has a real branch (its project is a repo too) but no
// swarm/usage/plan data — its footer renders with ONLY the branch item, not
// present-with-zeros for the rest and not absent outright. Order matches the
// locked mockup: branch · plan M/N · lane ticks · cost.
test("flatChatList: footer items render only with real data", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();

  const workingCard = page.locator(".pf-work-card--working");
  await expect(workingCard.locator(".pf-work-card-foot")).toHaveCount(1);
  await expect(workingCard.locator(".pf-work-card-branch")).toHaveText("main");
  await expect(workingCard.locator(".pf-work-card-plan")).toHaveText("plan 2/5");
  await expect(workingCard.locator(".pf-work-card-lane")).toHaveCount(3);
  await expect(workingCard.locator(".pf-work-card-lane-count")).toHaveText("1/3");
  await expect(workingCard.locator(".pf-work-card-cost")).toHaveText("$0.4100");
  // Document order within the footer follows branch · plan · lanes · cost.
  await expect(workingCard.locator(".pf-work-card-foot > *")).toHaveCount(4);
  const footItems = workingCard.locator(".pf-work-card-foot > *");
  await expect(footItems.nth(0)).toHaveClass(/pf-work-card-branch/);
  await expect(footItems.nth(1)).toHaveClass(/pf-work-card-plan/);
  await expect(footItems.nth(2)).toHaveClass(/pf-work-card-lanes/);
  await expect(footItems.nth(3)).toHaveClass(/pf-work-card-cost/);

  // No swarm dispatched, no usage/plan data warmed for this chat — only the
  // branch item (real: its project is a repo too) renders, nothing else.
  const needsYouCard = page.locator(".pf-work-card--needsyou");
  await expect(needsYouCard.locator(".pf-work-card-foot")).toHaveCount(1);
  await expect(needsYouCard.locator(".pf-work-card-foot > *")).toHaveCount(1);
  await expect(needsYouCard.locator(".pf-work-card-branch")).toHaveText("main");
  await expect(needsYouCard.locator(".pf-work-card-plan")).toHaveCount(0);
  await expect(needsYouCard.locator(".pf-work-card-lanes")).toHaveCount(0);
  await expect(needsYouCard.locator(".pf-work-card-cost")).toHaveCount(0);
});

// #306 PR3 review (P3) — the OTHER half of the branch conditional: a project
// with no resolvable branch (git_status mocked to return branch: null for
// acme-app via flatChatListNoBranchRoot) must omit the branch item while its
// other real footer data — plan/lanes/cost, all still fixture-seeded for
// this same working chat — keeps rendering independently. Closes the loop
// with the test above (branch present + other items absent) so both
// directions of "every item is its own conditional" are pinned.
test("flatChatList: a project with no branch omits the branch item, other footer data still renders", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
    localStorage.setItem("pickforge.vrt.flatChatListNoBranchRoot", "/home/dev/acme-app");
  });
  await page.goto("/#/workbench");
  await page.getByText("Sidebar waiting state").waitFor();

  const workingCard = page.locator(".pf-work-card--working");
  await expect(workingCard.locator(".pf-work-card-branch")).toHaveCount(0);
  await expect(workingCard.locator(".pf-work-card-plan")).toHaveText("plan 2/5");
  await expect(workingCard.locator(".pf-work-card-lane")).toHaveCount(3);
  await expect(workingCard.locator(".pf-work-card-cost")).toHaveText("$0.4100");
  await expect(workingCard.locator(".pf-work-card-foot > *")).toHaveCount(3);
});

// #306 PR2 — context edge: ember while working, amber while waiting. The
// edge track itself is structural (part of the card anatomy), not a footer
// item, so it renders even for the needs-you card that has no usage data —
// empty (0%), not absent.
test("flatChatList: context edge color follows state", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();

  const workingEdge = page.locator(".pf-work-card--working .pf-work-card-edge");
  await expect(workingEdge).toHaveClass(/pf-work-card-edge--ember/);
  const workingFillWidth = await workingEdge.locator("i").evaluate((el) => el.style.width);
  expect(workingFillWidth).toBe("38%"); // 380,000 / 1,000,000 from the fixture usage event

  const needsYouEdge = page.locator(".pf-work-card--needsyou .pf-work-card-edge");
  await expect(needsYouEdge).toHaveClass(/pf-work-card-edge--amber/);
  const needsYouFillWidth = await needsYouEdge.locator("i").evaluate((el) => el.style.width);
  expect(needsYouFillWidth).toBe("0%"); // no usage data warmed for this chat
});

// #306 PR2 — linger-then-collapse: a just-finished card keeps its work-card
// rendering for CARD_LINGER_MS before collapsing to the quiet one-liner, so
// it doesn't vanish mid-glance. Drives the transition via the VRT-only hook
// (flatChatListFixture.ts) since a static fixture can't produce a real
// browser-timer transition at install time.
test("flatChatList: a just-finished card lingers, then collapses to the quiet one-liner", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("Sidebar waiting state").waitFor();

  const workingCard = page.locator(".pf-work-card--working");
  await expect(workingCard).toHaveCount(1);

  await page.evaluate(() => {
    (window as unknown as { __PICKFORGE_VRT_FINISH_WORKING_TURN__: () => void })
      .__PICKFORGE_VRT_FINISH_WORKING_TURN__();
  });

  // Immediately: still a card, now "finishing" (justFinished), not yet a
  // one-liner — this is the whole point of the linger.
  const cardTitles = page.locator(".pf-work-card-title");
  await expect(cardTitles.filter({ hasText: "Sidebar waiting state" })).toHaveCount(1);
  const lingeringCard = page.locator(".pf-work-card--finishing");
  await expect(lingeringCard).toHaveCount(1);
  await expect(lingeringCard.locator(".pf-work-card-status")).toHaveText("done");
  await expect(lingeringCard.locator(".pf-work-card-edge")).toHaveCount(0); // no edge while finishing

  // CARD_LINGER_MS (4000ms) later: collapsed into the quiet one-liner.
  await expect(page.locator(".pf-work-card--finishing")).toHaveCount(0, { timeout: 6000 });
  const oneLinerTitles = page.locator(".pf-flat-title");
  await expect(oneLinerTitles.filter({ hasText: "Sidebar waiting state" })).toHaveCount(1);
});

test("flatChatList: reduced motion collapses the linger fade instantly (no transition duration)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("Sidebar waiting state").waitFor();

  await page.evaluate(() => {
    (window as unknown as { __PICKFORGE_VRT_FINISH_WORKING_TURN__: () => void })
      .__PICKFORGE_VRT_FINISH_WORKING_TURN__();
  });

  const lingeringCard = page.locator(".pf-work-card--finishing");
  await expect(lingeringCard).toHaveCount(1);
  const durations = await lingeringCard.evaluate((el) =>
    getComputedStyle(el).transitionDuration.split(",").map((d) => Number.parseFloat(d)),
  );
  expect(durations.every((d) => d === 0)).toBe(true);
});

test("flatChatList calm pane (visual) — no live chats, just the quiet tail", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
  });
  await page.goto("/#/workbench");
  await page.getByText("Login screen").waitFor();
  await page.waitForTimeout(300);

  await expect(page.locator(".pf-work-card")).toHaveCount(0);
  await expect(page.locator(".pf-pane-scroll").first()).toHaveScreenshot("flat-chat-list-calm.png", {
    maxDiffPixelRatio: 0.025,
    animations: "disabled",
  });
});

test("flatChatList normal pane (visual) — one working, one needs-you card above the quiet tail", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();
  await page.waitForTimeout(600);

  await expect(page.locator(".pf-pane-scroll").first()).toHaveScreenshot("flat-chat-list-normal.png", {
    maxDiffPixelRatio: 0.025,
    animations: "disabled",
  });
});

test("flatChatList heavy pane (visual) — four live cards above the quiet tail", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
    localStorage.setItem("pickforge.vrt.flatChatListHeavyFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("Whisper batch tuning").waitFor();
  await page.waitForTimeout(600);

  await expect(page.locator(".pf-work-card")).toHaveCount(4);
  await expect(page.locator(".pf-pane-scroll").first()).toHaveScreenshot("flat-chat-list-heavy.png", {
    maxDiffPixelRatio: 0.025,
    animations: "disabled",
  });
});

test("flatChatList reduced-motion pane (visual) — a lingering card mid-collapse", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("Sidebar waiting state").waitFor();

  await page.evaluate(() => {
    (window as unknown as { __PICKFORGE_VRT_FINISH_WORKING_TURN__: () => void })
      .__PICKFORGE_VRT_FINISH_WORKING_TURN__();
  });
  await expect(page.locator(".pf-work-card--finishing")).toHaveCount(1);

  await expect(page.locator(".pf-pane-scroll").first()).toHaveScreenshot(
    "flat-chat-list-reduced-motion.png",
    { maxDiffPixelRatio: 0.025, animations: "disabled" },
  );
});
