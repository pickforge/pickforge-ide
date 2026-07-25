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
  reattachRun,
  restartRun,
  runConsole,
  syncAutoReloadWatch,
  setConsoleHeight,
  stopRun,
  type RunStatus,
} from "../../stores/runConsole";
import { activeTarget, hasRunTargets } from "../../stores/runTargets";
import { logSourceOf } from "../../lib/runTargets";
import { autoReloadEnabled, toggleAutoReload } from "../../stores/autoReload";
import {
  bootingKind,
  cancelBoot,
  canLaunchActiveTarget,
  isBooting,
  launchActiveTarget,
  launchError,
  remoteDeviceLaunchReason,
} from "../../stores/runLaunch";
import { workbenchPrefs } from "../../stores/workbenchPrefs";
import { ingestRunOutput } from "../../stores/vmService";
import { pushMcpLogs } from "../../stores/mcp";

const STATUS: Record<RunStatus, { label: string; intent: StatusIntent; pulse?: boolean }> = {
  idle: { label: "idle", intent: "neutral" },
  running: { label: "running", intent: "live", pulse: true },
  disconnected: { label: "disconnected", intent: "warning" },
  stopped: { label: "stopped", intent: "warning" },
};

// Drag the top edge to resize the panel height (mirror of the dock resizer).
// Plain DOM/event logic, no Solid reactivity of its own.
function startDebugConsoleResize(e: PointerEvent): void {
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
}

