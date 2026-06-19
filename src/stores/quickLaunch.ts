// Configurable quick-launch items + hotkeys. Items either pin an agent (the
// command is resolved through launchCommand so the model picker still applies)
// or type a literal command. Persisted in localStorage like agentModels.
import { createSignal } from "solid-js";
import { AGENTS, launchCommand } from "../lib/agentModels";

export interface QuickLaunchItem {
  id: string;
  label: string;
  /** "Mod+1", "Mod+Shift+C" — Mod = Ctrl (Linux/Win) / Cmd (mac). null = none. */
  hotkey: string | null;
  /** model-pinned agent launch (resolved via launchCommand) … */
  agentId?: string;
  /** … or a literal command typed at the prompt. */
  command?: string;
  /** optional binary whose presence gates the chip (e.g. "flutter", "adb"). */
  binary?: string;
}

const STORE_KEY = "pickforge.quickLaunch";

export const DEFAULT_QUICK_LAUNCH: QuickLaunchItem[] = [
  { id: "agent-claude", label: "claude", agentId: "claudeCode", hotkey: "Mod+1" },
  { id: "agent-codex", label: "codex", agentId: "codex", hotkey: "Mod+2" },
  { id: "tool-flutter-doctor", label: "flutter doctor", command: "flutter doctor ", binary: "flutter", hotkey: "Mod+3" },
  { id: "tool-adb-devices", label: "adb devices", command: "adb devices ", binary: "adb", hotkey: "Mod+4" },
];

const clone = (items: QuickLaunchItem[]): QuickLaunchItem[] =>
  items.map((i) => ({ ...i }));

function load(): QuickLaunchItem[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return clone(DEFAULT_QUICK_LAUNCH);
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.items) && parsed.items.length) return parsed.items;
    return clone(DEFAULT_QUICK_LAUNCH);
  } catch {
    return clone(DEFAULT_QUICK_LAUNCH);
  }
}

const [items, setItems] = createSignal<QuickLaunchItem[]>(load());
/** Reactive accessor for the current quick-launch items. */
export const quickLaunchItems = items;

function persist(next: QuickLaunchItem[]) {
  setItems(next);
  localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, items: next }));
}

export function setQuickLaunchItems(next: QuickLaunchItem[]) {
  persist(next);
}
export function updateQuickLaunchItem(id: string, patch: Partial<QuickLaunchItem>) {
  persist(items().map((i) => (i.id === id ? { ...i, ...patch } : i)));
}
export function addQuickLaunchItem() {
  persist([
    ...items(),
    { id: `custom-${Date.now()}`, label: "new command", command: "", hotkey: null },
  ]);
}
export function removeQuickLaunchItem(id: string) {
  persist(items().filter((i) => i.id !== id));
}
export function resetQuickLaunchItems() {
  localStorage.removeItem(STORE_KEY);
  setItems(clone(DEFAULT_QUICK_LAUNCH));
}

/** The text to type for an item; agent items resolve the model-pinned command. */
export function commandForItem(item: QuickLaunchItem): string {
  if (item.agentId) return launchCommand(item.agentId);
  return item.command ?? "";
}

/** The binary whose availability gates a chip (explicit, or the agent's). */
export function binaryForItem(item: QuickLaunchItem): string | null {
  if (item.binary) return item.binary;
  if (item.agentId) return AGENTS.find((a) => a.id === item.agentId)?.binary ?? null;
  return null;
}

// ---- hotkeys (modifier-required so they never collide with shell input) ----
const MODS = ["Control", "Shift", "Alt", "Meta"];

/** The physical key as a stable label, independent of Shift. e.code keeps
 *  "Ctrl+Shift+2" reading as "2" rather than the shifted glyph "@". */
function keyToken(e: KeyboardEvent): string {
  const code = e.code;
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^F[0-9]{1,2}$/.test(code)) return code;
  if (e.key.length > 1) return e.key; // Arrow*, Enter, Tab, Home, …
  return e.key.toUpperCase();
}

/** Encode a keydown as a canonical hotkey string, or null if it's modifier-only
 *  or has no Mod/Alt (we require a modifier so plain typing never fires). */
export function eventToHotkey(e: KeyboardEvent): string | null {
  if (MODS.includes(e.key)) return null;
  const hasMod = e.ctrlKey || e.metaKey || e.altKey;
  if (!hasMod) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Mod");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(keyToken(e));
  return parts.join("+");
}

export function hotkeyMatches(e: KeyboardEvent, hotkey: string | null): boolean {
  return !!hotkey && eventToHotkey(e) === hotkey;
}

/** Human-readable hotkey label. */
export function formatHotkey(hotkey: string | null): string {
  if (!hotkey) return "—";
  const isMac =
    typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  return hotkey.replace("Mod", isMac ? "⌘" : "Ctrl").replace(/\+/g, " ");
}

/** ids of items sharing a hotkey (for a conflict warning in settings). */
export function conflictingHotkeys(list: QuickLaunchItem[]): Set<string> {
  const seen = new Map<string, string>();
  const dupes = new Set<string>();
  for (const i of list) {
    if (!i.hotkey) continue;
    const prev = seen.get(i.hotkey);
    if (prev) {
      dupes.add(i.id);
      dupes.add(prev);
    } else seen.set(i.hotkey, i.id);
  }
  return dupes;
}
