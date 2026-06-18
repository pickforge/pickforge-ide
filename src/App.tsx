import { createSignal, For, Match, onMount, Switch } from "solid-js";
import { navigate, route, type Route } from "./router";
import { loadWorkspace, workspace } from "./stores/workspace";
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

  onMount(async () => {
    if (localStorage.getItem("pickforge.theme") === "light") {
      document.documentElement.dataset.theme = "light";
    }
    await loadWorkspace();
    const dismissed = localStorage.getItem("pickforge.onboardingDismissed") === "true";
    if (workspace.projects.length === 0 && !dismissed && route() === "workbench") {
      navigate("onboarding");
    }
    setReady(true);
  });

  return (
    <div class="pf-app">
      <header class="pf-header">
        <div class="pf-brand">
          <span class="pf-mark" />
          <span class="pf-wordmark">PickForge</span>
          <MonoEyebrow text="Tauri" />
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
            <OnboardingScreen />
          </Match>
          <Match when={route() === "history"}>
            <HistoryScreen />
          </Match>
          <Match when={route() === "run-history"}>
            <RunHistoryScreen />
          </Match>
          <Match when={route() === "settings"}>
            <SettingsScreen />
          </Match>
        </Switch>
      </div>
    </div>
  );
}
