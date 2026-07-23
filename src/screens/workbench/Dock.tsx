// Dock primitives: a resizable/hideable dock column of draggable, collapsible
// PaneShells. Expanded panes are weighted flex children, so collapsing a pane
// lets the others fill the freed space and vertical dividers can re-weight a
// pair. Pane drags show a header drag image and an insertion placeholder. The
// center terminal column is never a dock, so terminal hosts never remount.
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import {
  isCollapsed,
  layout,
  movePane,
  PANE_TITLES,
  paneWeight,
  setDockWidth,
  setPaneWeights,
  toggleDock,
  togglePaneCollapsed,
  type DockId,
  type PaneId,
} from "../../stores/workbenchLayout";
import { IconChevronDown, IconChevronRight, IconGrip } from "../../components/icons";

const PANE_MIME = "application/x-pf-pane";

export function PaneShell(props: { pane: PaneId; actions?: JSX.Element; children: JSX.Element }) {
  const collapsed = () => isCollapsed(props.pane);
  let headEl!: HTMLElement;
  return (
    <section
      class="pf-pane-shell"
      classList={{ "pf-pane-shell--collapsed": collapsed() }}
    >
      {/* The whole header is the drag handle (not just a grip) and double-clicks
          to collapse; the chevron button toggles too. The body stays mounted so
          collapse/expand can animate the slot height. */}
      <header
        ref={headEl}
        class="pf-pane-shell-head"
        title="Drag to move · double-click to collapse"
        draggable={true}
        onDragStart={(e) => {
          e.dataTransfer?.setData(PANE_MIME, props.pane);
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setDragImage(headEl, 16, 12);
          }
        }}
        onDblClick={() => togglePaneCollapsed(props.pane)}
      >
        <button
          class="pf-pane-shell-toggle"
          classList={{ "pf-pane-shell-toggle--collapsed": collapsed() }}
          title={collapsed() ? "Expand" : "Collapse"}
          onClick={() => togglePaneCollapsed(props.pane)}
        >
          <IconChevronDown size={12} />
        </button>
        <span class="pf-pane-shell-title">{PANE_TITLES[props.pane]}</span>
        <span
          class="pf-pane-shell-actions"
          draggable={false}
          onPointerDown={(e) => e.stopPropagation()}
          onDragStart={(e) => e.preventDefault()}
        >
          {props.actions}
        </span>
        <span class="pf-pane-shell-grip" aria-hidden="true">
          <IconGrip size={13} />
        </span>
      </header>
      <div class="pf-pane-shell-body">{props.children}</div>
    </section>
  );
}

