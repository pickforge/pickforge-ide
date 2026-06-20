// Run-target + device selectors that live in the Debug Console header. The Run
// (play) action itself is the transport button in the console toolbar next to
// reload/restart/stop (see DebugConsole); these are just the pickers. Neutral
// chrome — the single ember stays on the focused terminal.
import { createEffect, For, Show } from "solid-js";
import { discoverRunTargets } from "../../lib/runTargets";
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
import { deviceKey, deviceLabel, resolveSelectedDevice } from "../../stores/runLaunch";

export function RunLauncher() {
  const { devices } = useDeviceList();

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
  const selectedKey = () => {
    const e = resolveSelectedDevice();
    return e ? deviceKey(e) : "";
  };

  return (
    <div class="pf-run-launcher">
      <Show
        when={runTargets().length > 0}
        fallback={<span class="pf-run-empty">No run target</span>}
      >
        <select
          class="pf-select pf-run-select"
          value={activeTargetId()}
          onChange={(e) => setActiveTargetId(e.currentTarget.value)}
          title="Run target"
        >
          <For each={runTargets()}>
            {(t) => (
              <option value={t.id}>
                {t.label}
                {t.source === "vscode" ? " · launch.json" : ""}
              </option>
            )}
          </For>
        </select>

        <Show when={showDevices()}>
          <select
            class="pf-select pf-run-select"
            value={selectedKey()}
            onChange={(e) =>
              workspace.activeRoot && setRunDevice(workspace.activeRoot, e.currentTarget.value)
            }
            title="Device"
          >
            <For each={devices()}>
              {(d) => (
                <option value={deviceKey(d)}>
                  {deviceLabel(d)}
                  {d.state === "stopped" ? " — start" : d.state === "offline" ? " (offline)" : ""}
                </option>
              )}
            </For>
          </select>
        </Show>
      </Show>
    </div>
  );
}
