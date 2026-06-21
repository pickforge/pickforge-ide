// Bottom Debug Console: a dedicated run terminal + session controls, docked at
// the foot of the workbench. Opens on Run and stays mounted (height-toggled, not
// unmounted) so a running process survives collapsing the panel or navigating
// away. The Run controls drive THIS terminal's pty, never the user's shell.
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { TerminalPane } from "../../components/Terminal";
import { LogcatView } from "../../components/LogcatView";
import { AskAiMenu } from "../../components/AskAiMenu";
import { RunLauncher } from "./RunLauncher";
import {
  ForgeEmptyState,
  StatusPill,
  type StatusIntent,
} from "../../components/ui";
import {
  IconClear,
  IconClose,
  IconPlay,
  IconRefresh,
  IconRestart,
  IconStop,
  IconTerminal,
} from "../../components/icons";
import {
  attachConsole,
  clearConsole,
  closeConsole,
  consoleExited,
  detachConsole,
  reloadRun,
  restartRun,
  runConsole,
  syncAutoReloadWatch,
  setConsoleHeight,
  stopRun,
  type RunStatus,
} from "../../stores/runConsole";
import { activeTarget, hasRunTargets } from "../../stores/runTargets";
import { isLogcatTarget } from "../../lib/runTargets";
import { autoReloadEnabled, toggleAutoReload } from "../../stores/autoReload";
import { isBooting, launchActiveTarget, launchError } from "../../stores/runLaunch";
import { workbenchPrefs } from "../../stores/workbenchPrefs";
import { ingestRunOutput } from "../../stores/vmService";

const STATUS: Record<RunStatus, { label: string; intent: StatusIntent; pulse?: boolean }> = {
  idle: { label: "idle", intent: "neutral" },
  running: { label: "running", intent: "live", pulse: true },
  stopped: { label: "stopped", intent: "warning" },
};

