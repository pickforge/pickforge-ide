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

// Bumped on every launch and on cancel, so a stale boot can't latch a later run:
// `waitForBootedSerial` polls it to break promptly, and `launchActiveTarget`
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

/** Poll the device list until a running emulator with this AVD id appears, and
 *  return its serial — or null if it doesn't boot within the timeout, or if this
 *  boot was cancelled / superseded (its `epoch` no longer matches `bootEpoch`).
 *  The abort is observed each iteration and inside an abortable poll sleep, so a
 *  cancel breaks out within ~one poll tick instead of waiting the full timeout. */
async function waitForBootedSerial(avdId: string, epoch: number): Promise<string | null> {
  const live = () => bootEpoch.isCurrent(epoch);
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (live() && Date.now() < deadline) {
    const list = await refreshDevices();
    if (!live()) return null; // cancelled while awaiting the device list
    const hit = list.find(
      (d) => d.state === "running" && d.avdId === avdId && d.serial,
    );
    if (hit?.serial) return hit.serial;
    await abortableSleep(BOOT_POLL_MS, live);
  }
  return null;
}

/** Poll the device list until the simulator with this udid reports "running",
 *  and return its serial — or null on timeout / cancellation. A simulator keeps
 *  its udid as `serial` across the boot transition (unlike an AVD, whose serial
 *  only appears once booted), so we match on that stable udid. Cancellable via
 *  the same `bootEpoch` as the AVD wait. */
async function waitForBootedSimulator(udid: string, epoch: number): Promise<string | null> {
  const live = () => bootEpoch.isCurrent(epoch);
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (live() && Date.now() < deadline) {
    const list = await refreshDevices();
    if (!live()) return null; // cancelled while awaiting the device list
    const hit = list.find((d) => d.state === "running" && d.serial === udid);
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
  if (!t) return;
  if (launching || booting() || runConsole.status() === "running") return;
  launching = true;
  try {
    await launchTarget(t);
  } finally {
    launching = false;
  }
}

async function launchTarget(t: RunTarget): Promise<void> {
  openConsole();
  setError(null);
  const remote = remotePtyFor(workspace.activeRoot);

  let serial: string | null = null;
  let device: DeviceEntry | null = null;
  if (t.needsDevice && !remote) {
    const entry = resolveSelectedDevice();
    device = entry;
    if (entry?.state === "offline") {
      setError(`${entry.displayName} is offline or unauthorized — reconnect it first`);
      return;
    }
    if (entry?.state === "running") {
      serial = entry.serial;
    } else if (entry?.kind === "simulator" && entry.serial) {
      // Stopped iOS simulator: `simctl boot` it and wait until it reports
      // running. Mirrors the AVD boot/wait UX (bounded timeout, cancellable),
      // but keyed on the udid, which is stable across the boot.
      const udid = entry.serial;
      const epoch = bootEpoch.next(); // this launch owns the boot; supersedes any prior
      setBootKind("simulator");
      setBooting(true);
      try {
        await iosBootDevice(udid);
        serial = await waitForBootedSimulator(udid, epoch);
        if (!bootEpoch.isCurrent(epoch)) return;
        if (!serial) setError(`Timed out waiting for ${entry.displayName} to boot`);
      } catch (e) {
        if (!bootEpoch.isCurrent(epoch)) return; // cancelled mid-boot — leave cancel state
        setError(String(e));
      } finally {
        if (bootEpoch.isCurrent(epoch)) setBooting(false);
      }
      if (!serial) return; // boot failed / cancelled — don't launch into nothing
    } else if (entry?.avdId) {
      const epoch = bootEpoch.next(); // this launch owns the boot; supersedes any prior
      setBootKind("emulator");
      setBooting(true);
      try {
        await androidLaunchAvd(entry.avdId);
        serial = await waitForBootedSerial(entry.avdId, epoch);
        // A cancel/supersede bumped the epoch: don't clobber its state or run.
        if (!bootEpoch.isCurrent(epoch)) return;
        if (!serial) setError(`Timed out waiting for ${entry.displayName} to boot`);
      } catch (e) {
        if (!bootEpoch.isCurrent(epoch)) return; // cancelled mid-boot — leave cancel state
        setError(String(e));
      } finally {
        // Only this launch's boot clears the flag; a newer one owns it now.
        if (bootEpoch.isCurrent(epoch)) setBooting(false);
      }
      if (!serial) return; // boot failed / cancelled — don't launch into nothing
    }
  }

  if (serial && workspace.activeRoot) setRunDevice(workspace.activeRoot, serial);
  // Bring up the local MCP endpoint for this project so an embedded agent can
  // re-query live context (selection / screenshot / logs) mid-run. Opt-in and
  // best-effort: it never blocks the run. Reset the run-log ring for THIS run so
  // a previous run's lines never bleed into the new run's `get_run_logs` (clears
  // once the endpoint is up — a no-op on the very first run, whose ring is empty).
  void ensureMcpRunning(workspace.activeRoot).then(mcpRunStarted);
  // Drop any stale VM connection and watch this run's output for the new VM
  // service URL so the Inspector auto-connects.
  await disconnectVm();
  const run = startRun({ ...t, command: withDevice(t, serial) }, workspace.activeRoot, {
    serial,
    avdId: device?.avdId ?? null,
    // The friendly virtual-device name for the run-history row: emulators AND
    // simulators are named virtual devices, so record either (physical devices
    // have only a serial, so they stay null). Same column, no schema change.
    avdName:
      device?.kind === "emulator" || device?.kind === "simulator"
        ? device.displayName
        : null,
    connectionMode: t.inspectorKind === "vmService" ? "vmService" : "auto",
  }, remote);
  armVmAutoConnect(
    remote && run && workspace.activeRoot
      ? { remote, projectRoot: workspace.activeRoot, runId: `run-${run.key}` }
      : undefined,
  );
}
