import { test, expect } from "@playwright/test";

// #357. The queue only exists while a turn is live, so this drives the
// `agentChatRunning` fixture — the shared agent-chat history replayed without
// its terminal `turnDone`. Messages are typed and queued through the real
// composer path rather than seeded, so the spec exercises what users do.
test("queued messages rack above the composer", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pickforge.vrt.agentChatFixture", "1");
    localStorage.setItem("pickforge.vrt.agentChatRunning", "1");
    localStorage.setItem("pickforge.flags", JSON.stringify({ messageQueue: true }));
  });

  await page.goto("/#/workbench");

  // A live turn used to leave this composer dead on Claude Code and OMP.
  // The fixture chat is Codex, which can steer, so the placeholder also
  // carries the chord hint. The chord glyph itself is deliberately not
  // asserted: the VRT mock installs __TAURI_INTERNALS__, so hostPlatform()
  // reads the real UA and renders ⌘⏎ on macOS but Ctrl⏎ on the Linux runner.
  const editor = page.locator(".pf-chat-editor");
  await expect(editor).toHaveAttribute("aria-label", /^Queue the next message…/);

  await editor.click();
  await page.keyboard.type("Fix the failing test first");
  await page.keyboard.press("Enter");
  await page.keyboard.type("then update the changelog");
  await page.keyboard.press("Enter");

  const dock = page.locator(".pf-chat-queue");
  const rows = dock.locator(".pf-chat-queue-row");
  await expect(dock.locator(".pf-chat-queue-head")).toHaveText("QUEUED · 2");
  await expect(rows).toHaveCount(2);
  await expect(editor).toHaveText("");

  // FIFO: the first message typed is the one that sends next, and it is marked
  // by position alone — no ordinal, no "NEXT" label.
  await expect(rows.first()).toContainText("Fix the failing test first");
  await expect(rows.nth(1)).toContainText("then update the changelog");

  // At rest a stack of queued messages shows no remove controls at all.
  await expect(dock.locator(".pf-chat-queue-remove").first()).toHaveCSS("opacity", "0");

  // The queue is announced through one always-mounted live region, not by
  // relabeling the visible header.
  await expect(page.locator(".pf-chat-queue-live")).toHaveText("2 messages queued");

  await expect(page.locator(".pf-chat-footer")).toHaveScreenshot("queue-dock-resting.png", {
    maxDiffPixelRatio: 0.025,
    animations: "disabled",
  });
});
