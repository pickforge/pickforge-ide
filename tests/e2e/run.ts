// Opt-in live E2E harness (TypeScript layer) — per-adapter run-command contract.
//
// This is the higher-level, programmatic counterpart to the Rust live-device
// integration tests. It does NOT drive the GUI (headless X has no window manager,
// so keyboard input never reaches native dialogs — see tests/e2e/README.md). It
// exercises the real run-command contract: detect a fixture's target from real
// files, then build the exact command PickForge would type at the prompt for the
// chosen device serial, reusing the PURE builders in src/lib/runTargets.ts.
//
// TWO concerns live here (the device-pixel round-trips live in Rust —
// crates/pickforge-core/tests/live_adapters.rs):
//
//   1. Web smoke (#37) — DEVICE-FREE, so it ALWAYS runs: assert `npm run dev`
//      is the web command, then prove the reachability probe by launching the
//      REAL web-app fixture's dev server (`npm run dev` → server.mjs) on a free
//      port and asserting HTTP 200 + the fixture's body, so a broken fixture
//      script / server fails the smoke. The server is bounded and torn down.
//   2. Device-adapter run-command contract (#34/#35/#36) — gated on
//      PICKFORGE_E2E_SERIAL: assert the built command for Flutter / React Native /
//      native-Android pins the chosen serial per its device convention.
//
// Unset PICKFORGE_E2E_SERIAL → the web smoke still runs (exit 0); the device
// asserts SKIP. Set but the device is missing/offline → FAIL FAST.
//
//   bun run e2e                                  # web smoke only
//   PICKFORGE_E2E_SERIAL=emulator-5556 bun run e2e  # + device contract
//
// Tauri's IPC core is mocked before importing runTargets so the pure builders
// never touch a Tauri runtime (the heavy device work lives in Rust).
import { mock } from "bun:test";

mock.module("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null) }));

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { detectTarget } from "./detect";
import {
  defaultCommand,
  runProfile,
  withDevice,
  type RunTarget,
} from "../../src/lib/runTargets";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");

let failed = false;

function note(reason: string): void {
  console.log(`SKIP e2e: ${reason}`);
}

function fail(reason: string): never {
  console.error(`FAIL e2e: ${reason}`);
  process.exit(1);
}

/** Online adb serials from `adb devices`, or null when adb itself is absent. */
function onlineSerials(): string[] | null {
  let out: string;
  try {
    out = execFileSync("adb", ["devices"], { encoding: "utf8", timeout: 20_000 });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null; // adb not installed
    throw e;
  }
  return out
    .split("\n")
    .slice(1) // drop the "List of devices attached" header
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/))
    .filter((parts) => parts[1] === "device")
    .map((parts) => parts[0]);
}

/** Build the live run command for a detected target + serial, the same way the
 *  workbench does: defaultCommand → runProfile → withDevice. */
function liveCommand(targetId: string, serial: string | null): string {
  const cmd = defaultCommand({ targetId } as never);
  if (cmd === null) fail(`no default command for target '${targetId}'`);
  const profile = runProfile(targetId);
  const target: RunTarget = {
    id: "detected",
    label: targetId,
    command: cmd,
    capabilities: [],
    needsDevice: profile.needsDevice,
    deviceConvention: profile.deviceConvention,
    inspectorKind: profile.inspectorKind,
    logSource: profile.logSource,
    source: "detected",
  };
  return withDevice(target, serial);
}

function expect(actual: string, wanted: string, what: string): void {
  if (actual !== wanted) {
    failed = true;
    console.error(`  FAIL ${what}\n   expected: ${wanted}\n   actual:   ${actual}`);
    return;
  }
  console.log(`  ok  ${what}`);
  console.log(`      → ${actual}`);
}

function assertDetected(dir: string, wantId: string): void {
  const d = detectTarget(join(FIXTURES, dir));
  if (d.targetId !== wantId) {
    fail(`'${dir}' fixture detected as '${d.targetId}', expected '${wantId}'`);
  }
  console.log(`detected ${dir} → ${d.displayName} (${d.targetId})`);
}

