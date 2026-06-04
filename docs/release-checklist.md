# Pickforge Release Dogfood Checklist

Run this checklist before tagging a release. Automated checks are required, but
they do not replace manual dogfood on real desktop hosts.

## Automated Preflight

- [ ] `fvm dart run build_runner build --delete-conflicting-outputs`
- [ ] `fvm dart format --set-exit-if-changed .`
- [ ] `fvm flutter analyze`
- [ ] `fvm flutter test --reporter=compact`
- [ ] `scripts/desktop_build_smoke.sh` on each desktop host.
- [ ] `scripts/desktop_launch_smoke.sh` on macOS and Windows after the desktop build smoke.
- [ ] `scripts/linux_smoke.sh` on Linux.
- [ ] `scripts/package_linux_deb.sh --skip-build` after the Linux release build.
- [ ] `scripts/linux_deb_smoke.sh --skip-build` after the Linux package is created.
- [ ] `scripts/linux_deb_container_install_smoke.sh --skip-build` on Linux with Docker or Podman.
- [ ] `scripts/linux_deb_signing_smoke.sh --skip-build` with an ephemeral key.
- [ ] `scripts/package_linux_appimage.sh --skip-build` after the Linux release build.
- [ ] `scripts/linux_appimage_smoke.sh --skip-build` after the Linux release build.
- [ ] `scripts/linux_installed_visible_smoke.sh` after installing the Linux package on a visible desktop host.
- [ ] `scripts/missing_tool_smoke.sh` on Linux.
- [ ] `scripts/linux_visible_diagnostics_smoke.sh` from a visible Linux desktop session.
- [ ] `scripts/emulator_e2e.sh Pixel_10` on a prepared Android runner.
- [ ] `scripts/dogfood_preflight.sh` before manual dogfood.
- [ ] `scripts/agent_profile_pty_smoke.sh` on Linux with installed Claude Code, Codex, and OpenCode CLIs.
- [ ] Review CI artifacts for golden failures, desktop build failures, Linux smoke output, and emulator E2E logs/screenshots.
- [ ] Review `docs/architecture/distribution.md` for current package, signing, and update-channel gates.

## Cold-Install Smoke

- [ ] Fresh VM or clean machine for Linux.
- [ ] Fresh VM or clean machine for macOS before public release.
- [ ] Install the built desktop artifact.
- [ ] App launches, keeps the expected desktop window behavior, and starts on onboarding or the last workspace.
- [ ] Demo mode opens without Android tooling and shows fake project, device, widget, explorer, and chat data.

## Project And Target Binding

- [ ] Add `fixtures/sample_flutter_app` or a real Flutter app as a Pickforge project.
- [ ] Bind an Android AVD to the project settings.
- [ ] Start the app from Pickforge or attach with a manual VM Service URL.
- [ ] Connection/status pill reaches `Running`.
- [ ] Disconnect and reconnect without a crash.
- [ ] Restart Pickforge and confirm the project binding is remembered.
- [ ] Kill the target app mid-session and confirm Pickforge shows a recoverable error or reconnecting state, then recovers after restart.

## Widget Pick To Forge

- [ ] Tap a user-code widget in the target app and verify it appears in the inspector details panel.
- [ ] Tap a framework widget and verify **Forge it** is disabled with the user-code eligibility hint.
- [ ] Select an active chat for the active project.
- [ ] Press **Forge it** and verify the prompt appears in the visible active embedded terminal session.
- [ ] Forge once with each installed agent profile: Claude Code (`claude`), Codex (`codex`), OpenCode (`opencode`), Cursor (`agent`), and Gemini (`gemini`).
- [ ] For each missing agent binary, verify setup checks show a recoverable missing-binary state.

## Context Files

- [ ] Verify `.pickforge/.gitignore` exists and ignores generated context by default.
- [ ] Verify `.pickforge/skill-active.md`, `.pickforge/widget-context.md`, and `.pickforge/initial-prompt.md` are written for the latest forge request.
- [ ] Verify `.pickforge/screenshot.png` is present when inspector screenshot capture succeeds.
- [ ] With `adb` available, verify `.pickforge/device-screen.png` is written and referenced in the prompt.
- [ ] With `adb` unavailable, verify forge still works without device-screen capture.
- [ ] After hot reload, verify `.pickforge/device-screen-after-hot-reload.png` is captured when the target supports it.
- [ ] Verify the user's existing `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md` files are untouched.

## Workspace UX

- [ ] Left pane list and grid modes render real projects/chats with grouping, pinning, and density settings.
- [ ] Project file explorer respects ignore rules and can open/reveal/copy project files.
- [ ] Context attachments tray shows selected widget, screenshots, logs, files, and custom notes.
- [ ] Command palette opens with Ctrl+K / Cmd+K and runs project, chat, device, settings, run, hot reload, and forge actions.
- [ ] Settings view reads and writes project-scoped defaults.

## Hot Reload And Review

- [ ] Hot reload from Pickforge refreshes the widget tree and keeps selection state understandable.
- [ ] Selecting a new widget post-reload still works.
- [ ] Dirty project warning appears before forge when the target repo has
  uncommitted changes; use
  `scripts/dirty_git_dogfood_setup.sh --source <git-project>` for a disposable
  staged/unstaged/untracked project.
