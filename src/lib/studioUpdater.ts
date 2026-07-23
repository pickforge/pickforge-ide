// Production wiring for @pickforge/tauri-updater (pickforge/pickforge-platform#36):
// the real Tauri adapter and the eligibility gate that defers the startup
// check until the packaged app's visible, focused main window is ready.
// Pure controller assembly lives in `createStudioUpdateController` so tests
// can inject fake adapters/eligibility without touching Tauri or the DOM.
import {
  createTauriUpdaterAdapter,
  createUpdateController,
  type UpdateAdapter,
  type UpdateController,
  type UpdateEligibility,
} from "@pickforge/tauri-updater";
import { isTauri } from "./platform";

export interface StudioUpdaterDeps {
  adapter: UpdateAdapter;
  eligibility: UpdateEligibility;
}

/** Assembles the controller from injected deps — the seam unit tests drive
 * directly with deterministic fakes. */
export function createStudioUpdateController(deps: StudioUpdaterDeps): UpdateController {
  return createUpdateController({ adapter: deps.adapter, eligibility: deps.eligibility });
}

/** True only for a packaged build running inside the Tauri runtime — never in
 * `tauri dev`, plain-browser VRT, or unit tests. Startup checks are
 * packaged-build-only per the design contract. */
export function isPackagedTauriBuild(): boolean {
  return isTauri() && import.meta.env.PROD;
}

/** Resolves once the packaged app's "main" window is visible and focused, so
 * the startup check never fires during a hidden window flash, a dev build, or
 * a secondary window. PickForge has one always-shown window (no hidden
 * login-start/tray flow), so this reduces to waiting for that window's own
 * visible+focused signal. */
export function createMainWindowEligibility(): UpdateEligibility {
  return {
    async whenEligible() {
      if (!isPackagedTauriBuild()) return false;
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        if (win.label !== "main") return false;
        if ((await win.isVisible()) && (await win.isFocused())) return true;
        return await new Promise<boolean>((resolve) => {
          let settled = false;
          let unlisten: (() => void) | undefined;
          const finish = (value: boolean) => {
            if (settled) return;
            settled = true;
            unlisten?.();
            resolve(value);
          };
          void win
            .onFocusChanged(({ payload: focused }) => {
              if (!focused) return;
              // A transient IPC failure here shouldn't forfeit the whole wait
              // — swallow it and keep listening for the next focus event.
              void win
                .isVisible()
                .then((visible) => {
                  if (visible) finish(true);
                })
                .catch(() => {});
            })
            .then((un) => {
              unlisten = un;
              // The window may have become visible/focused while the listener
              // was being registered. Same swallow-and-keep-waiting rule: a
              // transient query failure here must not finish(false) — a later
              // focus event can still resolve this eligibility check.
              void Promise.all([win.isVisible(), win.isFocused()])
                .then(([visible, focused]) => {
                  if (visible && focused) finish(true);
                })
                .catch(() => {});
            })
            .catch(() => finish(false));
        });
      } catch {
        return false;
      }
    },
  };
}

function productionAdapter(): UpdateAdapter {
  return createTauriUpdaterAdapter({
    check: async () => {
      const { check } = await import("@tauri-apps/plugin-updater");
      return check();
    },
    relaunch: async () => {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      return relaunch();
    },
  });
}

let productionController: UpdateController | undefined;

/** Lazily builds (once per process) the controller wired to the real Tauri
 * updater/process plugins and the main-window eligibility gate. */
export function sharedUpdateController(): UpdateController {
  if (!productionController) {
    productionController = createStudioUpdateController({
      adapter: productionAdapter(),
      eligibility: createMainWindowEligibility(),
    });
  }
  return productionController;
}