// Tap the run console output for the MCP `get_run_logs` buffer: feed the VM-URL
// scraper as before, and forward completed lines (ANSI stripped) to MCP. A small
// carry buffer reassembles lines that straddle two output chunks. A factory (not
// a composable — no Solid reactivity involved) so each mount gets its own carry.
function createRunOutputTap(): (chunk: string) => void {
  let logCarry = "";
  return (chunk: string) => {
    ingestRunOutput(chunk);
    logCarry += chunk;
    const parts = logCarry.split(/\r?\n/);
    logCarry = parts.pop() ?? ""; // keep the trailing partial line
    const lines = parts
      .map((l) => l.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").trimEnd())
      .filter((l) => l.length > 0);
    if (lines.length > 0) pushMcpLogs(lines);
  };
}

/** The Run button plus its hot-reload/hot-restart/reattach/stop transport
 *  controls. Store actions (`reloadRun`, `stopRun`, …) and store-only
 *  accessors (`isBooting`, `workbenchPrefs`, …) are read straight from their
 *  module-scope import, same as the original inline JSX did — only the
 *  locally-derived accessors are threaded through as props. */
function RunTransportControls(props: {
  can: (c: string) => boolean;
  isRunning: () => boolean;
  isDisconnected: () => boolean;
  bootNoun: () => ReturnType<typeof bootingKind>;
}) {
  return (
    <>
      {/* The actual Run, grouped with the transport controls to its right. */}
      <button
        class="pf-dc-btn pf-dc-btn--run"
        classList={{ "pf-dc-btn--labeled": workbenchPrefs().runButtonLabels }}
        title={
          isBooting()
            ? `Booting ${props.bootNoun()}…`
            : props.isRunning()
              ? "A run is active — stop it first"
              : remoteDeviceLaunchReason() ?? "Run"
        }
        aria-label={remoteDeviceLaunchReason() ?? "Run"}
        disabled={!hasRunTargets() || !canLaunchActiveTarget() || props.isRunning() || isBooting()}
        onClick={() => void launchActiveTarget()}
      >
        <IconPlay size={12} />
        <Show when={workbenchPrefs().runButtonLabels}>Run</Show>
      </button>
      <Show when={props.can("hotReload")}>
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
        <button class="pf-dc-btn pf-dc-btn--reload" title="Hot reload (r)" disabled={!props.isRunning()} onClick={reloadRun}>
          <IconRefresh size={13} />
        </button>
      </Show>
      <Show when={props.can("hotRestart")}>
        <button class="pf-dc-btn pf-dc-btn--restart" title="Hot restart (R)" disabled={!props.isRunning()} onClick={restartRun}>
          <IconRestart size={13} />
        </button>
      </Show>
      <Show when={props.isDisconnected()}>
        <button
          class="pf-dc-btn pf-dc-btn--restart pf-dc-btn--labeled"
          title="Reconnect the inspector through a fresh SSH tunnel; console streaming cannot reattach"
          onClick={() => void reattachRun()}
        >
          <IconRefresh size={13} />
          Reattach
        </button>
      </Show>
      <button class="pf-dc-btn pf-dc-btn--stop" title="Stop" disabled={!props.isRunning()} onClick={stopRun}>
        <IconStop size={12} />
      </button>
    </>
  );
}

/** The console/logs header: run target controls, hot reload/restart, stop,
 *  clear, close. Everything not owned by `DebugConsole`'s local state (boot/
 *  launch store accessors, the run actions) is read straight from its
 *  module-scope store import, same as the original inline JSX did — only
 *  the locally-derived accessors are threaded through as props. */
function DebugConsoleHeader(props: {
  meta: () => { label: string; intent: StatusIntent; pulse?: boolean };
  can: (c: string) => boolean;
  isRunning: () => boolean;
  isDisconnected: () => boolean;
  bootNoun: () => ReturnType<typeof bootingKind>;
  hasDeviceLogs: () => boolean;
  view: () => "console" | "logs";
  onViewChange: (v: "console" | "logs") => void;
}) {
  return (
    <header class="pf-dc-head">
      <RunLauncher />
      <Show when={props.hasDeviceLogs()}>
        <div class="pf-dc-tabs" role="tablist">
          <button
            class="pf-dc-tab"
            classList={{ "pf-dc-tab--on": props.view() === "console" }}
            role="tab"
            aria-selected={props.view() === "console"}
            onClick={() => props.onViewChange("console")}
          >
            Console
          </button>
          <button
            class="pf-dc-tab"
            classList={{ "pf-dc-tab--on": props.view() === "logs" }}
            role="tab"
            aria-selected={props.view() === "logs"}
            onClick={() => props.onViewChange("logs")}
          >
            Logs
          </button>
        </div>
      </Show>
      <Show when={isBooting()}>
        <span class="pf-run-booting">booting…</span>
        <button
          class="pf-dc-btn pf-dc-btn--cancel pf-dc-btn--labeled"
          title={`Cancel ${props.bootNoun()} boot`}
          onClick={cancelBoot}
        >
          Cancel
        </button>
      </Show>
      <Show when={!isBooting() && launchError()}>
        <span class="pf-run-error" title={launchError()!}>{launchError()}</span>
      </Show>
      <StatusPill label={props.meta().label} intent={props.meta().intent} pulsing={props.meta().pulse} />
      <span class="pf-dc-spacer" />
      <RunTransportControls
        can={props.can}
        isRunning={props.isRunning}
        isDisconnected={props.isDisconnected}
        bootNoun={props.bootNoun}
      />
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
  );
}

export function DebugConsole() {
  const target = runConsole.target;
  const status = runConsole.status;
  const meta = () => STATUS[status()];
  const can = (c: string) => !!target()?.capabilities.includes(c);
  const isRunning = () => status() === "running";
  const isDisconnected = () => status() === "disconnected";
  // Boot copy tracks what's actually booting (Android emulator vs iOS simulator).
  const bootNoun = () => bootingKind();
  const [askSel, setAskSel] = createSignal<{ text: string; x: number; y: number } | null>(null);
  const onRunOutput = createRunOutputTap();

  // Console | Logs switch — Logs exists for any target whose device logs don't
  // reach the run PTY: RN / native-Android (`adb logcat`) and native-iOS
  // (`os_log`). The running target wins (it's what's on the device); else the
  // selected launcher target.
  const [view, setView] = createSignal<"console" | "logs">("console");
  const logTarget = () => (isRunning() ? target() : activeTarget());
  const logSource = () => logSourceOf(logTarget()); // "pty" | "logcat" | "oslog"
  const hasDeviceLogs = () => logSource() !== "pty";
  // Fall back to the console whenever Logs isn't available (e.g. target switched
  // to Flutter), so the body never shows a Logs view for an unsupported target.
  createEffect(() => {
    if (view() === "logs" && !hasDeviceLogs()) setView("console");
  });

  onCleanup(detachConsole);

  return (
    <section class="pf-debug-console" style={{ height: `${runConsole.height()}px` }}>
      <div class="pf-dc-resizer" title="Drag to resize" onPointerDown={startDebugConsoleResize}>
        <span class="pf-dc-resizer-grip" />
      </div>
      <DebugConsoleHeader
        meta={meta}
        can={can}
        isRunning={isRunning}
        isDisconnected={isDisconnected}
        bootNoun={bootNoun}
        hasDeviceLogs={hasDeviceLogs}
        view={view}
        onViewChange={setView}
      />

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
                projectRoot={run.projectRoot ?? undefined}
                remote={run.remote}
                fallbackToLocal={!run.remote}
                onReady={attachConsole}
                onExit={consoleExited}
                onOutput={onRunOutput}
                onSelectionChange={setAskSel}
                readOnly
                consoleTheme
              />
            )}
          </Show>
        </div>
        {/* Mounted only for device-log targets (RN / native-Android → logcat,
            native-iOS → oslog); kept mounted across tab switches so the stream
            persists. Keyed on the source so switching between a logcat and an
            oslog target remounts the view onto the right stream client, and it
            tears down when the target stops having device logs. */}
        <Show when={hasDeviceLogs()}>
          <div class="pf-dc-view" style={{ display: view() === "logs" ? "flex" : "none" }}>
            <Show when={logSource()} keyed>
              {(src) => <LogcatView source={src as "logcat" | "oslog"} />}
            </Show>
          </div>
        </Show>
      </div>

      <Show when={askSel()}>
        {(s) => <AskAiMenu selection={s()} onClose={() => setAskSel(null)} />}
      </Show>
    </section>
  );
}
