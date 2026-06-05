# Native Host Validation

This runbook closes the checks that cannot be proven from a Linux-only session.
Do not tick the related plan or release checklist boxes until the relevant host
has run these steps and saved the listed evidence.

## Shared Setup

Run from the Pickforge repository worktree:

```bash
mkdir -p build/dogfood/native-host
fvm flutter --version | tee build/dogfood/native-host/flutter-version.txt
fvm flutter doctor -v | tee build/dogfood/native-host/flutter-doctor.txt
fvm flutter devices --machine | tee build/dogfood/native-host/flutter-devices.json
scripts/dogfood_preflight.sh | tee build/dogfood/native-host/dogfood-preflight.txt
fvm dart format --set-exit-if-changed .
fvm flutter analyze
fvm flutter test --reporter=compact | tee build/dogfood/native-host/flutter-test.txt
```

Run desktop build and launch smoke on the native host:

```bash
PICKFORGE_DESKTOP_BUILD_MODE=debug scripts/desktop_build_smoke.sh \
  | tee build/dogfood/native-host/desktop-build-smoke.txt
PICKFORGE_DESKTOP_BUILD_MODE=debug scripts/desktop_launch_smoke.sh \
  | tee build/dogfood/native-host/desktop-launch-smoke.txt
```

The launch smoke proves only short app liveness. The live VM Service and
inspector checks below still require visible desktop interaction.

## macOS And iOS Simulator

Prerequisites:

- macOS host with Xcode installed and selected by `xcode-select`.
- At least one bootable iOS Simulator.
- Flutter macOS and iOS tooling enabled for the pinned FVM Flutter version.
- A visible desktop session where Pickforge windows and Simulator windows can be
  interacted with.

Record host details:

```bash
xcode-select -p | tee build/dogfood/native-host/xcode-select.txt
xcodebuild -version | tee build/dogfood/native-host/xcodebuild-version.txt
xcrun simctl list devices available --json \
  | tee build/dogfood/native-host/simctl-devices.json
```

Boot an iOS Simulator and run the sample target:

```bash
open -a Simulator
xcrun simctl bootstatus booted -b \
  | tee build/dogfood/native-host/simctl-bootstatus.txt
cd fixtures/sample_flutter_app
fvm flutter run -d <ios-simulator-id> --machine \
  | tee ../../build/dogfood/native-host/ios-simulator-run.jsonl
```

Keep the sample app running. In another terminal, start Pickforge:

```bash
cd /path/to/pickforge
fvm flutter run -d macos --dart-define=PICKFORGE_INITIAL_ROUTE=/workbench \
  | tee build/dogfood/native-host/pickforge-macos-run.log
```

Manual pass criteria:

- Add `fixtures/sample_flutter_app` as the active Pickforge project.
- Attach to the iOS Simulator target VM Service from the running sample app.
- The connection/status pill reaches `Running`.
- Selecting a user-code widget populates the inspector details panel.
- The selected widget creation location resolves to
  `fixtures/sample_flutter_app/lib/main.dart`.
- Forge writes `.pickforge/skill-active.md`, `.pickforge/widget-context.md`,
  `.pickforge/initial-prompt.md`, `.pickforge/screenshot.png`, and the iOS
  simulator screenshot when available.
- The visible embedded terminal transcript contains the `[Pickforge sent prompt]`
  marker.

Save these artifacts before ticking the iOS validation checkbox:

- `build/dogfood/native-host/flutter-devices.json`
- `build/dogfood/native-host/simctl-devices.json`
- `build/dogfood/native-host/ios-simulator-run.jsonl`
- `build/dogfood/native-host/pickforge-macos-run.log`
- A screenshot of Pickforge showing the selected user-code widget.
- The latest `.pickforge/` context directory from the sample app.

## macOS Desktop Target

Run the sample app as a macOS desktop target:

```bash
cd fixtures/sample_flutter_app
fvm flutter run -d macos --machine \
  | tee ../../build/dogfood/native-host/sample-macos-run.jsonl
```

Manual pass criteria:

- Pickforge attaches to the macOS desktop target VM Service.
- The inspector can select a user-code widget from the macOS sample window.
- Forge prompt delivery and `.pickforge/` context files match the iOS criteria.
- `scripts/desktop_launch_smoke.sh` passed on the same host before the manual
  pass.

Save `sample-macos-run.jsonl`, the Pickforge run log, a selected-widget
screenshot, and the sample app `.pickforge/` directory.

## Windows Desktop Target

Prerequisites:

- Native Windows host with Visual Studio Desktop development tooling.
- Git Bash, MSYS2, or another shell that can run the repository Bash scripts.
- Flutter Windows desktop enabled for the pinned FVM Flutter version.
- A visible desktop session where Pickforge and the sample app can be
  interacted with.

Record host details:

```bash
fvm flutter config --enable-windows-desktop
fvm flutter devices --machine \
  | tee build/dogfood/native-host/windows-flutter-devices.json
```

Build and launch Pickforge:

```bash
PICKFORGE_DESKTOP_BUILD_MODE=debug scripts/desktop_build_smoke.sh \
  | tee build/dogfood/native-host/windows-desktop-build-smoke.txt
PICKFORGE_DESKTOP_BUILD_MODE=debug scripts/desktop_launch_smoke.sh \
  | tee build/dogfood/native-host/windows-desktop-launch-smoke.txt
fvm flutter run -d windows --dart-define=PICKFORGE_INITIAL_ROUTE=/workbench \
  | tee build/dogfood/native-host/pickforge-windows-run.log
```

Run the sample app as a Windows desktop target:

```bash
cd fixtures/sample_flutter_app
fvm flutter run -d windows --machine \
  | tee ../../build/dogfood/native-host/sample-windows-run.jsonl
```

Manual pass criteria:

- Pickforge attaches to the Windows desktop target VM Service.
- The inspector can select a user-code widget from the Windows sample window.
- Forge writes the expected `.pickforge/` context files.
- The visible embedded terminal transcript contains the `[Pickforge sent prompt]`
  marker.
- Process cleanup leaves no stuck Pickforge or sample app process after exit.

Save `windows-flutter-devices.json`, `sample-windows-run.jsonl`, the Pickforge
run log, a selected-widget screenshot, and the sample app `.pickforge/`
directory.

## What Remains Blocked Until These Pass

- P3.T3: live iOS Simulator VM Service and inspector extension validation.
- P3.T5: live macOS and Windows desktop VM Service and inspector validation.
- P7.T3: Sparkle updater enablement, which still requires signed/notarized
  macOS releases, production EdDSA keys, passing appcast smoke output, and
  update/rollback evidence from `docs/architecture/sparkle-updates.md`.
- P7.T4: macOS signing/notarization and Windows Authenticode/SmartScreen
  validation with real release credentials.
- P9.T3: public release signoff on macOS and Windows native hosts.
