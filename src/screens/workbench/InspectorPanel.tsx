// Right-rail inspector: detected target, the device the app will run on
// (selectable — shared with the Run bar), capability badges, and the Flutter
// VM-service bridge.
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import {
  EmberButton,
  MonoEyebrow,
  StatusPill,
  type StatusIntent,
} from "../../components/ui";
import { IconCheck, IconRefresh } from "../../components/icons";
import { selectedDevice, setRunDevice } from "../../stores/runDevice";
import { workspace } from "../../stores/workspace";
import * as device from "../../lib/device";
import * as vm from "../../lib/vm";

const CAP_LABELS: Record<string, string> = {
  detect: "Detect",
  launch: "Launch",
  stop: "Stop",
  hotReload: "Hot reload",
  hotRestart: "Hot restart",
  captureScreenshot: "Screenshot",
  streamLogs: "Logs",
  inspectSelection: "Inspect",
  mapSelectionToSource: "Source map",
  exposeMcpTools: "MCP",
};

export function InspectorPanel() {
  const [target] = createResource(
    () => workspace.activeRoot,
    (root) => (root ? device.targetDetect(root) : Promise.resolve(null)),
  );
  const [devices, { refetch }] = createResource(device.adbListDevices);

  const [vmUrl, setVmUrl] = createSignal("ws://127.0.0.1:8181/ws");
  const [vmConnected, setVmConnected] = createSignal(false);
  const [vmError, setVmError] = createSignal<string | null>(null);

  const connectVm = async () => {
    setVmError(null);
    try {
      await vm.vmConnect(vmUrl());
      setVmConnected(true);
    } catch (e) {
      setVmError(String(e));
      setVmConnected(false);
    }
  };
  const disconnectVm = async () => {
    await vm.vmDisconnect();
    setVmConnected(false);
  };

  const targetIntent = (): StatusIntent => {
    const t = target();
    if (!t) return "neutral";
    return t.confidence === "exact" ? "connected" : "warning";
  };

  // The selected run device (shared with the Run bar): the stored choice if that
  // device is still present, else the first connected device.
  const selected = () => {
    const list = devices() ?? [];
    const stored = selectedDevice(workspace.activeRoot);
    if (stored && list.some((d) => d.serial === stored)) return stored;
    return list.find((d) => d.state === "device")?.serial ?? "";
  };
  const selectedLabel = createMemo(() => {
    const d = (devices() ?? []).find((x) => x.serial === selected());
    return d ? (d.model ?? d.serial) : "—";
  });
  const pick = (serial: string) => {
    if (workspace.activeRoot) setRunDevice(workspace.activeRoot, serial);
  };

  return (
    <div class="pf-inspector">
      <div class="pf-inspector-head">
        <div class="pf-inspector-head-row">
          <MonoEyebrow text="Target" tick />
          <StatusPill
            label={target()?.displayName ?? "no project"}
            intent={targetIntent()}
          />
        </div>
        <Show when={workspace.activeRoot && (devices() ?? []).length > 0}>
          <div class="pf-run-on">
            <span class="pf-run-on-key">Run on</span>
            <span class="pf-run-on-val">{selectedLabel()}</span>
          </div>
        </Show>
      </div>

      <div class="pf-inspector-body">
        <Show when={target()}>
          <div class="pf-cap-badges">
            <For each={target()!.capabilities}>
              {(c) => <span class="pf-cap-badge">{CAP_LABELS[c] ?? c}</span>}
            </For>
          </div>
        </Show>

        <div class="pf-inspector-section">
          <div class="pf-rail-head">
            <MonoEyebrow text="Run device" />
            <button class="pf-icon-btn" title="Refresh" onClick={() => refetch()}>
              <IconRefresh size={14} />
            </button>
          </div>
          <Show
            when={(devices() ?? []).length > 0}
            fallback={<div class="pf-rail-empty">No devices (adb)</div>}
          >
            <div class="pf-run-list">
              <For each={devices()}>
                {(d) => (
                  <button
                    class="pf-run-row"
                    classList={{ "pf-run-row--on": selected() === d.serial }}
                    disabled={!workspace.activeRoot}
                    onClick={() => pick(d.serial)}
                  >
                    <span class="pf-run-radio" classList={{ "pf-run-radio--on": selected() === d.serial }}>
                      <Show when={selected() === d.serial}>
                        <IconCheck size={11} />
                      </Show>
                    </span>
                    <span class="pf-run-label">{d.model ?? d.serial}</span>
                    <StatusPill
                      label={d.state}
                      intent={d.state === "device" ? "connected" : "warning"}
                    />
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div class="pf-inspector-section">
          <div class="pf-rail-head">
            <MonoEyebrow text="VM service" />
            <Show when={vmConnected()}>
              <StatusPill label="connected" intent="connected" pulsing />
            </Show>
          </div>
          <Show
            when={!vmConnected()}
            fallback={
              <button class="pf-text-btn" onClick={disconnectVm}>
                Disconnect
              </button>
            }
          >
            <input
              class="pf-vm-input"
              value={vmUrl()}
              onInput={(e) => setVmUrl(e.currentTarget.value)}
              placeholder="ws://127.0.0.1:PORT/ws"
            />
            <EmberButton label="Connect" onClick={() => void connectVm()} />
            <Show when={vmError()}>
              <div class="pf-vm-error">{vmError()}</div>
            </Show>
          </Show>
          <Show when={!vmConnected()}>
            <p class="pf-inspector-hint">
              Paste a Flutter app's VM service URL to inspect its widget tree.
            </p>
          </Show>
        </div>
      </div>
    </div>
  );
}
