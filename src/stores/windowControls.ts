// Which side the custom window controls (minimize / maximize / close) sit on.
// "auto" follows the OS convention (left on macOS, right on Windows/Linux);
// "left"/"right" force a side. macOS always renders on the left regardless, to
// keep the traffic-light affordance where users expect it. Persisted locally.
import { createSignal } from "solid-js";
import { hostPlatform } from "../lib/platform";
import { noteSettingsEdit } from "../lib/settingsSyncEdits";

export type ControlsSide = "auto" | "left" | "right";

const KEY = "pickforge.windowControlsSide";

function load(): ControlsSide {
  const raw = localStorage.getItem(KEY);
  return raw === "left" || raw === "right" ? raw : "auto";
}

const [side, setSide] = createSignal<ControlsSide>(load());
export const windowControlsSide = side;

export function setWindowControlsSide(next: ControlsSide) {
  setSide(next);
  localStorage.setItem(KEY, next);
  noteSettingsEdit("appSettings");
}

/** Resolve the configured side to the concrete edge for the current host.
 *  macOS is always left; "auto" is right on Windows/Linux, left on macOS. */
export function resolvedControlsSide(): "left" | "right" {
  if (hostPlatform() === "macos") return "left";
  const s = side();
  if (s === "auto") return "right";
  return s;
}
