// Right-rail inspector: detected target + capability badges + ADB devices.
// Live widget inspection rides on the VM-service bridge (a later slice).
import { createResource, For, Show } from "solid-js";
import {
  ForgeEmptyState,
  MonoEyebrow,
  StatusPill,
  type StatusIntent,
} from "../../components/ui";
import { workspace } from "../../stores/workspace";
import * as device from "../../lib/device";

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
              ⟳
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

        <ForgeEmptyState
          glyph={<span style={{ "font-size": "20px" }}>◎</span>}
          eyebrow="Inspector"
          title="Connect a running app"
          hint="Live widget inspection rides on the VM-service bridge, landing in a later slice."
        />
      </div>
    </div>
  );
}
