// pi-kit lanes visibility (#274 slice 3, #288): lists active + recent pi-kit
// runs from `<run>.status.json` files, with a per-lane/per-run Abandon
// action. Mirrors SwarmRunCard's run/lane card idiom (components/chat) —
// same expandable-row + status-dot shape — since that's the closest existing
// "multi-lane run" surface in the app; see pikitLanes.css for the shared
// token usage.
import { For, Show, type JSX, createSignal, onCleanup, onMount } from "solid-js";
import { ConfirmDialog } from "../ConfirmDialog";
import { ForgeEmptyState, MonoEyebrow } from "../ui";
import { IconChevronDown, IconChevronRight, IconGrid, IconRefresh } from "../icons";
import type { PiKitRunEntry } from "../../lib/process";
import {
  loadPiKitRuns,
  pikitRuns,
  pikitRunsError,
  pikitRunsLoading,
  requestPiKitAbandon,
  startPiKitLanesPolling,
  stopPiKitLanesPolling,
} from "../../stores/pikitLanes";
import {
  abandonDisabledReason,
  formatCost,
  formatDuration,
  formatTokens,
  laneDetail,
  laneStatusTone,
  runLabel,
  runStatusTone,
} from "./pikitLaneDisplay";
import "./pikitLanes.css";

interface AbandonTarget {
  run: string;
  lane: string | null;
  label: string;
}

interface Notice {
  text: string;
  error: boolean;
}

// eslint-disable-next-line max-lines-per-function -- single cohesive panel; see codebase-design note in PR.
function RunCard(props: {
  entry: PiKitRunEntry;
  onAbandon: (target: AbandonTarget) => void;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const entry = () => props.entry;
  const status = () => entry().status;
  const runAbandonReason = () => abandonDisabledReason(entry());

  return (
    <section class="pf-pikit-card" aria-label="pi-kit run">
      <button
        type="button"
        class="pf-pikit-summary"
        aria-expanded={open()}
        onClick={() => setOpen((v) => !v)}
      >
        <span class="pf-pikit-summary-chevron" aria-hidden="true">
          <Show when={open()} fallback={<IconChevronRight size={12} />}>
            <IconChevronDown size={12} />
          </Show>
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
      <Show when={open()}>
        <div class="pf-pikit-body">
          <Show when={status()} fallback={<div class="pf-pikit-empty">No status details available.</div>}>
            {(s) => (
              <div class="pf-pikit-lanes">
                <For each={s().lanes}>
                  {(lane) => {
                    const reason = () => abandonDisabledReason(entry(), lane);
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
                        <button
                          type="button"
                          class="pf-text-btn pf-pikit-abandon"
                          disabled={reason() !== null}
                          title={reason() ?? "Request that pi-kit abandon this lane"}
                          onClick={() =>
                            props.onAbandon({ run: entry().run, lane: lane.lane, label: lane.lane })
                          }
                        >
                          Abandon
                        </button>
                      </div>
                    );
                  }}
                </For>
              </div>
            )}
          </Show>
          <Show when={entry().orphaned}>
            <div class="pf-pikit-orphan-note">
              Orphaned — no lane process appears alive and the run never ended cleanly.
            </div>
          </Show>
          <Show when={status() && status()!.lanes.length > 0}>
            <button
              type="button"
              class="pf-text-btn"
              disabled={runAbandonReason() !== null}
              title={runAbandonReason() ?? "Request that pi-kit abandon every active lane in this run"}
              onClick={() => props.onAbandon({ run: entry().run, lane: null, label: "all lanes" })}
            >
              Abandon all lanes
            </button>
          </Show>
        </div>
      </Show>
    </section>
  );
}

export function PiKitLanesPanel(): JSX.Element {
  const [confirmTarget, setConfirmTarget] = createSignal<AbandonTarget | null>(null);
  const [confirmBusy, setConfirmBusy] = createSignal(false);
  const [notice, setNotice] = createSignal<Notice | null>(null);

  onMount(() => startPiKitLanesPolling());
  onCleanup(() => stopPiKitLanesPolling());

  const confirmAbandon = async () => {
    const target = confirmTarget();
    if (!target) return;
    setConfirmBusy(true);
    const result = await requestPiKitAbandon(target.run, target.lane, null);
    setConfirmBusy(false);
    setConfirmTarget(null);
    if (!result.ok) {
      setNotice({ text: result.error, error: true });
    } else if (result.consumed) {
      setNotice({ text: `Abandon of ${target.label} confirmed by pi-kit.`, error: false });
    } else {
      setNotice({
        text: `Abandon of ${target.label} requested — not yet confirmed by pi-kit.`,
        error: false,
      });
    }
  };

  return (
    <div class="pf-pikit-panel">
      <div class="pf-pikit-head">
        <MonoEyebrow text="Runs" />
        <button
          type="button"
          class="pf-pikit-icon-btn"
          title="Refresh runs"
          onClick={() => void loadPiKitRuns()}
        >
          <IconRefresh size={13} />
        </button>
      </div>
      <Show when={pikitRunsError()}>
        {(error) => <div class="pf-pikit-error">{error()}</div>}
      </Show>
      <Show when={notice()}>
        {(n) => (
          <div class="pf-pikit-notice" classList={{ "pf-pikit-notice--error": n().error }}>
            {n().text}
          </div>
        )}
      </Show>
      <Show
        when={pikitRuns().length > 0}
        fallback={
          <ForgeEmptyState
            glyph={<IconGrid size={22} />}
            eyebrow="pi-kit"
            title={pikitRunsLoading() ? "Loading runs…" : "No pi-kit runs yet"}
            hint="Runs started from Pi with pi-kit lanes will show up here."
          />
        }
      >
        <div class="pf-pikit-list">
          <For each={pikitRuns()}>
            {(entry) => <RunCard entry={entry} onAbandon={setConfirmTarget} />}
          </For>
        </div>
      </Show>

      <ConfirmDialog
        open={confirmTarget() !== null}
        eyebrow="pi-kit"
        title={confirmTarget() ? `Abandon ${confirmTarget()!.label}?` : ""}
        confirmLabel={confirmBusy() ? "Requesting…" : "Abandon"}
        destructive
        busy={confirmBusy()}
        onConfirm={() => void confirmAbandon()}
        onCancel={() => setConfirmTarget(null)}
      >
        <p class="pf-confirm-para">
          This writes an abandon request for pi-kit's runner to pick up next poll. PickForge never
          signals the lane's process directly — the owning runner decides how to stop it.
        </p>
      </ConfirmDialog>
    </div>
  );
}
