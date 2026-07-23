// Pure view logic for the studioUpdateDialog integration seam
// (pickforge/pickforge-platform#36): which update info the titlebar badge
// shows, and how the Settings row labels the shared controller's state. Kept
// out of App.tsx/Settings.tsx so flag-gating and label mapping are
// unit-testable without mounting the app shell.
import type { UpdateInfo, UpdateState } from "@pickforge/tauri-updater";

export interface LegacyUpdateInfo {
  version: string;
  notes?: string;
}

/** Update info surfaced in the titlebar badge, from whichever updater path is
 * active for this process. */
export function activeUpdateInfo(
  studioEnabled: boolean,
  studioState: UpdateState,
  legacyInfo: LegacyUpdateInfo | null,
): UpdateInfo | LegacyUpdateInfo | undefined {
  if (studioEnabled) {
    return "update" in studioState ? studioState.update : undefined;
  }
  return legacyInfo ?? undefined;
}

/** Settings row label for the shared controller's current state. */
export function studioUpdateLabel(state: UpdateState): string {
  switch (state.status) {
    case "checking":
      return "Checking…";
    case "available":
      return `Version ${state.update.version} available`;
    case "downloading":
      return "Downloading update…";
    case "installing":
      return "Installing update…";
    case "restarting":
      return "Restarting…";
    case "error":
      return "Update check failed";
    case "dismissed":
      return state.update ? `Version ${state.update.version} available` : "You're up to date";
    case "idle":
    default:
      return "Check for the latest release";
  }
}

/** True while a manual "check for updates" click should be disabled. */
export function isStudioUpdateBusy(state: UpdateState): boolean {
  return (
    state.status === "checking"
    || state.status === "downloading"
    || state.status === "installing"
    || state.status === "restarting"
  );
}

/** Inline error text for the Settings row, when the shared controller is in a
 * retryable error state. */
export function studioUpdateErrorMessage(state: UpdateState): string | undefined {
  return state.status === "error" ? state.message : undefined;
}