export function DebugConsole() {
  const target = runConsole.target;
  const status = runConsole.status;
  const meta = () => STATUS[status()];
  const can = (c: string) => !!target()?.capabilities.includes(c);
  const isRunning = () => status() === "running";
  const [askSel, setAskSel] = createSignal<{ text: string; x: number; y: number } | null>(null);

  // Console | Logs switch — Logs only exists for RN / native-Android targets,
  // whose device logs live in `adb logcat`, not the run PTY. The running target
  // wins (it's what's on the device); else the selected launcher target.
  const [view, setView] = createSignal<"console" | "logs">("console");
  const logcatCapable = () =>
    isLogcatTarget(isRunning() ? target() : activeTarget());
  // Fall back to the console whenever Logs isn't available (e.g. target switched
  // to Flutter), so the body never shows a Logs view for an unsupported target.
  createEffect(() => {
    if (view() === "logs" && !logcatCapable()) setView("console");
  });

  onCleanup(detachConsole);

  // Drag the top edge to resize the panel height (mirror of the dock resizer).
  const startResize = (e: PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = runConsole.height();
    document.body.classList.add("pf-resizing");
    const onMove = (ev: PointerEvent) => setConsoleHeight(startH + (startY - ev.clientY));
    const end = () => {
      document.body.classList.remove("pf-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
  };

  return (
    <section class="pf-debug-console" style={{ height: `${runConsole.height()}px` }}>
      <div class="pf-dc-resizer" title="Drag to resize" onPointerDown={startResize}>
        <span class="pf-dc-resizer-grip" />
      </div>
      <header class="pf-dc-head">
        <RunLauncher />
        <Show when={logcatCapable()}>
          <div class="pf-dc-tabs" role="tablist">
            <button
              class="pf-dc-tab"
              classList={{ "pf-dc-tab--on": view() === "console" }}
              role="tab"
              aria-selected={view() === "console"}
              onClick={() => setView("console")}
            >
              Console
            </button>
            <button
              class="pf-dc-tab"
              classList={{ "pf-dc-tab--on": view() === "logs" }}
              role="tab"
              aria-selected={view() === "logs"}
              onClick={() => setView("logs")}
            >
              Logs
            </button>
          </div>
        </Show>
        <Show when={isBooting()}>
          <span class="pf-run-booting">booting…</span>
        </Show>
        <Show when={!isBooting() && launchError()}>
          <span class="pf-run-error" title={launchError()!}>{launchError()}</span>
        </Show>
        <StatusPill label={meta().label} intent={meta().intent} pulsing={meta().pulse} />
        <span class="pf-dc-spacer" />
        {/* The actual Run, grouped with the transport controls to its right. */}
        <button
          class="pf-dc-btn pf-dc-btn--run"
          classList={{ "pf-dc-btn--labeled": workbenchPrefs().runButtonLabels }}
          title={isBooting() ? "Booting emulator…" : isRunning() ? "A run is active — stop it first" : "Run"}
          disabled={!hasRunTargets() || isRunning() || isBooting()}
          onClick={() => void launchActiveTarget()}
        >
          <IconPlay size={12} />
          <Show when={workbenchPrefs().runButtonLabels}>Run</Show>
        </button>
        <Show when={can("hotReload")}>
          <button
            class="pf-dc-auto"
            classList={{ "pf-dc-auto--on": autoReloadEnabled() }}
            title={
              autoReloadEnabled()
                ? "Auto hot-reload on save: ON — click to disable"
                : "Auto hot-reload on save: OFF — click to enable"
            }
            onClick={() => {
              toggleAutoReload();
              syncAutoReloadWatch();
            }}
          >
            auto
          </button>
          <button class="pf-dc-btn pf-dc-btn--reload" title="Hot reload (r)" disabled={!isRunning()} onClick={reloadRun}>
            <IconRefresh size={13} />
          </button>
        </Show>
        <Show when={can("hotRestart")}>
          <button class="pf-dc-btn pf-dc-btn--restart" title="Hot restart (R)" disabled={!isRunning()} onClick={restartRun}>
            <IconRestart size={13} />
          </button>
        </Show>
        <button class="pf-dc-btn pf-dc-btn--stop" title="Stop" disabled={!isRunning()} onClick={stopRun}>
          <IconStop size={12} />
        </button>
        <button
          class="pf-dc-btn"
          title="Clear console"
          disabled={!runConsole.current()}
          onClick={clearConsole}
        >
          <IconClear size={13} />
        </button>
        <button class="pf-dc-btn" title="Hide console" onClick={closeConsole}>
          <IconClose size={14} />
        </button>
      </header>

      <div class="pf-dc-body">
        {/* Console + Logs are display-toggled (not unmounted) so switching tabs
            never kills the run pty or the live logcat stream. */}
        <div class="pf-dc-view" style={{ display: view() === "console" ? "flex" : "none" }}>
          <Show
            when={runConsole.current()}
            keyed
            fallback={
              <ForgeEmptyState
                glyph={<IconTerminal size={26} />}
                eyebrow="Run"
                title="Nothing running"
                hint="Pick a target and hit Run to launch it here."
              />
            }
          >
            {(run) => (
              <TerminalPane
                runCommand={run.command}
                cwd={run.cwd ?? undefined}
                onReady={attachConsole}
                onExit={consoleExited}
                onOutput={ingestRunOutput}
                onSelectionChange={setAskSel}
                readOnly
                consoleTheme
              />
            )}
          </Show>
        </div>
        {/* Mounted only for logcat-capable targets (RN / native-Android); kept
            mounted across tab switches so the stream persists, torn down when
            the target stops being logcat-capable. */}
        <Show when={logcatCapable()}>
          <div class="pf-dc-view" style={{ display: view() === "logs" ? "flex" : "none" }}>
            <LogcatView />
          </div>
        </Show>
      </div>

      <Show when={askSel()}>
        {(s) => <AskAiMenu selection={s()} onClose={() => setAskSel(null)} />}
      </Show>
    </section>
  );
}
