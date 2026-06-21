// Shared, ref-counted poller for the Android device list (running devices +
// stopped AVDs). Exactly one interval runs regardless of how many views
// subscribe, so the run launcher and the Inspector read the same live list and
// a freshly-booted emulator appears within a tick without switching chats.
import { createSignal, onCleanup, onMount } from "solid-js";
import { androidDeviceList, type DeviceEntry } from "../lib/device";

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
      const list = await androidDeviceList();
      const safe = Array.isArray(list) ? list : [];
      setDevices(safe);
      return safe;
    } catch {
      return devices(); // not in Tauri / adb missing — keep what we have
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
