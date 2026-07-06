import { For, Show, type JSX } from "solid-js";
import type { SwarmLaneSnapshot, SwarmRunSnapshot } from "../../lib/mcp";
import { setOrchestraOpen } from "../../stores/orchestraStage";
import { selectChat } from "../../stores/workspace";
import { IconChevronRight, IconGrid } from "../icons";
import "./chat.css";

function providerName(provider: string): string {
  return provider === "codex" ? "Codex" : "Claude";
}

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

function openLane(chatId: string | null) {
  if (!chatId) return;
  setOrchestraOpen(false);
  selectChat(chatId);
}

export function SwarmRunCard(props: { runs: SwarmRunSnapshot[] }): JSX.Element {
  const runs = () => props.runs.slice(0, 3);
  return (
    <For each={runs()}>
      {(run) => (
        <section class="pf-chat-swarm-card" aria-label="Pickforge swarm run">
          <div class="pf-chat-swarm-head">
            <div class="pf-chat-swarm-title">
              <IconGrid size={13} />
              <span>Pickforge swarm</span>
            </div>
            <span
              class="pf-chat-swarm-status"
              style={{ "--pf-swarm-status": statusTone(run.status) }}
            >
              <span class="pf-chat-swarm-dot" />
              {run.status}
            </span>
          </div>
          <div class="pf-chat-swarm-goal">{run.goal}</div>
          <div class="pf-chat-swarm-meta">
            {run.requestedCount} lanes / {run.mode} / {run.model || "selected models"}
          </div>
          <div class="pf-chat-swarm-lanes">
            <For each={run.lanes}>
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
                      {providerName(lane.provider)} / {modelName(lane)}
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
          <Show when={run.error}>
            {(error) => <div class="pf-chat-swarm-error">{error()}</div>}
          </Show>
        </section>
      )}
    </For>
  );
}
