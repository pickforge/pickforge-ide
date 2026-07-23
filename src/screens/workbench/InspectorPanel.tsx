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
import { refreshRemoteDevices } from "../../stores/remoteDevices";
import {
  compatibleDevices,
  currentDeviceTarget,
  deviceKey,
  deviceLabel,
  resolveSelectedDevice,
} from "../../stores/runLaunch";
import { workspace } from "../../stores/workspace";
import { runConsole } from "../../stores/runConsole";
import { connectVm, disconnectVm, setVmUrl, vmService } from "../../stores/vmService";
import { hasCapability, type InspectorKind } from "../../lib/runTargets";
import { remotePtyFor } from "../../lib/remoteContext";
import { WidgetTree } from "./WidgetTree";
import { A11yTree } from "./A11yTree";
import { CdpTree } from "./CdpTree";
import { RemoteDevicePicker } from "./RemoteDevicePicker";

function LocalRunDeviceControl(props: {
  showVm: boolean;
  vmConnected: boolean;
  disconnectVm: () => void;
}) {
  const { refresh } = useDeviceList();
  const devices = compatibleDevices;
  const selectedKey = () => {
    const entry = resolveSelectedDevice();
    return entry ? deviceKey(entry) : "";
  };
  const selectedEntry = () => resolveSelectedDevice();
  const stateIntent = (device: DeviceEntry): StatusIntent =>
    device.state === "running" ? "connected" : device.state === "offline" ? "error" : "warning";
  const stateLabel = (device: DeviceEntry) => device.state === "running" ? "online" : device.state;
  const noDevicesLabel = () => {
    const kind = currentDeviceTarget()?.inspectorKind ?? null;
    if (kind === "iosAccessibility") return "No simulators";
    if (kind === "cdp") return "No devices";
    return "No devices (adb)";
  };

  return (
    <>
      <div class="pf-rail-head">
        <MonoEyebrow text="Run device" />
        <div class="pf-wt-actions">
          <Show when={props.showVm && props.vmConnected}>
            <button class="pf-vm-chip" title="VM connected — click to disconnect" onClick={props.disconnectVm}>
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
        fallback={<div class="pf-rail-empty">{noDevicesLabel()}</div>}
      >
        <Dropdown
          value={selectedKey()}
          onChange={(key) => workspace.activeRoot && setRunDevice(workspace.activeRoot, key)}
          placeholder="Select device"
          disabled={!workspace.activeRoot}
          triggerTrailing={
            <Show when={selectedEntry()}>
              {(device) => <StatusPill label={stateLabel(device())} intent={stateIntent(device())} />}
            </Show>
          }
          options={devices().map((device) => ({
            value: deviceKey(device),
            label: deviceLabel(device),
            trailing: <StatusPill label={stateLabel(device)} intent={stateIntent(device)} />,
          }))}
        />
      </Show>
    </>
  );
}

// eslint-disable-next-line max-lines-per-function -- TODO(#263): reduce legacy function complexity.
export function InspectorPanel() {
  // Which inspector the rail shows, branched on the active target's capability:
  // a LIVE run wins (it's what's on the device), else the selected launcher
  // target. `runConsole` keeps its target after a run stops, so only honor it
  // while running — otherwise a finished RN/native/web run would keep hiding the
  // Flutter VM / no-target inspector. Null when nothing is selected → legacy VM.
  // The target whose capabilities gate the rail: a LIVE run wins, else the
  // selected launcher target (same precedence as inspectorKind below).
  const inspectTarget = currentDeviceTarget;
  const inspectorKind = (): InspectorKind | null =>
    inspectTarget()?.inspectorKind ?? null;
  // Honest capability gates so an absent capability mutes its action (with a
  // reason) instead of silently no-opping.
  const canInspect = () => hasCapability(inspectTarget(), "inspectSelection");
  const canMapSource = () => hasCapability(inspectTarget(), "mapSelectionToSource");

  // VM-service chrome (the connect box + the "VM connected" chip) is Flutter-only.
  // The legacy no-target case (null) keeps the VM flow, so it shows there too; every
  // other kind (uiAutomator · cdp · none) must never see Dart-VM-service language.
  const showVm = () => {
    const k = inspectorKind();
    return k === "vmService" || k === null;
  };

  // VM service connection is shared (the Debug Console auto-connects to a
  // `flutter run`'s VM service; this panel shows/controls the same state).
  const vmUrl = vmService.url;
  const vmConnected = vmService.connected;
  const vmError = vmService.error;

  const selectedDeviceEntry = () => resolveSelectedDevice();
  const remote = () => remotePtyFor(workspace.activeRoot);

  // The selected device's adb serial + whether it's online (only running devices
  // can be dumped) — fed to the accessibility inspector.
  const selectedSerial = () => selectedDeviceEntry()?.serial ?? null;
  const deviceOnline = () => selectedDeviceEntry()?.state === "running";

  return (
    <div class="pf-inspector">
      <div class="pf-inspector-body">
        <div class="pf-inspector-section">
          <Show
            when={remote()}
            fallback={
              <LocalRunDeviceControl
                showVm={showVm()}
                vmConnected={vmConnected()}
                disconnectVm={disconnectVm}
              />
            }
            keyed
          >
            {(binding) => (
              <Show when={workspace.activeRoot} keyed>
                {(root) => (
                  <>
                    <div class="pf-rail-head">
                      <MonoEyebrow text="Run device" />
                      <div class="pf-wt-actions">
                        <Show when={showVm() && vmConnected()}>
                          <button class="pf-vm-chip" title="VM connected — click to disconnect" onClick={disconnectVm}>
                            <span class="pf-vm-dot" />
                            VM
                          </button>
                        </Show>
                        <button
                          class="pf-icon-btn"
                          title="Refresh remote devices"
                          onClick={() => void refreshRemoteDevices(root, binding)}
                        >
                          <IconRefresh size={14} />
                        </button>
                      </div>
                    </div>
                    <RemoteDevicePicker
                      projectRoot={root}
                      remote={binding}
                      disabled={runConsole.status() === "running"}
                    />
                  </>
                )}
              </Show>
            )}
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
            <A11yTree
              serial={selectedSerial()}
              online={deviceOnline()}
              canInspect={canInspect()}
              canMapSource={canMapSource()}
            />
          </Match>
          <Match when={inspectorKind() === "iosAccessibility"}>
            <A11yTree
              serial={selectedSerial()}
              online={deviceOnline()}
              source="iosAccessibility"
              canInspect={canInspect()}
              canMapSource={canMapSource()}
            />
          </Match>
          <Match when={inspectorKind() === "cdp"}>
            <CdpTree canInspect={canInspect()} canMapSource={canMapSource()} />
          </Match>
          <Match when={inspectorKind() === "none"}>
            <div class="pf-inspector-section">
              <MonoEyebrow text="Inspector" />
              <div class="pf-rail-empty">No inspector for this target</div>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
