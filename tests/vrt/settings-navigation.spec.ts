import { expect, test, type Page } from "@playwright/test";

const ALL_SETTINGS_FLAGS = {
  operator: true,
  accounts: true,
};
const CONNECTOR_SETTINGS_FLAGS = {
  ...ALL_SETTINGS_FLAGS,
  ompAgents: true,
};

async function openSettings(
  page: Page,
  section = "appearance",
  flags: Record<string, boolean> = ALL_SETTINGS_FLAGS,
) {
  await page.addInitScript((enabledFlags) => {
    localStorage.setItem("pickforge.flags", JSON.stringify(enabledFlags));
  }, flags);
  await page.goto(`/#/settings/${section}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

async function expectSectionAtPaneTop(page: Page, section: string) {
  await expect.poll(async () =>
    page.locator(`[data-settings-section=${section}]`).evaluate((element) => {
      const pane = element.closest(".pf-settings-pane");
      if (!pane) return Number.POSITIVE_INFINITY;
      return Math.abs(element.getBoundingClientRect().top - pane.getBoundingClientRect().top);
    }),
  ).toBeLessThanOrEqual(2);
}
async function expectPaneAtScrollTop(page: Page) {
  await expect.poll(() =>
    page.locator(".pf-settings-pane").evaluate((pane) => pane.scrollTop),
  ).toBeLessThanOrEqual(0.5);
}

async function makeNextPickLabRefreshAddError(page: Page) {
  await page.evaluate(() => {
    const internals: unknown = Reflect.get(window, "__TAURI_INTERNALS__");
    if (
      !internals
      || typeof internals !== "object"
      || !("invoke" in internals)
      || typeof internals.invoke !== "function"
    ) {
      throw new Error("Missing Tauri VRT invoke mock");
    }

    const originalInvoke = internals.invoke;
    Reflect.set(
      internals,
      "invoke",
      (command: string, args: Record<string, unknown> = {}) => {
        if (command === "picklab_status") {
          return Promise.resolve({
            cliAvailable: true,
            mcpAvailable: true,
            cliPath: "/usr/bin/picklab",
            mcpPath: "/usr/bin/picklab-mcp",
            version: "0.1.3",
            doctor: { ok: false, checks: [] },
            agents: { ok: true, agents: [] },
            error: "PickLab status finished with a representative delayed layout warning.",
          });
        }
        return Reflect.apply(originalInvoke, internals, [command, args]);
      },
    );
  });
}

async function refreshPickLab(page: Page) {
  await page
    .locator("[data-settings-section=pickLab]")
    .getByRole("button", { name: "Refresh" })
    .evaluate((button: HTMLButtonElement) => button.click());
}

async function makeOmpProbeFail(page: Page) {
  await page.evaluate(() => {
    Reflect.set(window, "__PICKFORGE_VRT_FAIL_OMP_PROBE__", true);
  });
}

test.describe("settings navigation", () => {
  test.describe.configure({ mode: "serial" });
  test("selects, links, remembers, and keyboard-navigates categories", async ({ page }) => {
    await openSettings(page);

    const general = page.getByRole("button", { name: "General", exact: true });
    const agents = page.getByRole("button", { name: "Agents", exact: true });
    await expect(general).toHaveAttribute("aria-current", "page");

    await agents.click();
    await expect(page.getByRole("heading", { level: 1, name: "Agents" })).toBeVisible();
    await expect(agents).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(/#\/settings\/agentModels$/);

    await page.goto("/#/workbench");
    await page.goto("/#/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Agents" })).toBeVisible();

    await agents.focus();
    await agents.press("ArrowDown");
    const operator = page.getByRole("button", { name: "Operator", exact: true });
    await expect(operator).toBeFocused();
    await expect(operator).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1, name: "Operator" })).toBeVisible();

    await page.goto("/#/settings/quickLaunch");
    await expect(page.getByRole("heading", { level: 1, name: "Agents" })).toBeVisible();
    await expect(page.locator("[data-settings-section=quickLaunch]")).toBeVisible();
  });

  test("ignores remembered categories for an explicitly unavailable section", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("pickforge.settings.category", "agents");
    });
    await openSettings(page, "account", {});

    await expect(page.getByRole("heading", { level: 1, name: "General" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Account & sync" })).toHaveCount(0);
    await expect(page.locator("[data-settings-section=account]")).toHaveCount(0);
    await expect(page).toHaveURL(/#\/settings\/appearance$/);
  });

  test("handles malformed Settings hashes and preserves suffixed route fallback", async ({ page }) => {
    await openSettings(page, "%E0%A4%A", {});

    await expect(page.getByRole("heading", { level: 1, name: "General" })).toBeVisible();
    await expect(page).toHaveURL(/#\/settings\/appearance$/);

    await page.goto("/#/history/trailing");
    await expect(page.locator(".pf-workbench")).toBeVisible();
    await expect(page).toHaveURL(/#\/history\/trailing$/);

    await page.goto("/#/settings/appearance/trailing");
    await expect(page.locator(".pf-workbench")).toBeVisible();
    await expect(page).toHaveURL(/#\/settings\/appearance\/trailing$/);
  });

  test("positions linked sections through same-category history without moving focus", async ({
    page,
  }) => {
    await openSettings(page, "chats");
    await expectSectionAtPaneTop(page, "chats");

    const agents = page.getByRole("button", { name: "Agents", exact: true });
    await agents.focus();
    await page.evaluate(() => {
      window.location.hash = "/settings/agentModels";
    });
    await expect(page).toHaveURL(/#\/settings\/agentModels$/);
    await expectPaneAtScrollTop(page);
    await expect(agents).toBeFocused();

    await page.evaluate(() => {
      window.location.hash = "/settings/chats";
    });
    await expectSectionAtPaneTop(page, "chats");

    await page.goBack();
    await expect(page).toHaveURL(/#\/settings\/agentModels$/);
    await expectPaneAtScrollTop(page);
    await expect(agents).toBeFocused();

    await page.goForward();
    await expect(page).toHaveURL(/#\/settings\/chats$/);
    await expectSectionAtPaneTop(page, "chats");
    await expect(agents).toBeFocused();
  });

  test("resets the remembered category pane when its section hash is cleared", async ({ page }) => {
    await openSettings(page, "quickLaunch");
    await expectSectionAtPaneTop(page, "quickLaunch");

    const tail = page.locator(".pf-settings-pane-tail");
    await expect.poll(() => tail.evaluate((element) => element.style.height)).not.toBe("");

    await page.getByRole("button", { name: "Settings", exact: true }).click();

    await expect(page).toHaveURL(/#\/settings$/);
    await expect(page.getByRole("heading", { level: 1, name: "Agents" })).toBeVisible();
    await expectPaneAtScrollTop(page);
    await expect.poll(() => tail.evaluate((element) => element.style.height)).toBe("");
  });
  test("revokes a paired remote client and refreshes its status", async ({ page }) => {
    await openSettings(page, "remoteHost");
    await page.evaluate(() => {
      const internals: unknown = Reflect.get(window, "__TAURI_INTERNALS__");
      if (
        !internals
        || typeof internals !== "object"
        || !("invoke" in internals)
        || typeof internals.invoke !== "function"
      ) {
        throw new Error("Missing Tauri VRT invoke mock");
      }

      const originalInvoke = internals.invoke;
      const revokeCalls: string[] = [];
      let revoked = false;
      Reflect.set(window, "__PICKFORGE_REMOTE_REVOKE_CALLS__", revokeCalls);
      Reflect.set(
        internals,
        "invoke",
        (command: string, args: Record<string, unknown> = {}) => {
          if (command === "remote_host_revoke_client") {
            revokeCalls.push(String(args.clientId));
            revoked = true;
            return Promise.resolve();
          }
          if (command === "remote_host_status") {
            return Promise.resolve(Reflect.apply(originalInvoke, internals, [command, args]))
              .then((overview: Record<string, unknown>) => ({
                ...overview,
                clients: [
                  {
                    clientId: "client-tablet",
                    clientName: "Field tablet",
                    issuedAtMs: Date.UTC(2026, 0, 15),
                    lastSeenAtMs: null,
                    revokedAtMs: revoked ? Date.UTC(2026, 0, 16) : null,
                  },
                  {
                    clientId: "client-phone",
                    clientName: "Studio phone",
                    issuedAtMs: Date.UTC(2026, 0, 10),
                    lastSeenAtMs: null,
                    revokedAtMs: Date.UTC(2026, 0, 12),
                  },
                ],
              }));
          }
          return Reflect.apply(originalInvoke, internals, [command, args]);
        },
      );
    });

    const remote = page.locator("[data-settings-section=remoteHost]");
    await remote.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(remote.getByText("Field tablet", { exact: false })).toBeVisible();
    await expect(remote.getByText("Studio phone", { exact: false })).toBeVisible();
    await expect(remote.locator(".pf-settings-hint-inline", { hasText: "Paired" })).toHaveCount(2);
    await expect(remote).toHaveScreenshot("remote-host-clients.png", {
      animations: "disabled",
    });

    await remote.getByRole("button", { name: "Revoke Field tablet", exact: true }).click();

    await expect(remote.getByText("Revoked", { exact: true })).toHaveCount(2);
    await expect(
      remote.getByRole("button", { name: "Revoke Field tablet", exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() =>
      Reflect.get(window, "__PICKFORGE_REMOTE_REVOKE_CALLS__"),
    )).toEqual(["client-tablet"]);
  });

  test("keeps a later deep link aligned after PickLab finishes loading", async ({ page }) => {
    await openSettings(page, "quickLaunch");
    await expectSectionAtPaneTop(page, "quickLaunch");

    await makeNextPickLabRefreshAddError(page);
    await refreshPickLab(page);
    await expect(page.getByText("PickLab status finished with a representative delayed layout warning."))
      .toBeVisible();
    await expectSectionAtPaneTop(page, "quickLaunch");
  });

  test("stops repositioning a deep link after user scroll intent", async ({ page }) => {
    await openSettings(page, "quickLaunch");
    await expectSectionAtPaneTop(page, "quickLaunch");
    await makeNextPickLabRefreshAddError(page);

    const pane = page.locator(".pf-settings-pane");
    await pane.dispatchEvent("wheel", { deltaY: -120 });
    await pane.evaluate((element) => {
      element.scrollTop -= 120;
    });
    await refreshPickLab(page);
    await expect(page.getByText("PickLab status finished with a representative delayed layout warning."))
      .toBeVisible();
    await expect.poll(() =>
      page.locator("[data-settings-section=quickLaunch]").evaluate((element) => {
        const settingsPane = element.closest(".pf-settings-pane");
        if (!settingsPane) return 0;
        return element.getBoundingClientRect().top - settingsPane.getBoundingClientRect().top;
      }),
    ).toBeGreaterThan(40);
  });

  for (const state of [
    { name: "wide", width: 1280, height: 820 },
    { name: "narrow", width: 600, height: 760 },
  ]) {
    test(`keeps the category heading visible at scroll top in ${state.name} layout`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: state.width, height: state.height });
      await openSettings(page, "quickLaunch");
      await expectSectionAtPaneTop(page, "quickLaunch");

      if (state.name === "wide") {
        await page.getByRole("button", { name: "General", exact: true }).click();
      } else {
        await page.getByLabel("Category").selectOption("general");
      }

      await expect(page).toHaveURL(/#\/settings\/appearance$/);
      await expect(page.getByRole("heading", { level: 1, name: "General" })).toBeVisible();
      await expectPaneAtScrollTop(page);
    });
  }

  test("switches to the compact selector without clipping", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 760 });
    await openSettings(page, "agentModels");

    await expect(page.getByRole("navigation", { name: "Settings categories" })).toBeHidden();
    const selector = page.getByLabel("Category");
    await expect(selector).toBeVisible();
    await selector.selectOption("operator");
    await expect(page.getByRole("heading", { level: 1, name: "Operator" })).toBeVisible();
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 600);
  });


  test("shows compatible OMP and Pi connector diagnostics", async ({ page }) => {
    await openSettings(page, "agentModels", CONNECTOR_SETTINGS_FLAGS);

    const omp = page.locator("[data-agent-connector=omp]");
    const pi = page.locator("[data-agent-connector=pi]");
    await expect(omp).toContainText("Installed · omp 17.1.1");
    await expect(omp).toContainText("Native chat ready");
    await expect(omp).toContainText("3 discovered offline");
    const ompModelPicker = omp.getByRole("button", { name: /Oh My Pi \(OMP\) model: 3 discovered/ });
    await expect(ompModelPicker).toBeVisible();
    await ompModelPicker.click();
    await expect(omp.getByRole("option", { name: "cogito-2.1:671b · ollama-cloud" }))
      .toBeVisible();
    await expect(omp.getByRole("option", { name: "GPT-5.4 · openai-codex" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(omp).toContainText("ACP integration is available");

    await expect(pi).toContainText("Installed · pi 0.79.10");
    await expect(pi).toContainText("Native chat ready");
    await expect(pi).toContainText("2 discovered offline");
    const modelPicker = pi.getByRole("button", { name: /Pi model: 2 discovered/ });
    await expect(modelPicker).toBeVisible();
    await modelPicker.click();
    await expect(pi.getByRole("option", { name: "claude-sonnet-4-6 · anthropic" }))
      .toBeVisible();
    await expect(pi.getByRole("option", { name: "gpt-5.4 · openai" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pi).toContainText("Pi RPC loads installed extensions and tools");

    const refresh = page.getByRole("button", { name: "Refresh connector status" });
    await refresh.focus();
    await refresh.click();
    await expect(refresh).toBeFocused();
    await expect(omp).toHaveAttribute("aria-busy", "false");
    await expect(pi).toHaveAttribute("aria-busy", "false");

    await makeOmpProbeFail(page);
    await refresh.click();
    await expect(refresh).toBeFocused();
    await expect(omp).toContainText("Native status unavailable");
    await expect(omp).toContainText("Capabilities unavailable because the local probe failed.");
    await expect(omp).not.toContainText("until the CLI is installed");
  });

  test("honors reduced motion in connector controls", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openSettings(page, "agentModels", CONNECTOR_SETTINGS_FLAGS);
    const refresh = page.getByRole("button", { name: "Refresh connector status" });
    await expect(refresh).toBeVisible();
    expect(
      await refresh.evaluate((element) =>
        getComputedStyle(element).transitionDuration
          .split(",")
          .every((duration) => Number.parseFloat(duration) === 0),
      ),
    ).toBe(true);
  });

  for (const state of [
    { name: "wide", width: 1280, height: 820 },
    { name: "narrow", width: 600, height: 760 },
  ]) {
    test(`visual: ${state.name} connector diagnostics`, async ({ page }) => {
      await page.setViewportSize({ width: state.width, height: state.height });
      await openSettings(page, "agentModels", CONNECTOR_SETTINGS_FLAGS);
      await expect(page.getByText("Native chat ready")).toHaveCount(2);
      await page.locator(".pf-agent-diagnostics-head").evaluate((element) => {
        element.scrollIntoView({ block: "start" });
      });
      await expect(page).toHaveScreenshot(
        `settings-navigation-connectors-${state.name}.png`,
        { animations: "disabled" },
      );
    });
  }
  for (const state of [
    { name: "general", section: "appearance" },
    { name: "agents", section: "agentModels" },
    { name: "operator", section: "operatorRouter" },
    { name: "account", section: "account" },
    { name: "developer", section: "featureFlags" },
  ]) {
    test(`visual: ${state.name}`, async ({ page }) => {
      await openSettings(page, state.section);
      await expect(page).toHaveScreenshot(`settings-navigation-${state.name}.png`, {
        animations: "disabled",
      });
    });
  }

  test("visual: narrow agents", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 760 });
    await openSettings(page, "agentModels");
    await expect(page).toHaveScreenshot("settings-navigation-narrow-agents.png", {
      animations: "disabled",
    });
  });
});
