// Shared, ref-counted poller for the merged device list: Android (running
// devices + stopped AVDs) and iOS (booted + shut-down simulators). Exactly one
// interval runs regardless of how many views subscribe, so the run launcher and
// the Inspector read the same live list and a freshly-booted emulator/simulator
// appears within a tick without switching chats.
import { createSignal, onCleanup, onMount } from "solid-js";
import { androidDeviceList, iosDeviceList, type DeviceEntry } from "../lib/device";

const POLL_MS = 3000;

const [devices, setDevices] = createSignal<DeviceEntry[]>([]);
/** Reactive merged device list. */
export const deviceList = devices;

let subscribers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let inFlight: Promise<DeviceEntry[]> | null = null;

/** Re-fetch the device list now. Overlapping calls share the one in-flight
 *  request (and all await its fresh result, so a caller never gets a stale
 *  snapshot); resolves to the current list on failure / outside Tauri. */
export function refreshDevices(): Promise<DeviceEntry[]> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      // Query both sources concurrently; a null result means that source threw
      // (its CLI missing / not in Tauri). One source failing or returning empty
      // must never drop the other's devices.
      const [android, ios] = await Promise.all([
        androidDeviceList().catch(() => null),
        iosDeviceList().catch(() => null),
      ]);
      // Both sources unreachable: keep what we have rather than clobbering the
      // list to empty (preserves the "not in Tauri / adb missing" behavior).
      if (android === null && ios === null) return devices();
      const safe = [
        ...(Array.isArray(android) ? android : []),
        ...(Array.isArray(ios) ? ios : []),
      ];
      setDevices(safe);
      return safe;
    } catch {
      return devices();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function start() {
  void refreshDevices();
  timer = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    void refreshDevices();
  }, POLL_MS);
}

function stop() {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}

/** Subscribe a view to the shared poller for its lifetime. The poller starts on
 *  the first subscriber and stops when the last one unmounts. */
export function useDeviceList(): {
  devices: typeof devices;
  refresh: typeof refreshDevices;
} {
  onMount(() => {
    if (subscribers++ === 0) start();
  });
  onCleanup(() => {
    if (--subscribers === 0) stop();
  });
  return { devices, refresh: refreshDevices };
}
