// Right-rail inspector: detected target, the device the app will run on
// (selectable — shared with the Run bar), capability badges, and the Flutter
// VM-service bridge.
import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import {
  EmberButton,
  MonoEyebrow,
  StatusPill,
  type StatusIntent,
} from "../../components/ui";
import { IconCheck, IconChevronDown, IconRefresh } from "../../components/icons";
import type { DeviceEntry } from "../../lib/device";
import { setRunDevice } from "../../stores/runDevice";
import { useDeviceList } from "../../stores/deviceList";
import { deviceKey, deviceLabel, resolveSelectedDevice } from "../../stores/runLaunch";
import { workspace } from "../../stores/workspace";
import { connectVm, disconnectVm, setVmUrl, vmService } from "../../stores/vmService";
import { WidgetTree } from "./WidgetTree";
import * as device from "../../lib/device";

const CAP_LABELS: Record<string, string> = {
  detect: "Detect",
  launch: "Launch",
  test: "Test",
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
  const { devices, refresh } = useDeviceList();

  // VM service connection is shared (the Debug Console auto-connects to a
  // `flutter run`'s VM service; this panel shows/controls the same state).
  const vmUrl = vmService.url;
  const vmConnected = vmService.connected;
  const vmError = vmService.error;

  const targetIntent = (): StatusIntent => {
    const t = target();
    if (!t) return "neutral";
    return t.confidence === "exact" ? "connected" : "warning";
  };

  // The selected run device (shared with the run launcher): the stored choice if
  // it's still present, else the first running device (or first AVD to boot).
  const selectedKey = () => {
    const e = resolveSelectedDevice();
    return e ? deviceKey(e) : "";
  };
  const selectedLabel = createMemo(() => {
    const e = resolveSelectedDevice();
    return e ? deviceLabel(e) : "—";
  });
  const pick = (key: string) => {
    if (workspace.activeRoot) setRunDevice(workspace.activeRoot, key);
  };

  // Bespoke device dropdown (bracket-tag styled — see workbench.css).
  const [devOpen, setDevOpen] = createSignal(false);
  const selectedDeviceEntry = () => resolveSelectedDevice();
  const stateIntent = (d: DeviceEntry): StatusIntent =>
    d.state === "running" ? "connected" : d.state === "offline" ? "error" : "warning";
  const stateLabel = (d: DeviceEntry) => (d.state === "running" ? "online" : d.state);
  const closeDev = (e: PointerEvent) => {
    if (!(e.target as HTMLElement)?.closest?.(".pf-dev-select")) setDevOpen(false);
  };
  const onDevKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setDevOpen(false);
  };
  window.addEventListener("pointerdown", closeDev);
  window.addEventListener("keydown", onDevKey);
  onCleanup(() => {
    window.removeEventListener("pointerdown", closeDev);
    window.removeEventListener("keydown", onDevKey);
  });

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
            <button class="pf-icon-btn" title="Refresh" onClick={() => void refresh()}>
              <IconRefresh size={14} />
            </button>
          </div>
          <Show
            when={devices().length > 0}
            fallback={<div class="pf-rail-empty">No devices (adb)</div>}
          >
            <div class="pf-dev-select" classList={{ "pf-dev-select--open": devOpen() }}>
              <button
                class="pf-dev-trigger"
                disabled={!workspace.activeRoot}
                aria-expanded={devOpen()}
                onClick={() => setDevOpen((o) => !o)}
              >
                <span class="pf-dev-bracket" aria-hidden="true" />
                <span class="pf-dev-trigger-label">
                  {selectedDeviceEntry() ? deviceLabel(selectedDeviceEntry()!) : "Select device"}
                </span>
                <Show when={selectedDeviceEntry()}>
                  {(d) => <StatusPill label={stateLabel(d())} intent={stateIntent(d())} />}
                </Show>
                <IconChevronDown size={12} class="pf-dev-chevron" />
              </button>
              <Show when={devOpen()}>
                <div class="pf-dev-menu" role="listbox">
                  <For each={devices()}>
                    {(d) => (
                      <button
                        class="pf-dev-option"
                        classList={{ "pf-dev-option--on": selectedKey() === deviceKey(d) }}
                        role="option"
                        aria-selected={selectedKey() === deviceKey(d)}
                        onClick={() => {
                          pick(deviceKey(d));
                          setDevOpen(false);
                        }}
                      >
                        <span class="pf-dev-check" aria-hidden="true">
                          <Show when={selectedKey() === deviceKey(d)}>
                            <IconCheck size={11} />
                          </Show>
                        </span>
                        <span class="pf-dev-option-label">{deviceLabel(d)}</span>
                        <StatusPill label={stateLabel(d)} intent={stateIntent(d)} />
                      </button>
                    )}
                  </For>
                </div>
              </Show>
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

        <Show when={vmConnected()}>
          <WidgetTree />
        </Show>
      </div>
    </div>
  );
}
