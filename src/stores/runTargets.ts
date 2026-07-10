// Shared run-target state (discovered targets + the active selection), lifted
// out of the launcher component so both the Debug Console header launcher and
// the status-bar Run button read the same list. Populated by the launcher's
// effect on the active project.
import { createSignal } from "solid-js";
import type { RunTarget } from "../lib/runTargets";

const [targets, setTargets] = createSignal<RunTarget[]>([]);
const [activeId, setActiveId] = createSignal<string>("");
const [discoveryError, setDiscoveryError] = createSignal<string | null>(null);

/** Reactive list of discovered run targets. */
export const runTargets = targets;
/** Reactive id of the chosen target. */
export const activeTargetId = activeId;
export const runTargetDiscoveryError = discoveryError;

/** Replace the target list, keeping the active selection if it still exists. */
export function setRunTargets(list: RunTarget[]) {
  setTargets(list);
  if (!list.some((t) => t.id === activeId())) setActiveId(list[0]?.id ?? "");
}

export function setRunTargetDiscoveryError(value: string | null) {
  setDiscoveryError(value);
}

export function setActiveTargetId(id: string) {
  setActiveId(id);
}

/** The currently selected target (falls back to the first). */
export function activeTarget(): RunTarget | null {
  return targets().find((t) => t.id === activeId()) ?? targets()[0] ?? null;
}

export const hasRunTargets = () => targets().length > 0;
