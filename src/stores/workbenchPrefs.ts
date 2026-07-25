// Misc workbench chrome preferences (localStorage). Layout/docking lives in its
// own store; this holds the lightweight visibility toggles.
import { createSignal } from "solid-js";
import type { DiffViewMode } from "../lib/diffViewMode";
import { noteSettingsEdit } from "../lib/settingsSyncEdits";

const KEY = "pickforge.workbenchPrefs";

interface Prefs {
  /** show text labels next to the Run/Reload/Restart/Stop icons */
  runButtonLabels: boolean;
  /** Changes reviewer's preferred diff view (#231 PR5) — persists across
   *  files/sessions; narrow panes still force unified regardless of this
   *  value (`lib/diffViewMode.ts`'s `resolveDiffViewMode`). */
  diffViewMode: DiffViewMode;
}
const DEFAULTS: Prefs = { runButtonLabels: false, diffViewMode: "unified" };

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw);
    return {
      runButtonLabels: p.runButtonLabels === true,
      diffViewMode: p.diffViewMode === "split" ? "split" : "unified",
    };
  } catch {
    return { ...DEFAULTS };
  }
}

const [prefs, setPrefs] = createSignal<Prefs>(load());
export const workbenchPrefs = prefs;

function persist(next: Prefs) {
  setPrefs(next);
  localStorage.setItem(KEY, JSON.stringify(next));
  noteSettingsEdit("appSettings");
}

export function setRunButtonLabels(show: boolean) {
  persist({ ...prefs(), runButtonLabels: show });
}

export function setDiffViewMode(mode: DiffViewMode) {
  persist({ ...prefs(), diffViewMode: mode });
}
