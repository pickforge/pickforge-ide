import { test, expect } from "@playwright/test";

// #231 PR4's Workbench Changes review surface, behind the default-off
// `changesReview` flag. No `toHaveScreenshot` here (per PR4's scope, darwin
// goldens aren't generated for this scenario) — spec assertions only, on a
// deliberately mixed change-set: a plain modify, an unknown-stats add, a
// staged file, and a rename, so the honesty states (unknown stats, rename
// old->new) and the scope switch/file navigator/diff view all get exercised
// against real fixture data.
test("changes review surface — working tree scope with a mixed change-set", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ changesReview: true }));
    localStorage.setItem("pickforge.vrt.changesReviewSurfaceFixture", "1");
  });

  await page.goto("/#/workbench");
  const surface = page.locator(".pf-crs");
  await surface.waitFor();

  // Default scope is "This turn" with nothing ever selected — an honest
  // prompt, never a fabricated listing (no chat/turn exists in this scenario).
  await expect(surface.locator(".pf-rail-empty")).toHaveText(/Review changes/);

  await surface.getByRole("button", { name: "Working tree" }).click();

  await expect(surface.locator(".pf-crs-repo")).toHaveText("acme-app");
  await expect(surface.locator(".pf-crs-branch")).toHaveText("main");

  const rows = surface.locator(".pf-crs-navrow");
  await expect(rows).toHaveCount(4);
  await expect(surface.locator(".pf-crs-meta")).toHaveText("4 files");
  await expect(surface.locator(".pf-crs-stat--add").first()).toHaveText("+18");
  await expect(surface.locator(".pf-crs-stat--del").first()).toHaveText("−2");

  // `lib/new_widget.dart` carries no known line counts — rendered as
  // "unknown", never a fabricated "+0 −0".
  const unknownRow = rows.filter({ hasText: "lib/new_widget.dart" });
  await expect(unknownRow.locator(".pf-crs-unknown")).toHaveText("unknown");

  // The staged file gets its own badge, distinct from the three unstaged rows.
  const stagedRow = rows.filter({ hasText: "README.md" });
  await expect(stagedRow.locator(".pf-crs-badge")).toHaveText("staged");

  // The rename row shows old -> new, with the R status letter.
  const renameRow = rows.filter({ hasText: "new_button.dart" });
  await expect(renameRow.locator(".pf-crs-navpath-old")).toHaveText("lib/widgets/old_button.dart");
  await expect(renameRow.locator(".pf-crs-letter")).toHaveText("R");

  // The first file is selected by default; its diff renders with old/new
  // gutters and hunk-header structure.
  await expect(surface.locator(".pf-crs-diffpath")).toHaveText("lib/login.dart");
  await expect(surface.locator(".pf-crs-hunkhead")).toBeVisible();
  await expect(surface.locator(".pf-crs-diffline").first()).toBeVisible();

  // Selecting the rename row swaps the diff pane to it without touching the
  // scope or navigator selection state of any other row.
  await renameRow.click();
  await expect(surface.locator(".pf-crs-diffpath")).toHaveText("lib/widgets/new_button.dart");
  await expect(renameRow).toHaveClass(/pf-crs-navrow--active/);

  // Next/previous file navigation moves the active file in navigator order.
  // The rename is the last row, so "next" is correctly disabled here — use
  // "previous" to step back to the file before it.
  const nextBtn = surface.locator(".pf-crs-diffnav button").nth(1);
  await expect(nextBtn).toBeDisabled();
  const prevBtn = surface.locator(".pf-crs-diffnav button").nth(0);
  await prevBtn.click();
  await expect(surface.locator(".pf-crs-diffpath")).not.toHaveText("lib/widgets/new_button.dart");

  // Collapsing the active file hides its diff body but keeps the header (and
  // therefore file orientation) visible.
  const collapseBtn = surface.locator(".pf-crs-diffhead .pf-icon-btn").first();
  await collapseBtn.click();
  await expect(surface.locator(".pf-crs-diffbody")).toHaveCount(0);
  await expect(surface.locator(".pf-crs-diffpath")).toBeVisible();
});

// Flag-off preserves the pre-existing raw Source Control Changes list and
// diff modal exactly — the new surface never mounts, and the legacy porcelain
// path stays the only thing rendered.
test("changes review surface stays behind the flag — legacy Source Control renders unchanged", async ({
  page,
}) => {
  await page.goto("/#/workbench");
  const sourceControlPane = page.locator(".pf-sc");
  await sourceControlPane.waitFor();

  await expect(page.locator(".pf-crs")).toHaveCount(0);
  await expect(sourceControlPane.locator(".pf-sc-row")).toHaveCount(3);
});

// The no-remount invariant, proven against the REAL composed tree (not a
// stand-in): `Workbench.tsx`'s `ChatHostSlot` is a sibling of the dock
// column, never a descendant of the Source Control pane's own reactive
// state, so a receipt's "Review changes" retarget, a file selection, and a
// scope switch must never tear down and recreate the chat host's own DOM
// node. Pinned by holding an ElementHandle to that node across all three
// interactions and asserting it's still `isConnected` (a real remount would
// detach the ORIGINAL node from the document, which no amount of the new
// content merely "looking the same" could hide) — no unit-test stand-in can
// make this assertion meaningful, since a hand-written sibling in a test
// file doesn't track `Workbench.tsx`'s actual composition.
test("changes review surface — receipt-focus, file-select, and scope-switch never remount the chat host", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.vrt.agentChatFixture", "1");
    localStorage.setItem("pickforge.flags", JSON.stringify({ changesReview: true }));
  });

  await page.goto("/#/workbench");
  await page.getByText("Built a deterministic VRT fixture").waitFor();

  const hostSlot = page.locator(".pf-term-slot").first();
  await hostSlot.waitFor();
  const hostNode = await hostSlot.elementHandle();
  if (!hostNode) throw new Error("expected the chat host's DOM node to resolve");
  const stillConnected = () => hostNode.evaluate((el) => el.isConnected);

  // 1) Receipt-focus retarget: the real "Review changes" seam
  // (changesReceiptActions.reviewTurnChanges -> openChangesReviewForTurn +
  // navigate + focusChangesReviewSurface).
  await page.locator(".pf-chat-receipt-review").click();
  const surface = page.locator(".pf-crs");
  await surface.waitFor();
  await expect(surface.locator(".pf-crs-navrow")).toHaveCount(2);
  expect(await stillConnected()).toBe(true);

  // 2) File selection within the now-focused surface.
  const secondRow = surface.locator(".pf-crs-navrow").nth(1);
  await secondRow.click();
  await expect(surface.locator(".pf-crs-diffpath")).toHaveText("tests/vrt/agent-chat.spec.ts");
  expect(await stillConnected()).toBe(true);

  // 3) Scope switch to Working tree (a different fetch, a different file set).
  await surface.getByRole("button", { name: "Working tree" }).click();
  await expect(surface.locator(".pf-crs-navrow")).toHaveCount(3);
  expect(await stillConnected()).toBe(true);

  // The chat's own content survived untouched throughout — proof this was a
  // stable host, not a remount that happened to reproduce the same text.
  await expect(page.getByText("Built a deterministic VRT fixture")).toBeVisible();
});
