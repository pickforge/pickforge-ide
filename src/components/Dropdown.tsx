// The app's one dropdown: the bracket-tag trigger + glassy popover (design
// system). Replaces native <select> everywhere (run pickers, settings, the
// inspector device picker) so all dropdowns read the same.
import { createEffect, For, onCleanup, Show, type JSX } from "solid-js";
import { createSignal } from "solid-js";
import { IconCheck, IconChevronDown } from "./icons";

export interface DropdownOption {
  value: string;
  label: string;
  /** Optional trailing content per row (e.g. a StatusPill). */
  trailing?: JSX.Element;
}

export function Dropdown(props: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  /** Show the "[" bracket mark (default true). */
  bracket?: boolean;
  /** Trailing content on the trigger (e.g. the selected row's StatusPill). */
  triggerTrailing?: JSX.Element;
  /** Extra class on the wrapper (e.g. to size it in a horizontal toolbar). */
  class?: string;
}) {
  const [open, setOpen] = createSignal(false);
  const selected = () => props.options.find((o) => o.value === props.value);
  let root!: HTMLDivElement;

  const onPointer = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) setOpen(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  };
  createEffect(() => {
    if (open()) {
      window.addEventListener("pointerdown", onPointer);
      window.addEventListener("keydown", onKey);
    } else {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    }
  });
  onCleanup(() => {
    window.removeEventListener("pointerdown", onPointer);
    window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      ref={root}
      class="pf-dropdown"
      classList={{ "pf-dropdown--open": open(), [props.class ?? ""]: !!props.class }}
    >
      <button
        class="pf-dropdown-trigger"
        disabled={props.disabled}
        aria-expanded={open()}
        title={props.title}
        onClick={() => !props.disabled && setOpen((o) => !o)}
      >
        <Show when={props.bracket !== false}>
          <span class="pf-dropdown-bracket" aria-hidden="true" />
        </Show>
        <span class="pf-dropdown-trigger-label">{selected()?.label ?? props.placeholder ?? "Select"}</span>
        {props.triggerTrailing}
        <IconChevronDown size={12} class="pf-dropdown-chevron" />
      </button>
      <Show when={open()}>
        <div class="pf-dropdown-menu" role="listbox">
          <For each={props.options}>
            {(o) => (
              <button
                class="pf-dropdown-option"
                classList={{ "pf-dropdown-option--on": o.value === props.value }}
                role="option"
                aria-selected={o.value === props.value}
                onClick={() => {
                  props.onChange(o.value);
                  setOpen(false);
                }}
              >
                <span class="pf-dropdown-check" aria-hidden="true">
                  <Show when={o.value === props.value}>
                    <IconCheck size={11} />
                  </Show>
                </span>
                <span class="pf-dropdown-option-label">{o.label}</span>
                {o.trailing}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
