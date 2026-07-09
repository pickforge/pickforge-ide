// The Operator composer dock: a top-center command surface opened by keyboard
// shortcut, gated behind the operator flag. Parsing and dispatch live in
// stores/operatorDock; this renders the input, the router/preview/result views,
// and the recent-activity list.
import { For, Match, Show, Switch, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { MonoEyebrow, EmberButton } from "../ui";
import { IconMic } from "../icons";
import {
  cancelOperatorPreview,
  closeOperatorDock,
  confirmOperatorPreview,
  operatorBusy,
  operatorInput,
  operatorRecent,
  operatorView,
  relativeTime,
  setOperatorInput,
  submitOperatorCommand,
  type DockView,
} from "../../stores/operatorDock";
import {
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
  const micDisabled = () => voiceAvailability()?.available === false;
  const micTitle = () => {
    const status = voiceAvailability();
    if (!status) return "checking dictation…";
    if (!status.available) {
      if (status.error) return status.error;
      return `dictation unavailable — install ${status.missing.join(", ")}`;
    }
    return voiceDockActive() ? "stop dictation (Mod+M)" : "start dictation (Mod+M)";
  };

  const trapFocus = (e: KeyboardEvent) => {
    if (isComposing(e)) return;
    if (hotkeyMatches(e, "Mod+M")) {
      e.preventDefault();
      e.stopPropagation();
      if (!micDisabled()) toggleDictation();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (operatorView().kind === "preview") void cancelOperatorPreview();
      else closeOperatorDock();
      return;
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

            <Match when={asView("validationError")}>
              {(err) => (
                <div class="pf-op-note pf-op-note--error">
                  <span class="pf-op-note-key">parser</span>
                  <span class="pf-op-note-body">{err().reason}</span>
                </div>
              )}
            </Match>

            <Match when={asView("preview")}>
              {(p) => (
                <div class="pf-op-preview">
                  <div class="pf-op-preview-summary">
                    {p().summary}
                    <Show when={confidenceLabel(p().confidence)}>
                      {(label) => <span class="pf-op-preview-confidence"> · {label()}</span>}
                    </Show>
                  </div>
                  {(() => {
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
                  <div class="pf-op-actions">
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
                  </div>
                </div>
              )}
            </Match>

            <Match when={asView("result")}>
              {(r) => {
                const res = () => r().result;
                return (
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
