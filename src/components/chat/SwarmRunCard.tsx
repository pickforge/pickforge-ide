import { For, Show, type JSX, createSignal } from "solid-js";
import { compactInline } from "../../lib/chatDisplay";
import { agentBackendDescriptor } from "../../lib/agentBackends";
import type { SwarmLaneSnapshot, SwarmRunSnapshot } from "../../lib/mcp";
import { setOrchestraOpen } from "../../stores/orchestraStage";
import { selectChat } from "../../stores/workspace";
import { IconChevronDown, IconChevronRight, IconGrid } from "../icons";
import "./chat.css";


function modelName(lane: SwarmLaneSnapshot): string {
  return lane.model?.trim() || "default model";
}

function statusTone(status: string): string {
  if (status === "completed") return "var(--pf-connected)";
  if (status === "failed") return "var(--pf-error)";
  if (status === "cancelled") return "var(--pf-warning)";
  if (status === "running" || status === "starting") return "var(--pf-info)";
  return "var(--pf-text-low)";
}

function laneDetail(lane: SwarmLaneSnapshot): string {
  if (lane.error) return lane.error;
  if (lane.summary) return lane.summary;
  if (lane.status === "queued") return "Waiting for dispatch.";
  if (lane.status === "starting") return "Starting read-only worker lane.";
  if (lane.status === "running") return "Working in the background.";
  return lane.status;
}

function synthesisLabel(run: SwarmRunSnapshot): string | null {
  if (run.synthesisStatus === "pending") return "synthesis pending";
  if (run.synthesisStatus === "sent") return "synthesis sent";
  if (run.synthesisStatus === "failed") return "synthesis failed";
  return null;
}

function openLane(chatId: string | null) {
  if (!chatId) return;
  setOrchestraOpen(false);
  selectChat(chatId);
}

function SwarmRow(props: {
  run: SwarmRunSnapshot;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  const open = () => props.open;
  const setOpen = () => props.onToggle();
  const run = () => props.run;
  const modelLabel = () => run().model || "selected models";
  const synth = () => synthesisLabel(run());

  return (
    <section class="pf-chat-swarm-card" aria-label="Pickforge swarm run">
      <button
        type="button"
        class="pf-chat-swarm-summary"
        aria-expanded={open()}
        onClick={() => setOpen()}
      >
        <span class="pf-chat-swarm-summary-chevron" aria-hidden="true">
          <Show when={open()} fallback={<IconChevronRight size={12} />}>
            <IconChevronDown size={12} />
          </Show>
        </span>
        <span class="pf-chat-swarm-summary-title">
          <IconGrid size={13} />
          <span>swarm</span>
        </span>
        <span class="pf-chat-swarm-summary-goal" title={run().goal}>
          {compactInline(run().goal, 96)}
        </span>
        <span class="pf-chat-swarm-summary-meta">
          {run().requestedCount} / {run().mode} / {modelLabel()}
          <Show when={synth()}>{(label) => <> / {label()}</>}</Show>
        </span>
        <span
          class="pf-chat-swarm-status"
          style={{ "--pf-swarm-status": statusTone(run().status) }}
        >
          <span class="pf-chat-swarm-dot" />
          {run().status}
        </span>
      </button>
      <Show when={open()}>
        <div class="pf-chat-swarm-body">
          <div class="pf-chat-swarm-lanes">
            <For each={run().lanes}>
              {(lane) => (
                <button
                  type="button"
                  class="pf-chat-swarm-lane"
                  disabled={!lane.chatId}
                  onClick={() => openLane(lane.chatId)}
                >
                  <span
                    class="pf-chat-swarm-lane-status"
                    style={{ "--pf-swarm-status": statusTone(lane.status) }}
                  >
                    <span class="pf-chat-swarm-dot" />
                    {lane.status}
                  </span>
                  <span class="pf-chat-swarm-lane-main">
                    <span class="pf-chat-swarm-lane-title">{lane.title}</span>
                    <span class="pf-chat-swarm-lane-meta">
                      {agentBackendDescriptor(lane.provider)?.label ?? lane.provider} / {modelName(lane)}
                    </span>
                    <span class="pf-chat-swarm-lane-detail">{laneDetail(lane)}</span>
                  </span>
                  <Show when={lane.chatId}>
                    <span class="pf-chat-swarm-open" aria-hidden="true">
                      <IconChevronRight size={13} />
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
          <Show when={run().error}>
            {(error) => <div class="pf-chat-swarm-error">{error()}</div>}
          </Show>
          <Show when={run().synthesisError}>
            {(error) => <div class="pf-chat-swarm-error">{error()}</div>}
          </Show>
        </div>
      </Show>
    </section>
  );
}

export function SwarmRunCard(props: { runs: SwarmRunSnapshot[] }): JSX.Element {
  const runs = () => props.runs.slice(0, 3);
  // Expansion is held here, keyed by run id, not inside `SwarmRow` (#363).
  // `rememberRun` rebuilds the changed run as a new object on every lane
  // update, so `For` disposes and recreates that run's row — a local signal
  // reset the card to collapsed each time, which during an active swarm is
  // continuous. Keying by `runId` means the toggle outlives the object.
  const openRuns = new Map<string, boolean>();
  const [openVersion, setOpenVersion] = createSignal(0);
  const isOpen = (runId: string) => {
    openVersion();
    return openRuns.get(runId) ?? false;
  };
  const toggle = (runId: string) => {
    openRuns.set(runId, !(openRuns.get(runId) ?? false));
    setOpenVersion((version) => version + 1);
  };
  return (
    <For each={runs()}>
      {(run) => (
        <SwarmRow run={run} open={isOpen(run.runId)} onToggle={() => toggle(run.runId)} />
      )}
    </For>
  );
}
