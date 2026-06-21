// The Run action, shared by the Debug Console header launcher and the
// status-bar Run button. Resolves the chosen device, auto-boots a stopped AVD
// (waits until it's online), appends the device serial, and launches the active
// target into the Debug Console. Reads the shared run-target / device / run-
// device stores so any view can trigger a run.
import { createSignal } from "solid-js";
import { activeTarget } from "./runTargets";
import { deviceList, refreshDevices } from "./deviceList";
import { selectedDevice, setRunDevice } from "./runDevice";
import { openConsole, runConsole, startRun } from "./runConsole";
import { armVmAutoConnect, disconnectVm } from "./vmService";
import { workspace } from "./workspace";
import { androidLaunchAvd, type DeviceEntry } from "../lib/device";
import { withDevice } from "../lib/runTargets";

const BOOT_TIMEOUT_MS = 120_000;
const BOOT_POLL_MS = 2000;

const [booting, setBooting] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);
/** True while an emulator is booting before a run. */
export const isBooting = booting;
/** Last launch error (emulator boot failure / timeout), or null. */
export const launchError = error;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resolve the chosen device for the active project: the stored selection
 *  (matched by serial or AVD id) if present, else the first running device,
 *  else the first entry (e.g. a stopped AVD to boot). */
export function resolveSelectedDevice(): DeviceEntry | null {
  const list = deviceList();
  const stored = selectedDevice(workspace.activeRoot);
  const match = list.find(
    (d) => (d.serial && d.serial === stored) || (d.avdId && d.avdId === stored),
  );
  // Auto-pick prefers an online device, then a bootable AVD; never an offline /
  // unauthorized one (an explicit stored choice still resolves above).
  return (
    match ??
    list.find((d) => d.state === "running") ??
    list.find((d) => d.state === "stopped") ??
    null
  );
}

/** A stable per-entry key for selection/persistence (serial if running, else
 *  the AVD id which survives the boot transition). */
export function deviceKey(d: DeviceEntry): string {
  return d.serial ?? d.avdId ?? d.displayName;
}

/** "Pixel 10 · emulator-5554" for running devices; just the name for stopped. */
export function deviceLabel(d: DeviceEntry): string {
  return d.serial ? `${d.displayName} · ${d.serial}` : d.displayName;
}

/** Poll the device list until a running emulator with this AVD id appears, and
 *  return its serial — or null if it doesn't boot within the timeout. */
async function waitForBootedSerial(avdId: string): Promise<string | null> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const list = await refreshDevices();
    const hit = list.find(
      (d) => d.state === "running" && d.avdId === avdId && d.serial,
    );
    if (hit?.serial) return hit.serial;
    await sleep(BOOT_POLL_MS);
  }
  return null;
}

/** Launch the active target. Opens the console immediately (so boot progress is
 *  visible), auto-boots a stopped AVD if one is selected, then runs. */
export async function launchActiveTarget(): Promise<void> {
  const t = activeTarget();
  if (!t) return;
  if (booting() || runConsole.status() === "running") return; // never stack runs
  openConsole();
  setError(null);

  let serial: string | null = null;
  if (t.needsDevice) {
    const entry = resolveSelectedDevice();
    if (entry?.state === "offline") {
      setError(`${entry.displayName} is offline or unauthorized — reconnect it first`);
      return;
    }
    if (entry?.state === "running") {
      serial = entry.serial;
    } else if (entry?.avdId) {
      setBooting(true);
      try {
        await androidLaunchAvd(entry.avdId);
        serial = await waitForBootedSerial(entry.avdId);
        if (!serial) setError(`Timed out waiting for ${entry.displayName} to boot`);
      } catch (e) {
        setError(String(e));
      } finally {
        setBooting(false);
      }
      if (!serial) return; // boot failed — don't launch into nothing
    }
  }

  if (serial && workspace.activeRoot) setRunDevice(workspace.activeRoot, serial);
  // Drop any stale VM connection and watch this run's output for the new VM
  // service URL so the Inspector auto-connects.
  void disconnectVm();
  armVmAutoConnect();
  startRun({ ...t, command: withDevice(t, serial) }, workspace.activeRoot);
}
