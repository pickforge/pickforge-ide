// Feature-flag registry (@pickforge/flags), overrides kept in localStorage.
// Default-off release gates; dev builds can flip them from Settings.
import { createSignal } from "solid-js";
import { createFlags, type FlagOverrideStore, type FlagState } from "@pickforge/flags";

const KEY = "pickforge.flags";

function load(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const overrides = load();

function persist() {
  localStorage.setItem(KEY, JSON.stringify(overrides));
}

const localStorageStore: FlagOverrideStore = {
  get(key) {
    return overrides[key];
  },
  set(key, value) {
    if (value === undefined) {
      delete overrides[key];
    } else {
      overrides[key] = value;
    }
    persist();
  },
};

const definitions = {
  operator: { description: "Operator command layer (epic #118)" },
  remoteProjects: { description: "Per-project remote hosts (epic #144)" },
  accounts: { description: "Accounts and Pro entitlements (#132)" },
  settingsSync: { description: "Settings sync for signed-in users (#151)" },
} as const;

export type FlagKey = keyof typeof definitions;

const flags = createFlags(definitions, { store: localStorageStore });

const [version, setVersion] = createSignal(0);
flags.subscribe(() => setVersion((v) => v + 1));

export function flagEnabled(key: FlagKey): boolean {
  version();
  return flags.isEnabled(key);
}

export function flagStates(): FlagState[] {
  version();
  return flags.list();
}

export function setFlagOverride(key: FlagKey, value: boolean | undefined) {
  flags.setOverride(key, value);
}

export function subscribeToFlagChanges(listener: () => void): () => void {
  return flags.subscribe(listener);
}
