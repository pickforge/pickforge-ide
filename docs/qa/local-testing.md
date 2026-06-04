# Local Testing Strategy

Pickforge's production app is a Flutter desktop tool. It uses desktop-only
capabilities such as local files, PTY sessions, process execution, SQLite, window
management, and Android tooling. Do not treat the production app as web-runnable
without an explicit web-safe entrypoint.

## Layers

- Unit tests cover parsers, repositories, command construction, and service
  boundaries.
- Widget tests cover panes, Cubits, routing, Forge, file explorer, command
  palette, accessibility, and settings behavior.
- Golden tests protect the primary polished surfaces on Linux.
- `scripts/linux_smoke.sh` launches the Linux desktop target under Xvfb,
  verifies the demo route through the Flutter VM Service, and writes artifacts
  under `build/smoke/linux/`.
- `scripts/linux_deb_container_install_smoke.sh` installs the Linux `.deb` in a
  clean Ubuntu container with Docker or Podman, verifies package metadata/files
  and linkage, then checks first-run liveness under Xvfb.
- `scripts/linux_appimage_smoke.sh --skip-build` packages the Linux desktop
  bundle as an AppImage when needed, extracts it, verifies AppDir contents, and
  checks first-run liveness under Xvfb.
- `scripts/emulator_e2e.sh Pixel_10` runs the opt-in Android emulator E2Es and
  writes artifacts under `build/e2e/android/`.
- `scripts/desktop_build_smoke.sh` builds the current host's desktop target in
  debug mode by default.
- `scripts/desktop_launch_smoke.sh` launches the already-built macOS or Windows
  desktop app and verifies it survives a short liveness window. Linux launch
  coverage uses `scripts/linux_smoke.sh` instead because it also probes the VM
  Service under Xvfb.
- `scripts/dogfood_preflight.sh` records local agent, Android, and Flutter tool
  availability under `build/dogfood/`.
- `scripts/dirty_git_dogfood_setup.sh --source <git-project>` creates a
  disposable worktree with staged, unstaged, and untracked files for visible
  dirty-worktree Forge review.
- `docs/qa/manual-dogfood.md` describes the visible desktop and native-host
  checks that cannot be completed by headless CI.

## Web Demo Harness

The web harness exists only for UI/layout review. It is not a runtime
correctness test for Pickforge's desktop app and must not import PTY, process,
SQLite, `dart:io`, window-management, or Android tooling code.

Build the harness with:

```bash
scripts/web_demo_smoke.sh
```

The script builds `lib/web_demo.dart` into `build/web-demo/` using Flutter's
`--target` option. This keeps the desktop `lib/main.dart` out of the web build.

Use the web harness for:

- Layout checks for the fake project, explorer, terminal, and inspector panes.
- Browser screenshots when a lightweight visual review is useful.
- Regression checks that the web-safe demo entrypoint remains isolated from
  desktop-only imports.

Do not use the web harness for:

- VM Service correctness.
- Android emulator behavior.
- PTY/headless agent execution.
- Drift persistence, local files, screenshots from disk, or process execution.
