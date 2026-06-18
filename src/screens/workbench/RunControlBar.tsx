// VS Code-style run controls. Discovers run targets (detected + launch.json),
// lets you pick a device, and drives the FOCUSED terminal: Run types the command
// + Enter; Hot reload / restart / stop are the keystrokes the running tool reads
// (Flutter: r / R / q). Reuses the PTY — no separate runner process.
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { MonoEyebrow } from "../../components/ui";
import { IconPlay, IconRefresh, IconRestart, IconStop } from "../../components/icons";
import { discoverRunTargets, type RunTarget } from "../../lib/runTargets";
import { adbListDevices, type AdbDevice } from "../../lib/device";
import { workspace } from "../../stores/workspace";
import { workbenchPrefs } from "../../stores/workbenchPrefs";

export function RunControlBar(props: { send: (text: string) => void; canSend: boolean }) {
  const [targets, setTargets] = createSignal<RunTarget[]>([]);
  const [targetId, setTargetId] = createSignal<string>("");
  const [devices, setDevices] = createSignal<AdbDevice[]>([]);
  const [device, setDevice] = createSignal<string>("");
  const [running, setRunning] = createSignal(false);

  const target = createMemo(() => targets().find((t) => t.id === targetId()) ?? targets()[0] ?? null);
  const can = (cap: string) => !!target()?.capabilities.includes(cap);
  const labels = () => workbenchPrefs().runButtonLabels;

  // Reload targets + devices whenever the active project changes.
  createEffect(() => {
    const root = workspace.activeRoot;
    setRunning(false);
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
          setDevice((d) => d || ds.find((x) => x.state === "device")?.serial || "");
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
    if (t.needsDevice && device() && !/\s-d\s/.test(cmd)) cmd += ` -d ${device()}`;
    return cmd;
  };

  const run = () => {
    const cmd = fullCommand();
    if (!cmd) return;
    props.send(cmd + "\r");
    setRunning(true);
  };
  const reload = () => props.send("r");
  const restart = () => props.send("R");
  const stop = () => {
    // Flutter reads "q" to quit; everything else gets Ctrl-C.
    props.send(can("hotReload") ? "q" : "\x03");
    setRunning(false);
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
            onChange={(e) => setDevice(e.currentTarget.value)}
          >
            <For each={devices()}>
              {(d) => <option value={d.serial}>{d.model ?? d.serial}</option>}
            </For>
          </select>
        </Show>

        <div class="pf-runbar-btns">
          <button
            class="pf-runbar-btn pf-runbar-btn--run"
            classList={{ "pf-runbar-btn--icon": !labels() }}
            title={`Run: ${fullCommand()}`}
            disabled={!props.canSend || !fullCommand()}
            onClick={run}
          >
            <IconPlay size={13} />
            <Show when={labels()}>Run</Show>
          </button>
          <Show when={can("hotReload")}>
            <button class="pf-runbar-btn" classList={{ "pf-runbar-btn--icon": !labels() }} title="Hot reload (r)" disabled={!props.canSend || !running()} onClick={reload}>
              <IconRefresh size={13} />
              <Show when={labels()}>Reload</Show>
            </button>
          </Show>
          <Show when={can("hotRestart")}>
            <button class="pf-runbar-btn" classList={{ "pf-runbar-btn--icon": !labels() }} title="Hot restart (R)" disabled={!props.canSend || !running()} onClick={restart}>
              <IconRestart size={13} />
              <Show when={labels()}>Restart</Show>
            </button>
          </Show>
          <Show when={can("stop")}>
            <button class="pf-runbar-btn pf-runbar-btn--stop" classList={{ "pf-runbar-btn--icon": !labels() }} title="Stop" disabled={!props.canSend || !running()} onClick={stop}>
              <IconStop size={12} />
              <Show when={labels()}>Stop</Show>
            </button>
          </Show>
        </div>
      </div>
    </Show>
  );
}
