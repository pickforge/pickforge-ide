import { For } from "solid-js";
import { hostPlatform, isTauri } from "../lib/platform";

// A frameless window (decorations: false) loses the OS resize border and its
// resize cursors. These thin edge + corner zones restore the affordance: each
// shows the matching resize cursor and starts a native resize-drag on press,
// so the window resizes exactly like a decorated one. Rendered only under Tauri,
// and never on macOS — the window is decorated there and resizes natively.
const HANDLES = [
  { dir: "North", cls: "n" },
  { dir: "South", cls: "s" },
  { dir: "East", cls: "e" },
  { dir: "West", cls: "w" },
  { dir: "NorthWest", cls: "nw" },
  { dir: "NorthEast", cls: "ne" },
  { dir: "SouthWest", cls: "sw" },
  { dir: "SouthEast", cls: "se" },
] as const;

export function ResizeHandles() {
  if (!isTauri() || hostPlatform() === "macos") return null;

  const start = (dir: string) => async (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startResizeDragging(dir as never);
    } catch {
      /* not in Tauri / permission denied — no-op */
    }
  };

  return (
    <For each={HANDLES}>
      {(h) => <div class={`pf-resize pf-resize--${h.cls}`} onMouseDown={start(h.dir)} />}
    </For>
  );
}
