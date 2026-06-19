// VS Code-style run launcher. Discovers run targets (detected + launch.json),
// lets you pick a device, and launches the selected target into the bottom
// Debug Console (its own pty) — Run never types into the user's own shell.
// Hot reload / restart / stop live on the console panel, on the running session.
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { MonoEyebrow } from "../../components/ui";
import { IconPlay } from "../../components/icons";
import { discoverRunTargets, shquote, type RunTarget } from "../../lib/runTargets";
import { adbListDevices, type AdbDevice } from "../../lib/device";
import { workspace } from "../../stores/workspace";
import { workbenchPrefs } from "../../stores/workbenchPrefs";
import { selectedDevice, setRunDevice } from "../../stores/runDevice";
import { runConsole, startRun } from "../../stores/runConsole";

export function RunControlBar() {
  const [targets, setTargets] = createSignal<RunTarget[]>([]);
  const [targetId, setTargetId] = createSignal<string>("");
  const [devices, setDevices] = createSignal<AdbDevice[]>([]);
  // The chosen device is shared with the Inspector via the runDevice store. Use
  // the stored serial only if that device is actually present (a serial from a
  // previous session can linger in storage); otherwise fall back to the first
  // connected device.
  const device = () => {
    const list = devices();
    const stored = selectedDevice(workspace.activeRoot);
    if (stored && list.some((d) => d.serial === stored)) return stored;
    return list.find((d) => d.state === "device")?.serial ?? "";
  };

  const target = createMemo(() => targets().find((t) => t.id === targetId()) ?? targets()[0] ?? null);
  const labels = () => workbenchPrefs().runButtonLabels;

  // Reload targets + devices whenever the active project changes.
  createEffect(() => {
    const root = workspace.activeRoot;
    if (!root) {
      setTargets([]);
      return;
    }
    void (async () => {
      const found = await discoverRunTargets(root);
      if (workspace.activeRoot !== root) return; // project switched mid-flight
      setTargets(found);
      setTargetId(found[0]?.id ?? "");
      if (found.some((t) => t.needsDevice)) {
        try {
          const ds = await adbListDevices();
          if (workspace.activeRoot !== root) return;
          setDevices(ds);
        } catch {
          if (workspace.activeRoot === root) setDevices([]);
        }
      } else {
        setDevices([]);
      }
    })();
  });

  const fullCommand = () => {
    const t = target();
    if (!t) return "";
    let cmd = t.command;
    // `-d <serial>` is Flutter's device selector; React Native / Gradle use
    // different syntax, so only append it for Flutter commands.
    const isFlutter = /\bflutter\s/.test(cmd);
    if (t.needsDevice && isFlutter && device() && !/\s-d\s/.test(cmd)) {
      cmd += ` -d ${shquote(device())}`;
    }
    return cmd;
  };

  const run = () => {
    const t = target();
    const cmd = fullCommand();
    if (!t || !cmd) return;
    startRun({ ...t, command: cmd }, workspace.activeRoot);
  };

  return (
    <Show when={targets().length > 0}>
      <div class="pf-runbar">
        <MonoEyebrow text="Run" tick />
        <select
          class="pf-select pf-runbar-select"
          value={targetId()}
          onChange={(e) => setTargetId(e.currentTarget.value)}
        >
          <For each={targets()}>
            {(t) => <option value={t.id}>{t.label}{t.source === "vscode" ? " · launch.json" : ""}</option>}
          </For>
        </select>

        <Show when={target()?.needsDevice && devices().length > 0}>
          <select
            class="pf-select pf-runbar-select"
            value={device()}
            onChange={(e) => workspace.activeRoot && setRunDevice(workspace.activeRoot, e.currentTarget.value)}
          >
            <For each={devices()}>
              {(d) => <option value={d.serial}>{d.model ?? d.serial}</option>}
            </For>
          </select>
        </Show>

        <button
          class="pf-runbar-btn pf-runbar-btn--run"
          classList={{ "pf-runbar-btn--icon": !labels() }}
          title={runConsole.status() === "running" ? "A run is active — stop it in the console first" : `Run: ${fullCommand()}`}
          disabled={!fullCommand() || runConsole.status() === "running"}
          onClick={run}
        >
          <IconPlay size={13} />
          <Show when={labels()}>Run</Show>
        </button>
      </div>
    </Show>
  );
}
