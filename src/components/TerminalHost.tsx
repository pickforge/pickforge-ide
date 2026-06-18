// Multi-pane terminal host. The layout is a binary split tree; panes are
// rendered from a flat <For> over STABLE leaf objects and positioned absolutely
// from a computed layout, so splitting / closing / resizing only moves CSS rects
// — an existing pane is never remounted (which would kill its shell). Each pane
// carries its own controls: a directional split menu (left / right / up / down)
// and its own close button. The focused pane wears the travelling ember sweep.
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { TerminalPane, type TerminalHandle } from "./Terminal";
import { IconClose, IconSplit, IconSplitTrigger } from "./icons";
import "./TerminalHost.css";

type Dir = "left" | "right" | "up" | "down";
interface Leaf {
  kind: "leaf";
  id: string;
  callsign: string;
}
interface Split {
  kind: "split";
  id: string;
  dir: "row" | "col";
  ratio: number;
  a: Node;
  b: Node;
}
type Node = Leaf | Split;
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Divider {
  id: string;
  dir: "row" | "col";
  rect: Rect;
  bounds: Rect;
}

// Pane callsigns give each shell a quiet identity (brand "dev-coded" texture),
// the way tmux numbers windows. Cycles; collisions are harmless.
const CALLSIGNS = ["Mae", "Gus", "Ivy", "Bo", "Cal", "Rex", "Nim", "Ada", "Jun", "Lux"];
let paneCounter = 0;
let splitCounter = 0;
function newLeaf(): Leaf {
  const n = paneCounter++;
  return { kind: "leaf", id: `pane-${n}`, callsign: CALLSIGNS[n % CALLSIGNS.length] };
}
function newSplitId(): string {
  return `split-${splitCounter++}`;
}

const SPLITS: { dir: Dir; label: string }[] = [
  { dir: "left", label: "Split left" },
  { dir: "right", label: "Split right" },
  { dir: "up", label: "Split top" },
  { dir: "down", label: "Split bottom" },
];

/** Replace the targeted leaf with a split that adds `fresh` on the given side. */
function splitTree(node: Node, leafId: string, dir: Dir, fresh: Leaf): Node {
  if (node.kind === "leaf") {
    if (node.id !== leafId) return node;
    const horizontal = dir === "left" || dir === "right";
    const newFirst = dir === "left" || dir === "up";
    return {
      kind: "split",
      id: newSplitId(),
      dir: horizontal ? "row" : "col",
      ratio: 0.5,
      a: newFirst ? fresh : node,
      b: newFirst ? node : fresh,
    };
  }
  return { ...node, a: splitTree(node.a, leafId, dir, fresh), b: splitTree(node.b, leafId, dir, fresh) };
}

/** Remove a leaf, collapsing its parent split into the surviving sibling. */
function removeLeaf(node: Node, leafId: string): Node | null {
  if (node.kind === "leaf") return node.id === leafId ? null : node;
  const a = removeLeaf(node.a, leafId);
  const b = removeLeaf(node.b, leafId);
  if (a === null) return b;
  if (b === null) return a;
  if (a === node.a && b === node.b) return node;
  return { ...node, a, b };
}

/** Clone only the path to `splitId`, updating its ratio (leaf refs preserved). */
function setRatio(node: Node, splitId: string, ratio: number): Node {
  if (node.kind === "leaf") return node;
  if (node.id === splitId) return { ...node, ratio };
  return { ...node, a: setRatio(node.a, splitId, ratio), b: setRatio(node.b, splitId, ratio) };
}

function collectLeaves(node: Node, out: Leaf[] = []): Leaf[] {
  if (node.kind === "leaf") out.push(node);
  else {
    collectLeaves(node.a, out);
    collectLeaves(node.b, out);
  }
  return out;
}

