// Run-target + device selectors that live in the Debug Console header. The Run
// (play) action itself is the transport button in the console toolbar next to
// reload/restart/stop (see DebugConsole); these are just the pickers. Neutral
// chrome — the single ember stays on the focused terminal.
import { createEffect, Show } from "solid-js";
import { Dropdown } from "../../components/Dropdown";
import { StatusPill } from "../../components/ui";
import { discoverRunTargets, supportTierMeta } from "../../lib/runTargets";
import { workspace } from "../../stores/workspace";
import { useDeviceList } from "../../stores/deviceList";
import { setRunDevice } from "../../stores/runDevice";
import {
  activeTarget,
  activeTargetId,
  runTargets,
  setActiveTargetId,
  setRunTargets,
} from "../../stores/runTargets";
import { compatibleDevices, deviceKey, deviceLabel, resolveSelectedDevice } from "../../stores/runLaunch";

export function RunLauncher() {
  // Subscribe to the shared poller for this view's lifetime, but show only the
  // devices compatible with the active target's platform (never a simulator for
  // an Android run, or vice versa).
  useDeviceList();
  const devices = compatibleDevices;

  // Reload run targets whenever the active project changes.
  createEffect(() => {
    const root = workspace.activeRoot;
    if (!root) {
      setRunTargets([]);
      return;
    }
    void (async () => {
      const found = await discoverRunTargets(root);
      if (workspace.activeRoot === root) setRunTargets(found); // ignore stale switch
    })();
  });

  const showDevices = () => !!activeTarget()?.needsDevice && devices().length > 0;
  // Honest support tier for the active target — a quiet, neutral badge so a user
  // on an RN/Android/web project sees how deep PickForge actually goes, instead of
  // a bare dropdown that overstates support. Never the ember (Run keeps that).
  const tier = () => supportTierMeta(activeTarget());
  const selectedKey = () => {
    const e = resolveSelectedDevice();
    return e ? deviceKey(e) : "";
  };
  const deviceSuffix = (state: string) =>
    state === "stopped" ? " — start" : state === "offline" ? " (offline)" : "";

  return (
    <div class="pf-run-launcher">
      <Show
        when={runTargets().length > 0}
        fallback={<span class="pf-run-empty">No run target</span>}
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
          <Dropdown
            class="pf-run-dropdown"
            title="Device"
            value={selectedKey()}
            onChange={(v) => workspace.activeRoot && setRunDevice(workspace.activeRoot, v)}
            options={devices().map((d) => ({
              value: deviceKey(d),
              label: deviceLabel(d) + deviceSuffix(d.state),
            }))}
          />
        </Show>
      </Show>
    </div>
  );
}
