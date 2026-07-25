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

  // #340: the Source Control pane exposes exactly ONE refresh button (the
  // toolbar's, which kicks both the repo scanner and this store) — the
  // surface header reports freshness but never duplicates the control.
  await expect(page.locator(".pf-sc button[title=\"Refresh\"]")).toHaveCount(1);
  await expect(surface.locator("button[title=\"Refresh\"]")).toHaveCount(0);

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

// #231 PR5: split view is only available once the dock pane is wide enough
// (`lib/diffViewMode.ts`'s `SPLIT_VIEW_MIN_WIDTH`, chosen inside the dock's
// own real 180–600px range — see that constant's doc comment for why a
// docked pane can never reach an arbitrarily large threshold). No
// `toHaveScreenshot` here, per this spec file's existing convention — spec
// assertions only.
test("changes review surface — split view renders two aligned columns at sufficient width", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ changesReview: true }));
    localStorage.setItem("pickforge.vrt.changesReviewSurfaceFixture", "1");
    // Widen the Source Control dock (right dock) toward its MAX_W (600) so
    // the surface actually clears SPLIT_VIEW_MIN_WIDTH — the 320px default
    // is well under it, by design (split is an opt-in-by-widening state,
    // proven separately below).
    localStorage.setItem("pickforge.workbenchLayout", JSON.stringify({ rightWidth: 600 }));
  });

  await page.goto("/#/workbench");
  const surface = page.locator(".pf-crs");
  await surface.waitFor();
  await surface.getByRole("button", { name: "Working tree" }).click();
  await expect(surface.locator(".pf-crs-navrow").first()).toBeVisible();

  // The toggle only renders once the pane clears the width threshold.
  const toggle = surface.locator(".pf-crs-viewtoggle");
  await expect(toggle).toBeVisible();
  await expect(surface.locator(".pf-crs-diffline").first()).toBeVisible(); // unified by default

  await toggle.getByRole("button", { name: "Split" }).click();
  const splitRows = surface.locator(".pf-crs-splitrow");
  await expect(splitRows.first()).toBeVisible();
  // Each split row carries two cells (old/new columns) sharing the same
  // gutter/marker language unified view uses.
  await expect(splitRows.first().locator(".pf-crs-splitcell")).toHaveCount(2);

  // Switching files keeps the split preference (persisted in
  // `stores/workbenchPrefs.ts`) rather than resetting to unified.
  const rows = surface.locator(".pf-crs-navrow");
  await rows.nth(1).click();
  await expect(surface.locator(".pf-crs-splitrow").first()).toBeVisible();
});

// The narrow-pane half of the same rule, as a SEPARATE page load (this
// component measures its own DOM width via `ResizeObserver` at mount, so a
// fresh load at a deliberately narrow dock width is the reliable way to
// exercise it in a real browser — no synthetic resize event to fake).
test("changes review surface — narrow dock forces unified even with a persisted split preference", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ changesReview: true }));
    localStorage.setItem("pickforge.vrt.changesReviewSurfaceFixture", "1");
    localStorage.setItem("pickforge.workbenchLayout", JSON.stringify({ rightWidth: 200 }));
    localStorage.setItem("pickforge.workbenchPrefs", JSON.stringify({ diffViewMode: "split" }));
  });

  await page.goto("/#/workbench");
  const surface = page.locator(".pf-crs");
  await surface.waitFor();
  await surface.getByRole("button", { name: "Working tree" }).click();
  await expect(surface.locator(".pf-crs-navrow").first()).toBeVisible();

  // No toggle at all at this width, and — despite the persisted "split"
  // preference — the diff still renders unified, never a squeezed/broken
  // split layout.
  await expect(surface.locator(".pf-crs-viewtoggle")).toHaveCount(0);
  await expect(surface.locator(".pf-crs-diffline").first()).toBeVisible();
  await expect(surface.locator(".pf-crs-splitrow")).toHaveCount(0);
});

// #231 PR5's hard-state matrix, against real fixture rows for each: a
// submodule, a symlink, a mode-only change, a merge conflict, a binary file
// with a known size, and a truncated diff with a working load-more action.
// No `toHaveScreenshot`, per this spec file's existing convention — spec
// assertions only.
test("changes review surface — hard states render honest placeholders, never a crash or a blank pane", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ changesReview: true }));
    localStorage.setItem("pickforge.vrt.changesHardStatesFixture", "1");
    // Give the Source Control pane the dock's vertical room (this fixture's
    // 9 navigator rows plus the diff pane need more than the default weight
    // split with Inspector leaves it) so every row and the load-more action
    // stay reachable without the pane's own overflow clipping them.
    localStorage.setItem(
      "pickforge.workbenchLayout",
      JSON.stringify({ rightWidth: 600, paneWeights: { sourceControl: 8, inspector: 0.3 } }),
    );
  });

  await page.goto("/#/workbench");
  const surface = page.locator(".pf-crs");
  await surface.waitFor();
  await surface.getByRole("button", { name: "Working tree" }).click();
  const rows = surface.locator(".pf-crs-navrow");
  await expect(rows.first()).toBeVisible();

  // Submodule: honest placeholder, kind badge, no diff fetch attempted.
  await rows.filter({ hasText: "vendor/lib" }).click();
  await expect(surface.locator(".pf-crs-diffmessage")).toHaveText(/Submodule/);
  await expect(rows.filter({ hasText: "vendor/lib" }).locator(".pf-crs-badge").last()).toHaveText("submodule");

  // Symlink.
  await rows.filter({ hasText: "config/link.txt" }).click();
  await expect(surface.locator(".pf-crs-diffmessage")).toHaveText(/Symlink/);

  // Mode-only change.
  await rows.filter({ hasText: "scripts/run.sh" }).click();
  await expect(surface.locator(".pf-crs-diffmessage")).toHaveText(/mode changed only/);

  // Merge conflict — status wins even though its kind is the honest
  // "regular" default (no clean mid-merge mode to classify).
  await rows.filter({ hasText: "src/conflict.rs" }).click();
  await expect(surface.locator(".pf-crs-diffmessage")).toHaveText(/Merge conflict/);
  await expect(rows.filter({ hasText: "src/conflict.rs" }).locator(".pf-crs-letter")).toHaveText("C");

  // Binary file: an honestly known byte size, not a fabricated placeholder.
  await rows.filter({ hasText: "assets/logo.png" }).click();
  await expect(surface.locator(".pf-crs-diffmessage")).toHaveText("Binary file — 2,048 bytes.");

  // Truncated diff: an explicit, working load-more action — never silent
  // truncation. Clicking it fetches the next chunk at the correct line
  // offset (the fixture's first chunk is 2 lines: the `@@ ... @@` header
  // and one `-old` line) and the notice/action disappears once the next
  // chunk reports not-truncated.
  await rows.filter({ hasText: "huge_generated.rs" }).click();
  const loadMore = surface.getByRole("button", { name: "Load more" });
  await expect(loadMore).toBeVisible();
  await expect(surface.locator(".pf-crs-diffnotice--actions")).toContainText("truncated");
  await loadMore.click();
  await expect(surface.locator(".pf-crs-diffnotice--actions")).toHaveCount(0);
  const skipLines = await page.evaluate(
    () => (window as unknown as { __PICKFORGE_VRT_LAST_DIFF_SKIP_LINES__?: number }).__PICKFORGE_VRT_LAST_DIFF_SKIP_LINES__,
  );
  expect(skipLines).toBe(2);
});
