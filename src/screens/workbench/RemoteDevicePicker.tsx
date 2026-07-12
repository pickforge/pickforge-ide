import { createEffect, Show } from "solid-js";
import { Dropdown } from "../../components/Dropdown";
import type { RemotePty } from "../../lib/pty";
import { selectedDevice, setRunDevice } from "../../stores/runDevice";
import {
  refreshRemoteDevices,
  remoteDeviceState,
  resolveRemoteDevice,
} from "../../stores/remoteDevices";

export function RemoteDevicePicker(props: {
  projectRoot: string;
  remote: RemotePty;
  disabled?: boolean;
  class?: string;
}) {
  const state = () => remoteDeviceState(props.projectRoot, props.remote);
  const stored = () => selectedDevice(props.projectRoot, props.remote);
  const selected = () => resolveRemoteDevice(state().devices, stored());
  const refresh = () => refreshRemoteDevices(props.projectRoot, props.remote);

  createEffect(() => {
    void refresh();
  });
  const placeholder = () => {
    const snapshot = state();
    if (snapshot.status === "idle" || (snapshot.status === "loading" && snapshot.devices.length === 0)) {
      return "Finding devices…";
    }
    if (snapshot.status === "error") return "Device check failed";
    if (snapshot.devices.length === 0) return "No devices";
    if (stored() && !selected()) return "Saved device unavailable";
    return "Choose device";
  };
  const statusText = () => {
    const snapshot = state();
    if (snapshot.status === "loading" && snapshot.devices.length > 0) return "Checking…";
    if (snapshot.status === "error") {
      return snapshot.error ? `Device check failed: ${snapshot.error}` : "Device check failed";
    }
    if (snapshot.status === "ready" && snapshot.devices.length === 0) return "No remote Flutter devices";
    if (snapshot.status === "ready" && stored() && !selected()) return "Saved device unavailable";
    return null;
  };
  const blocked = () => {
    const snapshot = state();
    return props.disabled
      || snapshot.status !== "ready"
      || snapshot.devices.length === 0;
  };

  return (
    <div class="pf-remote-device-picker">
      <Dropdown
        class={props.class}
        title="Remote Flutter device"
        value={selected()?.id ?? ""}
        placeholder={placeholder()}
        disabled={blocked()}
        onChange={(id) => setRunDevice(props.projectRoot, id, props.remote)}
        options={state().devices.map((device) => ({
          value: device.id,
          label: `${device.name} · ${device.id}`,
        }))}
      />
      <Show when={statusText()}>
        {(text) => (
          <span class="pf-run-device-state" role="status" aria-live="polite" title={text()}>
            {text()}
          </span>
        )}
      </Show>
      <Show when={state().status === "error" || (state().status === "ready" && state().devices.length === 0)}>
        <button class="pf-run-device-retry" type="button" onClick={() => void refresh()}>
          Retry
        </button>
      </Show>
    </div>
  );
}
