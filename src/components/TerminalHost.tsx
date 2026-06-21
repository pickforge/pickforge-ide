// Multi-pane terminal host. The layout is a binary split tree; panes are
// rendered from a flat <For> over STABLE leaf objects and positioned absolutely
// from a computed layout, so splitting / closing / resizing only moves CSS rects
// — an existing pane is never remounted (which would kill its shell). Each pane
// carries its own controls: a directional split menu (left / right / up / down)
// and its own close button. The focused pane wears the travelling ember sweep.
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { TerminalPane, type TerminalHandle } from "./Terminal";
import { AskAiMenu } from "./AskAiMenu";
import { IconClose, IconGrip, IconSplit, IconSplitTrigger } from "./icons";
import "./TerminalHost.css";

type Dir = "left" | "right" | "up" | "down";
type Region = Dir | "center";
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

/** Rebuild the tree, swapping in replacement leaves (refs preserved elsewhere).
 * Used to swap two panes' positions without remounting either terminal. */
function mapLeaves(node: Node, fn: (l: Leaf) => Leaf): Node {
  if (node.kind === "leaf") return fn(node);
  return { ...node, a: mapLeaves(node.a, fn), b: mapLeaves(node.b, fn) };
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
  /** Type text into the currently focused pane's shell. Returns that pane's id
   *  if a shell accepted the text, or null if no pane was ready yet. */
  typeToFocused: (text: string) => string | null;
  /** Split the focused pane and run `command` in the new pane; returns the new
   *  pane's id (e.g. to arm auto-naming on it). */
  openInNewPane: (command: string) => string;
}

