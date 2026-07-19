import { createSignal } from "solid-js";
import { errorText } from "../lib/errors";
import type { RemotePty } from "../lib/pty";
import {
  remoteFlutterDevices,
  type RemoteFlutterDevice,
} from "../lib/remoteHost";

export type RemoteDeviceStatus = "idle" | "loading" | "ready" | "error";

export interface RemoteDeviceState {
  status: RemoteDeviceStatus;
  devices: RemoteFlutterDevice[];
  error: string | null;
}

const EMPTY: RemoteDeviceState = { status: "idle", devices: [], error: null };
const cache = new Map<string, RemoteDeviceState>();
const inFlight = new Map<string, Promise<RemoteDeviceState>>();
const [version, setVersion] = createSignal(0);

export function remoteDeviceScope(projectRoot: string, remote: RemotePty): string {
  return JSON.stringify(["remote", projectRoot, remote.host, remote.remoteRoot]);
}

function publish(key: string, state: RemoteDeviceState): RemoteDeviceState {
  cache.set(key, state);
  setVersion((value) => value + 1);
  return state;
}

export function remoteDeviceState(
  projectRoot: string | null,
  remote: RemotePty | null,
): RemoteDeviceState {
  version();
  if (!projectRoot || !remote) return EMPTY;
  return cache.get(remoteDeviceScope(projectRoot, remote)) ?? EMPTY;
}

export function resolveRemoteDevice(
  devices: RemoteFlutterDevice[],
  storedId: string,
): RemoteFlutterDevice | null {
  if (storedId) return devices.find((device) => device.id === storedId) ?? null;
  return devices.length === 1 ? devices[0] : null;
}

export function refreshRemoteDevices(
  projectRoot: string,
  remote: RemotePty,
): Promise<RemoteDeviceState> {
  const key = remoteDeviceScope(projectRoot, remote);
  const running = inFlight.get(key);
  if (running) return running;

  const prior = cache.get(key) ?? EMPTY;
  publish(key, { status: "loading", devices: prior.devices, error: null });
  const request = remoteFlutterDevices(projectRoot, remote.host, remote.remoteRoot)
    .then((devices) => publish(key, {
      status: "ready",
      devices: devices
        .filter((device) => device.isSupported)
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      error: null,
    }))
    .catch((error) => publish(key, {
      status: "error",
      devices: prior.devices,
      error: errorText(error),
    }))
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}
