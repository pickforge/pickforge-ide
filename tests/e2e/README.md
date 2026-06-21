# Live-device E2E harness

The Playwright VRT (`bun run vrt`) runs the UI in plain Chromium with
`src/lib/tauriMock.ts` stubbing every IPC call — great for visual regressions,
but it proves nothing about real device flows. This harness fills that gap: it
drives the **real** device/run/inspect functionality against a live emulator or
handset.

It is **opt-in**. Nothing here runs in a normal `cargo test` or `bun run vrt`,
and CI without a device stays green. Everything is gated on one env var:

```sh
PICKFORGE_E2E_SERIAL=emulator-5556   # the adb serial to drive
```

## Why not GUI click-through?

Automated GUI driving (xdotool/ydotool typing into the running app) is **not
viable** in this/CI environment: headless X has no window manager, so synthetic
keyboard input never reaches native dialogs/focus. So the harness drives the real
functionality **programmatically through the core commands**, not the GUI. The
device-pixel work happens in Rust against the live device; the TypeScript layer
asserts the run-command contract.

`scrcpy` CLI is also **absent**, so device-frame capture uses
`adb exec-out screencap -p` (what `capture_screenshot` already does), never
scrcpy.

## Layers

### 1. Rust live-device integration tests — the device assertions

`crates/pickforge-core/tests/live_device.rs` drives the real Android bridges in
the core (`android::{list_devices, capture_screenshot, dump_uiautomator_xml,
parse_uiautomator, logcat_event}`):

- the serial appears **online** in `list_devices()`,
- `capture_screenshot` writes a non-empty **PNG** (verified by magic bytes),
- `dump_uiautomator_xml` → `parse_uiautomator` yields a non-empty `A11yNode`
  tree (root + children),
- a real `adb logcat -v threadtime` dump parses into `LogEvent`s with a known
  level/source.

Run them (they're regular `#[test]`s that **skip cleanly** when the gate is
closed, so no `--ignored` flag is needed):

```sh
# Skips cleanly (prints `skipped: … set PICKFORGE_E2E_SERIAL`):
cargo test -p pickforge-core --test live_device

# Runs against the real device (use --nocapture to see the per-test detail):
PICKFORGE_E2E_SERIAL=emulator-5556 \
  cargo test -p pickforge-core --test live_device -- --nocapture
```

The logcat test dumps a bounded slice (`adb logcat -d … -t 200`) and never
leaves an `adb logcat` stream running.

### 2. TypeScript run-command harness — the run contract

