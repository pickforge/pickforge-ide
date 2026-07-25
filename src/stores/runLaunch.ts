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
import { ensureMcpRunning, mcpRunStarted } from "./mcp";
import { workspace } from "./workspace";
import { androidLaunchAvd, iosBootDevice, type DeviceEntry } from "../lib/device";
import { hasCapability, isCompatibleDevice, withDevice, type RunTarget } from "../lib/runTargets";
import { BootEpoch } from "../lib/bootEpoch";
import { remotePtyFor } from "../lib/remoteContext";
import {
  refreshRemoteDevices,
  remoteDeviceState,
  resolveRemoteDevice,
} from "./remoteDevices";
import type { RemotePty } from "../lib/pty";
import type { RemoteFlutterDevice } from "../lib/remoteHost";

const BOOT_TIMEOUT_MS = 120_000;
const BOOT_POLL_MS = 2000;

const [booting, setBooting] = createSignal(false);
const [bootKind, setBootKind] = createSignal<"emulator" | "simulator">("emulator");
const [error, setError] = createSignal<string | null>(null);
let launching = false;
/** True while an emulator/simulator is booting before a run. */
export const isBooting = booting;
/** What the in-flight boot is booting ("emulator" | "simulator"), for UI copy.
 *  Only meaningful while `isBooting()`. */
export const bootingKind = bootKind;
/** Last launch error (boot failure / timeout / cancellation), or null. */
export const launchError = error;

export function remoteDeviceLaunchReason(): string | null {
  const root = workspace.activeRoot;
  const target = activeTarget();
  const remote = remotePtyFor(root);
  if (!root || !remote || !target?.needsDevice) return null;
  const state = remoteDeviceState(root, remote);
  if (state.status === "idle" || state.status === "loading") return "Finding remote devices…";
  if (state.status === "error") return "Remote device check failed";
  if (state.devices.length === 0) return "No remote Flutter devices";
  const stored = selectedDevice(root, remote);
  if (!stored) return state.devices.length > 1 ? "Choose a remote device" : null;
  return state.devices.some((device) => device.id === stored)
    ? null
    : "Saved remote device unavailable";
}

export function canLaunchActiveTarget(): boolean {
  return !!activeTarget() && remoteDeviceLaunchReason() === null;
}

// Bumped on every launch and on cancel, so a stale boot can't latch a later run:
// `waitForDevice` polls it to break promptly, and `launchActiveTarget`
// bails after the await if its captured epoch was superseded. Mirrors the
// watchEpoch pattern in runConsole.ts.
const bootEpoch = new BootEpoch();

/** Cancel an in-flight emulator boot promptly: bumps the epoch so the poll loop
 *  breaks out of its sleep without waiting the full timeout, clears the booting
 *  state, and surfaces a neutral "boot cancelled" note (not a scary error). */
export function cancelBoot(): void {
  if (!booting()) return;
  bootEpoch.bump(); // supersede the in-flight wait so it resolves null and bails
  setBooting(false);
  setError("Boot cancelled");
}

/** The target whose platform constrains the device list: a LIVE run wins (it's
 *  what's on the device), else the selected launcher target — the same
 *  precedence the Debug Console and Inspector use. */
export function currentDeviceTarget(): RunTarget | null {
  const running = runConsole.status() === "running" ? runConsole.target() : null;
  return running ?? activeTarget() ?? null;
}

/** The merged device list narrowed to the current target's platform (see
 *  `isCompatibleDevice`): native-iOS sees only simulators, adb-backed targets
 *  only emulators/physical, flutter and no-device targets everything. The
 *  device picker AND selection read this so a native-ios run can never resolve
 *  an Android serial (or vice versa). */
export function compatibleDevices(): DeviceEntry[] {
  const t = currentDeviceTarget();
  return deviceList().filter((d) => isCompatibleDevice(t, d.kind));
}

/** Resolve the chosen device for the active project among the devices
 *  compatible with the current target: the stored selection (matched by serial
 *  or AVD id) if present and compatible, else the first running device, else
 *  the first stopped entry (an AVD or simulator to boot). */