// eslint-disable-next-line max-lines-per-function -- TODO(#263): reduce legacy function complexity.
export function DockColumn(props: { dock: DockId; render: (pane: PaneId) => JSX.Element }) {
  const panes = () => layout().docks[props.dock];
  const [dropIndex, setDropIndex] = createSignal<number | null>(null);
  const slotEls = new Map<PaneId, HTMLElement>();
  let dockEl!: HTMLDivElement;

  const isPaneDrag = (e: DragEvent) => !!e.dataTransfer?.types.includes(PANE_MIME);

  const computeIndex = (clientY: number): number => {
    const ps = panes();
    for (let i = 0; i < ps.length; i++) {
      const el = slotEls.get(ps[i]);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return ps.length;
  };

  const onDragOver = (e: DragEvent) => {
    if (!isPaneDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    setDropIndex(computeIndex(e.clientY));
  };
  const onDragLeave = (e: DragEvent) => {
    if (!dockEl.contains(e.relatedTarget as Node)) setDropIndex(null);
  };
  const onDrop = (e: DragEvent) => {
    const pane = e.dataTransfer?.getData(PANE_MIME) as PaneId;
    const idx = dropIndex();
    setDropIndex(null);
    if (!pane || idx === null) return;
    e.preventDefault();
    movePane(pane, props.dock, idx);
  };

  // --- vertical resize between two adjacent expanded panes ---
  const startResize = (e: PointerEvent, aboveId: PaneId, belowId: PaneId) => {
    e.preventDefault();
    const aEl = slotEls.get(aboveId);
    const bEl = slotEls.get(belowId);
    if (!aEl || !bEl) return;
    const startY = e.clientY;
    const aH = aEl.offsetHeight;
    const sum = aH + bEl.offsetHeight;
    const sumW = paneWeight(aboveId) + paneWeight(belowId);
    const MIN = 64;
    document.body.classList.add("pf-resizing");
    const onMove = (ev: PointerEvent) => {
      let na = aH + (ev.clientY - startY);
      na = Math.max(MIN, Math.min(sum - MIN, na));
      setPaneWeights({
        [aboveId]: (na / sum) * sumW,
        [belowId]: ((sum - na) / sum) * sumW,
      });
    };
    const end = () => {
      document.body.classList.remove("pf-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
  };

  const width = () => (props.dock === "left" ? layout().leftWidth : layout().rightWidth);

  return (
    <div
      ref={dockEl}
      class="pf-dock"
      classList={{ "pf-dock--left": props.dock === "left", "pf-dock--right": props.dock === "right" }}
      style={{ width: `${width()}px` }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <For each={panes()}>
        {(pane, i) => {
          const next = () => panes()[i() + 1];
          const expanded = () => !isCollapsed(pane);
          const resizable = () => expanded() && next() && !isCollapsed(next());
          onCleanup(() => slotEls.delete(pane)); // drop the ref when this pane leaves the dock
          return (
            <>
              <Show when={dropIndex() === i()}>
                <div class="pf-drop-placeholder" />
              </Show>
              <div
                class="pf-dock-slot"
                classList={{ "pf-dock-slot--expanded": expanded() }}
                // Animatable flex longhands: collapsing eases flex-grow → 0 and
                // flex-basis → the header height, so the slot rolls up smoothly
                // while siblings expand to fill the freed space.
                style={{
                  "flex-grow": expanded() ? `${paneWeight(pane)}` : "0",
                  "flex-shrink": "1",
                  "flex-basis": expanded() ? "0px" : "var(--pf-pane-head-h)",
                }}
                ref={(el) => slotEls.set(pane, el)}
              >
                {props.render(pane)}
              </div>
              <Show when={resizable()}>
                <div
                  class="pf-pane-vresizer"
                  title="Drag to resize"
                  onPointerDown={(e) => startResize(e, pane, next()!)}
                >
                  <span class="pf-pane-vresizer-grip" />
                </div>
              </Show>
            </>
          );
        }}
      </For>
      <Show when={dropIndex() === panes().length}>
        <div class="pf-drop-placeholder" />
      </Show>
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

// The dock in the workbench flex row: an always-mounted panel whose width eases
// between its resized width and 0 (a drawer), with the inner DockColumn pinned
// to its own width so the panes never reflow-squish during the transition. When
// hidden, a reveal handle replaces the resizer; the DockColumn is unmounted a
// beat after the close animation so hidden panes stop running (device mirror,
// git scans). The center terminal column is untouched, so hosts never remount.
export function DockPanel(props: { dock: DockId; render: (pane: PaneId) => JSX.Element }) {
  const left = props.dock === "left";
  const visible = () => (left ? layout().leftVisible : layout().rightVisible);
  const width = () => (left ? layout().leftWidth : layout().rightWidth);
  const [rendered, setRendered] = createSignal(visible());
  createEffect(() => {
    if (visible()) {
      setRendered(true);
      return;
    }
    const t = setTimeout(() => setRendered(false), 300);
    onCleanup(() => clearTimeout(t));
  });
  const panel = (
    <div
      class="pf-dock-panel"
      classList={{
        "pf-dock-panel--left": left,
        "pf-dock-panel--right": !left,
        "pf-dock-panel--hidden": !visible(),
      }}
      style={{ width: visible() ? `${width()}px` : "0px" }}
    >
      <Show when={rendered()}>
        <DockColumn dock={props.dock} render={props.render} />
      </Show>
    </div>
  );
  const edge = (
    <Show when={visible()} fallback={<DockRevealHandle dock={props.dock} />}>
      <DockResizer dock={props.dock} />
    </Show>
  );
  return (
    <>
      {left ? panel : edge}
      {left ? edge : panel}
    </>
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
      <IconChevronRight size={14} class={props.dock === "right" ? "pf-flip-x" : undefined} />
    </button>
  );
}
