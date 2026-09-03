import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { navigate, navigateSettingsSection, route, type Route } from "./router";
import { loadWorkspace, refreshFromDb, workspace } from "./stores/workspace";
import { applyPersistedZoom, currentZoom, handleZoomKey, zoomReset } from "./lib/zoom";
import { appVersion, loadAppVersion } from "./lib/appInfo";
import { initTheme } from "./stores/theme";
import { checkForUpdate, updateAvailable } from "./lib/updater";
import { startStudioUpdateCheck, studioUpdateState } from "./stores/studioUpdate";
import { activeUpdateInfo } from "./lib/studioUpdateView";
import { StudioUpdateDialog } from "./components/StudioUpdateDialog";
import { RetirementNotice } from "./components/RetirementNotice";
import { MonoEyebrow, StatusPill } from "./components/ui";
import { WindowControls } from "./components/WindowControls";
import { ResizeHandles } from "./components/ResizeHandles";
import { resolvedControlsSide } from "./stores/windowControls";
import { hostPlatform } from "./lib/platform";
import { IconChevronRight, IconTerminal } from "./components/icons";
import { layout, toggleDock } from "./stores/workbenchLayout";
import { runConsole, toggleConsole } from "./stores/runConsole";
import { startSwarmBridge } from "./stores/swarm";
import { installAccountStoreBootstrap } from "./stores/account";
import { installCreditsBootstrap } from "./stores/credits";
import { installForgeContextBootstrap } from "./stores/forgeContext";
import { installSettingsSyncBootstrap } from "./stores/settingsSyncStore";
import {
  handleTitlebarMouseDown,
  handleTitlebarMouseMove,
  handleTitlebarMouseUp,
} from "./lib/windowChrome";
import {
  ensureOmpNativeCompatibility,
  ensurePiNativeCompatibility,
} from "./lib/agentModels";
import { flagEnabled, subscribeToFlagChanges } from "./stores/flags";
import { WorkbenchScreen } from "./screens/workbench/Workbench";
import { OnboardingScreen } from "./screens/Onboarding";
import { SettingsScreen } from "./screens/Settings";
import { HistoryScreen } from "./screens/History";
import { RunHistoryScreen } from "./screens/RunHistory";
import "./App.css";

const NAV: { route: Route; label: string }[] = [
  { route: "workbench", label: "Workbench" },
  { route: "history", label: "History" },
  { route: "run-history", label: "Runs" },
  { route: "settings", label: "Settings" },
];

const WINDOW_RESIZING_SETTLE_MS = 180;

/** The wordmark + version + dev badge + update badge, shown on whichever
 *  side of the titlebar the platform's own window controls aren't. A
 *  presentational component — everything it reads is module-scope state. */
function AppBrand() {
  return (
    <div class="pf-brand">
      <span class="pf-mark" />
      <span class="pf-wordmark">PickForge</span>
      <MonoEyebrow text={`v${appVersion()}`} />
      <Show when={import.meta.env.DEV}>
        <span class="pf-dev-badge" title="Development build — running via tauri dev">
          Dev
        </span>
      </Show>
      <Show
        when={activeUpdateInfo(
          flagEnabled("studioUpdateDialog"),
          studioUpdateState(),
          updateAvailable(),
        )}
      >
        {(info) => (
          <button
            class="pf-update-badge"
            title={`Update available: v${info().version}`}
            onClick={() => navigateSettingsSection("updates")}
          >
            <span class="pf-update-dot" /> Update
          </button>
        )}
      </Show>
    </div>
  );
}

/** The draggable titlebar: window controls, brand, and route nav. A
 *  presentational component — `brandOnRight` is the only value not already
 *  module-scope state. */
