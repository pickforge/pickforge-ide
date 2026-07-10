// The Operator composer dock: a top-center command surface opened by keyboard
// shortcut, gated behind the operator flag. Parsing and dispatch live in
// stores/operatorDock; this renders the input, the router/preview/result views,
// and the recent-activity list.
import { For, Match, Show, Switch, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { MonoEyebrow, EmberButton } from "../ui";
import { IconMic } from "../icons";
import { formatCostCents, formatCreditBalance } from "../../lib/agentPricing";
import {
  cancelOperatorPreview,
  candidateIndexForKey,
  closeOperatorDock,
  confirmOperatorPreview,
  openBuyCredits,
  operatorBusy,
  operatorInput,
  operatorRecent,
  operatorRouteMeta,
  operatorView,
  pickOperatorWidgetCandidate,
  relativeTime,
  setOperatorInput,
  submitOperatorCommand,
  type DockView,
} from "../../stores/operatorDock";
import {
  micBusyLocked,
  refreshVoiceStatus,
  resetVoiceDock,
  toggleDictation,
  voiceAvailability,
  voiceDockActive,
  voiceDockError,
  voiceDockPhase,
  voiceDockPreview,
} from "../../stores/voiceDock";
import { voiceDictationSettings } from "../../stores/voiceSettings";
import { hotkeyMatches } from "../../stores/quickLaunch";
import { previewPayloadLines } from "./previewPayload";
import "./OperatorDock.css";

const PLACEHOLDER = "operator command — try: open project <name>";

function asView<K extends DockView["kind"]>(
  kind: K,
): Extract<DockView, { kind: K }> | undefined {
  const v = operatorView();
  return v.kind === kind ? (v as Extract<DockView, { kind: K }>) : undefined;
}

function statusLabel(status: string): string {
  switch (status) {
    case "needs_confirmation":
      return "await";
    case "started":
      return "run";
    default:
      return status;
  }
}

function confidenceLabel(value?: number): string | null {
  if (value === undefined || value >= 1) return null;
  return `${Math.round(value * 100)}% confidence`;
}

function routeMetaLabel(): string | null {
  const meta = operatorRouteMeta();
  if (!meta) return null;
  const balance =
    meta.balanceCents !== null ? ` · ${formatCreditBalance(meta.balanceCents)} left` : "";
  return `routed · ${formatCostCents(meta.costCents)}${balance}`;
}

export function OperatorDock() {
  let inputEl!: HTMLInputElement;
  let panelEl!: HTMLDivElement;

  onMount(() => {
    inputEl.focus();
    void refreshVoiceStatus();
  });
  onCleanup(() => resetVoiceDock());

  const isComposing = (e: KeyboardEvent) => e.isComposing || e.keyCode === 229;

  // The mic carries the composition's single ember only when it's the live
  // focus — while a preview shows, the Confirm CTA owns the ember and the mic
  // yields to a neutral live treatment (never two embers).
  const micEmber = () => voiceDockActive() && operatorView().kind !== "preview";
  // Busy only blocks starting a recording (micBusyLocked); stopping a live one
  // stays reachable so the mic can't go dead while pw-record keeps rolling.
  const micDisabled = () =>
    voiceAvailability()?.available === false || micBusyLocked(operatorBusy());
  // The button and the Mod+M hotkey share this gate so a hidden or disabled
  // mic can never record.
  const micUsable = () => voiceDictationSettings().micEnabled && !micDisabled();
  const micTitle = () => {
    const status = voiceAvailability();
    if (!status) return "checking dictation…";
    if (!status.available) {
      if (status.error) return status.error;
      return `dictation unavailable — install ${status.missing.join(", ")}`;
    }
    if (micBusyLocked(operatorBusy())) return "dictation paused while the command runs";
    return voiceDockActive() ? "stop dictation (Mod+M)" : "start dictation (Mod+M)";
  };

  const trapFocus = (e: KeyboardEvent) => {
    if (isComposing(e)) return;
    if (hotkeyMatches(e, "Mod+M")) {
      e.preventDefault();
      e.stopPropagation();
      if (micUsable()) toggleDictation();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (operatorView().kind === "preview") void cancelOperatorPreview();
      else closeOperatorDock();
      return;
    }
    const current = operatorView();
    if (current.kind === "preview" && current.candidates) {
      const index = candidateIndexForKey(e.key, current.candidates);
      if (index !== null) {
        e.preventDefault();
        e.stopPropagation();
        void pickOperatorWidgetCandidate(index);
        return;
      }
    }
    if (e.key !== "Tab") return;
    const focusables = Array.from(
      panelEl.querySelectorAll<HTMLElement>("input, button:not([disabled])"),
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <Portal>
      <div class="pf-op-backdrop" onPointerDown={() => closeOperatorDock()}>
        <div
          ref={panelEl}
          class="pf-op-dock"
          role="dialog"
          aria-label="Operator command"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={trapFocus}
        >
          <MonoEyebrow text="Operator" />
          <div class="pf-op-field">
            <input
              ref={inputEl}
              class="pf-op-input"
              type="text"
              spellcheck={false}
              autocomplete="off"
              placeholder={PLACEHOLDER}
              value={operatorInput()}
              disabled={operatorBusy()}
              onInput={(e) => setOperatorInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || isComposing(e)) return;
                e.preventDefault();
                if (operatorView().kind === "preview") void confirmOperatorPreview();
                else void submitOperatorCommand();
              }}
            />
            <Show when={voiceDictationSettings().micEnabled}>
              <button
                type="button"
                class="pf-op-mic"
                classList={{
                  "pf-op-mic--live": voiceDockActive() && !micEmber(),
                  "pf-op-mic--ember": micEmber(),
                }}
                disabled={micDisabled()}
                title={micTitle()}
                aria-label={micTitle()}
                aria-pressed={voiceDockActive()}
                onClick={() => toggleDictation()}
              >
                <IconMic size={15} />
              </button>
            </Show>
          </div>

          <Show when={voiceDockActive()}>
            <div class="pf-op-note pf-op-note--voice">
              <span class="pf-op-note-key">
                {voiceDockPhase() === "finalizing" ? "transcribe" : "listening"}
              </span>
              <span class="pf-op-note-body">
                {voiceDockPreview() || (voiceDockPhase() === "finalizing" ? "finishing…" : "speak now…")}
              </span>
            </div>
          </Show>

          <Show when={!voiceDockActive() && voiceDockError()}>
            {(message) => (
              <div class="pf-op-note pf-op-note--voice">
                <span class="pf-op-note-key">voice</span>
                <span class="pf-op-note-body">{message()}</span>
              </div>
            )}
          </Show>

          <Switch>
            <Match when={asView("needsRouter")}>
              {(nr) => (
                <div class="pf-op-note">
                  <span class="pf-op-note-key">router</span>
                  <span class="pf-op-note-body">
                    needs a router model. Configure Operator router in Settings.
                    <span class="pf-op-note-reason"> {nr().reason}</span>
                  </span>
                </div>
              )}
            </Match>

            <Match when={asView("needsCredits")}>
              {(nc) => (
                <div class="pf-op-credits">
                  <div class="pf-op-note">
                    <span class="pf-op-note-key">credits</span>
                    <span class="pf-op-note-body">
                      hosted routing needs credits.
                      <span class="pf-op-note-reason"> {formatCreditBalance(nc().balance)} left</span>
                    </span>
                  </div>
                  <div class="pf-op-actions">
                    <button
                      type="button"
                      class="pf-op-cancel"
                      onClick={() => openBuyCredits()}
                    >
                      Buy credits
                    </button>
                  </div>
                </div>
              )}
            </Match>

            <Match when={asView("validationError")}>
              {(err) => (
                <div class="pf-op-note pf-op-note--error">
                  <span class="pf-op-note-key">parser</span>
                  <span class="pf-op-note-body">{err().reason}</span>
                </div>
              )}
            </Match>

            <Match when={asView("preview")}>
              {(p) => {
                const candidates = () => p().candidates;
                return (
                  <div class="pf-op-preview">
                    <div class="pf-op-preview-summary">
                      {p().summary}
                      <Show when={confidenceLabel(p().confidence)}>
                        {(label) => <span class="pf-op-preview-confidence"> · {label()}</span>}
                      </Show>
                    </div>
                    <Show
                      when={candidates()}
                      fallback={(() => {
                        const lines = previewPayloadLines(p().intent);
                        return (
                          <Show when={lines.length > 0}>
                            <div class="pf-op-preview-payload">
                              <For each={lines}>
                                {(line) => <div class="pf-op-preview-payload-line">{line}</div>}
                              </For>
                            </div>
                          </Show>
                        );
                      })()}
                    >
                      {(choices) => (
                        <div class="pf-op-candidates" aria-label="Widget candidates">
                          <For each={choices()}>
                            {(candidate, position) => (
                              <button
                                type="button"
                                class="pf-op-candidate"
                                disabled={operatorBusy()}
                                onClick={() => void pickOperatorWidgetCandidate(candidate.index)}
                              >
                                <span class="pf-op-candidate-key">{position() + 1}</span>
                                <span class="pf-op-candidate-label">
                                  {candidate.className}
                                  <Show when={candidate.label}> — {candidate.label}</Show>
                                </span>
                                <span class="pf-op-candidate-index">#{candidate.index}</span>
                              </button>
                            )}
                          </For>
                        </div>
                      )}
                    </Show>
                    <div class="pf-op-actions">
                      <Show
                        when={!candidates()}
                        fallback={
                          <button
                            type="button"
                            class="pf-op-cancel"
                            disabled={operatorBusy()}
                            onClick={() => void cancelOperatorPreview()}
                          >
                            Cancel
                          </button>
                        }
                      >
                        <EmberButton
                          label="Confirm"
                          disabled={operatorBusy()}
                          onClick={() => void confirmOperatorPreview()}
                        />
                        <button
                          type="button"
                          class="pf-op-cancel"
                          disabled={operatorBusy()}
                          onClick={() => void cancelOperatorPreview()}
                        >
                          Cancel
                        </button>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </Match>

            <Match when={asView("result")}>
              {(r) => {
                const res = () => r().result;
                return (
                  <>
                    <div
                      class="pf-op-result"
                      classList={{
                        "pf-op-result--ok":
                          res().status === "done" || res().status === "noop",
                        "pf-op-result--error":
                          res().status === "failed" || res().status === "unsupported",
                        "pf-op-result--warn": res().status === "denied",
                      }}
                    >
                      {(() => {
                        const value = res();
                        return "summary" in value ? value.summary : value.message;
                      })()}
                    </div>
                    <Show when={routeMetaLabel()}>
                      {(label) => <div class="pf-op-meta">{label()}</div>}
                    </Show>
                  </>
                );
              }}
            </Match>
          </Switch>

          <Show when={operatorRecent().length > 0}>
            <div class="pf-op-recent">
              <MonoEyebrow text="Recent" />
              <For each={operatorRecent()}>
                {(row) => (
                  <div class="pf-op-recent-row">
                    <span class="pf-op-recent-status" data-status={row.status}>
                      {statusLabel(row.status)}
                    </span>
                    <span class="pf-op-recent-input">{row.inputText}</span>
                    <span class="pf-op-recent-time">{relativeTime(row.createdAt)}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </Portal>
  );
}
