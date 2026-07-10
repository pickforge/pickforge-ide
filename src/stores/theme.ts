// App color theme (dark/light), reactive so live consumers — notably the xterm
// terminals — can re-theme when it changes (CSS tokens flip via the data-theme
// attribute; the terminal reads tokens in JS, so it needs an explicit nudge).
import { createSignal } from "solid-js";
import { noteSettingsEdit } from "../lib/settingsSyncEdits";

export type ThemeMode = "dark" | "light";

const KEY = "pickforge.theme";

function load(): ThemeMode {
  return localStorage.getItem(KEY) === "light" ? "light" : "dark";
}

const [theme, setTheme] = createSignal<ThemeMode>(load());
/** Reactive current theme. */
export const appTheme = theme;

export function applyTheme(mode: ThemeMode) {
  // Flip the attribute (and thus the CSS tokens) BEFORE the signal fires, so
  // effects that read computed token values see the new palette.
  document.documentElement.dataset.theme = mode === "light" ? "light" : "";
  localStorage.setItem(KEY, mode);
  setTheme(mode);
  noteSettingsEdit("appSettings");
}

/** Apply the persisted theme to <html> at startup. */
export function initTheme() {
  document.documentElement.dataset.theme = theme() === "light" ? "light" : "";
}
