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
(`defaultCommand` / `runProfile` / `withDevice`). It asserts, for the live serial:

- React Native →
  `ANDROID_SERIAL='<serial>' npx react-native run-android --deviceId '<serial>'`
- Flutter → `flutter --color run -d '<serial>'`

```sh
# Skips cleanly (exit 0) when PICKFORGE_E2E_SERIAL is unset:
bun run e2e

# Runs against the live serial:
PICKFORGE_E2E_SERIAL=emulator-5556 bun run e2e
```

Keep this layer lightweight — the heavy device assertions belong in layer 1.

## Gating: skip vs. run vs. fail

| Condition                                   | Rust test         | `bun run e2e`     |
| ------------------------------------------- | ----------------- | ----------------- |
| `PICKFORGE_E2E_SERIAL` unset                | skip (pass)       | skip (exit 0)     |
| adb missing / no online devices             | skip (pass)       | skip (exit 0)     |
| var set, but that serial is offline/missing | skip (pass)       | **fail fast**     |
| var set, serial online                      | assert the device | assert the run    |

(The Rust layer treats a set-but-offline serial as a skip so an unrelated `cargo
test` run can never go red on a device hiccup; the TypeScript layer, being the
explicit `bun run e2e` entry, fails fast to surface a wrong serial.)

## Required tools

- `adb` on PATH, with a target device online (`adb devices` shows it as
  `device`). The verified default is `emulator-5556`.
- `cargo` (layer 1) and `bun` (layer 2).
- No `scrcpy` CLI is needed (and none is present) — screenshots go through
  `adb exec-out screencap`.

## Deferred to the per-adapter smokes (#34–#37)

This harness proves the **shared primitives** (device list, screenshot,
UIAutomator dump, logcat parse) and the **run-command contract** live. Per-target
end-to-end smokes — actually launching a RN / native-Android / web / Flutter app
on the device, asserting it boots, hot-reload/restart keystrokes, and
inspect-selection round-trips against the running app — are tracked separately in
issues #34–#37.