export function TerminalHost(props: {
  onReady?: (handle: TerminalHostHandle) => void;
  cwd?: string;
  /** Extra `PICKFORGE_*` env for every spawned shell — MCP endpoint discovery. */
  env?: Record<string, string> | null;
  /** Forwarded from every pane: a line the user typed and submitted, tagged with
   *  the id of the pane it came from. */
  onUserSubmit?: (line: string, paneId: string) => void;
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

  // Commands queued to run in a freshly-split pane once its shell is ready
  // (used by openInNewPane for "open file in editor").
  const pendingCmd = new Map<string, string>();
  const openInNewPane = (command: string): string => {
    const fresh = newLeaf();
    pendingCmd.set(fresh.id, command);
    setRoot((r) => splitTree(r, focusedId(), "down", fresh));
    setFocusedId(fresh.id);
    return fresh.id;
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

  // Closing panes play an exit animation in place before leaving the split tree
  // (mirrors the open animation); siblings reflow once they're gone. Reduced
  // motion removes them immediately.
  const [closing, setClosing] = createSignal<string[]>([]);
  const reduceMotion = () =>
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const CLOSE_MS = 260; // matches the --pf-dur-standard close animation
  const requestClose = (id: string) => {
    if (leaves().length <= 1 || closing().includes(id)) return;
    if (reduceMotion()) {
      close(id);
      return;
    }
    setClosing((c) => [...c, id]);
    setTimeout(() => {
      setClosing((c) => c.filter((x) => x !== id));
      close(id);
    }, CLOSE_MS);
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

  // --- pane rearrange: drag a pane by its top bar onto another pane ---
  // Drop on the centre swaps the two panes; drop on an edge moves the dragged
  // pane to that side of the target. Leaf objects are reused throughout, so the
  // dragged shell is repositioned, never remounted.
  const [dragId, setDragId] = createSignal<string | null>(null);
  const [drop, setDrop] = createSignal<{ id: string; region: Region } | null>(null);
  let paneDrag: { id: string; startX: number; startY: number; active: boolean } | null = null;

  const hitTest = (cx: number, cy: number): { id: string; region: Region } | null => {
    const box = containerEl.getBoundingClientRect();
    const fx = (cx - box.left) / box.width;
    const fy = (cy - box.top) / box.height;
    for (const [id, r] of layout().map) {
      if (fx < r.x || fx > r.x + r.w || fy < r.y || fy > r.y + r.h) continue;
      const lx = (fx - r.x) / r.w;
      const ly = (fy - r.y) / r.h;
      const edge = Math.min(lx, 1 - lx, ly, 1 - ly);
      let region: Region = "center";
      if (edge < 0.28) {
        if (edge === lx) region = "left";
        else if (edge === 1 - lx) region = "right";
        else if (edge === ly) region = "up";
        else region = "down";
      }
      return { id, region };
    }
    return null;
  };

  const rearrange = (sourceId: string, targetId: string, region: Region) => {
    if (sourceId === targetId) return;
    if (region === "center") {
      const a = leaves().find((l) => l.id === sourceId);
      const b = leaves().find((l) => l.id === targetId);
      if (!a || !b) return;
      setRoot((r) => mapLeaves(r, (l) => (l.id === sourceId ? b : l.id === targetId ? a : l)));
    } else {
      const src = leaves().find((l) => l.id === sourceId);
      const without = removeLeaf(root(), sourceId);
      if (!src || !without) return;
      setRoot(splitTree(without, targetId, region, src));
    }
    focus(sourceId);
  };

  const onPaneDragMove = (e: PointerEvent) => {
    if (!paneDrag) return;
    if (!paneDrag.active) {
      if (Math.abs(e.clientX - paneDrag.startX) + Math.abs(e.clientY - paneDrag.startY) < 6) return;
      paneDrag.active = true;
      setDragId(paneDrag.id);
      document.body.classList.add("pf-pane-moving");
    }
    e.preventDefault();
    const hit = hitTest(e.clientX, e.clientY);
    setDrop(hit && hit.id !== paneDrag.id ? hit : null);
  };
  const endPaneDrag = () => {
    const pd = paneDrag;
    const target = drop();
    paneDrag = null;
    window.removeEventListener("pointermove", onPaneDragMove);
    window.removeEventListener("pointerup", endPaneDrag);
    document.body.classList.remove("pf-pane-moving");
    setDragId(null);
    setDrop(null);
    if (pd?.active && target && target.id !== pd.id) rearrange(pd.id, target.id, target.region);
  };
  const startPaneDrag = (e: PointerEvent, leafId: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".pf-pane-ctls")) return; // controls aren't handles
    if (leaves().length <= 1) return; // nothing to rearrange against
    paneDrag = { id: leafId, startX: e.clientX, startY: e.clientY, active: false };
    window.addEventListener("pointermove", onPaneDragMove);
    window.addEventListener("pointerup", endPaneDrag);
  };
  onCleanup(() => {
    if (paneDrag) endPaneDrag();
  });

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
    typeToFocused: (text) => {
      const id = focusedId();
      const h = handles.get(id);
      if (!h) return null;
      h.typeText(text);
      return id;
    },
    openInNewPane,
  });

  const [askSel, setAskSel] = createSignal<{ text: string; x: number; y: number } | null>(null);

  return (
    <div class="pf-term-host" ref={containerEl}>
      <For each={leaves()}>
        {(leaf) => {
          const rect = () => layout().map.get(leaf.id) ?? { x: 0, y: 0, w: 1, h: 1 };
          const focused = () => focusedId() === leaf.id;
          return (
            <div
              class="pf-pane"
              classList={{ "pf-pane--closing": closing().includes(leaf.id) }}
              style={{
                left: pct(rect().x),
                top: pct(rect().y),
                width: pct(rect().w),
                height: pct(rect().h),
              }}
            >
              <div
                class="pf-pane-frame"
                classList={{
                  "pf-pane-frame--focused": focused(),
                  "pf-pane-frame--dragging": dragId() === leaf.id,
                }}
                onPointerDown={() => focus(leaf.id)}
              >
                {/* A real top bar: its own row above the terminal, never an
                    overlay — the shell prompt below it is never covered. The
                    whole bar is the drag handle for rearranging panes. */}
                <div
                  class="pf-pane-bar"
                  title="Drag to move this pane"
                  onPointerDown={(e) => startPaneDrag(e, leaf.id)}
                >
                  <div class="pf-pane-bar-id">
                    <span class="pf-pane-grip"><IconGrip size={13} /></span>
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
                        requestClose(leaf.id);
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
                    env={props.env}
                    onUserSubmit={(line) => props.onUserSubmit?.(line, leaf.id)}
                    onSelectionChange={setAskSel}
                    onReady={(handle) => {
                      handles.set(leaf.id, handle);
                      if (focusedId() === leaf.id) handle.focus();
                      const cmd = pendingCmd.get(leaf.id);
                      if (cmd) {
                        pendingCmd.delete(leaf.id);
                        handle.typeText(cmd + "\r");
                      }
                    }}
                    onExit={() => requestClose(leaf.id)}
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

      {/* drop indicator: highlights the side/centre the dragged pane will land */}
      <Show when={drop()}>
        {(d) => {
          const rect = () => layout().map.get(d().id);
          return (
            <Show when={rect()}>
              <div
                class="pf-drop"
                style={{
                  left: pct(rect()!.x),
                  top: pct(rect()!.y),
                  width: pct(rect()!.w),
                  height: pct(rect()!.h),
                }}
              >
                <div class={`pf-drop-zone pf-drop-zone--${d().region}`} />
              </div>
            </Show>
          );
        }}
      </Show>

      <Show when={askSel()}>
        {(s) => <AskAiMenu selection={s()} onClose={() => setAskSel(null)} />}
      </Show>
    </div>
  );
}