`bun run e2e` (→ `tests/e2e/run.ts`) detects each fixture project's target from
real files (`tests/e2e/fixtures/`, mirroring the core's `detect_target` rules),
then builds the exact command PickForge would type at the prompt for the chosen
serial — reusing the **pure** builders in `src/lib/runTargets.ts`
(`defaultCommand` / `runProfile` / `withDevice`).

The **web smoke (#37) is device-free, so it ALWAYS runs** (it's the harness
shakedown): it asserts `web → npm run dev`, confirms web is not a device target,
then proves the reachability probe by spinning a throwaway local server and
asserting an HTTP 200 from the served URL (and tears the server down).

The **device-adapter run-command contract** is gated on `PICKFORGE_E2E_SERIAL`.
For the live serial it asserts:

- Flutter (#34) → `flutter --color run -d '<serial>'`
- React Native (#35) →
  `ANDROID_SERIAL='<serial>' npx react-native run-android --deviceId '<serial>'`
- native-Android (#36) → `ANDROID_SERIAL='<serial>' ./gradlew installDebug`

```sh
# Runs the web smoke; the device contract SKIPS (exit 0) without a serial:
bun run e2e

# Adds the device run-command contract for the live serial:
PICKFORGE_E2E_SERIAL=emulator-5556 bun run e2e
```

Keep this layer lightweight — the heavy device assertions belong in layers 1 & 3.

### 3. Per-adapter live smokes — two opt-in tiers (#34–#37)

`crates/pickforge-core/tests/live_adapters.rs` proves each adapter end-to-end
**per target**, in two tiers so CI stays green while deep live runs are still
possible. (Web — #37 — needs no device and lives entirely in layer 2 above.)

**Tier A — always-on-with-device** (gated on `PICKFORGE_E2E_SERIAL`, like #33).
Per adapter it detects the fixture, then asserts the device-layer round-trip that
adapter depends on against whatever is on screen — fast, no app build:

| Adapter (#)            | Detects          | Device round-trip asserted                 |
| ---------------------- | ---------------- | ------------------------------------------ |
| Flutter (#34)          | `flutter`        | screencap → PNG, uiautomator → tree        |
| React Native (#35)     | `react-native`   | screencap → PNG, uiautomator → tree, logcat → events |
| native-Android (#36)   | `native-android` | screencap → PNG, uiautomator → tree, logcat → events |

```sh
# Skips cleanly without a serial; runs Tier A against the device when set:
PICKFORGE_E2E_SERIAL=emulator-5556 \
  cargo test -p pickforge-core --test live_adapters -- --nocapture
```

**Tier B — heavy real-launch** (gated behind the ADDITIONAL `PICKFORGE_E2E_LAUNCH=1`
flag, because a real `flutter run` / `gradle` / `metro` build is slow and flaky).
It actually launches an app on the serial, waits for it to **foreground** (via
`dumpsys activity activities` / `pidof`), screenshots + dumps UIAutomator of the
**running** app, then stops it and asserts clean teardown (process gone, the
launch process-group SIGKILLed on drop, device still online). It **SKIPS loudly**
unless the flag is set AND a project + toolchain are present, so a plain
`cargo test` / CI never triggers a multi-minute build.

The Flutter heavy smoke launches `flutter --color run -d <serial>` against a real
buildable project — the repo's `fixtures/sample_flutter_app` by default, overridable
via `PICKFORGE_E2E_FLUTTER_PROJECT` (+ `PICKFORGE_E2E_FLUTTER_PACKAGE` for the
applicationId it waits to foreground):

```sh
# Tier A + Tier B (real launch on the emulator):
PICKFORGE_E2E_SERIAL=emulator-5556 PICKFORGE_E2E_LAUNCH=1 \
  cargo test -p pickforge-core --test live_adapters -- --nocapture --test-threads=1
```

Every skip prints a `skipped: …` line naming the missing gate, so a skipped heavy
tier never silently reads as a pass. No `adb` / build process is left running: the
logcat dump is bounded (`-d -t 200`) and the launch is spawned in its own process
group and SIGKILLed (group-wide) on teardown.

## Gating: skip vs. run vs. fail

| Condition                                   | Rust tests        | `bun run e2e`             |
| ------------------------------------------- | ----------------- | ------------------------- |
| `PICKFORGE_E2E_SERIAL` unset                | skip (pass)       | web smoke runs; device contract skips (exit 0) |
| adb missing / no online devices             | skip (pass)       | web smoke runs; device contract skips (exit 0) |
| var set, but that serial is offline/missing | skip (pass)       | **fail fast**             |
| var set, serial online                      | Tier A asserts the device | asserts the run contract |
| `PICKFORGE_E2E_LAUNCH=1` (+ serial)         | adds Tier B (real launch) | n/a                |

(The Rust layer treats a set-but-offline serial as a skip so an unrelated `cargo
test` run can never go red on a device hiccup; the TypeScript layer, being the
explicit `bun run e2e` entry, fails fast to surface a wrong serial. The web smoke
needs no device, so it runs regardless of the serial.)

## Required tools

- `adb` on PATH, with a target device online (`adb devices` shows it as
  `device`). The verified default is `emulator-5556`.
- `cargo` (layers 1 & 3) and `bun` (layer 2).
- No `scrcpy` CLI is needed (and none is present) — screenshots go through
  `adb exec-out screencap`.
- **Tier B only** (`PICKFORGE_E2E_LAUNCH=1`): the relevant SDK/toolchain
  (`flutter` on PATH for the Flutter heavy smoke) and a real buildable project
  (defaults to `fixtures/sample_flutter_app`). Missing → that smoke skips loudly.

## Per-adapter coverage (#34–#37)

The shared primitives (device list, screenshot, UIAutomator dump, logcat parse)
and the run-command contract are proven in layers 1 & 2. The per-target smokes
now live in:

- **#34 Flutter / #35 React Native / #36 native-Android** —
  `crates/pickforge-core/tests/live_adapters.rs` (Tier A device round-trip + Tier
  B real launch, see "3. Per-adapter live smokes" above).
- **#37 Web** — `tests/e2e/run.ts` (device-free: `npm run dev` + reachability
  probe; always runs).
