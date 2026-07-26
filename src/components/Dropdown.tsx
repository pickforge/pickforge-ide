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
  /** Optional per-row right-click handler. Added for the flat sidebar's
   *  project filter (#371): the chips it replaced carried the project context
   *  menu, and the flat list has no other project surface, so the affordance
   *  has to survive the swap. Optional — every other Dropdown is unaffected. */
  onContextMenu?: (event: MouseEvent) => void;
}

/** One option row in the open menu. A child component (not inlined in the
 * `<For>` callback) so its per-row reactive attributes (`selected`/`active`,
 * derived from the parent's `value`/`activeIndex` signals) update
 * independently without re-running the whole list callback — the props are
 * read directly here, not destructured, so Solid keeps them reactive. */
function DropdownOptionRow(props: {
  option: DropdownOption;
  index: number;
  selected: boolean;
  active: boolean;
  optionsLength: number;
  onRef: (element: HTMLButtonElement) => void;
  onFocus: () => void;
  onChoose: () => void;
  onFocusOption: (index: number) => void;
  onClose: (restoreFocus?: boolean) => void;
}): JSX.Element {
  return (
    <button
      ref={props.onRef}
      class="pf-dropdown-option"
      classList={{ "pf-dropdown-option--on": props.selected }}
      role="option"
      tabIndex={props.active ? 0 : -1}
      aria-selected={props.selected}
      onFocus={props.onFocus}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          props.onFocusOption(props.index + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          props.onFocusOption(props.index - 1);
        } else if (event.key === "Home") {
          event.preventDefault();
          props.onFocusOption(0);
        } else if (event.key === "End") {
          event.preventDefault();
          props.onFocusOption(props.optionsLength - 1);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onChoose();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.onClose(true);
        }
      }}
      onClick={props.onChoose}
      onContextMenu={
        props.option.onContextMenu
          ? (event) => {
              // Close first: the handler opens its own popover positioned from
              // this event's coords, and two stacked popovers is not a state
              // this app has. `false` skips focus restore so the trigger does
              // not steal focus back from the menu that is about to open.
              props.onClose(false);
              props.option.onContextMenu?.(event);
            }
          : undefined
      }
    >
      <span class="pf-dropdown-check" aria-hidden="true">
        <Show when={props.selected}>
          <IconCheck size={11} />
        </Show>
      </span>
      <Show when={props.option.icon}>
        {(icon) => <span class="pf-dropdown-icon">{icon()()}</span>}
      </Show>
      <span class="pf-dropdown-option-label">{props.option.label}</span>
      {props.option.trailing}
    </button>
  );
}

/** The trigger button. A child component so it can carry its own aria/label
 * reactivity; `open`/`currentLabel`/`selectedIcon` are passed as accessor
 * functions (not called until read inside this component's JSX), which
 * keeps them tracked exactly as if read in the parent. */
function DropdownTrigger(props: {
  onRef: (element: HTMLButtonElement) => void;
  disabled?: boolean;
  title?: string;
  bracket?: boolean;
  triggerTrailing?: JSX.Element;
  listboxId: string;
  open: () => boolean;
  currentLabel: () => string;
  selectedIcon: () => (() => JSX.Element) | undefined;
  onToggleOpen: () => void;
  onArrowDown: () => void;
  onArrowUp: () => void;
}): JSX.Element {
  return (
    <button
      ref={props.onRef}
      class="pf-dropdown-trigger"
      disabled={props.disabled}
      aria-haspopup="listbox"
      aria-expanded={props.open()}
      aria-controls={props.open() ? props.listboxId : undefined}
      aria-label={props.title ? `${props.title}: ${props.currentLabel()}` : props.currentLabel()}
      title={props.title}
      onClick={props.onToggleOpen}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          props.onArrowDown();
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          props.onArrowUp();
        }
      }}
    >
      <Show when={props.bracket !== false}>
        <span class="pf-dropdown-bracket" aria-hidden="true" />
      </Show>
      <Show when={props.selectedIcon()}>
        {(icon) => <span class="pf-dropdown-icon">{icon()()}</span>}
      </Show>
      <span class="pf-dropdown-trigger-label">{props.currentLabel()}</span>
      {props.triggerTrailing}
      <IconChevronDown size={12} class="pf-dropdown-chevron" />
    </button>
  );
}

interface DropdownProps {
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
}

/** All of the dropdown's open/active-option state and interaction logic, as
 * a composable — called synchronously from `Dropdown`'s own setup, so its
 * `createEffect`/`onCleanup` calls run under the same reactive owner as if
 * written inline. `getRoot`/`getTrigger` are getters (not the elements
 * themselves) because they close over `Dropdown`'s ref variables, which are
 * still unset when this runs — reading them later, at interaction time,
 * sees the mounted elements. */
function createDropdownController(
  props: DropdownProps,
  getRoot: () => HTMLDivElement,
  getTrigger: () => HTMLButtonElement,
  optionRefs: HTMLButtonElement[],
) {
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(0);

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
    if (restoreFocus) queueMicrotask(() => getTrigger().focus());
  };
  const choose = (index: number) => {
    const option = props.options[index];
    if (!option || props.disabled) return close(true);
    props.onChange(option.value);
    close(true);
  };

  const onPointer = (e: PointerEvent) => {
    if (!getRoot().contains(e.target as Node)) close();
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

  return { open, setOpen, activeIndex, setActiveIndex, selectedIndex, focusOption, close, choose };
}

export function Dropdown(props: DropdownProps) {
  let root!: HTMLDivElement;
  let trigger!: HTMLButtonElement;
  const optionRefs: HTMLButtonElement[] = [];
  const listboxId = createUniqueId();
  const { open, setOpen, activeIndex, setActiveIndex, selectedIndex, focusOption, close, choose } =
    createDropdownController(props, () => root, () => trigger, optionRefs);
  const selected = () => props.options.find((o) => o.value === props.value);
  const currentLabel = () => selected()?.label ?? props.placeholder ?? "Select";

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
      <DropdownTrigger
        onRef={(element) => { trigger = element; }}
        disabled={props.disabled}
        title={props.title}
        bracket={props.bracket}
        triggerTrailing={props.triggerTrailing}
        listboxId={listboxId}
        open={open}
        currentLabel={currentLabel}
        selectedIcon={() => selected()?.icon}
        onToggleOpen={() => {
          if (props.disabled) return;
          if (open()) return close();
          setActiveIndex(selectedIndex());
          setOpen(true);
        }}
        onArrowDown={() => {
          if (props.disabled || open()) return;
          setActiveIndex(selectedIndex());
          setOpen(true);
        }}
        onArrowUp={() => {
          if (props.disabled || open()) return;
          setActiveIndex(Math.max(0, props.options.length - 1));
          setOpen(true);
        }}
      />
      <Show when={open()}>
        <div
          id={listboxId}
          class="pf-dropdown-menu"
          classList={{ "pf-dropdown-menu--up": props.up }}
          role="listbox"
        >
          <For each={props.options}>
            {(o, index) => (
              <DropdownOptionRow
                option={o}
                index={index()}
                selected={o.value === props.value}
                active={index() === activeIndex()}
                optionsLength={props.options.length}
                onRef={(element) => { optionRefs[index()] = element; }}
                onFocus={() => setActiveIndex(index())}
                onChoose={() => choose(index())}
                onFocusOption={focusOption}
                onClose={close}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
