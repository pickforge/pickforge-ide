// Misc workbench chrome preferences (localStorage). Layout/docking lives in its
// own store; this holds the lightweight visibility toggles.
import { createSignal } from "solid-js";

const KEY = "pickforge.workbenchPrefs";

interface Prefs {
  quickLaunchVisible: boolean;
}
const DEFAULTS: Prefs = { quickLaunchVisible: true };

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw);
    return { quickLaunchVisible: p.quickLaunchVisible !== false };
  } catch {
    return { ...DEFAULTS };
  }
}

const [prefs, setPrefs] = createSignal<Prefs>(load());
export const workbenchPrefs = prefs;

function persist(next: Prefs) {
  setPrefs(next);
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function setQuickLaunchVisible(visible: boolean) {
  persist({ ...prefs(), quickLaunchVisible: visible });
}
export function toggleQuickLaunch() {
  setQuickLaunchVisible(!prefs().quickLaunchVisible);
}
