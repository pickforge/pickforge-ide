import { type JSX, Show, createEffect, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { MonoEyebrow } from "./ui";
import "./ConfirmDialog.css";

/** A centered confirmation modal following the operator dock's Portal + backdrop
 *  pattern. The parent owns the body and confirm-gating; this handles the
 *  overlay, focus, Escape, and the cancel/confirm controls. */
// eslint-disable-next-line max-lines-per-function -- TODO(#263): reduce legacy function complexity.
export function ConfirmDialog(props: {
  open: boolean;
  eyebrow: string;
  title: string;
  children: JSX.Element;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  let panelEl: HTMLDivElement | undefined;
  let cancelEl: HTMLButtonElement | undefined;

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!props.open) return;
      if (e.key === "Escape" && !props.busy) {
        e.preventDefault();
        props.onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // Move focus into the dialog each time it opens. The Portal content only
  // mounts while `open` is true, so wait a microtask for the ref to attach.
  createEffect(() => {
    if (!props.open) return;
    queueMicrotask(() => (cancelEl ?? panelEl)?.focus());
  });

  const trapFocus = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !panelEl) return;
    const focusables = Array.from(
      panelEl.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    // While busy every control is disabled — keep focus pinned to the dialog
    // itself rather than letting Tab fall through to the page behind it.
    if (focusables.length === 0) {
      e.preventDefault();
      panelEl.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    // Focus drifted off a just-disabled control — pull it back into the set.
    if (!(active instanceof HTMLElement) || !focusables.includes(active)) {
      e.preventDefault();
      first.focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="pf-confirm-backdrop"
          onPointerDown={() => {
            if (!props.busy) props.onCancel();
          }}
        >
          <div
            ref={panelEl}
            class="pf-confirm"
            role="dialog"
            aria-modal="true"
            aria-label={props.title}
            tabindex="-1"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={trapFocus}
          >
            <MonoEyebrow text={props.eyebrow} tick={props.destructive} />
            <h2 class="pf-confirm-title">{props.title}</h2>
            <div class="pf-confirm-body">{props.children}</div>
            <div class="pf-confirm-actions">
              <button
                ref={cancelEl}
                type="button"
                class="pf-confirm-cancel"
                disabled={props.busy}
                onClick={() => props.onCancel()}
              >
                {props.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                class="pf-confirm-go"
                classList={{ "pf-confirm-go--danger": props.destructive }}
                disabled={props.confirmDisabled || props.busy}
                onClick={() => props.onConfirm()}
              >
                {props.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
