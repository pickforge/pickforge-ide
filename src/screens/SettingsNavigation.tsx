import { For, type JSX } from "solid-js";
import type { SETTINGS_CATEGORIES, SettingsCategoryKey } from "./settingsRegistry";

type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

export function SettingsNavigation(props: {
  categories: readonly SettingsCategory[];
  active: SettingsCategoryKey;
  onSelect: (category: SettingsCategoryKey) => void;
  paneRef?: (element: HTMLElement) => void;
  children: JSX.Element;
}): JSX.Element {
  const activeCategory = () =>
    props.categories.find((category) => category.key === props.active) ?? props.categories[0];
  const navButtons: Partial<Record<SettingsCategoryKey, HTMLButtonElement>> = {};

  const moveSelection = (event: KeyboardEvent, current: SettingsCategoryKey) => {
    const index = props.categories.findIndex((category) => category.key === current);
    if (index < 0) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (index + 1) % props.categories.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (index - 1 + props.categories.length) % props.categories.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = props.categories.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const next = props.categories[nextIndex];
    props.onSelect(next.key);
    navButtons[next.key]?.focus();
  };

  return (
    <div class="pf-settings-shell">
      <aside class="pf-settings-rail">
        <nav class="pf-settings-nav" aria-label="Settings categories">
          <For each={props.categories}>
            {(category) => (
              <button
                ref={(element) => {
                  navButtons[category.key] = element;
                }}
                type="button"
                class="pf-settings-nav-item"
                classList={{ "pf-settings-nav-item--active": category.key === props.active }}
                aria-current={category.key === props.active ? "page" : undefined}
                onClick={() => props.onSelect(category.key)}
                onKeyDown={(event) => moveSelection(event, category.key)}
              >
                {category.label}
              </button>
            )}
          </For>
        </nav>
      </aside>

      <label class="pf-settings-category-picker">
        <span class="pf-settings-category-picker-label">Category</span>
        <select
          value={props.active}
          onChange={(event) => props.onSelect(event.currentTarget.value as SettingsCategoryKey)}
        >
          <For each={props.categories}>
            {(category) => <option value={category.key}>{category.label}</option>}
          </For>
        </select>
      </label>

      <main
        ref={props.paneRef}
        class="pf-settings-pane"
        aria-labelledby="pf-settings-category-title"
      >
        <header class="pf-settings-pane-head" aria-live="polite" aria-atomic="true">
          <h1 id="pf-settings-category-title">{activeCategory()?.label}</h1>
          <p>{activeCategory()?.description}</p>
        </header>
        {props.children}
        <div class="pf-settings-pane-tail" aria-hidden="true" />
      </main>
    </div>
  );
}
