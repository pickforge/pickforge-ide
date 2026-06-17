// Multi-pane terminal host. Panes are a flat keyed list (a <For> over stable
// object refs) so splitting/closing never remounts an existing pane and kills
// its shell. Splitting sets the flex axis and appends a pane; the focused pane
// carries the ember sweep and receives quick-launch text.
import { createSignal, For } from "solid-js";
import { TerminalPane, type TerminalHandle } from "./Terminal";
import "./TerminalHost.css";

interface Pane {
  id: string;
}

let paneCounter = 0;
function newPane(): Pane {
  paneCounter += 1;
  return { id: `pane-${paneCounter}` };
}

export interface TerminalHostHandle {
  /** Type text into the currently focused pane's shell. */
  typeToFocused: (text: string) => void;
}

export function TerminalHost(props: {
  onReady?: (handle: TerminalHostHandle) => void;
  cwd?: string;
}) {
  const first = newPane();
  const [panes, setPanes] = createSignal<Pane[]>([first]);
  const [axis, setAxis] = createSignal<"row" | "col">("row");
  const [focusedId, setFocusedId] = createSignal<string>(first.id);
  const handles = new Map<string, TerminalHandle>();

  const focus = (id: string) => {
    setFocusedId(id);
    handles.get(id)?.focus();
  };

  const split = (dir: "row" | "col") => {
    setAxis(dir);
    const pane = newPane();
    setPanes([...panes(), pane]);
    setFocusedId(pane.id); // its terminal focuses itself once ready
  };

  const close = (id: string) => {
    if (panes().length <= 1) return;
    const remaining = panes().filter((p) => p.id !== id);
    setPanes(remaining);
    handles.delete(id);
    if (focusedId() === id) focus(remaining[remaining.length - 1].id);
  };

  props.onReady?.({
    typeToFocused: (text) => handles.get(focusedId())?.typeText(text),
  });

  return (
    <div class="pf-term-host">
      <div class="pf-term-toolbar">
        <button
          class="pf-term-tool"
          title="Split right"
          onClick={() => split("row")}
        >
          ▥
        </button>
        <button
          class="pf-term-tool"
          title="Split down"
          onClick={() => split("col")}
        >
          ▤
        </button>
        <button
          class="pf-term-tool"
          title="Close focused pane"
          disabled={panes().length <= 1}
          onClick={() => close(focusedId())}
        >
          ✕
        </button>
      </div>

      <div
        class="pf-term-grid"
        classList={{ "pf-term-grid--col": axis() === "col" }}
      >
        <For each={panes()}>
          {(pane) => (
            <div
              class="pf-term-cell"
              classList={{ "pf-term-cell--focused": focusedId() === pane.id }}
              onPointerDown={() => focus(pane.id)}
            >
              <div class="pf-term-inner">
                <TerminalPane
                  cwd={props.cwd}
                  onReady={(handle) => {
                    handles.set(pane.id, handle);
                    if (focusedId() === pane.id) handle.focus();
                  }}
                  onExit={() => close(pane.id)}
                />
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