function AppTitlebar(props: { brandOnRight: () => boolean }) {
  return (
    <header
      class="pf-titlebar"
      classList={{
        "pf-titlebar--controls-left": resolvedControlsSide() === "left",
        "pf-titlebar--brand-right": props.brandOnRight(),
      }}
      onMouseDown={handleTitlebarMouseDown}
      onMouseMove={handleTitlebarMouseMove}
    >
      <div class="pf-titlebar-left">
        <Show when={resolvedControlsSide() === "left"}>
          <WindowControls />
        </Show>
        <Show when={!props.brandOnRight()}>
          <AppBrand />
        </Show>
      </div>
      <nav class="pf-nav">
        <For each={NAV}>
          {(n) => (
            <button
              class="pf-nav-btn"
              data-tour={n.route === "settings" ? "settings" : undefined}
              classList={{ active: route() === n.route }}
              onClick={() => navigate(n.route)}
            >
              {n.label}
            </button>
          )}
        </For>
      </nav>
      <div class="pf-titlebar-right">
        <StatusPill
          compact
          label={workspace.activeRoot ? "shell · live" : "no project"}
          intent={workspace.activeRoot ? "connected" : "neutral"}
        />
        <Show when={props.brandOnRight()}>
          <AppBrand />
        </Show>
        <Show when={resolvedControlsSide() === "right"}>
          <WindowControls />
        </Show>
      </div>
    </header>
  );
}

/** The footer: project basename, dock toggles, console toggle, zoom reset. A
 *  presentational component — everything it reads is module-scope state. */
function AppStatusBar() {
  return (
    <footer class="pf-statusbar">
      <div class="pf-statusbar-left">
        <Show when={route() === "workbench"}>
          <button
            class="pf-statusbar-dock"
            classList={{ active: layout().leftVisible }}
            title={layout().leftVisible ? "Hide left panel" : "Show left panel"}
            onClick={() => toggleDock("left")}
          >
            <IconChevronRight size={11} class={layout().leftVisible ? "pf-flip-x" : ""} />
          </button>
        </Show>
        <span class="pf-statusbar-item">
          {workspace.activeRoot ? statusBasename(workspace.activeRoot) : "no project"}
        </span>
      </div>
      <div class="pf-statusbar-right">
        <Show when={route() === "workbench"}>
          <button
            class="pf-statusbar-console"
            classList={{ active: runConsole.open() }}
            title={runConsole.open() ? "Hide debug console" : "Show debug console"}
            onClick={toggleConsole}
          >
            <IconTerminal size={11} /> Console
          </button>
        </Show>
        <button class="pf-statusbar-zoom" title="Reset interface zoom" onClick={zoomReset}>
          {Math.round(currentZoom() * 100)}%
        </button>
        <Show when={route() === "workbench"}>
          <button
            class="pf-statusbar-dock"
            classList={{ active: layout().rightVisible }}
            title={layout().rightVisible ? "Hide right panel" : "Show right panel"}
            onClick={() => toggleDock("right")}
          >
            <IconChevronRight size={11} class={layout().rightVisible ? "" : "pf-flip-x"} />
          </button>
        </Show>
      </div>
    </footer>
  );
}

/** Every imperative one-time bootstrap glued to app mount: theme, titlebar
 *  drag, zoom hotkeys, window-resize class toggling, version/update checks,
 *  the swarm/settings-sync/credits/forge-context bootstraps, cross-window DB
 *  refresh on focus, and initial workspace load + onboarding redirect. A
 *  composable, called synchronously from `App`'s own setup so its `onMount`/
 *  `onCleanup` calls run under the same reactive owner as if written inline. */
