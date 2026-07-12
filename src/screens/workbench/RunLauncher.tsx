// Run-target + device selectors that live in the Debug Console header. The Run
// (play) action itself is the transport button in the console toolbar next to
// reload/restart/stop (see DebugConsole); these are just the pickers. Neutral
// chrome — the single ember stays on the focused terminal.
import { createEffect, onCleanup, Show } from "solid-js";
import { Dropdown } from "../../components/Dropdown";
import { StatusPill } from "../../components/ui";
import { RunTargetDiscovery, supportTierMeta } from "../../lib/runTargets";
import { remotePtyFor } from "../../lib/remoteContext";
import { workspace } from "../../stores/workspace";
import { useDeviceList } from "../../stores/deviceList";
import { setRunDevice } from "../../stores/runDevice";
import {
  activeTarget,
  activeTargetId,
  runTargets,
  setActiveTargetId,
  runTargetDiscoveryError,
  setRunTargetDiscoveryError,
  setRunTargets,
} from "../../stores/runTargets";
import { compatibleDevices, deviceKey, deviceLabel, resolveSelectedDevice } from "../../stores/runLaunch";
import { runConsole } from "../../stores/runConsole";
import { RemoteDevicePicker } from "./RemoteDevicePicker";

function LocalDevicePicker() {
  useDeviceList();
  const devices = compatibleDevices;
  const selectedKey = () => {
    const entry = resolveSelectedDevice();
    return entry ? deviceKey(entry) : "";
  };
  const deviceSuffix = (state: string) =>
    state === "stopped" ? " — start" : state === "offline" ? " (offline)" : "";

  return (
    <Show when={devices().length > 0}>
      <Dropdown
        class="pf-run-dropdown"
        title="Device"
        value={selectedKey()}
        onChange={(value) => workspace.activeRoot && setRunDevice(workspace.activeRoot, value)}
        options={devices().map((device) => ({
          value: deviceKey(device),
          label: deviceLabel(device) + deviceSuffix(device.state),
        }))}
      />
    </Show>
  );
}

export function RunLauncher() {
  const discovery = new RunTargetDiscovery();
  onCleanup(() => discovery.cancel());

  // Reload run targets whenever the active project changes.
  createEffect(() => {
    const root = workspace.activeRoot;
    if (!root) {
      discovery.cancel();
      setRunTargets([]);
      setRunTargetDiscoveryError(null);
      return;
    }
    const remote = remotePtyFor(root);
    setRunTargetDiscoveryError(null);
    void discovery.discover(root, remote).then((result) => {
      if (!result) return;
      setRunTargets(result.targets);
      setRunTargetDiscoveryError(result.error);
    });
  });

  const remote = () => remotePtyFor(workspace.activeRoot);
  const showDevices = () => !!activeTarget()?.needsDevice;
  // Honest support tier for the active target — a quiet, neutral badge so a user
  // on an RN/Android/web project sees how deep PickForge actually goes, instead of
  // a bare dropdown that overstates support. Never the ember (Run keeps that).
  const tier = () => supportTierMeta(activeTarget());
  return (
    <div class="pf-run-launcher">
      <Show
        when={runTargets().length > 0}
        fallback={<span class="pf-run-empty">{runTargetDiscoveryError() ?? "No run target"}</span>}
      >
        <Dropdown
          class="pf-run-dropdown"
          title="Run target"
          value={activeTargetId()}
          onChange={setActiveTargetId}
          options={runTargets().map((t) => ({
            value: t.id,
            label: t.label + (t.source === "vscode" ? " · launch.json" : ""),
          }))}
        />
        <Show when={activeTarget()}>
          <span class="pf-run-tier" title={`${tier().label} support — ${tier().blurb}`}>
            <StatusPill label={tier().label} intent="neutral" />
          </span>
        </Show>
        <Show when={showDevices()}>
          <Show when={remote()} fallback={<LocalDevicePicker />} keyed>
            {(binding) => (
              <Show when={workspace.activeRoot} keyed>
                {(root) => (
                  <RemoteDevicePicker
                    class="pf-run-dropdown"
                    projectRoot={root}
                    remote={binding}
                    disabled={runConsole.status() === "running"}
                  />
                )}
              </Show>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
}
