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
  voiceDockSpeaking,
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

/** The command input + its dictation mic toggle. A presentational child
 *  component — everything is an accessor/callback prop, so reactivity is
 *  preserved. */
function OperatorComposerField(props: {
  inputRef: (el: HTMLInputElement) => void;
  value: () => string;
  busy: () => boolean;
  onInput: (v: string) => void;
  onEnter: () => void;
  isComposing: (e: KeyboardEvent) => boolean;
  micEnabled: () => boolean;
  micEmber: () => boolean;
  micLive: () => boolean;
  micDisabled: () => boolean;
  micTitle: () => string;
  micPressed: () => boolean;
  onToggleMic: () => void;
}) {
  return (
    <div class="pf-op-field">
      <input
        ref={props.inputRef}
        class="pf-op-input"
        type="text"
        spellcheck={false}
        autocomplete="off"
        placeholder={PLACEHOLDER}
        value={props.value()}
        disabled={props.busy()}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || props.isComposing(e)) return;
          e.preventDefault();
          props.onEnter();
        }}
      />
      <Show when={props.micEnabled()}>
        <button
          type="button"
          class="pf-op-mic"
          classList={{
            "pf-op-mic--live": props.micLive() && !props.micEmber(),
            "pf-op-mic--ember": props.micEmber(),
          }}
          disabled={props.micDisabled()}
          title={props.micTitle()}
          aria-label={props.micTitle()}
          aria-pressed={props.micPressed()}
          onClick={props.onToggleMic}
        >
          <IconMic size={15} />
        </button>
      </Show>
    </div>
  );
}

/** The live-dictation transcript note, or (once dictation stops) its last
 *  error. A presentational child component. */
function OperatorVoiceStatus() {
  return (
    <>
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

      <Show when={voiceDockSpeaking()}>
        <div class="pf-op-note pf-op-note--voice">
          <span class="pf-op-note-key">ember</span>
          <span class="pf-op-note-body">speaking… (say anything to interrupt)</span>
        </div>
      </Show>

      <Show when={!voiceDockActive() && !voiceDockSpeaking() && voiceDockError()}>
        {(message) => (
          <div class="pf-op-note pf-op-note--voice">
            <span class="pf-op-note-key">voice</span>
            <span class="pf-op-note-body">{message()}</span>
          </div>
        )}
      </Show>
    </>
  );
}

/** The widget-candidate picker (or plain payload preview) plus confirm/
 *  cancel actions for a `preview` dock view. A presentational child
 *  component. */
function OperatorPreviewView(props: { view: () => Extract<DockView, { kind: "preview" }> }) {
  const p = props.view;
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
      <Show when={routeMetaLabel()}>
        {(label) => (
          <div class="pf-op-meta">{label()} · charged for routing; confirm runs the action</div>
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
}

/** The dispatched-command outcome for a `result` dock view. A presentational
 *  child component. */
function OperatorResultView(props: { view: () => Extract<DockView, { kind: "result" }> }) {
  const res = () => props.view().result;
  return (
    <>
      <div
        class="pf-op-result"
        classList={{
          "pf-op-result--ok": res().status === "done" || res().status === "noop",
          "pf-op-result--error": res().status === "failed" || res().status === "unsupported",
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
}

/** The "needs a router model" notice for a `needsRouter` dock view. A
 *  presentational child component. */
function OperatorNeedsRouterView(props: { view: () => Extract<DockView, { kind: "needsRouter" }> }) {
  return (
    <>
      <div class="pf-op-note">
        <span class="pf-op-note-key">router</span>
        <span class="pf-op-note-body">
          needs a router model. Configure Operator router in Settings.
          <span class="pf-op-note-reason"> {props.view().reason}</span>
        </span>
      </div>
      <Show when={routeMetaLabel()}>
        {(label) => <div class="pf-op-meta">{label()}</div>}
      </Show>
    </>
  );
}

/** The "needs credits" notice + Buy credits CTA for a `needsCredits` dock
 *  view. A presentational child component. */
function OperatorNeedsCreditsView(props: { view: () => Extract<DockView, { kind: "needsCredits" }> }) {
  return (
    <div class="pf-op-credits">
      <div class="pf-op-note">
        <span class="pf-op-note-key">credits</span>
        <span class="pf-op-note-body">
          hosted routing needs credits.
          <span class="pf-op-note-reason"> {formatCreditBalance(props.view().balance)} left</span>
        </span>
      </div>
      <div class="pf-op-actions">
        <button type="button" class="pf-op-cancel" onClick={() => openBuyCredits()}>
          Buy credits
        </button>
      </div>
    </div>
  );
}

/** The recent-activity list at the bottom of the dock. A presentational
 *  child component. */
function OperatorRecentList() {
  return (
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
  );
}

/** Derived mic affordance state shared by the composer field and the
 *  Mod+M hotkey. A factory (not a composable — no signals of its own). */
function createMicDockState() {
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
  return { micEmber, micDisabled, micUsable, micTitle };
}

/** The dock's keyboard trap: Mod+M dictation toggle, Escape to cancel/close,
 *  digit keys to pick a preview candidate, and Tab focus wrapping. A factory
 *  (not a composable — no signals of its own). */
function createOperatorFocusTrap(
  panelEl: () => HTMLDivElement,
  isComposing: (e: KeyboardEvent) => boolean,
  micUsable: () => boolean,
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
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
      panelEl().querySelectorAll<HTMLElement>("input, button:not([disabled])"),
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
  const { micEmber, micDisabled, micUsable, micTitle } = createMicDockState();
  const trapFocus = createOperatorFocusTrap(() => panelEl, isComposing, micUsable);

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
          <OperatorComposerField
            inputRef={(el) => (inputEl = el)}
            value={operatorInput}
            busy={operatorBusy}
            onInput={setOperatorInput}
            onEnter={() => {
              if (operatorView().kind === "preview") void confirmOperatorPreview();
              else void submitOperatorCommand();
            }}
            isComposing={isComposing}
            micEnabled={() => voiceDictationSettings().micEnabled}
            micEmber={micEmber}
            micLive={voiceDockActive}
            micDisabled={micDisabled}
            micTitle={micTitle}
            micPressed={voiceDockActive}
            onToggleMic={() => toggleDictation()}
          />

          <OperatorVoiceStatus />

          <Switch>
            <Match when={asView("needsRouter")}>
              {(nr) => <OperatorNeedsRouterView view={nr} />}
            </Match>

            <Match when={asView("needsCredits")}>
              {(nc) => <OperatorNeedsCreditsView view={nc} />}
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
              {(p) => <OperatorPreviewView view={p} />}
            </Match>

            <Match when={asView("result")}>
              {(r) => <OperatorResultView view={r} />}
            </Match>
          </Switch>

          <OperatorRecentList />
        </div>
      </div>
    </Portal>
  );
}