// ── #37 Web: device-free, so it always runs ────────────────────────────────
// Assert the dev-server command, then prove the reachability probe against the
// REAL web-app fixture: launch its `npm run dev` (→ server.mjs) on a free port,
// wait for the port, assert HTTP 200 + the fixture's body. Running the actual
// fixture command means a broken package.json script or server.mjs fails the
// smoke instead of passing on a throwaway server. The child is always reaped.
async function webSmoke(): Promise<void> {
  console.log("web smoke (#37): device-free");
  assertDetected("web-app", "web");

  const cmd = defaultCommand({ targetId: "web" } as never);
  expect(cmd ?? "<null>", "npm run dev", "web default command is `npm run dev`");

  const profile = runProfile("web");
  expect(String(profile.needsDevice), "false", "web is not a device target (needsDevice=false)");
  expect(profile.deviceConvention, "none", "web applies no device convention");
  expect(profile.inspectorKind, "cdp", "web inspects over CDP (inspectorKind=cdp)");

  const fixture = join(FIXTURES, "web-app");
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;

  // Run the fixture's OWN dev command (the asserted `npm run dev`), pinned to a
  // free port via PORT (server.mjs honours it). Detached into its own group so
  // we can kill the whole tree on teardown; output discarded.
  const child = spawn("npm", ["run", "dev"], {
    cwd: fixture,
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
    detached: true,
  });
  let spawnError: Error | null = null;
  child.on("error", (e) => {
    spawnError = e;
  });

  try {
    const status = await waitForHttp(url, 15_000, child, () => spawnError);
    if (status === -2) {
      fail(`web fixture \`npm run dev\` exited before serving ${url} (broken fixture script / server.mjs?)`);
    }
    expect(String(status), "200", `web fixture dev server at ${url} returns HTTP 200`);

    // Assert it's actually the fixture's HTML (its server.mjs serves index.html),
    // not some unrelated process that happened to grab the port.
    const body = await fetch(url).then((r) => r.text());
    expect(
      String(body.includes("pf-e2e-web-fixture")),
      "true",
      "web fixture serves its index.html body",
    );
  } finally {
    killTree(child);
  }
  console.log("      → web fixture dev server torn down");
}

/** Reserve and immediately release an ephemeral port, returning its number, so
 *  the fixture's server can bind it. Tiny TOCTOU window, fine for a local test. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** SIGKILL the child's whole process group (npm forks node), then the child. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGKILL"); // negative pid → the detached group
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/** Poll `url` until it answers (returns the status), `timeoutMs` elapses
 *  (returns -1), or the spawned server dies / fails to spawn first (returns -2 —
 *  fail fast instead of polling a dead server until timeout). */
