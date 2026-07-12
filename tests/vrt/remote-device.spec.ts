import { expect, test, type Page } from "@playwright/test";

const projectRoot = "/home/dev/acme-app";
const remote = {
  host: "acorns-macbook.tailnet.ts.net",
  remoteRoot: "/Users/elberte/Projects/Personal/sample_flutter_app",
};

async function openFixture(page: Page, fixture: string, selected?: string) {
  await page.addInitScript(({ fixture, selected, projectRoot, remote }) => {
    localStorage.setItem("pickforge.flags", JSON.stringify({ remoteProjects: true }));
    localStorage.setItem("pickforge.vrt.remoteDeviceFixture", fixture);
    if (selected) {
      const key = JSON.stringify(["remote", projectRoot, remote.host, remote.remoteRoot]);
      localStorage.setItem("pickforge.runDevice", JSON.stringify({ [key]: selected }));
    }
  }, { fixture, selected, projectRoot, remote });
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("/#/workbench");
}

async function expectInspectorScreenshot(page: Page, name: string) {
  await expect(page.locator(".pf-inspector")).toHaveScreenshot(name, {
    animations: "disabled",
    maxDiffPixelRatio: 0.025,
  });
}

test("remote device loading state", async ({ page }) => {
  await openFixture(page, "loading");
  await expect(page.getByText("Finding devices…").first()).toBeVisible();
  await expectInspectorScreenshot(page, "remote-device-loading-1024.png");
});

test("remote device empty state", async ({ page }) => {
  await openFixture(page, "empty");
  await expect(page.getByText("No remote Flutter devices").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" }).first()).toBeVisible();
  await expectInspectorScreenshot(page, "remote-device-empty-1024.png");
});

test("remote device error state", async ({ page }) => {
  await openFixture(page, "error");
  await expect(page.getByText(/Device check failed: SSH unavailable/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" }).first()).toBeVisible();
  await expectInspectorScreenshot(page, "remote-device-error-1024.png");
});

test("remote device stale state", async ({ page }) => {
  await openFixture(page, "stale", "missing-device");
  await expect(page.getByText("Saved device unavailable").first()).toBeVisible();
  await expectInspectorScreenshot(page, "remote-device-stale-1024.png");
});

test("remote device menu supports keyboard focus", async ({ page }) => {
  await openFixture(page, "multiple");
  const trigger = page.getByRole("button", { name: "Remote Flutter device: Choose device" }).first();
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox").first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "macOS · macos" }).first()).toBeFocused();
  await expectInspectorScreenshot(page, "remote-device-keyboard-1024.png");
});
