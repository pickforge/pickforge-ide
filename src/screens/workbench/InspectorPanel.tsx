// Right-rail inspector: detected target + capability badges + ADB devices.
// Live widget inspection rides on the VM-service bridge (a later slice).
import { createResource, createSignal, For, Show } from "solid-js";
import {
  EmberButton,
  MonoEyebrow,
  StatusPill,
  type StatusIntent,
} from "../../components/ui";
import { IconRefresh } from "../../components/icons";
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

  return (
    <div class="pf-inspector">
      <div class="pf-inspector-head">
        <MonoEyebrow text="Target" tick />
        <StatusPill
          label={target()?.displayName ?? "no project"}
          intent={targetIntent()}
        />
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
            <MonoEyebrow text="Devices" />
            <button class="pf-icon-btn" title="Refresh" onClick={() => refetch()}>
              <IconRefresh size={14} />
            </button>
          </div>
          <Show
            when={(devices() ?? []).length > 0}
            fallback={<div class="pf-rail-empty">No devices (adb)</div>}
          >
            <For each={devices()}>
              {(d) => (
                <div class="pf-device-row">
                  <span class="pf-mono">{d.model ?? d.serial}</span>
                  <StatusPill
                    label={d.state}
                    intent={d.state === "device" ? "connected" : "warning"}
                  />
                </div>
              )}
            </For>
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
