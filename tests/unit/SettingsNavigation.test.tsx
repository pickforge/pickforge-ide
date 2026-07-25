// @vitest-environment jsdom
// Focused component tests for the settings shell's left category rail
// (pickforge#211 PR-3): keyboard movement, aria-current exposure, and click
// selection. The category/section persistence and link-selection logic
// itself is pure and already covered by settingsRegistry.test.ts and
// settingsCategoryPersistence.test.ts — this file exercises only what the
// rendered nav actually does with those decisions.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { SettingsNavigation } from "../../src/screens/SettingsNavigation";
import { SETTINGS_CATEGORIES, type SettingsCategoryKey } from "../../src/screens/settingsRegistry";

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
});

function mount(initial: SettingsCategoryKey = "general") {
  const [active, setActive] = createSignal<SettingsCategoryKey>(initial);
  const selections: SettingsCategoryKey[] = [];
  dispose = render(
    () => (
      <SettingsNavigation
        categories={SETTINGS_CATEGORIES}
        active={active()}
        onSelect={(key) => {
          selections.push(key);
          setActive(key);
        }}
      >
        <div>content</div>
      </SettingsNavigation>
    ),
    root,
  );
  const navButton = (key: SettingsCategoryKey) => {
    const index = SETTINGS_CATEGORIES.findIndex((category) => category.key === key);
    return root.querySelectorAll<HTMLButtonElement>(".pf-settings-nav-item")[index];
  };
  return { active, selections, navButton };
}

function press(button: HTMLButtonElement, key: string) {
  button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("SettingsNavigation", () => {
  it("renders one nav button per category with the active one marked aria-current", () => {
    const { navButton } = mount("agents");

    const buttons = root.querySelectorAll(".pf-settings-nav-item");
    expect(buttons).toHaveLength(SETTINGS_CATEGORIES.length);
    expect(navButton("agents").getAttribute("aria-current")).toBe("page");
    expect(navButton("general").getAttribute("aria-current")).toBeNull();
    expect(navButton("agents").textContent).toBe("Agents");
  });

  it("selects a category by click", () => {
    const { selections, navButton } = mount("general");

    navButton("operator").click();

    expect(selections).toEqual(["operator"]);
    expect(navButton("operator").getAttribute("aria-current")).toBe("page");
  });

  it("moves to the next category on ArrowDown/ArrowRight and focuses it", () => {
    const { selections, navButton } = mount("general");

    press(navButton("general"), "ArrowDown");
    expect(selections).toEqual(["agents"]);
    expect(document.activeElement).toBe(navButton("agents"));

    press(navButton("agents"), "ArrowRight");
    expect(selections).toEqual(["agents", "operator"]);
    expect(document.activeElement).toBe(navButton("operator"));
  });

  it("moves to the previous category on ArrowUp/ArrowLeft and wraps at the start", () => {
    const { selections, navButton } = mount("general");

    press(navButton("general"), "ArrowUp");

    const last = SETTINGS_CATEGORIES[SETTINGS_CATEGORIES.length - 1].key;
    expect(selections).toEqual([last]);
    expect(document.activeElement).toBe(navButton(last));
  });

  it("wraps from the last category to the first on ArrowDown", () => {
    const last = SETTINGS_CATEGORIES[SETTINGS_CATEGORIES.length - 1].key;
    const { selections, navButton } = mount(last);

    press(navButton(last), "ArrowDown");

    expect(selections).toEqual(["general"]);
    expect(document.activeElement).toBe(navButton("general"));
  });

  it("jumps to the first/last category on Home/End", () => {
    const { selections, navButton } = mount("operator");
    const last = SETTINGS_CATEGORIES[SETTINGS_CATEGORIES.length - 1].key;

    press(navButton("operator"), "End");
    expect(selections).toEqual([last]);
    expect(document.activeElement).toBe(navButton(last));

    press(navButton(last), "Home");
    expect(selections).toEqual([last, "general"]);
    expect(document.activeElement).toBe(navButton("general"));
  });

  it("ignores unrelated keys", () => {
    const { selections, navButton } = mount("general");

    press(navButton("general"), "a");
    press(navButton("general"), "Tab");

    expect(selections).toEqual([]);
  });

  it("mirrors the same categories and selection in the narrow-layout picker", () => {
    const { selections } = mount("general");

    const select = root.querySelector<HTMLSelectElement>(".pf-settings-category-picker select")!;
    expect(select.options).toHaveLength(SETTINGS_CATEGORIES.length);
    expect(select.value).toBe("general");

    select.value = "developer";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(selections).toEqual(["developer"]);
  });

  it("renders the active category's heading and description in the content pane head", () => {
    mount("developer");

    const heading = root.querySelector("#pf-settings-category-title");
    expect(heading?.tagName).toBe("H1");
    expect(heading?.textContent).toBe("Developer");
    const head = root.querySelector(".pf-settings-pane-head");
    expect(head?.getAttribute("aria-live")).toBe("polite");
    expect(head?.querySelector("p")?.textContent).toBe(
      "Local feature gates and diagnostics.",
    );
  });
});
