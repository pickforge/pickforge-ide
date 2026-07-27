// One pi-kit run's lanes, rendered inside an agent chat's MCP row (#362).
//
// Renders the SAME `RunCard` Settings uses, so the two surfaces cannot drift.
// What differs is the lifecycle, not the rendering:
//
//   live  — the MCP call is in flight, so this polls while the row is open.
//           That is what makes watching a `lanes_wait` worth anything.
//   frozen — the call has finished, so it shows whatever the store already
//           knows and never polls. A replayed row must not rewrite itself from
//           a run that has since moved on, or blank out because the run was
//           pruned.
//
// Polling is scoped to a MOUNTED, OPEN row: the card only mounts when its
// disclosure opens (`Disclosure` keeps closed bodies out of the DOM), so a
// transcript full of old lanes rows costs nothing.
import { Show, type JSX, onCleanup, onMount } from "solid-js";
import { RunCard } from "./PiKitRunCard";
import {
  pikitRuns,
  startPiKitLanesPolling,
  stopPiKitLanesPolling,
} from "../../stores/pikitLanes";

export function PiKitRunLanes(props: { run: string; live: boolean }): JSX.Element {
  onMount(() => {
    if (!props.live) return;
    // Idempotent: the Settings panel may already be polling, and this must not
    // double the interval or stop it out from under that panel on cleanup —
    // `startPiKitLanesPolling` no-ops when a poll is already running.
    startPiKitLanesPolling();
    onCleanup(() => stopPiKitLanesPolling());
  });

  const entry = () => pikitRuns().find((candidate) => candidate.run === props.run) ?? null;

  return (
    <Show
      when={entry()}
      fallback={
        <div class="pf-pikit-empty">
          {props.live ? "Waiting for lane status…" : `No lane status retained for ${props.run}.`}
        </div>
      }
    >
      {(found) => (
        <div class="pf-pikit-inline">
          {/* Abandon is deliberately inert here: acting on a run belongs in the
              Settings panel that owns it, and offering it mid-transcript would
              be a destructive action two clicks from a replayed message. */}
          <RunCard entry={found()} onAbandon={() => undefined} readOnly />
        </div>
      )}
    </Show>
  );
}