function useAppBootstrap(setReady: (v: boolean) => void): void {
  onMount(() => {
    initTheme();
    window.addEventListener("mouseup", handleTitlebarMouseUp, true);
    onCleanup(() => window.removeEventListener("mouseup", handleTitlebarMouseUp, true));

    // Interface zoom (VS Code-style): apply persisted level + global hotkeys.
    // Registered synchronously so cleanup binds before the async bootstrap.
    applyPersistedZoom();
    const onZoom = (e: KeyboardEvent) => {
      if (handleZoomKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onZoom, true);
    onCleanup(() => window.removeEventListener("keydown", onZoom, true));

    let resizeSettleTimer: ReturnType<typeof setTimeout> | undefined;
    let unlistenResize: (() => void) | undefined;
    const markWindowResizing = () => {
      document.body.classList.add("pf-window-resizing");
      if (resizeSettleTimer) clearTimeout(resizeSettleTimer);
      resizeSettleTimer = setTimeout(() => {
        document.body.classList.remove("pf-window-resizing");
        resizeSettleTimer = undefined;
      }, WINDOW_RESIZING_SETTLE_MS);
    };
    window.addEventListener("resize", markWindowResizing);
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        unlistenResize = await getCurrentWindow().onResized(markWindowResizing);
      } catch {
        /* plain browser/VRT fallback uses the DOM resize event */
      }
    })();
    onCleanup(() => {
      window.removeEventListener("resize", markWindowResizing);
      unlistenResize?.();
      if (resizeSettleTimer) clearTimeout(resizeSettleTimer);
      document.body.classList.remove("pf-window-resizing");
    });

    void loadAppVersion();
    if (flagEnabled("studioUpdateDialog")) {
      startStudioUpdateCheck();
    } else {
      void checkForUpdate(true);
    }
    startSwarmBridge();
    onCleanup(installSettingsSyncBootstrap());
    onCleanup(installCreditsBootstrap());
    onCleanup(installForgeContextBootstrap());

    // Dev + release share one DB (~/.pickforge/pickforge.db); re-read it whenever
    // this window regains focus so the other instance's chat/project edits don't
    // sit stale here. Falls back to the DOM focus event outside Tauri (VRT).
    let unlistenFocus: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused) void refreshFromDb();
        });
      } catch {
        const onFocus = () => void refreshFromDb();
        window.addEventListener("focus", onFocus);
        unlistenFocus = () => window.removeEventListener("focus", onFocus);
      }
    })();
    onCleanup(() => unlistenFocus?.());

    void (async () => {
      await loadWorkspace();
      const dismissed = localStorage.getItem("pickforge.onboardingDismissed") === "true";
      if (workspace.projects.length === 0 && !dismissed && route() === "workbench") {
        navigate("onboarding");
      }
      setReady(true);
    })();
  });
}

export function App() {
  const [, setReady] = createSignal(false);
  installAccountStoreBootstrap();
  const probeNativeCompatibility = () => {
    if (flagEnabled("ompAgents")) void ensureOmpNativeCompatibility(true);
    void ensurePiNativeCompatibility(true);
  };
  probeNativeCompatibility();
  onCleanup(subscribeToFlagChanges(probeNativeCompatibility));
  // macOS convention: window controls sit top-left, so the brand moves to the
  // top-right to balance the bar (matches the platform's own app chrome).
  const brandOnRight = () => hostPlatform() === "macos";

  useAppBootstrap(setReady);

  return (
    <div class="pf-app">
      <ResizeHandles />
      <Show when={flagEnabled("studioUpdateDialog")}>
        <StudioUpdateDialog />
      </Show>
      {/* Drag starts only after the pointer moves so the second primary press
          remains available to toggle maximize before Tauri takes over. */}
      <AppTitlebar brandOnRight={brandOnRight} />
      <RetirementNotice />

      <div class="pf-body">
        {/* Workbench stays mounted (display toggled) so its terminals/shells
            survive navigation to other routes. */}
        <div style={{ display: route() === "workbench" ? "block" : "none" }}>
          <WorkbenchScreen />
        </div>
        <Switch>
          <Match when={route() === "onboarding"}>
            <div class="pf-route pf-reveal"><OnboardingScreen /></div>
          </Match>
          <Match when={route() === "history"}>
            <div class="pf-route pf-reveal"><HistoryScreen /></div>
          </Match>
          <Match when={route() === "run-history"}>
            <div class="pf-route pf-reveal"><RunHistoryScreen /></div>
          </Match>
          <Match when={route() === "settings"}>
            <div class="pf-route pf-reveal"><SettingsScreen /></div>
          </Match>
        </Switch>
      </div>

      <AppStatusBar />
    </div>
  );
}

function statusBasename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || path;
}