export function resolveSelectedDevice(): DeviceEntry | null {
  const list = compatibleDevices();
  const stored = selectedDevice(workspace.activeRoot);
  const match = list.find(
    (d) => (d.serial && d.serial === stored) || (d.avdId && d.avdId === stored),
  );
  // Auto-pick prefers an online device, then a bootable AVD/simulator; never an
  // offline / unauthorized one (an explicit stored choice still resolves above).
  return (
    match ??
    list.find((d) => d.state === "running") ??
    list.find((d) => d.state === "stopped") ??
    null
  );
}

export function screenshotTarget(): RunTarget | null {
  const target = currentDeviceTarget();
  if (!hasCapability(target, "captureScreenshot")) return null;
  return target?.inspectorKind === "vmService" || target?.deviceConvention !== "none"
    ? target
    : null;
}

export function resolveScreenshotDevice(): DeviceEntry | null {
  const target = screenshotTarget();
  if (!target) return null;
  const device = resolveSelectedDevice();
  if (!device?.serial || device.state !== "running") return null;
  return isCompatibleDevice(target, device.kind) ? device : null;
}

/** A stable per-entry key for selection/persistence (serial if running, else
 *  the AVD id which survives the boot transition). */
export function deviceKey(d: DeviceEntry): string {
  return d.serial ?? d.avdId ?? d.displayName;
}

/** "Pixel 10 · emulator-5554" for running devices; just the name otherwise. A
 *  stopped simulator still carries its udid as `serial`, but a 36-char udid on
 *  a stopped row is noise, not signal — so the serial is running-only. */
export function deviceLabel(d: DeviceEntry): string {
  return d.state === "running" && d.serial ? `${d.displayName} · ${d.serial}` : d.displayName;
}

/** Poll the device list until a running device matching `match` appears, and
 *  return its serial — or null if it doesn't boot within the timeout, or if this
 *  boot was cancelled / superseded (its `epoch` no longer matches `bootEpoch`).
 *  The abort is observed each iteration and inside an abortable poll sleep, so a
 *  cancel breaks out within ~one poll tick instead of waiting the full timeout.
 *  Shared by the AVD wait (matches on avdId — an AVD's serial only appears
 *  once booted) and the simulator wait (matches on udid, which a simulator
 *  keeps as `serial` across the boot transition, unlike an AVD's). */
async function waitForDevice(
  match: (d: DeviceEntry) => boolean,
  epoch: number,
): Promise<string | null> {
  const live = () => bootEpoch.isCurrent(epoch);
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (live() && Date.now() < deadline) {
    const list = await refreshDevices();
    if (!live()) return null; // cancelled while awaiting the device list
    const hit = list.find((d) => d.state === "running" && match(d));
    if (hit?.serial) return hit.serial;
    await abortableSleep(BOOT_POLL_MS, live);
  }
  return null;
}

/** Sleep up to `ms`, but poll `live` so a cancelled boot wakes promptly instead
 *  of blocking the full poll interval. */
function abortableSleep(ms: number, live: () => boolean): Promise<void> {
  return new Promise<void>((resolve) => {
    const step = 100;
    const tick = () => {
      if (!live() || (ms -= step) <= 0) return resolve();
      setTimeout(tick, step);
    };
    setTimeout(tick, Math.min(step, ms));
  });
}

/** Launch the active target. Opens the console immediately (so boot progress is
 *  visible), auto-boots a stopped AVD / simulator if one is selected, then runs. */
export async function launchActiveTarget(): Promise<void> {
  const t = activeTarget();
  const projectRoot = workspace.activeRoot;
  if (!t || !projectRoot) return;
  if (launching || booting() || runConsole.status() === "running") return;
  launching = true;
  try {
    await launchTarget(t, projectRoot);
  } finally {
    launching = false;
  }
}

function sameRemote(left: RemotePty | null, right: RemotePty | null): boolean {
  return left === right
    || (!!left && !!right && left.host === right.host && left.remoteRoot === right.remoteRoot);
}

