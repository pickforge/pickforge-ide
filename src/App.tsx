import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { navigate, route, type Route } from "./router";
import { loadWorkspace, workspace } from "./stores/workspace";
import { applyPersistedZoom, currentZoom, handleZoomKey, zoomReset } from "./lib/zoom";
import { appVersion, loadAppVersion } from "./lib/appInfo";
import { initTheme } from "./stores/theme";
import { checkForUpdate, updateAvailable } from "./lib/updater";
import { MonoEyebrow, StatusPill } from "./components/ui";
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

export function App() {
  const [, setReady] = createSignal(false);

  onMount(() => {
    initTheme();

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

    void loadAppVersion();
    void checkForUpdate(true);

    void (async () => {
      await loadWorkspace();
      const dismissed = localStorage.getItem("pickforge.onboardingDismissed") === "true";
      if (workspace.projects.length === 0 && !dismissed && route() === "workbench") {
        navigate("onboarding");
      }
      setReady(true);
    })();
  });

  return (
    <div class="pf-app">
      <header class="pf-header">
        <div class="pf-brand">
          <span class="pf-mark" />
          <span class="pf-wordmark">PickForge</span>
          <MonoEyebrow text={`v${appVersion()}`} />
          <Show when={updateAvailable()}>
            <button
              class="pf-update-badge"
              title={`Update available: v${updateAvailable()!.version}`}
              onClick={() => navigate("settings")}
            >
              <span class="pf-update-dot" /> Update
            </button>
          </Show>
        </div>
        <nav class="pf-nav">
          <For each={NAV}>
            {(n) => (
              <button
                class="pf-nav-btn"
                classList={{ active: route() === n.route }}
                onClick={() => navigate(n.route)}
              >
                {n.label}
              </button>
            )}
          </For>
        </nav>
        <StatusPill
          label={workspace.activeRoot ? "shell · live" : "no project"}
          intent={workspace.activeRoot ? "live" : "neutral"}
          pulsing={!!workspace.activeRoot}
        />
      </header>

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

      <footer class="pf-statusbar">
        <span class="pf-statusbar-item">
          {workspace.activeRoot ? statusBasename(workspace.activeRoot) : "no project"}
        </span>
        <button class="pf-statusbar-zoom" title="Reset interface zoom" onClick={zoomReset}>
          {Math.round(currentZoom() * 100)}%
        </button>
      </footer>
    </div>
  );
}

function statusBasename(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || path;
}
