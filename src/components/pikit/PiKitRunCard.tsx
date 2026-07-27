// One pi-kit run, rendered identically in Settings and in an agent chat's MCP
// row (#362). Extracted out of PiKitLanesPanel rather than written twice —
// a second lane card would drift from this one the first time either changed.
import { For, Show, type JSX, createSignal } from "solid-js";
import { Disclosure } from "../ui";
import { IconChevronRight, IconGrid } from "../icons";
import type { PiKitRunEntry } from "../../lib/process";
import {
  abandonDisabledReason,
  abandonHint,
  formatCost,
  formatDuration,
  formatTokens,
  laneDetail,
  laneStatusTone,
  orphanNote,
  runLabel,
  runStatusTone,
} from "./pikitLaneDisplay";
import "./pikitLanes.css";

export interface AbandonTarget {
  run: string;
  lane: string | null;
  label: string;
}

// eslint-disable-next-line max-lines-per-function -- one cohesive card; splitting it would spread the lane row across files.
export function RunCard(props: {
  entry: PiKitRunEntry;
  onAbandon: (target: AbandonTarget) => void;
  /** Hides the Abandon controls. Acting on a run belongs in the Settings panel
   *  that owns it — offering a destructive action two clicks from a replayed
   *  chat message would be a trap (#362). */
  readOnly?: boolean;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const entry = () => props.entry;
  const status = () => entry().status;
  const runAbandonReason = () => abandonDisabledReason(entry());
  const runAbandonHint = () => abandonHint(entry());

  return (
    <section
      class="pf-pikit-card"
      classList={{ "pf-pikit-card--open": open() }}
      aria-label="pi-kit run"
    >
      <button
        type="button"
        class="pf-pikit-summary"
        aria-expanded={open()}
        onClick={() => setOpen((v) => !v)}
      >
        <span class="pf-pikit-summary-chevron" aria-hidden="true">
          <IconChevronRight size={12} />
        </span>
        <span class="pf-pikit-summary-title">
          <IconGrid size={13} />
          <span>{entry().run}</span>
        </span>
        <span class="pf-pikit-summary-meta">
          <Show when={status()}>
            {(s) => (
              <>
                {s().lanes.length} lane{s().lanes.length === 1 ? "" : "s"} · {formatCost(s().totals.cost)} ·{" "}
                {formatDuration(s().durationMs)}
              </>
            )}
          </Show>
        </span>
        <span class="pf-pikit-status" style={{ "--pf-pikit-status": runStatusTone(entry()) }}>
          <span class="pf-pikit-dot" />
          {runLabel(entry())}
        </span>
      </button>
      <Disclosure open={open()}>
        <div class="pf-pikit-body">
          <Show when={status()} fallback={<div class="pf-pikit-empty">No status details available.</div>}>
            {(s) => (
              <div class="pf-pikit-lanes">
                <For each={s().lanes}>
                  {(lane) => {
                    const reason = () => abandonDisabledReason(entry(), lane);
                    const hint = () => abandonHint(entry());
                    return (
                      <div class="pf-pikit-lane">
                        <span
                          class="pf-pikit-lane-status"
                          style={{ "--pf-pikit-status": laneStatusTone(lane.state) }}
                        >
                          <span class="pf-pikit-dot" />
                          {lane.state}
                        </span>
                        <span class="pf-pikit-lane-main">
                          <span class="pf-pikit-lane-title">{lane.lane}</span>
                          <span class="pf-pikit-lane-meta">
                            {lane.model} · {lane.effort} · {formatTokens(lane.tokensIn)}/
                            {formatTokens(lane.tokensOut)} tok · {formatCost(lane.cost)} ·{" "}
                            {formatDuration(lane.durationMs)}
                          </span>
                          <span class="pf-pikit-lane-detail">{laneDetail(lane)}</span>
                        </span>
                        <Show when={!props.readOnly}>
                        <button
                          type="button"
                          class="pf-text-btn pf-pikit-abandon"
                          disabled={reason() !== null}
                          title={reason() ?? hint() ?? "Request that pi-kit abandon this lane"}
                          onClick={() =>
                            props.onAbandon({ run: entry().run, lane: lane.lane, label: lane.lane })
                          }
                        >
                          Abandon
                        </button>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            )}
          </Show>
          <Show when={orphanNote(entry())}>
            {(note) => <div class="pf-pikit-orphan-note">{note()}</div>}
          </Show>
          <Show when={!props.readOnly && status() && status()!.lanes.length > 0}>
            <button
              type="button"
              class="pf-text-btn"
              disabled={runAbandonReason() !== null}
              title={
                runAbandonReason() ??
                runAbandonHint() ??
                "Request that pi-kit abandon every active lane in this run"
              }
              onClick={() => props.onAbandon({ run: entry().run, lane: null, label: "all lanes" })}
            >
              Abandon all lanes
            </button>
          </Show>
        </div>
      </Disclosure>
    </section>
  );
}

