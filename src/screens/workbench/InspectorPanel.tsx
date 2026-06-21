// Right-rail inspector: the run device (with VM-service status folded in) and a
// framework-specific inspector branched on the active target's inspectorKind —
// Flutter VM-service widget tree (vmService) / UIAutomator accessibility tree
// (uiAutomator) / honest empty state (cdp · none).
import { Match, Show, Switch } from "solid-js";
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
import { runConsole } from "../../stores/runConsole";
import { activeTarget } from "../../stores/runTargets";
import type { InspectorKind } from "../../lib/runTargets";
import { WidgetTree } from "./WidgetTree";
import { A11yTree } from "./A11yTree";

export function InspectorPanel() {
  const { devices, refresh } = useDeviceList();

  // Which inspector the rail shows, branched on the active target's capability:
  // a LIVE run wins (it's what's on the device), else the selected launcher
  // target. `runConsole` keeps its target after a run stops, so only honor it
  // while running — otherwise a finished RN/native/web run would keep hiding the
  // Flutter VM / no-target inspector. Null when nothing is selected → legacy VM.
  const inspectorKind = (): InspectorKind | null => {
    const running = runConsole.status() === "running" ? runConsole.target() : null;
    return running?.inspectorKind ?? activeTarget()?.inspectorKind ?? null;
  };

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

  // The selected device's adb serial + whether it's online (only running devices
  // can be dumped) — fed to the accessibility inspector.
  const selectedSerial = () => selectedDeviceEntry()?.serial ?? null;
  const deviceOnline = () => selectedDeviceEntry()?.state === "running";

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

        {/* The right rail branches on the active target's inspector kind. The
            Flutter VM-service flow (the default Match) is preserved verbatim for
            vmService AND when no target is selected; RN / native-Android dump the
            UIAutomator accessibility tree; web (cdp) / unknown (none) get an
            honest empty state — never the VM-service copy. */}
        <Switch
          fallback={
            <>
              {/* Manual VM connect — only when not already auto-connected. Once
                  connected, status + disconnect live in the Run device header. */}
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
            </>
          }
        >
          <Match when={inspectorKind() === "uiAutomator"}>
            <A11yTree serial={selectedSerial()} online={deviceOnline()} />
          </Match>
          <Match when={inspectorKind() === "cdp" || inspectorKind() === "none"}>
            <div class="pf-inspector-section">
              <MonoEyebrow text="Inspector" />
              <div class="pf-rail-empty">
                {inspectorKind() === "cdp"
                  ? "No inspector for web targets yet"
                  : "No inspector for this target"}
              </div>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
