// The Operator composer dock: a top-center command surface opened by keyboard
// shortcut, gated behind the operator flag. Parsing and dispatch live in
// stores/operatorDock; this renders the input, the router/preview/result views,
// and the recent-activity list.
import { For, Match, Show, Switch, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { MonoEyebrow, EmberButton } from "../ui";
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

export function OperatorDock() {
  let inputEl!: HTMLInputElement;
  let panelEl!: HTMLDivElement;

  onMount(() => inputEl.focus());

  const isComposing = (e: KeyboardEvent) => e.isComposing || e.keyCode === 229;

  const trapFocus = (e: KeyboardEvent) => {
    if (isComposing(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (operatorView().kind === "preview") cancelOperatorPreview();
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

          <Switch>
            <Match when={asView("needsRouter")}>
              {(nr) => (
                <div class="pf-op-note">
                  <span class="pf-op-note-key">router</span>
                  <span class="pf-op-note-body">
                    needs the router model — BYO routing is not wired yet (#141).
                    <span class="pf-op-note-reason"> {nr().reason}</span>
                  </span>
                </div>
              )}
            </Match>

            <Match when={asView("preview")}>
              {(p) => (
                <div class="pf-op-preview">
                  <div class="pf-op-preview-summary">{p().summary}</div>
                  <div class="pf-op-actions">
                    <EmberButton
                      label="Confirm"
                      disabled={operatorBusy()}
                      onClick={() => void confirmOperatorPreview()}
                    />
                    <button
                      type="button"
                      class="pf-op-cancel"
                      onClick={() => cancelOperatorPreview()}
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
