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
import {
  captureRemotePtyForPane,
  paneSpawnModeFor,
  resolvePtyRemote,
  type CapturedRemotePtys,
  type PaneSpawnMode,
} from "../lib/remoteContext";
import { askpassNotice, getAskpassStatus, type AskpassStatus, type RemotePty } from "../lib/pty";
import "./TerminalHost.css";

type Dir = "left" | "right" | "up" | "down";
type Region = Dir | "center";
interface Leaf {
  kind: "leaf";
  id: string;
  callsign: string;
  remote?: RemotePty | null;
}

export interface PaneSpawnOptions {
  forceLocal?: boolean;
  remote?: RemotePty | null;
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
function newLeaf(remote?: RemotePty | null): Leaf {
  const n = paneCounter++;
  return { kind: "leaf", id: `pane-${n}`, callsign: CALLSIGNS[n % CALLSIGNS.length], remote };
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
  openInNewPane: (command: string, options?: PaneSpawnOptions) => string;
  /** Run `command` (with a trailing newline) in this host's PRIMARY,
   *  session-backed pane — the one wired to the chat's recoverable dtach/tmux
   *  session — and focus it. Returns the primary pane's id, or null if it isn't
  *  ready yet. Agent quick-launches use this so the launched agent runs INSIDE
  *  the recoverable session (surviving close/restart), not a raw split pane. */
  runInPrimary: (command: string) => string | null;
  primarySpawnMode: () => PaneSpawnMode;
  primaryRemotePty: () => RemotePty | null;
}

type TerminalHostProps = {
  onReady?: (handle: TerminalHostHandle) => void;
  cwd?: string;
  /** The chat this host belongs to. When set, panes spawn SESSION-BACKED shells
   *  (dtach/tmux) keyed off the chat so a running agent survives pane-close and
   *  app-restart; unset → a plain interactive shell (today's behaviour). */
  chatId?: string;
  /** Extra `PICKFORGE_*` env for every spawned shell — MCP endpoint discovery. */
  env?: Record<string, string> | null;
  /** Forwarded from every pane: a line the user typed and submitted, tagged with
   *  the id of the pane it came from. */
  onUserSubmit?: (line: string, paneId: string) => void;
  /** Forwarded from every pane: decoded terminal output, tagged with the pane id. */
  onOutput?: (chunk: string, paneId: string) => void;
  /** Forwarded from every pane: terminal bell, tagged with the pane id. */
  onBell?: (paneId: string) => void;
  /** Forwarded from every pane: terminal notification OSC, tagged with the pane id. */
  onNotification?: (message: string, paneId: string) => void;
  /** Called when the session-backed primary remounts under a fresh pane id. */
  onPrimaryPaneRemount?: (fromPaneId: string, toPaneId: string) => void;
  /** Called when a pane leaves the split tree and its shell is killed — the
   *  user closed it, or it was the survivor swapped out by a primary
   *  promotion. Lets the host drop per-pane state (agent ownership, activity). */
  onPaneClosed?: (paneId: string) => void;
  /** Called for the PTY/session lifecycle exit even when its pane remains mounted
   *  to preserve output. Unlike OSC title restoration, this boundary is emitted
   *  by the process lifecycle and always revokes terminal title authority. */
  onPaneExited?: (paneId: string) => void;
  /** Forwarded from every pane: the shell/agent's OSC 2 terminal title, tagged
   *  with the pane id — the host maps it to this chat's name. */
  onTitle?: (title: string, paneId: string) => void;
  /** Session recovery for this chat's PRIMARY pane (dtach/tmux). Only the first
   *  pane is session-backed — extra split panes are plain shells, so two panes
   *  never attach the same session and interleave input. */
  session?: {
    projectRoot: string;
    sessionId?: string | null;
    backend: "dtach" | "tmux" | "raw";
    onSession?: (
      info: { sessionId: string | null; backend: string; degraded: boolean; attached: boolean },
      paneId: string,
    ) => void;
  };
};

/** The split-tree state (root/primary/focus) plus per-pane bookkeeping (live
 *  handles, dead/closed tracking, captured remotes, the askpass chip). A
 *  composable, called synchronously from `createTerminalHostController`'s own
 *  setup so its signals live under the same reactive owner as if written
 *  inline. */
function createPaneTreeState(props: TerminalHostProps, first: Leaf) {
  const [primaryId, setPrimaryId] = createSignal<string>(first.id);
  const [root, setRoot] = createSignal<Node>(first);
  const [focusedId, setFocusedId] = createSignal<string>(first.id);
  const [menuFor, setMenuFor] = createSignal<string | null>(null);
  const [paneRemote, setPaneRemote] = createSignal<CapturedRemotePtys>({});
  const [deadPanes, setDeadPanes] = createSignal<string[]>([]);
  // Linux graphical sudo (askpass) pre-flight status — pickforge#215. Only
  // relevant to the session-backed (chat) primary pane, where agents run;
  // `getAskpassStatus()` is itself cached, so this never re-triggers IPC
  // across hosts/panes. Stays null (no chip) on macOS/Windows and while
  // agents CAN run `sudo -A` — the chip is only the two actionable failure
  // states from the locked v1 contract.
  const [askpassStatus, setAskpassStatus] = createSignal<AskpassStatus | null>(null);
  if (props.session) {
    getAskpassStatus()
      .then(setAskpassStatus)
      .catch(() => {});
  }
  const handles = new Map<string, TerminalHandle>();
  const closedPanes = new Set<string>();

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

  const primarySpawnMode = () => paneSpawnModeFor(paneRemote(), primaryId());
  const primaryRemotePty = () =>
    resolvePtyRemote(paneRemote()[primaryId()], props.session?.projectRoot ?? props.cwd);

  const notifyPaneClosed = (id: string) => {
    if (closedPanes.has(id)) return;
    closedPanes.add(id);
    props.onPaneClosed?.(id);
  };
  const markPtyDead = (id: string) => {
    setDeadPanes((panes) => (panes.includes(id) ? panes : [...panes, id]));
    notifyPaneClosed(id);
  };

  return {
    primaryId,
    setPrimaryId,
    root,
    setRoot,
    focusedId,
    setFocusedId,
    menuFor,
    setMenuFor,
    paneRemote,
    setPaneRemote,
    deadPanes,
    askpassStatus,
    handles,
    leaves,
    layout,
    focus,
    primarySpawnMode,
    primaryRemotePty,
    notifyPaneClosed,
    markPtyDead,
  };
}

/** Split/close/rearrange operations over the pane tree, plus the queued
 *  commands that flush once a freshly-split (or not-yet-ready primary) pane's
 *  handle arrives. A composable, called synchronously from
 *  `createTerminalHostController`'s own setup so its signal lives under the
 *  same reactive owner as if written inline. */
function createPaneTreeOperations(props: TerminalHostProps, tree: ReturnType<typeof createPaneTreeState>) {
  const doSplit = (leafId: string, dir: Dir) => {
    const fresh = newLeaf();
    tree.setRoot((r) => splitTree(r, leafId, dir, fresh));
    tree.setMenuFor(null);
    tree.setFocusedId(fresh.id); // its terminal focuses itself once ready
  };

  // Commands queued to run in a freshly-split pane once its shell is ready
  // (used by openInNewPane for "open file in editor").
  const pendingCmd = new Map<string, string>();
  // A command queued to run in the PRIMARY (session-backed) pane before its
  // handle exists — an agent chip/hotkey fired right after the host registered
  // but before the primary pane's async font-load/spawn called onReady. Flushed
  // when the primary handle arrives so the launch is never silently dropped.
  let pendingPrimaryCmd: string | null = null;
  const flushPrimaryCmd = () => {
    if (pendingPrimaryCmd === null) return;
    const id = tree.primaryId();
    const h = tree.handles.get(id);
    if (!h) return;
    const cmd = pendingPrimaryCmd;
    pendingPrimaryCmd = null;
    tree.focus(id);
    h.typeText(cmd + "\r");
  };
  const setPendingPrimaryCmd = (cmd: string) => {
    pendingPrimaryCmd = cmd;
  };

  const openInNewPane = (command: string, options?: PaneSpawnOptions): string => {
    const fresh = newLeaf(options?.forceLocal ? null : options?.remote);
    pendingCmd.set(fresh.id, command);
    tree.setRoot((r) => splitTree(r, tree.focusedId(), "down", fresh));
    tree.setFocusedId(fresh.id);
    return fresh.id;
  };

  const close = (id: string) => {
    if (tree.leaves().length <= 1) return;
    let next = removeLeaf(tree.root(), id);
    if (!next) return;
    // If the user closed the SESSION-BACKED primary while other panes remain,
    // promote a survivor so the chat's recovery session stays attached to this
    // still-mounted host. We swap that survivor's leaf for a fresh id, which
    // remounts it WITH the chat session props (its old raw shell is replaced by
    // a pane that re-attaches the live dtach/tmux session); without this the
    // session would detach with nothing left to reattach it here, and later
    // agent quick-launches would target a missing primary handle.
    if (id === tree.primaryId() && props.session && props.chatId) {
      const survivor = collectLeaves(next)[0];
      if (survivor) {
        const promoted = newLeaf();
        next = mapLeaves(next, (l) => (l.id === survivor.id ? promoted : l));
        tree.handles.delete(survivor.id);
        tree.setPrimaryId(promoted.id);
        props.onPrimaryPaneRemount?.(id, promoted.id);
        // The survivor's raw shell dies in the swap (the promoted pane
        // re-attaches the chat session instead) — report it as closed so any
        // agent ownership it held doesn't outlive the shell.
        tree.notifyPaneClosed(survivor.id);
        if (tree.focusedId() === survivor.id) tree.setFocusedId(promoted.id);
      }
    }
    tree.setRoot(next);
    tree.handles.delete(id);
    tree.notifyPaneClosed(id);
    tree.setMenuFor((m) => (m === id ? null : m));
    if (tree.focusedId() === id) {
      const remaining = collectLeaves(next);
      if (remaining.length) tree.focus(remaining[remaining.length - 1].id);
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
    if (tree.leaves().length <= 1 || closing().includes(id)) return;
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

  return {
    doSplit,
    pendingCmd,
    flushPrimaryCmd,
    setPendingPrimaryCmd,
    openInNewPane,
    close,
    closing,
    requestClose,
  };
}

/** Divider-drag → live split-ratio. A composable, called synchronously from
 *  `createTerminalHostController`'s own setup so its `onCleanup` runs under
 *  the same reactive owner as if written inline. */
function createDividerDragState(containerEl: () => HTMLDivElement, setRoot: (fn: (r: Node) => Node) => void) {
  let drag: { id: string; dir: "row" | "col"; bounds: Rect } | null = null;
  const onDragMove = (e: PointerEvent) => {
    if (!drag) return;
    const box = containerEl().getBoundingClientRect();
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

  return { startDrag };
}

/** Pane rearrange: drag a pane by its top bar onto another pane. Drop on the
 *  centre swaps the two panes; drop on an edge moves the dragged pane to that
 *  side of the target. Leaf objects are reused throughout, so the dragged
 *  shell is repositioned, never remounted. A composable, called synchronously
 *  from `createTerminalHostController`'s own setup so its signals/`onCleanup`
 *  run under the same reactive owner as if written inline. */
function createPaneRearrangeState(
  containerEl: () => HTMLDivElement,
  tree: ReturnType<typeof createPaneTreeState>,
) {
  const [dragId, setDragId] = createSignal<string | null>(null);
  const [drop, setDrop] = createSignal<{ id: string; region: Region } | null>(null);
  let paneDrag: { id: string; startX: number; startY: number; active: boolean } | null = null;

  const hitTest = (cx: number, cy: number): { id: string; region: Region } | null => {
    const box = containerEl().getBoundingClientRect();
    const fx = (cx - box.left) / box.width;
    const fy = (cy - box.top) / box.height;
    for (const [id, r] of tree.layout().map) {
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
      const a = tree.leaves().find((l) => l.id === sourceId);
      const b = tree.leaves().find((l) => l.id === targetId);
      if (!a || !b) return;
      tree.setRoot((r) => mapLeaves(r, (l) => (l.id === sourceId ? b : l.id === targetId ? a : l)));
    } else {
      const src = tree.leaves().find((l) => l.id === sourceId);
      const without = removeLeaf(tree.root(), sourceId);
      if (!src || !without) return;
      tree.setRoot(splitTree(without, targetId, region, src));
    }
    tree.focus(sourceId);
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
    if (tree.leaves().length <= 1) return; // nothing to rearrange against
    paneDrag = { id: leafId, startX: e.clientX, startY: e.clientY, active: false };
    window.addEventListener("pointermove", onPaneDragMove);
    window.addEventListener("pointerup", endPaneDrag);
  };
  onCleanup(() => {
    if (paneDrag) endPaneDrag();
  });

  return { dragId, drop, startPaneDrag };
}

type TerminalHostController = ReturnType<typeof createTerminalHostController>;

function createTerminalHostController(props: TerminalHostProps) {
  const first = newLeaf();
  const tree = createPaneTreeState(props, first);
  const ops = createPaneTreeOperations(props, tree);

  let containerEl!: HTMLDivElement;
  const dividerDrag = createDividerDragState(() => containerEl, tree.setRoot);
  const paneRearrange = createPaneRearrangeState(() => containerEl, tree);

  // Close the split menu on any outside pointer-down.
  const onWindowDown = (e: PointerEvent) => {
    const t = e.target as HTMLElement;
    if (!t.closest(".pf-pane-menu") && !t.closest(".pf-pane-ctl--split")) {
      tree.setMenuFor(null);
    }
  };
  window.addEventListener("pointerdown", onWindowDown);
  onCleanup(() => window.removeEventListener("pointerdown", onWindowDown));

  props.onReady?.({
    typeToFocused: (text) => {
      const id = tree.focusedId();
      if (tree.deadPanes().includes(id)) return null;
      const h = tree.handles.get(id);
      if (!h) return null;
      h.typeText(text);
      return id;
    },
    openInNewPane: ops.openInNewPane,
    primarySpawnMode: tree.primarySpawnMode,
    primaryRemotePty: tree.primaryRemotePty,
    runInPrimary: (command) => {
      // The primary pane is the only session-backed one; run the agent there so
      // it lives inside the recoverable dtach/tmux session. If its handle isn't
      // ready yet (the pane's font-load/spawn is async and may not have called
      // onReady), QUEUE the command and flush it when the handle arrives, rather
      // than dropping the launch. The primary pane id is stable and known up
      // front, so callers can still arm auto-naming on it immediately.
      const id = tree.primaryId();
      if (tree.deadPanes().includes(id)) return null;
      const h = tree.handles.get(id);
      if (!h) {
        ops.setPendingPrimaryCmd(command);
        return id;
      }
      tree.focus(id);
      h.typeText(command + "\r");
      return id;
    },
  });

  const [askSel, setAskSel] = createSignal<{ text: string; x: number; y: number } | null>(null);

  return {
    props,
    setContainerEl: (el: HTMLDivElement) => (containerEl = el),
    ...tree,
    ...ops,
    ...dividerDrag,
    ...paneRearrange,
    askSel,
    setAskSel,
  };
}

const PaneSplitMenu = (props: { ctrl: TerminalHostController; leaf: Leaf }) => (
  <Show when={props.ctrl.menuFor() === props.leaf.id}>
    <div class="pf-pane-menu" onPointerDown={(e) => e.stopPropagation()}>
      <div class="pf-pane-menu-grid">
        <For each={SPLITS}>
          {(s) => (
            <button
              class={`pf-split-tile pf-split-tile--${s.dir}`}
              onClick={(e) => {
                e.stopPropagation();
                props.ctrl.doSplit(props.leaf.id, s.dir);
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
);

const PaneBar = (props: { ctrl: TerminalHostController; leaf: Leaf; focused: () => boolean }) => {
  const ctrl = props.ctrl;
  const leaf = props.leaf;
  return (
    <div
      class="pf-pane-bar"
      title="Drag to move this pane"
      onPointerDown={(e) => ctrl.startPaneDrag(e, leaf.id)}
    >
      <div class="pf-pane-bar-id">
        <span class="pf-pane-grip"><IconGrip size={13} /></span>
        <span class="pf-pane-dot" classList={{ "pf-pane-dot--live": props.focused() }} />
        <span class="pf-pane-callsign">{leaf.callsign}</span>
        <Show when={baseName(ctrl.props.cwd)}>
          <span class="pf-pane-cwd">{baseName(ctrl.props.cwd)}</span>
        </Show>
        <Show when={ctrl.paneRemote()[leaf.id]}>
          {(remote) => <span class="pf-pane-cwd">ssh:{remote().host}</span>}
        </Show>
        <Show when={ctrl.deadPanes().includes(leaf.id)}>
          <span class="pf-pane-cwd">closed</span>
        </Show>
        <Show
          when={
            ctrl.props.session &&
            leaf.id === ctrl.primaryId() &&
            askpassNotice(ctrl.askpassStatus())
          }
        >
          {(notice) => (
            <span class="pf-pane-cwd" title="Graphical sudo (askpass) is unavailable for this session">
              {notice()}
            </span>
          )}
        </Show>
      </div>
      <div class="pf-pane-ctls">
        <button
          class="pf-pane-ctl pf-pane-ctl--split"
          classList={{ "pf-pane-ctl--active": ctrl.menuFor() === leaf.id }}
          title="Split this pane"
          onClick={(e) => {
            e.stopPropagation();
            ctrl.setMenuFor((m) => (m === leaf.id ? null : leaf.id));
          }}
        >
          <IconSplitTrigger size={14} />
        </button>
        <button
          class="pf-pane-ctl pf-pane-ctl--close"
          title="Close pane"
          disabled={ctrl.leaves().length <= 1}
          onClick={(e) => {
            e.stopPropagation();
            ctrl.requestClose(leaf.id);
          }}
        >
          <IconClose size={14} />
        </button>

        <PaneSplitMenu ctrl={ctrl} leaf={leaf} />
      </div>
    </div>
  );
};

const PaneTerminal = (props: { ctrl: TerminalHostController; leaf: Leaf }) => {
  const ctrl = props.ctrl;
  const leaf = props.leaf;
  const hostProps = ctrl.props;
  return (
    <TerminalPane
      cwd={hostProps.cwd}
      projectRoot={hostProps.session?.projectRoot ?? hostProps.cwd}
      remote={leaf.remote}
      env={hostProps.env}
      onSpawn={(remote) =>
        ctrl.setPaneRemote((panes) => captureRemotePtyForPane(panes, leaf.id, remote))
      }
      chat={
        hostProps.session && hostProps.chatId && leaf.id === ctrl.primaryId()
          ? {
              chatId: hostProps.chatId,
              projectRoot: hostProps.session.projectRoot,
              sessionId: hostProps.session.sessionId,
              backend: hostProps.session.backend,
              onSession: (info) => hostProps.session?.onSession?.(info, leaf.id),
            }
          : undefined
      }
      onOutput={
        hostProps.onOutput ? (chunk) => hostProps.onOutput?.(chunk, leaf.id) : undefined
      }
      onBell={hostProps.onBell ? () => hostProps.onBell?.(leaf.id) : undefined}
      onNotification={
        hostProps.onNotification
          ? (message) => hostProps.onNotification?.(message, leaf.id)
          : undefined
      }
      onUserSubmit={(line) => hostProps.onUserSubmit?.(line, leaf.id)}
      onTitle={(title) => hostProps.onTitle?.(title, leaf.id)}
      onSelectionChange={ctrl.setAskSel}
      onReady={(handle) => {
        ctrl.handles.set(leaf.id, handle);
        if (ctrl.focusedId() === leaf.id) handle.focus();
        const cmd = ctrl.pendingCmd.get(leaf.id);
        if (cmd) {
          ctrl.pendingCmd.delete(leaf.id);
          handle.typeText(cmd + "\r");
        }
        // The session-backed (primary) pane just came up — flush any
        // agent launch queued before its handle existed.
        if (leaf.id === ctrl.primaryId()) ctrl.flushPrimaryCmd();
      }}
      onExit={(exit) => {
        hostProps.onPaneExited?.(leaf.id);
        if (exit.preserveBuffer) ctrl.markPtyDead(leaf.id);
        else ctrl.requestClose(leaf.id);
      }}
    />
  );
};

const PaneItem = (props: { ctrl: TerminalHostController; leaf: Leaf }) => {
  const ctrl = props.ctrl;
  const leaf = props.leaf;
  const rect = () => ctrl.layout().map.get(leaf.id) ?? { x: 0, y: 0, w: 1, h: 1 };
  const focused = () => ctrl.focusedId() === leaf.id;
  return (
    <div
      class="pf-pane"
      classList={{ "pf-pane--closing": ctrl.closing().includes(leaf.id) }}
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
          "pf-pane-frame--dragging": ctrl.dragId() === leaf.id,
        }}
        onPointerDown={() => ctrl.focus(leaf.id)}
      >
        {/* A real top bar: its own row above the terminal, never an
            overlay — the shell prompt below it is never covered. The
            whole bar is the drag handle for rearranging panes. */}
        <PaneBar ctrl={ctrl} leaf={leaf} focused={focused} />

        <div class="pf-pane-inner">
          <PaneTerminal ctrl={ctrl} leaf={leaf} />
        </div>
      </div>
    </div>
  );
};

export function TerminalHost(props: TerminalHostProps) {
  const ctrl = createTerminalHostController(props);

  return (
    <div class="pf-term-host" ref={ctrl.setContainerEl}>
      <For each={ctrl.leaves()}>
        {(leaf) => <PaneItem ctrl={ctrl} leaf={leaf} />}
      </For>

      {/* draggable seams */}
      <For each={ctrl.layout().divs}>
        {(d) => (
          <div
            class="pf-divider"
            classList={{ "pf-divider--row": d.dir === "row", "pf-divider--col": d.dir === "col" }}
            style={
              d.dir === "row"
                ? { left: pct(d.rect.x), top: pct(d.rect.y), height: pct(d.rect.h) }
                : { left: pct(d.rect.x), top: pct(d.rect.y), width: pct(d.rect.w) }
            }
            onPointerDown={(e) => ctrl.startDrag(e, d)}
          >
            <span class="pf-divider-grip" />
          </div>
        )}
      </For>

      {/* drop indicator: highlights the side/centre the dragged pane will land */}
      <Show when={ctrl.drop()}>
        {(d) => {
          const rect = () => ctrl.layout().map.get(d().id);
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

      <Show when={ctrl.askSel()}>
        {(s) => <AskAiMenu selection={s()} onClose={() => ctrl.setAskSel(null)} />}
      </Show>
    </div>
  );
}