function launchContextIsCurrent(projectRoot: string, remote: RemotePty | null): boolean {
  return workspace.activeRoot === projectRoot && sameRemote(remotePtyFor(projectRoot), remote);
}

type DeviceResolution =
  | { aborted: true }
  | { aborted: false; serial: string | null; device: DeviceEntry | null };

type RemoteDeviceResolution =
  | { aborted: true }
  | { aborted: false; serial: string; remoteDevice: RemoteFlutterDevice };

/** Refreshes the remote host's device list and resolves the saved selection
 * against it. Aborts (no launch) if the launch context moved on mid-await,
 * the check itself errored, or the saved selection isn't among the current
 * devices. */
async function resolveRemoteLaunchDevice(
  projectRoot: string,
  remote: RemotePty,
  capturedSelection: string,
): Promise<RemoteDeviceResolution> {
  const state = await refreshRemoteDevices(projectRoot, remote);
  if (!launchContextIsCurrent(projectRoot, remote)) return { aborted: true };
  if (state.status === "error") {
    setError(state.error ? `Remote device check failed: ${state.error}` : "Remote device check failed");
    return { aborted: true };
  }
  const remoteDevice = resolveRemoteDevice(state.devices, capturedSelection);
  if (!remoteDevice) {
    setError(
      state.devices.length === 0
        ? "No supported Flutter devices found on the remote host"
        : capturedSelection
          ? "Saved remote device is unavailable — choose another device"
          : "Choose a remote device before running",
    );
    return { aborted: true };
  }
  return { aborted: false, serial: remoteDevice.id, remoteDevice };
}

/** Stopped iOS simulator: `simctl boot` it and wait until it reports
 * running. Mirrors the AVD boot/wait UX (bounded timeout, cancellable), but
 * keyed on the udid, which is stable across the boot. Returns the serial
 * once running, or `null` on timeout/failure/cancel — a cancelled boot
 * (superseded epoch) leaves its error/booting state to the newer boot that
 * owns it instead of touching it here. */
async function bootAndWaitForSimulator(
  entry: DeviceEntry,
  udid: string,
): Promise<string | null> {
  const epoch = bootEpoch.next(); // this launch owns the boot; supersedes any prior
  setBootKind("simulator");
  setBooting(true);
  try {
    await iosBootDevice(udid);
    const serial = await waitForDevice((d) => d.serial === udid, epoch);
    if (!bootEpoch.isCurrent(epoch)) return null;
    if (!serial) setError(`Timed out waiting for ${entry.displayName} to boot`);
    return serial;
  } catch (e) {
    if (!bootEpoch.isCurrent(epoch)) return null; // cancelled mid-boot — leave cancel state
    setError(String(e));
    return null;
  } finally {
    if (bootEpoch.isCurrent(epoch)) setBooting(false);
  }
}

/** Same as `bootAndWaitForSimulator`, for a stopped Android AVD. */
async function bootAndWaitForEmulator(
  entry: DeviceEntry,
  avdId: string,
): Promise<string | null> {
  const epoch = bootEpoch.next(); // this launch owns the boot; supersedes any prior
  setBootKind("emulator");
  setBooting(true);
  try {
    await androidLaunchAvd(avdId);
    const serial = await waitForDevice((d) => d.avdId === avdId, epoch);
    // A cancel/supersede bumped the epoch: don't clobber its state or run.
    if (!bootEpoch.isCurrent(epoch)) return null;
    if (!serial) setError(`Timed out waiting for ${entry.displayName} to boot`);
    return serial;
  } catch (e) {
    if (!bootEpoch.isCurrent(epoch)) return null; // cancelled mid-boot — leave cancel state
    setError(String(e));
    return null;
  } finally {
    // Only this launch's boot clears the flag; a newer one owns it now.
    if (bootEpoch.isCurrent(epoch)) setBooting(false);
  }
}