async function waitForHttp(
  url: string,
  timeoutMs: number,
  child: ChildProcess,
  spawnError: () => Error | null,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (spawnError() !== null) return -2;
    if (child.exitCode !== null || child.signalCode !== null) return -2;
    try {
      const res = await fetch(url);
      return res.status;
    } catch {
      if (Date.now() >= deadline) return -1;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

// ── #34/#35/#36 device adapters: run-command contract, gated on a serial ────
function deviceContract(serial: string): void {
  console.log(`device contract: driving against ${serial}`);

  // #34 Flutter → `flutter --color run -d '<serial>'`, inspected over the VM
  // service. Asserting inspectorKind guards the vm-service inspector wiring: a
  // regression that drops it can't silently false-pass on the run command alone.
  assertDetected("flutter-app", "flutter");
  expect(
    liveCommand("flutter", serial),
    `flutter --color run -d '${serial}'`,
    "flutter run command appends -d <serial>",
  );
  expect(
    runProfile("flutter").inspectorKind,
    "vmService",
    "flutter inspects over the VM service (inspectorKind=vmService)",
  );

  // #35 React Native → ANDROID_SERIAL + --deviceId pin the chosen serial;
  // inspected via UIAutomator.
  assertDetected("rn-app", "react-native");
  expect(
    liveCommand("react-native", serial),
    `ANDROID_SERIAL='${serial}' npx react-native run-android --deviceId '${serial}'`,
    "react-native run command pins the chosen serial",
  );
  expect(
    runProfile("react-native").inspectorKind,
    "uiAutomator",
    "react-native inspects over UIAutomator (inspectorKind=uiAutomator)",
  );

  // #36 native-Android → ANDROID_SERIAL prefixes `./gradlew installDebug`;
  // inspected via UIAutomator (same lane as RN).
  assertDetected("native-android-app", "native-android");
  expect(
    liveCommand("native-android", serial),
    `ANDROID_SERIAL='${serial}' ./gradlew installDebug`,
    "native-android run command prefixes ANDROID_SERIAL",
  );
  expect(
    runProfile("native-android").inspectorKind,
    "uiAutomator",
    "native-android inspects over UIAutomator (inspectorKind=uiAutomator)",
  );
}

// ── native-iOS: run-command contract is pure, so it always runs (the live
// simulator smokes live in crates/pickforge-core/tests/live_adapters.rs) ────
function iosContract(): void {
  console.log("native-ios contract: device-free");
  assertDetected("native-ios-app", "native-ios");

  const udid = "0000AAAA-1111-2222-3333-4444BBBB5555";
  // A bare `xcodebuild build` only COMPILES — the run command must build a
  // SIMULATOR app (`-sdk iphonesimulator`; a destination alone builds the device
  // SDK, which simctl can't install), then `simctl install` + `simctl launch`
  // the freshly-built app so the RUNNING app is what the screenshot / os_log
  // panels inspect. The bundle id is read from the built app at runtime.
  expect(
    liveCommand("native-ios", udid),
    `xcodebuild build -configuration Debug -sdk iphonesimulator SYMROOT=build/pickforge-ios && ` +
      `APP="$(ls -d build/pickforge-ios/Debug-iphonesimulator/*.app | head -1)" && ` +
      `xcrun simctl install '${udid}' "$APP" && ` +
      `xcrun simctl launch '${udid}' "$(plutil -extract CFBundleIdentifier raw "$APP/Info.plist")"`,
    "native-ios run command builds → installs → launches the app on the sim",
  );
  const profile = runProfile("native-ios");
  expect(
    profile.inspectorKind,
    "iosAccessibility",
    "native-ios inspects the accessibility tree via idb (inspectorKind=iosAccessibility)",
  );
  expect(profile.logSource, "oslog", "native-ios streams device logs over os_log");
}

async function main(): Promise<void> {
  // Device-free web smoke ALWAYS runs (it's the harness shakedown).
  await webSmoke();

  // Device-free native-iOS command contract always runs too.
  iosContract();

  const serial = process.env.PICKFORGE_E2E_SERIAL?.trim();
  if (!serial) {
    note("PICKFORGE_E2E_SERIAL unset — device-adapter run-command contract skipped");
    console.log("        set PICKFORGE_E2E_SERIAL (e.g. emulator-5556) to run it.");
  } else {
    const online = onlineSerials();
    if (online === null) {
      note("adb is not on PATH — device contract skipped");
    } else if (online.length === 0) {
      note("adb reports no online devices — device contract skipped");
    } else if (!online.includes(serial)) {
      // The var IS set, so a missing/offline target is a hard error, not a skip.
      fail(`PICKFORGE_E2E_SERIAL='${serial}' is not an online device (online: ${online.join(", ") || "none"})`);
    } else {
      deviceContract(serial);
    }
  }

  if (failed) {
    console.error("e2e: FAIL");
    process.exit(1);
  }
  console.log("e2e: PASS");
}

main().catch((e) => fail(String(e)));
