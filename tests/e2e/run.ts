// Opt-in live-device E2E harness (TypeScript layer).
//
// This is the higher-level, programmatic counterpart to the Rust live-device
// integration tests. It does NOT drive the GUI (headless X has no window manager,
// so keyboard input never reaches native dialogs — see tests/e2e/README.md). It
// exercises the real run-command contract: detect a fixture's target from real
// files, then build the exact command PickForge would type at the prompt for the
// chosen device serial, reusing the PURE builders in src/lib/runTargets.ts.
//
// Gated on PICKFORGE_E2E_SERIAL. Unset → SKIP cleanly (exit 0) so CI stays green.
// Set but the device is missing/offline → FAIL FAST with a clear message.
//
//   PICKFORGE_E2E_SERIAL=emulator-5556 bun run e2e
//
// Tauri's IPC core is mocked before importing runTargets so the pure builders
// never touch a Tauri runtime (the heavy device work lives in Rust).
import { mock } from "bun:test";

mock.module("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null) }));

import { execFileSync } from "node:child_process";
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

function skip(reason: string): never {
  console.log(`SKIP e2e: ${reason}`);
  console.log("        set PICKFORGE_E2E_SERIAL (e.g. emulator-5556) to run.");
  process.exit(0);
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
function liveCommand(targetId: string, serial: string): string {
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
    source: "detected",
  };
  return withDevice(target, serial);
}

function expect(actual: string, wanted: string, what: string): void {
  if (actual !== wanted) fail(`${what}\n   expected: ${wanted}\n   actual:   ${actual}`);
  console.log(`  ok  ${what}`);
  console.log(`      → ${actual}`);
}

function main(): void {
  const serial = process.env.PICKFORGE_E2E_SERIAL?.trim();
  if (!serial) skip("PICKFORGE_E2E_SERIAL is unset");

  const online = onlineSerials();
  if (online === null) skip("adb is not on PATH");
  if (online.length === 0) skip("adb reports no online devices");
  // The var IS set, so a missing/offline target is a hard error, not a skip
  // (acceptance criterion: a set-but-unreachable serial fails fast and clearly).
  if (!online.includes(serial)) {
    fail(`PICKFORGE_E2E_SERIAL='${serial}' is not an online device (online: ${online.join(", ") || "none"})`);
  }

  console.log(`e2e: driving against ${serial}`);

  // React Native fixture → Android run pinned to the serial via ANDROID_SERIAL +
  // --deviceId (the live Android lane the emulator validates).
  const rn = detectTarget(join(FIXTURES, "rn-app"));
  if (rn.targetId !== "react-native") fail(`rn-app fixture detected as '${rn.targetId}', expected react-native`);
  console.log(`detected rn-app → ${rn.displayName} (${rn.targetId})`);
  expect(
    liveCommand(rn.targetId, serial),
    `ANDROID_SERIAL='${serial}' npx react-native run-android --deviceId '${serial}'`,
    "react-native run command pins the chosen serial",
  );

  // Flutter fixture → `flutter --color run -d <serial>`.
  const flutter = detectTarget(join(FIXTURES, "flutter-app"));
  if (flutter.targetId !== "flutter") fail(`flutter-app fixture detected as '${flutter.targetId}', expected flutter`);
  console.log(`detected flutter-app → ${flutter.displayName} (${flutter.targetId})`);
  expect(
    liveCommand(flutter.targetId, serial),
    `flutter --color run -d '${serial}'`,
    "flutter run command appends -d <serial>",
  );

  console.log("e2e: PASS");
}

main();
