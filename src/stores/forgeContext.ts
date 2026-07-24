// PickForge context writer for pi-kit sessions (#299, #274 slice 4): the
// reverse direction of pikitLanes.ts — instead of PickForge reading pi-kit's
// status files, this writes `<dataDir>/context.json` so a Pi session can
// read PickForge's active project (see pi-kit's `/forge` command and
// `forge_context` tool). Path/identity only — the project root, the last
// file opened in it, and its display name. NEVER file contents or secrets.
//
// Default-off behind the `pikitContext` flag; both ends must opt in (this
// flag here, the extension installed in Pi) before anything crosses, mirroring
// the consent model in #274. Debounced so a burst of project/file switches
// collapses into one write.
import { createEffect, createRoot, createSignal } from "solid-js";
import { clearForgeContext, writeForgeContext } from "../lib/process";
import { flagEnabled } from "./flags";
import { activeProject, workspace } from "./workspace";

const DEBOUNCE_MS = 750;

interface OpenedFile {
  root: string;
  path: string;
}

// Transient, session-only — never persisted. Keyed to the root it was opened
// in so a stale path from a project the user has since switched away from
// never gets attributed to the new active root.
const [lastOpened, setLastOpenedInternal] = createSignal<OpenedFile | null>(null);

/** Records the path of a file just opened in `root` (the project it belongs
 * to). Call from the Workbench's file-open seam. Path only — never contents. */
export function noteFileOpened(root: string, path: string): void {
  setLastOpenedInternal({ root, path });
}

// Serializes the actual write_forge_context/clear_forge_context IPC calls:
// each enqueued call awaits the previous one's settlement before firing.
// Without this, a slow write's promise resolving AFTER a later clear's
// promise would recreate context.json right after the user opted out or
// closed the project — the debounce alone only dedupes SCHEDULING, not the
// in-flight IPC calls it eventually fires.
let ipcQueue: Promise<void> = Promise.resolve();

function enqueueIpc(action: () => Promise<void>): void {
  ipcQueue = ipcQueue.then(action);
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
// The IPC action a debounce cycle currently has armed, but ONLY when it's a
// clear — set so bootstrap disposal can flush it immediately instead of
// silently dropping it (a dropped clear right before teardown, e.g. the
// project closing as the app quits, would leave context.json behind). A
// pending WRITE is intentionally left unset here: disposal cancels it.
let pendingClear: (() => void) | undefined;

function scheduleWrite(action: () => void): void {
  if (debounceTimer !== undefined) clearTimeout(debounceTimer);
  pendingClear = undefined;
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    action();
  }, DEBOUNCE_MS);
}

function scheduleClear(action: () => void): void {
  if (debounceTimer !== undefined) clearTimeout(debounceTimer);
  pendingClear = action;
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    pendingClear = undefined;
    action();
  }, DEBOUNCE_MS);
}

function writeContextFor(root: string): void {
  const opened = lastOpened();
  const lastOpenedFile = opened && opened.root === root ? opened.path : null;
  const displayName = activeProject()?.displayName ?? null;
  scheduleWrite(() => {
    enqueueIpc(() =>
      writeForgeContext(root, lastOpenedFile, displayName).catch((error) => {
        console.error("[pickforge] write_forge_context failed", error);
      }),
    );
  });
}

function clearContext(): void {
  scheduleClear(() => {
    enqueueIpc(() =>
      clearForgeContext().catch((error) => {
        console.error("[pickforge] clear_forge_context failed", error);
      }),
    );
  });
}

let bootstrapDisposed: (() => void) | null = null;

/** Wires the reactive write/clear effect: fires on active-project changes,
 * last-opened-file changes, and flag flips (`flagEnabled` is itself
 * reactive over the flags module's version signal). Safe to call once at app
 * start; returns a disposer. */
export function installForgeContextBootstrap(): () => void {
  if (bootstrapDisposed) return bootstrapDisposed;

  let disposeRoot = () => {};
  createRoot((dispose) => {
    disposeRoot = dispose;
    createEffect(() => {
      const root = workspace.activeRoot;
      if (!flagEnabled("pikitContext") || !root) {
        clearContext();
        return;
      }
      writeContextFor(root);
    });
  });

  bootstrapDisposed = () => {
    disposeRoot();
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    // A pending clear must still happen — dropping it would leave a stale
    // context.json behind. A pending write is cancelled: it's fine (and
    // safer) for a write to simply not happen on teardown.
    if (pendingClear) {
      const clear = pendingClear;
      pendingClear = undefined;
      clear();
    }
    bootstrapDisposed = null;
  };
  return bootstrapDisposed;
}
