// Dock primitives: a resizable/hideable dock column of draggable, collapsible
// PaneShells, plus the edge resizer and the reveal handle shown when a dock is
// hidden. The center terminal column is never a dock, so terminals never remount.
import { For, Show, type JSX } from "solid-js";
import {
  isCollapsed,
  layout,
  movePane,
  PANE_TITLES,
  setDockWidth,
  toggleDock,
  togglePaneCollapsed,
  type DockId,
  type PaneId,
} from "../../stores/workbenchLayout";
import { IconChevronDown, IconChevronRight, IconMore } from "../../components/icons";

const PANE_MIME = "application/x-pf-pane";
// Panes whose body fills available height (the rest size to content).
const GROW_PANES: ReadonlySet<PaneId> = new Set(["chats", "files", "inspector"]);

export function PaneShell(props: {
  pane: PaneId;
  grow?: boolean;
  actions?: JSX.Element;
  children: JSX.Element;
}) {
  const collapsed = () => isCollapsed(props.pane);
  return (
    <section
      class="pf-pane-shell"
      classList={{
        "pf-pane-shell--collapsed": collapsed(),
        "pf-pane-shell--grow": !!props.grow && !collapsed(),
      }}
    >
      <header class="pf-pane-shell-head" onDblClick={() => togglePaneCollapsed(props.pane)}>
        <button
          class="pf-pane-shell-toggle"
          title={collapsed() ? "Expand" : "Collapse"}
          onClick={() => togglePaneCollapsed(props.pane)}
        >
          <Show when={!collapsed()} fallback={<IconChevronRight size={12} />}>
            <IconChevronDown size={12} />
          </Show>
        </button>
        <span class="pf-pane-shell-title">{PANE_TITLES[props.pane]}</span>
        <span class="pf-pane-shell-actions" onPointerDown={(e) => e.stopPropagation()}>
          {props.actions}
        </span>
        <span
          class="pf-pane-shell-grip"
          title="Drag to move pane"
          draggable={true}
          onDragStart={(e) => {
            e.dataTransfer?.setData(PANE_MIME, props.pane);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          }}
        >
          <IconMore size={14} />
        </span>
      </header>
      <Show when={!collapsed()}>
        <div class="pf-pane-shell-body">{props.children}</div>
      </Show>
    </section>
  );
}

export function DockColumn(props: { dock: DockId; render: (pane: PaneId) => JSX.Element }) {
  const panes = () => layout().docks[props.dock];
  const allow = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes(PANE_MIME)) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    }
  };
  const dropAt = (index: number, e: DragEvent) => {
    const pane = e.dataTransfer?.getData(PANE_MIME) as PaneId;
    if (!pane) return;
    e.preventDefault();
    e.stopPropagation();
    movePane(pane, props.dock, index);
  };
  const width = () => (props.dock === "left" ? layout().leftWidth : layout().rightWidth);
  return (
    <div
      class="pf-dock"
      classList={{ "pf-dock--left": props.dock === "left", "pf-dock--right": props.dock === "right" }}
      style={{ width: `${width()}px` }}
      onDragOver={allow}
      onDrop={(e) => dropAt(panes().length, e)}
    >
      <For each={panes()}>
        {(pane, i) => (
          <div
            class="pf-dock-slot"
            classList={{ "pf-dock-slot--grow": GROW_PANES.has(pane) }}
            onDragOver={allow}
            onDrop={(e) => dropAt(i(), e)}
          >
            {props.render(pane)}
          </div>
        )}
      </For>
      <Show when={panes().length === 0}>
        <div class="pf-dock-empty">Drop a pane here</div>
      </Show>
    </div>
  );
}

export function DockResizer(props: { dock: DockId }) {
  let dragging = false;
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const w = props.dock === "left" ? e.clientX : window.innerWidth - e.clientX;
    setDockWidth(props.dock, w);
  };
  const end = () => {
    dragging = false;
    document.body.classList.remove("pf-resizing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", end);
  };
  return (
    <div
      class="pf-dock-resizer"
      title="Drag to resize · double-click to hide"
      onPointerDown={(e) => {
        e.preventDefault();
        dragging = true;
        document.body.classList.add("pf-resizing");
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", end);
      }}
      onDblClick={() => toggleDock(props.dock)}
    >
      <span class="pf-dock-resizer-grip" />
    </div>
  );
}

export function DockRevealHandle(props: { dock: DockId }) {
  return (
    <button
      class="pf-dock-reveal"
      classList={{ "pf-dock-reveal--left": props.dock === "left", "pf-dock-reveal--right": props.dock === "right" }}
      title={`Show ${props.dock} panel`}
      onClick={() => toggleDock(props.dock)}
    >
      {/* chevron points "into" the screen: ▸ for the left edge, ◂ (flipped) for right */}
      <IconChevronRight size={14} class={props.dock === "right" ? "pf-flip-x" : undefined} />
    </button>
  );
}
