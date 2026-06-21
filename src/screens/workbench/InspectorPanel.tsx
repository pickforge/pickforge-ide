// Right-rail inspector: the run device (with VM-service status folded in) and
// the Flutter widget tree / details / "send to AI".
import { Show } from "solid-js";
import {
  EmberButton,
  MonoEyebrow,
  StatusPill,
  type StatusIntent,
} from "../../components/ui";
import { Dropdown } from "../../components/Dropdown";
import { IconRefresh } from "../../components/icons";
import type { DeviceEntry } from "../../lib/device";
import { setRunDevice } from "../../stores/runDevice";
import { useDeviceList } from "../../stores/deviceList";
import { deviceKey, deviceLabel, resolveSelectedDevice } from "../../stores/runLaunch";
import { workspace } from "../../stores/workspace";
import { connectVm, disconnectVm, setVmUrl, vmService } from "../../stores/vmService";
import { WidgetTree } from "./WidgetTree";

export function InspectorPanel() {
  const { devices, refresh } = useDeviceList();

  // VM service connection is shared (the Debug Console auto-connects to a
  // `flutter run`'s VM service; this panel shows/controls the same state).
  const vmUrl = vmService.url;
  const vmConnected = vmService.connected;
  const vmError = vmService.error;

  // The selected run device (shared with the run launcher): the stored choice if
  // it's still present, else the first running device (or first AVD to boot).
  const selectedKey = () => {
    const e = resolveSelectedDevice();
    return e ? deviceKey(e) : "";
  };
  const pick = (key: string) => {
    if (workspace.activeRoot) setRunDevice(workspace.activeRoot, key);
  };

  const selectedDeviceEntry = () => resolveSelectedDevice();
  const stateIntent = (d: DeviceEntry): StatusIntent =>
    d.state === "running" ? "connected" : d.state === "offline" ? "error" : "warning";
  const stateLabel = (d: DeviceEntry) => (d.state === "running" ? "online" : d.state);

  return (
    <div class="pf-inspector">
      <div class="pf-inspector-body">
        <div class="pf-inspector-section">
          <div class="pf-rail-head">
            <MonoEyebrow text="Run device" />
            <div class="pf-wt-actions">
              {/* VM-service status folded in: a connected chip whose click
                  disconnects (replaces the standalone VM Service section). */}
              <Show when={vmConnected()}>
                <button class="pf-vm-chip" title="VM connected — click to disconnect" onClick={disconnectVm}>
                  <span class="pf-vm-dot" />
                  VM
                </button>
              </Show>
              <button class="pf-icon-btn" title="Refresh" onClick={() => void refresh()}>
                <IconRefresh size={14} />
              </button>
            </div>
          </div>
          <Show
            when={devices().length > 0}
            fallback={<div class="pf-rail-empty">No devices (adb)</div>}
          >
            <Dropdown
              value={selectedKey()}
              onChange={pick}
              placeholder="Select device"
              disabled={!workspace.activeRoot}
              triggerTrailing={
                <Show when={selectedDeviceEntry()}>
                  {(d) => <StatusPill label={stateLabel(d())} intent={stateIntent(d())} />}
                </Show>
              }
              options={devices().map((d) => ({
                value: deviceKey(d),
                label: deviceLabel(d),
                trailing: <StatusPill label={stateLabel(d)} intent={stateIntent(d)} />,
              }))}
            />
          </Show>
        </div>

        {/* Manual VM connect — only when not already auto-connected. Once
            connected, status + disconnect live in the Run device header above. */}
        <Show when={!vmConnected()}>
          <div class="pf-inspector-section">
            <MonoEyebrow text="VM service" />
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
            <p class="pf-inspector-hint">
              Run a Flutter app and it connects automatically — or paste a VM
              service URL to inspect its widget tree.
            </p>
          </div>
        </Show>

        <Show when={vmConnected()}>
          <WidgetTree />
        </Show>
      </div>
    </div>
  );
}
