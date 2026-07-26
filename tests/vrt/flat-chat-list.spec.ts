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

test("flatChatList: quiet terminal-kind rows show an honest terminal mark", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();

  const quietRows = page.locator(".pf-flat-row");
  await expect(quietRows).toHaveCount(4);
  const marks = quietRows.locator(".pf-flat-mark");
  await expect(marks).toHaveCount(4);
  expect(await marks.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label"))))
    .toEqual(["Terminal", "Terminal", "Terminal", "Terminal"]);
});

test("flatChatList: new-chat menu shows terminal and harness marks", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();

  await page.getByTitle("New chat").click();
  await page.locator(".pf-menu").getByRole("button", { name: "acme-app", exact: true }).click();

  for (const label of ["Terminal", "Claude Code", "Codex", "Oh My Pi (OMP)", "Pi"]) {
    const item = page.locator(".pf-menu").getByRole("button", { name: label, exact: true });
    await expect(item).toHaveCount(1);
    await expect(item.locator("svg")).toHaveCount(1);
  }
});

// #306 PR1 review (P2-3, design decision): the project filter narrows
// working + quiet chats, but a needs-you chat stays visible from EVERY
// project — the flat list's whole point is "everything that needs me across
// projects", so filtering to one project must never hide one that lives in
// another.
test("flatChatList project dropdown single-selects filter working/quiet, never hide needs-you", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();

  // #371: the chip row became the app's one dropdown. `All projects` is a real
  // option, not a placeholder, so it is the trigger's label in the all-state.
  const trigger = page.locator(".pf-flat-project-filter .pf-dropdown-trigger");
  await expect(trigger).toContainText("All projects");

  // The point of the swap: the toolbar is ONE row and stays one row. The chip
  // row it replaced wrapped and measured 72px here, leaving a 108px list
  // viewport for 92px cards; the dropdown measures 36px and leaves 144px.
  // A regression to a wrapping control would show up as this growing.
  const barHeight = await page
    .locator(".pf-flat-bar")
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(barHeight).toBeLessThanOrEqual(44);

  await trigger.click();
  const options = page.locator(".pf-dropdown-option-label");
  await expect(options).toHaveText(["All projects", "acme-app", "widgets"]);
  await expect(
    page.locator(".pf-dropdown-option--on .pf-dropdown-option-label"),
  ).toHaveText("All projects");

  // "PR monitoring agent flow" is a widgets chat — filtering to acme-app must
  // still show it, above acme-app's own working/quiet chats, while hiding
  // widgets' quiet chats ("Slider refactor", "Local usage analytics plan").
  await options.filter({ hasText: "acme-app" }).click();
  await expect(trigger).toContainText("acme-app");

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

// #371: the chips carried the project context menu (rename, remote host, move
// to group, archive) and the flat list has no other project surface, so losing
// it in the swap would be a silent regression. Right-clicking an option row
// must close the dropdown and open the same ProjectMenu.
test("flatChatList: right-clicking a project option opens the project menu, not the browser's", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();

  await page.locator(".pf-flat-project-filter .pf-dropdown-trigger").click();
  await page.locator(".pf-dropdown-option-label").filter({ hasText: "acme-app" }).click({
    button: "right",
  });

  // The dropdown yields to the menu rather than stacking two popovers.
  await expect(page.locator(".pf-dropdown-option")).toHaveCount(0);
  const menu = page.locator(".pf-floating-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("Rename");

  // Selection is unchanged — a right-click inspects, it does not filter.
  await page.keyboard.press("Escape");
  await expect(page.locator(".pf-flat-project-filter .pf-dropdown-trigger")).toContainText(
    "All projects",
  );
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

// #331 review (finding 4): a work card and a quiet row were plain clickable
// <div>s — no tab stop, no accessible name, no Enter/Space activation. Both
// now expose a real <button> as their primary interactive element (the
// "..." options button stays a separate sibling button). Proves the
// keyboard path end to end: focus the button directly, press Enter, the
// chat becomes active — the same outcome a click already produced above.
test("flatChatList: work card and quiet row are keyboard-activatable via a real button (#331 review)", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("PR monitoring agent flow").waitFor();

  const workCardButton = page.locator(".pf-work-card--working button.pf-work-card-primary");
  await expect(workCardButton).toHaveCount(1);
  await workCardButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".pf-work-card--working.active")).toHaveCount(1);

  const quietRowButton = page.locator("button.pf-flat-row-lines").first();
  await expect(quietRowButton).toHaveCount(1);
  await quietRowButton.focus();
  await page.keyboard.press("Enter");
  await expect(quietRowButton.locator("xpath=..")).toHaveClass(/active/); // parent .pf-flat-row
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

// #341: `.pf-flat-list` is a flex column and a card's own overflow:hidden
// zeroes its automatic flex min-height, so a short pane squashed every card
// into a clipped one-line pill instead of scrolling the list. Squash is
// directly observable as vertical clipping (scrollHeight > clientHeight), so
// this pins the fix without a screenshot: force a short viewport with the
// heavy fixture (4 cards + quiet tail can never fit), then require every
// card to be unclipped and the list itself to be the thing that scrolls.
test("flatChatList: a short pane scrolls the list instead of squashing cards (#341)", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 420 });
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
    localStorage.setItem("pickforge.vrt.flatChatListHeavyFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("Whisper batch tuning").waitFor();

  const clipped = await page.locator(".pf-flat-list .pf-work-card").evaluateAll((cards) =>
    cards
      .filter((el) => el.scrollHeight > el.clientHeight + 1)
      .map((el) => `${el.querySelector(".pf-work-card-title")?.textContent}: ${el.clientHeight}/${el.scrollHeight}`),
  );
  expect(clipped).toEqual([]);

  const listScrolls = await page
    .locator(".pf-flat-list")
    .evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(listScrolls).toBe(true);
});

// #356: the list re-sorts mid-turn — a chat promoted out of the quiet tail is
// inserted as a live work card ABOVE the reader's scroll offset. The browser
// answers content growth above the viewport by silently adjusting scrollTop,
// which in a short pane parks the view mid-card and reads as the section
// having collapsed. jsdom has no layout engine, so this cannot be a unit test;
// it follows #341's assertion-only (non-screenshot) precedent above.
//
// The synthetic insertion stands in for a real quiet→live promotion: it
// isolates the anchoring behavior deterministically, where driving a genuine
// `chatBusy` flip would need a new fixture switch in `src/lib/tauriMock.ts`.
test("flatChatList: content growing above the fold does not silently re-scroll the list (#356)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 560 });
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ flatChatList: true }));
    localStorage.setItem("pickforge.vrt.flatChatListFixture", "1");
    localStorage.setItem("pickforge.vrt.flatChatListHeavyFixture", "1");
  });
  await page.goto("/#/workbench");
  await page.getByText("Whisper batch tuning").waitFor();

  const drift = await page.locator(".pf-flat-list").evaluate(async (list: HTMLElement) => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    list.scrollTop = 40;
    await raf();
    const before = list.scrollTop;
    const promoted = document.createElement("div");
    promoted.style.height = "120px";
    list.insertBefore(promoted, list.firstElementChild);
    await raf();
    const after = list.scrollTop;
    promoted.remove();
    return { before, after };
  });

  // Non-vacuity guard: if the fixture ever fits the viewport, `scrollTop = 40`
  // clamps to 0 and the drift assertion passes for free, fix or no fix.
  expect(drift.before).toBe(40);
  // Without `overflow-anchor: none` this measured 40 -> 162.
  expect(drift.after).toBe(drift.before);
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