/** Resolves (auto-booting a stopped AVD/simulator if needed) the local
 * device to launch onto. Aborts (no launch) if the device is offline, or a
 * needed boot failed/timed out/was cancelled. Falls through with a null
 * serial for a selection that needs no boot decision (e.g. no device
 * selected) — matching the pre-refactor behavior of launching anyway. */
async function resolveLocalLaunchDevice(): Promise<DeviceResolution> {
  const entry = resolveSelectedDevice();
  const device = entry;
  if (entry?.state === "offline") {
    setError(`${entry.displayName} is offline or unauthorized — reconnect it first`);
    return { aborted: true };
  }
  if (entry?.state === "running") {
    return { aborted: false, serial: entry.serial, device };
  }
  if (entry?.kind === "simulator" && entry.serial) {
    const serial = await bootAndWaitForSimulator(entry, entry.serial);
    if (!serial) return { aborted: true }; // boot failed / cancelled — don't launch into nothing
    return { aborted: false, serial, device };
  }
  if (entry?.avdId) {
    const serial = await bootAndWaitForEmulator(entry, entry.avdId);
    if (!serial) return { aborted: true }; // boot failed / cancelled — don't launch into nothing
    return { aborted: false, serial, device };
  }
  return { aborted: false, serial: null, device };
}

/** The friendly virtual-device name for the run-history row: emulators AND
 * simulators are named virtual devices, so record either (physical devices
 * have only a serial, so they stay null). Same column, no schema change. */
function runHistoryAvdName(
  remoteDevice: RemoteFlutterDevice | null,
  device: DeviceEntry | null,
): string | null {
  if (remoteDevice?.emulator) return remoteDevice.name;
  if (device?.kind === "emulator" || device?.kind === "simulator") return device.displayName;
  return null;
}

async function launchTarget(t: RunTarget, projectRoot: string): Promise<void> {
  openConsole();
  setError(null);
  // Capture this launch's execution facts once, synchronously, before any
  // await: the Project's remote binding and its saved device selection. Every
  // later step threads these captured values through instead of re-reading
  // the live stores, so a Project switch — or just a changed device selection
  // for the same Project — mid-await can never retarget this launch.
  const remote = remotePtyFor(projectRoot);
  const capturedSelection = selectedDevice(projectRoot, remote);

  let serial: string | null = null;
  let device: DeviceEntry | null = null;
  let remoteDevice: RemoteFlutterDevice | null = null;
  if (t.needsDevice && remote) {
    const resolved = await resolveRemoteLaunchDevice(projectRoot, remote, capturedSelection);
    if (resolved.aborted) return;
    serial = resolved.serial;
    remoteDevice = resolved.remoteDevice;
  } else if (t.needsDevice && !remote) {
    const resolved = await resolveLocalLaunchDevice();
    if (resolved.aborted) return;
    serial = resolved.serial;
    device = resolved.device;
  }

  if (!launchContextIsCurrent(projectRoot, remote)) return;
  if (serial) setRunDevice(projectRoot, serial, remote);
  // Bring up the local MCP endpoint for this project so an embedded agent can
  // re-query live context (selection / screenshot / logs) mid-run. Opt-in and
  // best-effort: it never blocks the run. Reset the run-log ring for THIS run so
  // a previous run's lines never bleed into the new run's `get_run_logs` (clears
  // once the endpoint is up — a no-op on the very first run, whose ring is empty).
  void ensureMcpRunning(projectRoot).then(mcpRunStarted);
  // Drop any stale VM connection and watch this run's output for the new VM
  // service URL so the Inspector auto-connects.
  await disconnectVm();
  if (!launchContextIsCurrent(projectRoot, remote)) return;
  const connectionMode = t.inspectorKind === "vmService" ? "vmService" : "auto";
  const run = startRun({ ...t, command: withDevice(t, serial) }, projectRoot, {
    serial,
    avdId: device?.avdId ?? null,
    avdName: runHistoryAvdName(remoteDevice, device),
    connectionMode,
  }, remote);
  armVmAutoConnect(remote && run ? { remote, projectRoot, runId: `run-${run.key}` } : undefined);
}
