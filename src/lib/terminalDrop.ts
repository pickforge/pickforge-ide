// OS file/image drag-and-drop INTO registered targets. In Tauri v2 the
// webview INTERCEPTS native file drops — they never reach HTML drop handlers —
// so we subscribe to Tauri's own drag-drop event, which gives us the dropped
// file PATHS plus the drop POSITION (physical pixels). We hit-test that point
// against every live target, with last-registered wins on overlap.
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { shquote } from "./runTargets";

/** A terminal pane that can receive a dropped path. Registered on mount. */
interface TerminalDropTarget {
  /** The pane's terminal element — used to hit-test the drop position. */
  el: HTMLElement;
  /** Write text into this pane's pty (no newline). If the pty hasn't spawned
   *  yet the pane buffers the text and flushes it on spawn, so an early drop is
   *  never lost. Returns false only if the pane can't accept the drop at all. */
  write: (text: string) => boolean;
  /** Toggle the subtle drop-highlight while a drag hovers this pane. */
  setHover: (on: boolean) => void;
}

interface PathDropTarget {
  el: HTMLElement;
  onPaths: (paths: string[]) => void;
  setHover: (on: boolean) => void;
}

type DropTarget = TerminalDropTarget | PathDropTarget;

const targets = new Set<DropTarget>();
let unlisten: Promise<UnlistenFn[]> | null = null;

/** Quote a dropped path for the shell, leaving bare paths (only safe chars)
 *  unquoted so the common case reads cleanly at the prompt, and single-quoting
 *  anything with spaces / globs / `$` etc. via the shared `shquote`. */
export function shellQuotePath(p: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(p) ? p : shquote(p);
}

/** Join dropped paths into one shell-safe, space-separated string. */
export function quotePaths(paths: string[]): string {
  return paths.map(shellQuotePath).join(" ");
}

/** Is the point inside the element's on-screen box, and is the element actually
 *  visible (a hidden host's panes report a zero-area rect)? */
function hitTarget(t: DropTarget, x: number, y: number): boolean {
  const r = t.el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** Tauri's drag-drop position is in PHYSICAL pixels; getBoundingClientRect is in
 *  CSS pixels. Convert by the device pixel ratio (webview zoom raises it). */
function toCssPoint(pos: { x: number; y: number }): { x: number; y: number } {
  const dpr = window.devicePixelRatio || 1;
  return { x: pos.x / dpr, y: pos.y / dpr };
}

/** The frontmost target under the point — last-registered wins on overlap, which
 *  maps to the topmost stacking target in practice (hidden hosts score no hit). */
function targetAt(x: number, y: number): DropTarget | null {
  let found: DropTarget | null = null;
  for (const t of targets) if (hitTarget(t, x, y)) found = t;
  return found;
}

function clearHover(): void {
  for (const t of targets) t.setHover(false);
}

/** Start the one shared Tauri drag-drop subscription (idempotent). The `drop`
 *  event carries `{ paths, position }`; `drag-over` carries a moving `position`
 *  we use to light the hovered pane; `drag-leave` clears it. */
function ensureListener(): void {
  if (unlisten) return;
  unlisten = Promise.all([
    listen<{ paths?: string[]; position?: { x: number; y: number } }>(
      "tauri://drag-drop",
      (e) => {
        const { paths, position } = e.payload;
        clearHover();
        if (!paths?.length || !position) return;
        const { x, y } = toCssPoint(position);
        const target = targetAt(x, y);
        if (!target) return;
        if ("onPaths" in target) {
          target.onPaths(paths);
        } else {
          target.write(quotePaths(paths));
        }
      },
    ),
    listen<{ position?: { x: number; y: number } }>("tauri://drag-over", (e) => {
      const pos = e.payload.position;
      if (!pos) return;
      const { x, y } = toCssPoint(pos);
      const target = targetAt(x, y);
      for (const t of targets) t.setHover(t === target);
    }),
    listen("tauri://drag-leave", clearHover),
  ]).catch((err) => {
    // Plain-browser / VRT mock has no Tauri event bus — drag-drop is a no-op.
    console.debug("[pickforge] native drag-drop unavailable", err);
    return [];
  });
}

/** Register a terminal pane as a drop target. Call on mount; the returned
 *  function unregisters it on unmount (no leak). The shared Tauri listener
 *  starts on the first registration and simply idles once all panes are gone. */
export function registerDropTarget(t: TerminalDropTarget): () => void {
  targets.add(t);
  ensureListener();
  return () => {
    targets.delete(t);
  };
}

export function registerPathDropTarget(t: PathDropTarget): () => void {
  targets.add(t);
  ensureListener();
  return () => {
    targets.delete(t);
  };
}
