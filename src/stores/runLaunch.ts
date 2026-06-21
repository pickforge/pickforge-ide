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
import { androidLaunchAvd, type DeviceEntry } from "../lib/device";
import { withDevice } from "../lib/runTargets";
import { BootEpoch } from "../lib/bootEpoch";

const BOOT_TIMEOUT_MS = 120_000;
const BOOT_POLL_MS = 2000;

const [booting, setBooting] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);
/** True while an emulator is booting before a run. */
export const isBooting = booting;
/** Last launch error (emulator boot failure / timeout / cancellation), or null. */
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
 *  visible), auto-boots a stopped AVD if one is selected, then runs. */
export async function launchActiveTarget(): Promise<void> {
  const t = activeTarget();
  if (!t) return;
  if (booting() || runConsole.status() === "running") return; // never stack runs
  openConsole();
  setError(null);

  let serial: string | null = null;
  let device: DeviceEntry | null = null;
  if (t.needsDevice) {
    const entry = resolveSelectedDevice();
    device = entry;
    if (entry?.state === "offline") {
      setError(`${entry.displayName} is offline or unauthorized — reconnect it first`);
      return;
    }
    if (entry?.state === "running") {
      serial = entry.serial;
    } else if (entry?.avdId) {
      const epoch = bootEpoch.next(); // this launch owns the boot; supersedes any prior
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
  void disconnectVm();
  armVmAutoConnect();
  startRun({ ...t, command: withDevice(t, serial) }, workspace.activeRoot, {
    serial,
    avdId: device?.avdId ?? null,
    avdName: device?.kind === "emulator" ? device.displayName : null,
    connectionMode: t.inspectorKind === "vmService" ? "vmService" : "auto",
  });
}
