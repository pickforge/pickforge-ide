// pi-kit lanes visibility (#274 slice 3, #288): lists active + recent pi-kit
// runs from `<run>.status.json` files, with a per-lane/per-run Abandon
// action. Mirrors SwarmRunCard's run/lane card idiom (components/chat) —
// same expandable-row + status-dot shape — since that's the closest existing
// "multi-lane run" surface in the app; see pikitLanes.css for the shared
// token usage.
import { For, Show, type JSX, createSignal, onCleanup, onMount } from "solid-js";
import { ConfirmDialog } from "../ConfirmDialog";
import { RunCard, type AbandonTarget } from "./PiKitRunCard";
import { ForgeEmptyState, MonoEyebrow } from "../ui";
import { IconGrid, IconRefresh } from "../icons";
import type { PiKitRunEntry } from "../../lib/process";
import {
  loadAllPiKitRuns,
  loadPiKitRuns,
  pikitRuns,
  pikitRunsError,
  pikitRunsLoading,
  pikitRunsTotal,
  requestPiKitAbandon,
  startPiKitLanesPolling,
  stopPiKitLanesPolling,
} from "../../stores/pikitLanes";
import "./pikitLanes.css";

interface Notice {
  text: string;
  error: boolean;
}

/** The complete run list, behind the panel's "view all" affordance. Reuses
 *  `ConfirmDialog`'s portal/backdrop shape rather than introducing a second
 *  modal idiom (#363). */
function AllRunsDialog(props: {
  runs: PiKitRunEntry[];
  onAbandon: (target: AbandonTarget) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      class="pf-confirm-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        class="pf-confirm pf-pikit-all-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`All ${props.runs.length} pi-kit runs`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            props.onClose();
          }
        }}
      >
        <h2 class="pf-confirm-title">All runs</h2>
        <div class="pf-pikit-all-scroll">
          <For each={props.runs}>
            {(entry) => <RunCard entry={entry} onAbandon={props.onAbandon} />}
          </For>
        </div>
        <div class="pf-confirm-actions">
          <button type="button" class="pf-confirm-cancel" onClick={() => props.onClose()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function PiKitLanesPanel(): JSX.Element {
  const [confirmTarget, setConfirmTarget] = createSignal<AbandonTarget | null>(null);
  const [confirmBusy, setConfirmBusy] = createSignal(false);
  const [notice, setNotice] = createSignal<Notice | null>(null);
  // The full list is read on demand, not polled — the whole point of the page
  // is that the 4s cadence stops scaling with history (#363).
  const [allRuns, setAllRuns] = createSignal<PiKitRunEntry[] | null>(null);
  const hidden = () => Math.max(0, pikitRunsTotal() - pikitRuns().length);

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
          <Show when={hidden() > 0}>
            <button type="button" class="pf-text-btn pf-pikit-view-all" onClick={() => void loadAllPiKitRuns().then(setAllRuns)}>
              View all {pikitRunsTotal()} runs →
            </button>
          </Show>
        </div>
      </Show>

      <Show when={allRuns()}>
        {(runs) => (
          <AllRunsDialog
            runs={runs()}
            onAbandon={setConfirmTarget}
            onClose={() => setAllRuns(null)}
          />
        )}
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
