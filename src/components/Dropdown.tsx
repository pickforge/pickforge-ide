// The app's one dropdown: the bracket-tag trigger + glassy popover (design
// system). Replaces native <select> everywhere (run pickers, settings, the
// inspector device picker) so all dropdowns read the same.
import { createEffect, createUniqueId, For, onCleanup, Show, type JSX } from "solid-js";
import { createSignal } from "solid-js";
import { IconCheck, IconChevronDown } from "./icons";

export interface DropdownOption {
  value: string;
  label: string;
  /** Optional leading glyph, as a factory — the same option renders in the
   *  list AND on the trigger, and one JSX node can't live in two places. */
  icon?: () => JSX.Element;
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
  /** Open the menu above the trigger (for pickers at the bottom of a pane). */
  up?: boolean;
  /** Extra class on the wrapper (e.g. to size it in a horizontal toolbar). */
  class?: string;
}) {
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(0);
  const selected = () => props.options.find((o) => o.value === props.value);
  const currentLabel = () => selected()?.label ?? props.placeholder ?? "Select";
  let root!: HTMLDivElement;
  let trigger!: HTMLButtonElement;
  const optionRefs: HTMLButtonElement[] = [];
  const listboxId = createUniqueId();

  const selectedIndex = () => {
    const index = props.options.findIndex((option) => option.value === props.value);
    return index >= 0 ? index : 0;
  };
  const focusOption = (index: number) => {
    if (props.options.length === 0) return;
    const next = (index + props.options.length) % props.options.length;
    setActiveIndex(next);
    queueMicrotask(() => optionRefs[next]?.focus());
  };
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => trigger.focus());
  };
  const choose = (index: number) => {
    const option = props.options[index];
    if (!option || props.disabled) return close(true);
    props.onChange(option.value);
    close(true);
  };

  const onPointer = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close(true);
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
  createEffect(() => {
    if (props.disabled) setOpen(false);
  });
  createEffect(() => {
    if (!open()) return;
    const index = activeIndex();
    queueMicrotask(() => optionRefs[index]?.focus());
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
      onFocusOut={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && root.contains(next)) return;
        close();
      }}
    >
      <button
        ref={trigger}
        class="pf-dropdown-trigger"
        disabled={props.disabled}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={open() ? listboxId : undefined}
        aria-label={props.title ? `${props.title}: ${currentLabel()}` : currentLabel()}
        title={props.title}
        onClick={() => {
          if (props.disabled) return;
          if (open()) return close();
          setActiveIndex(selectedIndex());
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (props.disabled || open()) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex(selectedIndex());
            setOpen(true);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex(Math.max(0, props.options.length - 1));
            setOpen(true);
          }
        }}
      >
        <Show when={props.bracket !== false}>
          <span class="pf-dropdown-bracket" aria-hidden="true" />
        </Show>
        <Show when={selected()?.icon}>
          {(icon) => <span class="pf-dropdown-icon">{icon()()}</span>}
        </Show>
        <span class="pf-dropdown-trigger-label">{currentLabel()}</span>
        {props.triggerTrailing}
        <IconChevronDown size={12} class="pf-dropdown-chevron" />
      </button>
      <Show when={open()}>
        <div
          id={listboxId}
          class="pf-dropdown-menu"
          classList={{ "pf-dropdown-menu--up": props.up }}
          role="listbox"
        >
          <For each={props.options}>
            {(o, index) => (
              <button
                ref={(element) => { optionRefs[index()] = element; }}
                class="pf-dropdown-option"
                classList={{ "pf-dropdown-option--on": o.value === props.value }}
                role="option"
                tabIndex={index() === activeIndex() ? 0 : -1}
                aria-selected={o.value === props.value}
                onFocus={() => setActiveIndex(index())}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusOption(index() + 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    focusOption(index() - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    focusOption(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    focusOption(props.options.length - 1);
                  } else if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choose(index());
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    close(true);
                  }
                }}
                onClick={() => choose(index())}
              >
                <span class="pf-dropdown-check" aria-hidden="true">
                  <Show when={o.value === props.value}>
                    <IconCheck size={11} />
                  </Show>
                </span>
                <Show when={o.icon}>
                  {(icon) => <span class="pf-dropdown-icon">{icon()()}</span>}
                </Show>
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
