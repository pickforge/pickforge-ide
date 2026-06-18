// VS Code-style interface zoom. Native Wayland reports scale 1 on an unscaled
// HiDPI display, so WebKitGTK rasterizes text coarsely; bumping the webview
// zoom raises the effective device-pixel-ratio and re-rasterizes everything
// (UI + terminal) crisply. Ctrl/Cmd +/-/0, 0.25 steps, persisted.
import { createSignal } from "solid-js";

const KEY = "pickforge.zoom";
const MIN = 0.5;
const MAX = 3;
const STEP = 0.25;

function clampStep(z: number): number {
  const snapped = Math.round(z / STEP) * STEP;
  return Math.min(MAX, Math.max(MIN, snapped));
}

function load(): number {
  const v = parseFloat(localStorage.getItem(KEY) ?? "1");
  return Number.isFinite(v) ? clampStep(v) : 1;
}

const [zoom, setZoom] = createSignal(load());
/** Reactive current zoom factor (1 = 100%). */
export const currentZoom = zoom;

function inTauri(): boolean {
  return typeof window !== "undefined" &&
    !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

async function applyToWebview(z: number): Promise<void> {
  if (!inTauri()) return;
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(z);
  } catch (err) {
    // Plain-browser / VRT mock has no real webview — ignore.
    console.debug("[pickforge] setZoom unavailable", err);
  }
}

function commit(z: number): void {
  const c = clampStep(z);
  setZoom(c);
  localStorage.setItem(KEY, String(c));
  void applyToWebview(c);
}

export function zoomIn(): void {
  commit(zoom() + STEP);
}
export function zoomOut(): void {
  commit(zoom() - STEP);
}
export function zoomReset(): void {
  commit(1);
}

/** Re-apply the persisted zoom to the webview (call once the app is mounted). */
export function applyPersistedZoom(): void {
  void applyToWebview(zoom());
}

/** True if a keydown is a zoom shortcut; performs the zoom and returns true. */
export function handleZoomKey(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  switch (e.key) {
    case "=":
    case "+":
      zoomIn();
      return true;
    case "-":
    case "_":
      zoomOut();
      return true;
    case "0":
      zoomReset();
      return true;
    default:
      return false;
  }
}