- [ ] After agent edits, changed files and diff summary are visible.
- [ ] Copy diff, open changed file, and discard-instructions actions work.

## Keyboard And Accessibility

- [ ] Keyboard-only pass covers sidebar, file explorer, inspector, settings, dialogs, command palette, terminal focus, and forge.
- [ ] High-contrast dark theme remains readable.
- [ ] Larger text scale does not overflow primary panes and dialogs.
- [ ] Icon-only controls have accessible labels or tooltips.

## Latest Recorded Results

### Linux - 2026-06-04

- Automated checks passed: `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, `scripts/linux_smoke.sh`, and `scripts/emulator_e2e.sh Pixel_10`.
- `scripts/linux_smoke.sh` reached `DemoWorkspaceView` through the Flutter VM Service and wrote `build/smoke/linux/flutter-run.log`, `build/smoke/linux/inspector-root.json`, and `build/smoke/linux/first-frame.png`.
- `scripts/emulator_e2e.sh Pixel_10` passed both emulator and widget-pick E2Es and wrote logs plus the inspector screenshot under `build/e2e/android/`.
- Visible desktop pass completed project binding and embedded-terminal prompt delivery against `/home/dev/Development/Personal/MyGamesList/app` on `emulator-5554`: selected the app-owned sign-in `ElevatedButton`, pressed **Forge it**, verified `.pickforge/` context files, and verified the active transcript starts with `[Pickforge sent prompt]`.
- `scripts/linux_visible_diagnostics_smoke.sh` passed in a visible KDE Wayland desktop session. It verified onboarding setup checks for all-present tools plus missing `claude`, `codex`, `opencode`, `agent`, `gemini`, and `adb`, and wrote inspector JSON plus screenshots under `build/dogfood/visible-diagnostics/`.
- `scripts/agent_profile_pty_smoke.sh` passed for installed Claude Code, Codex, and OpenCode. It launched each real CLI through the embedded PTY adapter, generated disposable `.pickforge/` context, verified the Pickforge prompt marker in each transcript, and wrote transcripts/context artifacts under `build/dogfood/agent-profile-pty/`.
- `scripts/linux_deb_smoke.sh --skip-build` passed against `build/dist/linux/pickforge_0.1.0+1_amd64.deb`. It verified the `.deb` checksum, Debian members/control metadata, extracted app bundle, launcher symlink, desktop/icon files, and first-run liveness from a clean HOME under Xvfb. Headless Xvfb did not expose a discoverable window and the screenshot was blank, matching the known headless limitation.
- `scripts/linux_deb_container_install_smoke.sh --skip-build --image ubuntu:26.04` passed against the locally built `build/dist/linux/pickforge_0.1.0+1_amd64.deb`. The default Ubuntu 24.04 baseline correctly fails for the local CachyOS-built artifact because `librive_native_plugin.so` requires `GLIBC_2.43`; release CI is pinned to Ubuntu 24.04 and runs the default smoke after building there.
- `scripts/linux_deb_signing_smoke.sh --skip-build` passed with an ephemeral GPG key. It created and verified detached armored signatures for both the Linux `.deb` and its SHA-256 checksum.
- `scripts/linux_appimage_smoke.sh --skip-build` passed against `build/dist/linux/Pickforge-0.1.0+1-x86_64.AppImage`. It generated the AppImage with `appimagetool`, verified checksum and extracted AppDir contents, and proved first-run liveness under Xvfb.
- `scripts/linux_installed_visible_smoke.sh` passed as a dry run against `build/linux/x64/release/bundle/pickforge`, launching Pickforge with a clean HOME in the visible KDE Wayland desktop session and writing `build/dogfood/linux-installed-visible-dry-run/app.log`, `window-info.env`, and `desktop.png`. `xdotool` could not discover the Wayland window, but the screenshot was nonblank and showed the Pickforge first-run window. The true `/usr/bin/pickforge` post-install pass remains pending because this shell cannot run passwordless sudo.
- Remaining Linux signoff gaps: true visible sudo install on a fresh VM or clean machine, plus configuring the protected release signing key secret before public tags. Cursor/Gemini real-agent passes remain pending until those binaries are installed locally.

### macOS

- Pending native macOS host dogfood before public release. Use
  `docs/qa/native-host-validation.md` for the iOS Simulator and macOS desktop
  evidence required before ticking the macOS checklist items.

### Windows

- Pending native Windows host dogfood before public release. Use
  `docs/qa/native-host-validation.md` for the Windows desktop evidence required
  before ticking the Windows checklist items.

## Release Signoff

- [ ] Linux dogfood pass completed on a real desktop session.
- [ ] macOS dogfood pass completed before public release.
- [ ] Windows dogfood pass completed before public release.
- [ ] Signing/notarization/package-manager blockers are recorded before tagging public builds.
- [ ] Linux release signing secret is configured or the unsigned-release decision is explicitly approved.
- [ ] Blockers recorded as issues or follow-up plan items.

Sign off: _______________________________