function computeLayout(
  node: Node,
  rect: Rect,
  leaves: Map<string, Rect>,
  dividers: Divider[],
): void {
  if (node.kind === "leaf") {
    leaves.set(node.id, rect);
    return;
  }
  if (node.dir === "row") {
    const aw = rect.w * node.ratio;
    computeLayout(node.a, { x: rect.x, y: rect.y, w: aw, h: rect.h }, leaves, dividers);
    computeLayout(node.b, { x: rect.x + aw, y: rect.y, w: rect.w - aw, h: rect.h }, leaves, dividers);
    dividers.push({
      id: node.id,
      dir: "row",
      rect: { x: rect.x + aw, y: rect.y, w: 0, h: rect.h },
      bounds: rect,
    });
  } else {
    const ah = rect.h * node.ratio;
    computeLayout(node.a, { x: rect.x, y: rect.y, w: rect.w, h: ah }, leaves, dividers);
    computeLayout(node.b, { x: rect.x, y: rect.y + ah, w: rect.w, h: rect.h - ah }, leaves, dividers);
    dividers.push({
      id: node.id,
      dir: "col",
      rect: { x: rect.x, y: rect.y + ah, w: rect.w, h: 0 },
      bounds: rect,
    });
  }
}

const pct = (v: number) => `${v * 100}%`;
const baseName = (p?: string) =>
  p ? p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "" : "";

export interface TerminalHostHandle {
  /** Type text into the currently focused pane's shell. */
  typeToFocused: (text: string) => void;
}

