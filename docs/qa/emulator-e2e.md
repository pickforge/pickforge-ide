# Emulator E2E Runner

Pickforge keeps Android emulator E2E tests out of the required pull-request CI
matrix. GitHub-hosted runners are not treated as reliable enough for this suite
because AVD image availability, boot time, hardware acceleration, and nested
virtualization vary by runner image and can turn app regressions into
infrastructure flakes.

The supported flow is a manual or scheduled run on a prepared Linux runner with:

- Flutter installed through FVM for this repo.
- Android SDK and platform tools on `PATH`.
- An AVD named `Pixel_10` by default, or another AVD passed to the script.
- `adb` access to the emulator started by the tests.

Run locally or on a self-hosted runner:

```bash
scripts/emulator_e2e.sh Pixel_10
```

Artifacts are written under `build/e2e/android/`:

- `emulator/flutter-test.log`
- `emulator/emulator-e2e.log`
- `widget-pick/flutter-test.log`
- `widget-pick/widget-pick.txt`
- `widget-pick/selected-widget.json`
- `widget-pick/inspector-root.json`
- `widget-pick/inspector-screenshot.png`

The manual GitHub Actions workflow `.github/workflows/emulator-e2e.yml` expects
a self-hosted runner labeled `self-hosted`, `linux`, and `android`. It uploads
`build/e2e/android/**` regardless of pass or failure.
