// Single shared-controller seam for the studioUpdateDialog flag path
// (pickforge/pickforge-platform#36): the startup check, the titlebar badge,
// the Settings "check for updates" action, and the mounted
// `pickforge-update-dialog` all read/drive the SAME @pickforge/tauri-updater
// controller through this store, never the legacy `src/lib/updater.ts` store.
import { createSignal } from "solid-js";
import type { UpdateController, UpdateState } from "@pickforge/tauri-updater";
import { sharedUpdateController } from "../lib/studioUpdater";

const [state, setState] = createSignal<UpdateState>({ status: "idle" });

let active: UpdateController | undefined;
let unsubscribe: (() => void) | undefined;

function controller(): UpdateController {
  if (!active) {
    active = sharedUpdateController();
    setState(active.getState());
    unsubscribe = active.subscribe(setState);
  }
  return active;
}

/** Reactive current state of the shared updater controller. */
export const studioUpdateState = state;

/** The controller currently backing this store — bound directly onto the
 * mounted `pickforge-update-dialog` element. */
export function activeUpdateController(): UpdateController {
  return controller();
}

/** Startup path: one silent, non-blocking check per process. The controller's
 * own eligibility gate defers this until the packaged app's visible, focused
 * main window is ready; feed/network failures never surface. */
export function startStudioUpdateCheck(): void {
  void controller().start();
}

/** Settings "check for updates" and any other manual re-check entry point:
 * clears a `dismissed` state and always performs a fresh check, reporting
 * failures as a retryable error instead of staying silent. */
export function checkForStudioUpdate(): void {
  void controller().check({ manual: true });
}

/** Test/VRT injection seam — swaps the controller this store reads from.
 * Never called from a production code path; only from test setup and the
 * VRT-only fixture installer (mirrors `installTauriMock`). */
export function overrideSharedUpdateController(next: UpdateController | undefined): void {
  unsubscribe?.();
  unsubscribe = undefined;
  active = next;
  if (next) {
    setState(next.getState());
    unsubscribe = next.subscribe(setState);
  } else {
    setState({ status: "idle" });
  }
}
