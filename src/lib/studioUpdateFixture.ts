// VRT-only fixture for the studioUpdateDialog controller
// (pickforge/pickforge-platform#36). Mirrors `installTauriMock`: when
// VITE_PICKFORGE_VRT=1, swaps the shared updater store's controller for a
// static fixture so `pickforge-update-dialog` renders a deterministic state
// for screenshots, bypassing the packaged-build/window-eligibility gate. Only
// reachable from the VITE_PICKFORGE_VRT branch in index.tsx — dead code (and
// unused) in the shipped app.
import type { UpdateController, UpdateState } from "@pickforge/tauri-updater";
import { overrideSharedUpdateController } from "../stores/studioUpdate";

const FIXTURE_KEY = "pickforge.vrt.updateFixture";

const FIXTURES: Record<string, UpdateState> = {
  available: {
    status: "available",
    update: {
      version: "0.2.0",
      notes: [
        "- Faster device pairing over Tailscale",
        "- Fixed a terminal focus glitch after detaching a pane",
        "- Smaller installer size on all platforms",
      ].join("\n"),
    },
  },
  downloading: {
    status: "downloading",
    update: { version: "0.2.0" },
    progress: { downloaded: 42_000_000, contentLength: 96_000_000, percent: 44 },
  },
};

function readFixtureName(): string | null {
  try {
    return localStorage.getItem(FIXTURE_KEY);
  } catch {
    return null;
  }
}

function fixtureController(state: UpdateState): UpdateController {
  return {
    getState: () => state,
    start: () => Promise.resolve(),
    check: () => Promise.resolve(),
    install: () => Promise.resolve(),
    retry: () => Promise.resolve(),
    dismiss: () => {},
    subscribe: () => () => {},
  };
}

export function installStudioUpdateFixture(): void {
  const name = readFixtureName();
  const state = name ? FIXTURES[name] : undefined;
  if (!state) return;
  overrideSharedUpdateController(fixtureController(state));
}