export function TerminalHost(props: {
  onReady?: (handle: TerminalHostHandle) => void;
  cwd?: string;
}) {
  const first = newLeaf();
  const [root, setRoot] = createSignal<Node>(first);
  const [focusedId, setFocusedId] = createSignal<string>(first.id);
  const [menuFor, setMenuFor] = createSignal<string | null>(null);
  const handles = new Map<string, TerminalHandle>();
  let containerEl!: HTMLDivElement;

  const leaves = createMemo(() => collectLeaves(root()));
  const layout = createMemo(() => {
    const map = new Map<string, Rect>();
    const divs: Divider[] = [];
    computeLayout(root(), { x: 0, y: 0, w: 1, h: 1 }, map, divs);
    return { map, divs };
  });

  const focus = (id: string) => {
    setFocusedId(id);
    handles.get(id)?.focus();
  };

  const doSplit = (leafId: string, dir: Dir) => {
    const fresh = newLeaf();
    setRoot((r) => splitTree(r, leafId, dir, fresh));
    setMenuFor(null);
    setFocusedId(fresh.id); // its terminal focuses itself once ready
  };

  const close = (id: string) => {
    if (leaves().length <= 1) return;
    const next = removeLeaf(root(), id);
    if (!next) return;
    setRoot(next);
    handles.delete(id);
    setMenuFor((m) => (m === id ? null : m));
    if (focusedId() === id) {
      const remaining = collectLeaves(next);
      if (remaining.length) focus(remaining[remaining.length - 1].id);
    }
  };

  // --- divider drag → live ratio ---
  let drag: { id: string; dir: "row" | "col"; bounds: Rect } | null = null;
  const onDragMove = (e: PointerEvent) => {
    if (!drag) return;
    const box = containerEl.getBoundingClientRect();
    const fx = (e.clientX - box.left) / box.width;
    const fy = (e.clientY - box.top) / box.height;
    const local =
      drag.dir === "row"
        ? (fx - drag.bounds.x) / drag.bounds.w
        : (fy - drag.bounds.y) / drag.bounds.h;
    setRoot((r) => setRatio(r, drag!.id, Math.min(0.85, Math.max(0.15, local))));
  };
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove("pf-resizing");
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", endDrag);
  };
  const startDrag = (e: PointerEvent, d: Divider) => {
    e.preventDefault();
    drag = { id: d.id, dir: d.dir, bounds: d.bounds };
    document.body.classList.add("pf-resizing");
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endDrag);
  };
  onCleanup(endDrag);

  // Close the split menu on any outside pointer-down.
  const onWindowDown = (e: PointerEvent) => {
    const t = e.target as HTMLElement;
    if (!t.closest(".pf-pane-menu") && !t.closest(".pf-pane-ctl--split")) {
      setMenuFor(null);
    }
  };
  window.addEventListener("pointerdown", onWindowDown);
  onCleanup(() => window.removeEventListener("pointerdown", onWindowDown));

  props.onReady?.({
    typeToFocused: (text) => handles.get(focusedId())?.typeText(text),
  });

  return (
    <div class="pf-term-host" ref={containerEl}>
      <For each={leaves()}>
        {(leaf) => {
          const rect = () => layout().map.get(leaf.id) ?? { x: 0, y: 0, w: 1, h: 1 };
          const focused = () => focusedId() === leaf.id;
          return (
            <div
              class="pf-pane"
              style={{
                left: pct(rect().x),
                top: pct(rect().y),
                width: pct(rect().w),
                height: pct(rect().h),
              }}
            >
              <div
                class="pf-pane-frame"
                classList={{ "pf-pane-frame--focused": focused() }}
                onPointerDown={() => focus(leaf.id)}
              >
                {/* A real top bar: its own row above the terminal, never an
                    overlay — the shell prompt below it is never covered. */}
                <div class="pf-pane-bar">
                  <div class="pf-pane-bar-id">
                    <span class="pf-pane-dot" classList={{ "pf-pane-dot--live": focused() }} />
                    <span class="pf-pane-callsign">{leaf.callsign}</span>
                    <Show when={baseName(props.cwd)}>
                      <span class="pf-pane-cwd">{baseName(props.cwd)}</span>
                    </Show>
                  </div>
                  <div class="pf-pane-ctls">
                    <button
                      class="pf-pane-ctl pf-pane-ctl--split"
                      classList={{ "pf-pane-ctl--active": menuFor() === leaf.id }}
                      title="Split this pane"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuFor((m) => (m === leaf.id ? null : leaf.id));
                      }}
                    >
                      <IconSplitTrigger size={14} />
                    </button>
                    <button
                      class="pf-pane-ctl pf-pane-ctl--close"
                      title="Close pane"
                      disabled={leaves().length <= 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        close(leaf.id);
                      }}
                    >
                      <IconClose size={14} />
                    </button>

                    <Show when={menuFor() === leaf.id}>
                      <div class="pf-pane-menu" onPointerDown={(e) => e.stopPropagation()}>
                        <div class="pf-pane-menu-grid">
                          <For each={SPLITS}>
                            {(s) => (
                              <button
                                class={`pf-split-tile pf-split-tile--${s.dir}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  doSplit(leaf.id, s.dir);
                                }}
                              >
                                <IconSplit dir={s.dir} size={26} />
                                <span class="pf-split-tile-label">{s.label}</span>
                              </button>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>
                  </div>
                </div>

                <div class="pf-pane-inner">
                  <TerminalPane
                    cwd={props.cwd}
                    onReady={(handle) => {
                      handles.set(leaf.id, handle);
                      if (focusedId() === leaf.id) handle.focus();
                    }}
                    onExit={() => close(leaf.id)}
                  />
                </div>
              </div>
            </div>
          );
        }}
      </For>

      {/* draggable seams */}
      <For each={layout().divs}>
        {(d) => (
          <div
            class="pf-divider"
            classList={{ "pf-divider--row": d.dir === "row", "pf-divider--col": d.dir === "col" }}
            style={
              d.dir === "row"
                ? { left: pct(d.rect.x), top: pct(d.rect.y), height: pct(d.rect.h) }
                : { left: pct(d.rect.x), top: pct(d.rect.y), width: pct(d.rect.w) }
            }
            onPointerDown={(e) => startDrag(e, d)}
          >
            <span class="pf-divider-grip" />
          </div>
        )}
      </For>
    </div>
  );
}
