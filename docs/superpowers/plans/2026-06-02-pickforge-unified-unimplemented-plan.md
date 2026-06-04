# Pickforge Unified Unimplemented Spec + Plan

**Status:** active planning source for not-yet-done work
**Created:** 2026-06-02
**Scope:** everything still unimplemented, unlanded, unverified, or intentionally deferred after the current Pickforge codebase state
**Supersedes for planning:** stale unchecked items in `docs/superpowers/checkpoints/2026-04-23-pickforge-mvp-progress.md`

## 1. Purpose

Pickforge has several historical specs and plans:

- `docs/superpowers/specs/2026-04-23-pickforge-design.md`
- `docs/superpowers/plans/2026-04-23-pickforge-mvp.md`
- `docs/superpowers/checkpoints/2026-04-23-pickforge-mvp-progress.md`
- `docs/superpowers/specs/2026-04-25-embedded-terminal-design.md`
- `docs/superpowers/plans/2026-04-25-embedded-terminal.md`
- `docs/superpowers/specs/2026-04-28-emulator-per-project-design.md`
- `docs/superpowers/plans/2026-04-28-emulator-per-project.md`
- `docs/release-checklist.md`
- `NOTES.md`

Those docs contain useful decisions, but some task checkboxes are stale because implementation advanced outside the original checkpoint workflow. This document consolidates the remaining work into one execution plan.

## 2. Current baseline

Treat these capabilities as already present in the codebase or current working tree and do not re-plan them from scratch:

- Feature-first single-package Flutter app structure.
- Drift-backed projects, chats, project settings, pick history, agent run log, and run session log tables.
- Project sidebar, chat sidebar, embedded PTY terminal, transcript replay/recording.
- Agent profiles for Claude Code, Codex, and OpenCode.
- Skill loading and context writing into `.pickforge/`.
- `ForgeCubit` and `ForgePanel`.
- Per-project emulator binding, AVD device picker, manual VM service URL, run logs pane, and IPC server.
- VM Service client, inspector extension wrapper, widget decoding, source snippets, selection polling.
- Widget picker scope and active chat forge wiring in the current working tree.
- Very Good Analysis, build runner, CI workflow, fixture sample app, and opt-in emulator E2E test.

## 3. Planning assumptions

- The Android emulator remains the first supported runtime target.
- The embedded PTY terminal remains the default agent experience.
- Pickforge does not store agent API keys or user credentials.
- Pickforge writes only under project-local `.pickforge/` and must not modify user-owned `CLAUDE.md` or `AGENTS.md`.
- MVP means the loop works end-to-end: add project → run/connect emulator → pick widget → inspect context → forge prompt into active chat → agent edits → hot reload → verify visually.
- Items labeled **post-MVP** should not block first dogfood unless explicitly promoted.

## 4. Status labels

- **Unlanded:** implemented in the current working tree but not committed, pushed, or CI-verified.
- **Partial:** code exists, but product behavior, wiring, tests, or dogfood evidence is incomplete.
- **Not started:** no substantive implementation found.
- **Deferred:** intentionally post-MVP.

## 5. Immediate landing gate

### P0.T1 — Land current MVP core-loop wiring

**Status:** Completed
**Why:** The widget picker → inspector → ForgePanel → active chat wiring is committed on `main`/`origin/main` (`e236683`) and current main CI runs are green.

**Tasks**

- [x] Review current uncommitted diff.
- [x] Confirm no secrets or unrelated files are staged.
- [x] Commit MVP core-loop wiring.
- [x] Push `main`.
- [x] Watch GitHub CI to green.

**Validation**

```bash
fvm dart format --output=none --set-exit-if-changed .
fvm flutter analyze
fvm flutter test --coverage --reporter=compact
gh run watch <run-id> --repo pickforge/pickforge --exit-status
```

## 6. MVP completion plan

These items should be completed before calling Pickforge MVP dogfood-ready.

### P1.T1 — Real widget-pick dogfood pass

**Status:** Completed
**Why:** The complete runtime loop is verified against a real Flutter app in an Android emulator and the active embedded terminal now visibly records the generated Forge prompt.

**Tasks**

- [x] Launch the fixture or a real Flutter app in an Android emulator.
- [x] Bind it to a Pickforge project.
- [x] Confirm the runtime reaches a running VM Service in emulator E2E.
- [x] Pick a user-code widget and verify inspector selection, source metadata, eligibility, and screenshot state.
- [x] Press **Forge it** and verify the prompt appears in the active embedded terminal session.
- [x] Verify agent context files under `.pickforge/`.
- [x] Verify hot reload/restart path with emulator E2E.

**Acceptance criteria**

- Widget selection reaches the right pane without stale project/chat state.
- **Forge it** is disabled unless there is both a selected widget and active chat for the active project.
- Prompt is sent to the visible active chat's PTY session.

**Latest evidence**

- 2026-06-03: Ran `fvm flutter test --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/widget_pick_e2e_test.dart --reporter=compact` against `emulator-5554` (`Pixel_10`); passed.
- 2026-06-03: Ran `fvm flutter test --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/emulator_e2e_test.dart --reporter=compact` against `emulator-5554` (`Pixel_10`); passed.
- 2026-06-03: Ran focused Forge/context/PTY tests proving context file writing and prompt delivery to the active session pool; passed.
- 2026-06-03: Added and ran a `ForgeCubit` regression with real `AgentLauncher`, real `PickforgeContextWriter`, project-local skill override, fake adb, and recording PTY pool; verified `skill-active.md`, `widget-context.md`, `initial-prompt.md`, and prompt delivery to `chat-1`.
- 2026-06-04: Ran the real Linux desktop app from Ghostty with dogfood wrappers on PATH (`codex --model gpt-5.3-codex-spark`, `opencode --model deepseek/deepseek-v4-flash`, `claude --model sonnet`). Verified `scripts/dogfood_preflight.sh`, project/chat binding to `fixtures/sample_flutter_app`, `Pixel_10` discovery/selection, VM Service connection/adoption, widget selection (`Center` at `lib/main.dart:28`), pick-history recording, inspector screenshot, and Forge context generation.
- 2026-06-04: Real Forge wrote `.pickforge/skill-active.md`, `.pickforge/widget-context.md`, `.pickforge/initial-prompt.md`, `.pickforge/screenshot.png`, `.pickforge/device-screen.png`, and `.pickforge/ipc.sock-path` after confirming the dirty worktree.
- 2026-06-04: Fixed dogfood blockers found during the visible desktop pass: unsupported `flutter emulators --machine`, transcript-created `.pickforge/` missing the Pickforge marker, xterm assertions from replay/live ANSI control sequences after hot restart, and binary `adb exec-out screencap -p` stdout decoding.
- 2026-06-04: Switched the real-app dogfood target from `lucky_app` to `/home/dev/Development/Personal/MyGamesList/app` because `lucky_app` is mostly WebView. Ran MyGamesList on `emulator-5554`, bound it to Pickforge through manual VM Service URL `ws://127.0.0.1:36923/jM77deaFyMw=/ws`, selected the app-owned sign-in `ElevatedButton` at `lib/features/auth/sign_in/sign_in_screen.dart:150`, pressed **Forge it** in the visible Linux desktop app, and verified the active chat transcript starts with `[Pickforge sent prompt]` followed by the generated Forge prompt.

**Follow-up:** Keep Codex/OpenCode/Claude Code platform passes in the manual dogfood matrix; the MVP runtime blocker is resolved by the visible MyGamesList pass.

### P1.T2 — Inspector screenshot capture path

**Status:** Completed
**Why:** Inspector screenshots are captured into `.pickforge/screenshot.png`, Android device screenshots remain secondary context, previews render from `SelectedWidget.screenshotPath`, and forge prompts include screenshot paths.

**Tasks**

- [x] Add screenshot capture to the inspector selection flow.
- [x] Persist clean inspector screenshot under `.pickforge/screenshot.png`.
- [x] Preserve Android device screenshot as secondary context when `adb` is available.
- [x] Render screenshot preview consistently in `WidgetDetailsPanel`.
- [x] Include both screenshot paths in the forge prompt when present.

**Validation**

- Unit test for screenshot bytes decoding/writing.
- Widget test for screenshot preview visibility.
- Forge prompt/context test that includes screenshot paths.

### P1.T3 — User-code widget gating

**Status:** Completed
**Why:** Forge eligibility is limited to user-code widgets and framework/internal selections show the user-code hint instead of allowing forge.

**Tasks**

- [x] Define user-code detection: project-root-contained creation file, non-null creation location, or explicit allowlist.
- [x] Add a `SelectedWidget` helper or policy service for forge eligibility.
- [x] Disable **Forge it** for framework/internal widgets.
- [x] Show a clear hint: pick a widget from the app's source.

**Validation**

- Unit tests for user-code vs framework widget classification.
- `ForgePanel` widget tests for disabled state and hint.

### P1.T4 — Active-project settings correctness

**Status:** Completed
**Why:** Settings load from the active project root and show an empty state when no project is selected.

**Tasks**

- [x] Pass active project root into `SettingsView` or move device/run settings into a project-scoped surface.
- [x] Ensure default agent, terminal settings, emulator binding, target file, and extra run args load for the intended project.
- [x] Add empty state when no project is selected.

**Validation**

- Widget test: settings reads active project from `ProjectsCubit`.
- Cubit tests for per-project settings preservation.

### P1.T5 — Command palette wiring

**Status:** Completed
**Why:** The router is wrapped in `CommandPaletteScope` and exposes base Workbench/Settings navigation commands.

**Tasks**

- [x] Wrap `MaterialApp.router` or the routed shell in `CommandPaletteScope`.
- [x] Include Workbench and Settings navigation commands.
- [x] Leave context-aware commands deferred until base nav works.

**Validation**

- Widget test for `Ctrl+K` / `Meta+K` opening the palette.
- Existing command filtering tests remain green.

### P1.T6 — Pick history UI or explicit deletion from MVP

**Status:** Completed for MVP
**Why:** Drift has pick history and release checklist expects a History view, but no history feature route/view is present.

**Decision needed**

- [x] Explicitly remove the full History UI from MVP release criteria; keep pick history data recording and defer the full History UI to post-MVP.

**Implementation option**

- [x] Add `HistoryView` or fold recent picks into command palette/search.
- [x] Show selected widget class, project, skill, agent, picked time, and linked chat if available.
- [x] Add route/command entry if implemented.

**Validation**

- [x] DAO/repository tests for recent history.
- [x] Widget test for rendering an empty and populated history.

**Latest evidence**

- 2026-06-03: Added pick-history recording from inspector selections, a route-backed `HistoryView`, and a command palette entry; ran `fvm flutter test test/core/history/pick_history_recorder_test.dart test/features/history/view/history_view_test.dart test/core/router/app_router_test.dart test/features/workbench/view/inspector_panel_test.dart --reporter=compact`, passed.
- 2026-06-03: Final P1.T6 gates passed: `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, and `fvm flutter test --reporter=compact` (338 passed, 2 skipped emulator E2E tests without `PICKFORGE_E2E_AVD`).

### P1.T7 — PTY lifecycle on project switch

**Status:** Completed
**Why:** Project switches park outgoing PTY sessions and active chats are constrained to the selected project.

**Tasks**

- [x] Define desired behavior for switching active projects.
- [x] Park/kill outgoing project's PTYs on project switch.
- [x] Rehydrate terminal scrollback for selected chat in incoming project.
- [x] Ensure prompts cannot be sent to a parked/stale chat.

**Validation**

- Cubit/widget test for project switch clearing active incompatible chat.
- Unit test for pool parking invoked on project switch.

### P1.T8 — Dogfood release checklist refresh

**Status:** Completed
**Why:** `docs/release-checklist.md` now reflects the embedded-terminal, per-project emulator flow and separates manual dogfood signoff from automated validation.

**Tasks**

- [x] Update checklist to current embedded-terminal and per-project emulator flow.
- [x] Add a local dogfood signoff section for MVP.
- [x] Keep manual checks separate from automated validation.

**Validation**

- Diff review only.

## 7. Emulator and run-session hardening

### P2.T1 — Run-log persistence and Run History UI

**Status:** Completed
**Source:** `NOTES.md`, emulator-per-project design
**Why:** Run logs are in memory; `run_session_log` rows exist but no UI surfaces past sessions.

**Tasks**

- [x] Persist run logs under `.pickforge/runs/<sessionId>/log.jsonl`.
- [x] Add retention/cap policy.
- [x] Add Run History UI listing past sessions per project.
- [x] Link run sessions to errors, hot reload count, VM service URL, target file, and exit reason.

**Latest evidence**

- 2026-06-03: Verified `RunSessionLogDao.pruneToCap` and `RunSessionLogRepository.recordStart(..., cap: 100)` retention behavior; ran `fvm flutter test test/core/drift/dao/run_session_log_dao_test.dart --reporter=compact`, passed.
- 2026-06-03: Added `RunSessionEventLogWriter` and cubit wiring to append run events to `.pickforge/runs/<sessionId>/log.jsonl`; ran `fvm flutter test test/core/emulator/run_session_event_log_writer_test.dart test/features/emulator/cubit/emulator_session_logs_wire_test.dart --reporter=compact`, passed.
- 2026-06-03: Added route-backed `RunHistoryView`, `run_session_log.target_file`, VM Service URL updates, persisted reload/error summaries, and run-history command/menu entry; ran focused run-history/schema/cubit/router tests, `fvm flutter analyze`, `fvm flutter test --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/emulator_e2e_test.dart --reporter=compact`, and `fvm flutter test --reporter=compact` (346 passed, 2 skipped without `PICKFORGE_E2E_AVD`), passed.

### P2.T2 — Build flavor and target picker UI

**Status:** Completed
**Why:** `RunArgs` supports `targetFile` and extra args, but the UI is text-oriented.

**Tasks**

- [x] Scan `lib/main*.dart` and parse project metadata where practical.
- [x] Surface target file dropdown.
- [x] Surface flavor/build mode fields.
- [x] Preserve manual extra args for advanced use.

**Latest evidence**

- 2026-06-03: Added `FlutterRunTargetScanner` for `lib/main*.dart` and Android Gradle product flavors, structured run-args parsing for build mode/flavor/manual args, and settings UI controls for target dropdown, build mode, flavor, and advanced args; ran focused settings/run-args tests, `fvm flutter analyze`, `fvm flutter test --reporter=compact` (357 passed, 2 skipped without `PICKFORGE_E2E_AVD`), and `fvm flutter test --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/emulator_e2e_test.dart --reporter=compact`, passed.

### P2.T3 — Power AVD flags

**Status:** Completed
**Why:** Per-project emulator launch options are persisted and validated, while the no-options path still uses `flutter emulators --launch`.

**Tasks**

- [x] Add optional per-project emulator launch flags: `-no-audio`, `-gpu`, `-no-snapshot-load`, custom port, cores.
- [x] Validate flags against known emulator capabilities.
- [x] Keep simple `flutter emulators --launch` path as default.

**Latest evidence**

- 2026-06-03: Added `EmulatorLaunchOptions`, per-project settings persistence, Device & Run controls, direct `emulator -avd ...` launch when flags are set, and default `flutter emulators --launch` preservation when flags are empty.
- 2026-06-03: Verified with focused launcher/settings/migration/boot tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact` (373 passed, 2 skipped without `PICKFORGE_E2E_AVD`), `fvm flutter test --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/emulator_e2e_test.dart --reporter=compact`, and `fvm flutter test --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/widget_pick_e2e_test.dart --reporter=compact`; all passed.

### P2.T4 — Run-session crash recovery/adoption

**Status:** Completed
**Why:** Pickforge now writes recoverable run metadata, detects live orphaned `flutter run --machine` processes on startup, and exposes adoption or safe cleanup in the connection pill.
**Tasks**

- [x] Persist PID/session metadata and IPC socket path.
- [x] On Pickforge startup, detect orphaned `flutter run --machine`.
- [x] Offer adoption or cleanup.
- [x] Handle stale PID safely.

**Latest evidence**

- 2026-06-03: Added `RunSessionRecoveryStore`, persisted `.pickforge/runs/<sessionId>/session.json` metadata with PID, serial, VM Service URL, app id, and IPC socket path, and wired `EmulatorSessionCubit` startup to surface recoverable orphaned runs.
- 2026-06-03: Added recovery/adoption/cleanup connection pill actions, guarded stale PID cleanup by re-validating `/proc/<pid>/cmdline` and process cwd before terminating, and covered persistence, stale cleanup, cubit adoption, and UI behavior with focused tests.
- 2026-06-03: Verified with `fvm dart run build_runner build --delete-conflicting-outputs`, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact` (385 passed, 2 skipped without `PICKFORGE_E2E_AVD`), `fvm flutter test --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/emulator_e2e_test.dart --reporter=compact`, and `fvm flutter test --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/widget_pick_e2e_test.dart --reporter=compact`; all passed.

### P2.T5 — Per-project AVD auto-shutdown

**Status:** Completed
**Why:** Each project can now opt into idle emulator shutdown, defaults to prompting before killing the AVD, and only auto-shuts down when confirmation is explicitly disabled.
**Tasks**

- [x] Add per-project idle shutdown setting.
- [x] Track last activity/run state.
- [x] Prompt before destructive shutdown unless explicitly configured.

**Latest evidence**

- 2026-06-03: Added `EmulatorIdleShutdownSettings`, schema v6 `emulator_idle_shutdown` persistence, Device & Run controls for `Shutdown when idle` and `Ask before shutdown`, and `AvdShutdownController` using `adb -s <serial> emu kill`.
- 2026-06-03: Added `Idle.idleSince` and `Idle.shutdownPrompt`, connection pill keep/shutdown actions, Cubit handling for prompt-based shutdown, explicit automatic shutdown, and shutdown failure state.
- 2026-06-03: Verified with focused idle-shutdown/settings/schema/pill/Cubit tests, `fvm dart run build_runner build --delete-conflicting-outputs`, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact` (401 passed, 2 skipped without `PICKFORGE_E2E_AVD`), `fvm flutter test --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/emulator_e2e_test.dart --reporter=compact`, and `fvm flutter test --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/widget_pick_e2e_test.dart --reporter=compact`; all passed.

### P2.T6 — Inspector auto-attach optimization

**Status:** Completed
**Tasks**

- [x] Skip or pause inspector polling when right pane is collapsed.
- [x] Resume cleanly when visible.
- [x] Measure CPU savings before making this default.

**Latest evidence**

- 2026-06-03: Added right-pane visibility wiring into `WidgetPickerScope`, pausing inspector select mode and selection polling while collapsed and resuming when visible.
- 2026-06-03: Added race coverage for hiding while select-mode enable is still in flight, plus a polling-count proxy measurement: active polling produced `fetchSelection` calls, paused polling produced zero calls, and resumed polling produced calls again.
- 2026-06-03: Verified with `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact` (405 passed, 2 skipped without `PICKFORGE_E2E_AVD`), `fvm flutter test --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/emulator_e2e_test.dart --reporter=compact`, and `fvm flutter test --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/widget_pick_e2e_test.dart --reporter=compact`; all passed.

## 8. Platform expansion

### P3.T1 — Windows IPC parity

**Status:** Completed
**Why:** CI runs on Windows, but IPC server design is Unix-socket first.

**Tasks**

- [x] Add named-pipe implementation for Windows.
- [x] Preserve Unix socket path for Linux/macOS.
- [x] Add platform-specific tests where possible.
- [x] Verify ConPTY edge cases for embedded agent sessions.

**Latest evidence**

- 2026-06-03: Replaced Unix-only IPC internals with platform transports: Linux/macOS keep Unix domain sockets, while Windows uses an isolate-backed Win32 named-pipe transport at `\\.\pipe\pickforge-<pid>-agent`.
- 2026-06-03: Added `EmulatorIpcClient` and unskipped IPC tests so Windows CI exercises the named-pipe server/client path; local Linux validation exercised the Unix socket path and endpoint-shape assertions.
- 2026-06-03: Added PTY session edge coverage for terminal resize forwarding and stop escalation, covering the ConPTY-sensitive behavior Pickforge controls directly before handing off to `flutter_pty`.
- 2026-06-03: Verified with `fvm flutter pub get`, `fvm dart format --set-exit-if-changed .`, focused IPC/PTY tests, `fvm flutter analyze`, `fvm flutter test --reporter=compact` (409 passed, 2 skipped without `PICKFORGE_E2E_AVD`), `fvm dart run build_runner build --delete-conflicting-outputs`, `fvm flutter test --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/emulator_e2e_test.dart --reporter=compact`, and `fvm flutter test --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/widget_pick_e2e_test.dart --reporter=compact`; all passed locally.

### P3.T2 — Physical Android support

**Status:** Completed
**Tasks**

- [x] Detect physical devices separately from emulators.
- [x] Respect adb serial selection.
- [x] Validate screenshot and run-session behavior.

**Latest evidence**

- 2026-06-03: Added physical Android device classification from `adb devices -l`, model-based display names, persisted `EmulatorBinding.physical`, and connected-device rows in the device picker and Device & Run settings.
- 2026-06-03: Threaded selected serials through run sessions and Android screenshots so physical devices use `flutter run -d <serial>` and `adb -s <serial> exec-out screencap -p`; idle shutdown remains emulator-only.
- 2026-06-03: Verified with focused physical-device discovery/settings/session/screenshot/forge tests, `fvm dart run build_runner build --delete-conflicting-outputs`, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact` (423 passed, 2 skipped without `PICKFORGE_E2E_AVD`), and both emulator E2Es using `fvm flutter test --reporter=compact --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/emulator_e2e_test.dart test/integration/widget_pick_e2e_test.dart`; all passed locally.

### P3.T3 — iOS Simulator support

**Status:** Partial / host-gated
**Tasks**

- [x] Add iOS simulator discovery.
- [x] Add `xcrun simctl` screenshot support.
- [ ] Validate VM Service and inspector extensions against iOS on a macOS host.

**Latest evidence**

- 2026-06-03: Added booted iOS simulator discovery via `xcrun simctl list devices booted --json`, iOS simulator matching in the device model, `EmulatorBinding.iosSimulator`, and picker/settings/session wiring for connected and launchable iOS targets.
- 2026-06-03: Added iOS boot polling through `BootReadinessPoller`, preserved target platform in run recovery metadata, and kept idle shutdown Android-emulator-only.
- 2026-06-03: Added `xcrun simctl io <udid> screenshot <path>` support through the existing device screenshot capture path and threaded selected target platform through Forge.
- 2026-06-03: Verified with focused iOS discovery/model/settings/session/screenshot/Forge tests, `fvm dart run build_runner build --delete-conflicting-outputs`, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact` (436 passed, 2 skipped without `PICKFORGE_E2E_AVD`), and both Android emulator E2Es using `fvm flutter test --reporter=compact --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/emulator_e2e_test.dart test/integration/widget_pick_e2e_test.dart`; all passed locally.

**Blocked:** Full live iOS VM Service/inspector dogfood requires Xcode/iOS Simulator on macOS; this Linux environment can only validate the command construction, parsing, persistence, run-session serial selection, and Android regression path.

### P3.T4 — Flutter web target support

**Status:** Completed
**Tasks**

- [x] Support Chrome/web VM service connection.
- [x] Handle web-specific inspector/source paths.
- [x] Define screenshot behavior for browser targets.

**Latest evidence**

- 2026-06-03: Added Chrome/web-server discovery from `flutter devices --machine`, `EmulatorBinding.webTarget`, picker/settings/session wiring, and web run-session selection through the existing `flutter run --machine -d <targetId>` path.
- 2026-06-03: Added web source path normalization for `org-dartlang-app:/...` creation locations and project-root-relative snippet extraction/forge eligibility.
- 2026-06-03: Defined browser device screenshot behavior as unsupported in `AdbScreenshotCapturer`; Flutter reports Chrome `capabilities.screenshot: false`, while inspector screenshots remain separate VM Service/inspector-extension context.
- 2026-06-03: Verified Chrome was discoverable with `fvm flutter devices --machine`, then ran the fixture app with `timeout 90s fvm flutter run -d chrome --machine --web-browser-flag=--headless=new --web-browser-flag=--disable-gpu`; Flutter emitted `app.debugPort` with a `ws://127.0.0.1:.../ws` VM Service URI and started from `org-dartlang-app:/web_entrypoint.dart`.
- 2026-06-03: Focused web discovery/settings/session/screenshot/source-path tests passed, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, and `fvm flutter test --reporter=compact` passed (450 passed, 2 skipped without `PICKFORGE_E2E_AVD`), and both Android emulator E2Es passed with `fvm flutter test --reporter=compact --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/emulator_e2e_test.dart test/integration/widget_pick_e2e_test.dart`.

### P3.T5 — Flutter desktop target support

**Status:** Partial / host-gated
**Tasks**

- [x] Attach to desktop target VM services.
- [x] Define screenshot path per platform.
- [x] Validate with Linux first.
- [ ] Validate macOS/Windows on native hosts.

**Latest evidence**

- 2026-06-03: Added Linux/macOS/Windows discovery from `flutter devices --machine`, `EmulatorBinding.desktopTarget`, picker/settings/session wiring, and desktop run-session selection through the existing `flutter run --machine -d <targetId>` path.
- 2026-06-03: Added desktop secondary screenshot behavior through `flutter screenshot -d <targetId> -o <path>` with null-on-failure semantics; inspector screenshots remain the primary VM Service/inspector-extension context.
- 2026-06-03: Verified Linux was discoverable with `fvm flutter devices --machine`, then ran the fixture app with `timeout 120s fvm flutter run -d linux --machine`; Flutter emitted `app.debugPort` with a `ws://127.0.0.1:.../ws` VM Service URI and then stopped cleanly after SIGTERM.
- 2026-06-03: Focused desktop discovery/settings/session/screenshot tests passed, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, and `fvm flutter test --reporter=compact` passed (462 passed, 2 skipped without `PICKFORGE_E2E_AVD`), and both Android emulator E2Es passed with `fvm flutter test --reporter=compact --dart-define=PICKFORGE_E2E_AVD=Pixel_10 test/integration/emulator_e2e_test.dart test/integration/widget_pick_e2e_test.dart`.
- 2026-06-04: Added `scripts/desktop_build_smoke.sh` and CI desktop build smoke coverage for Linux, macOS, and Windows hosts. This verifies host-specific Flutter desktop builds in CI, but does not replace live macOS/Windows VM Service and inspector dogfood. Verified locally on Linux with `scripts/desktop_build_smoke.sh`.
- 2026-06-04: Added `scripts/desktop_launch_smoke.sh` and wired macOS/Windows CI and release jobs to launch the already-built desktop app and verify short process liveness, uploading launch-smoke artifacts from PR CI. This strengthens native-host startup coverage but still does not replace live macOS/Windows VM Service and inspector dogfood.

**Blocked:** macOS and Windows live desktop validation require native macOS/Windows hosts; this Linux environment can validate Linux and command construction for all desktop target ids.

## 9. Agent ecosystem and MCP

### P4.T1 — Pickforge MCP server

**Status:** Completed
**Why:** Pickforge now exposes the P4.T1 capabilities through the existing project-discovered local IPC socket and includes a dependency-free stdio MCP adapter that proxies `tools/list` and `tools/call` to that IPC contract.
**Goal:** Let agents re-query Pickforge state after the initial prompt.

**Capabilities**

- [x] `get_selected_widget`
- [x] `list_pickforge_history`
- [x] `capture_screenshot`
- [x] `hot_reload`
- [x] `get_run_logs`
- [x] `get_project_context`

**Integration**

- [x] Decide whether MCP server ships inside this repo, separate repo, or both.
- [x] Document socket/transport discovery.
- [x] Add agent-profile-specific MCP configuration guidance.
- [x] Add stdio MCP adapter.

**Latest evidence**

- 2026-06-04: Added `PickforgeMcpServer`, `tool/pickforge_mcp.dart`, and `scripts/pickforge_mcp.sh`, implementing MCP `initialize`, `notifications/initialized`, `ping`, `tools/list`, and `tools/call` over stdio while forwarding tool calls to `.pickforge/ipc.sock-path` through the existing `EmulatorIpcClient`. Updated `docs/architecture/pickforge-mcp.md` with adapter usage. Verified with focused MCP/IPC tests, a clean-stdout wrapper smoke check, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and `scripts/emulator_e2e.sh Pixel_10`.

### P4.T2 — Agent expansion

**Status:** Completed
**Why:** Cursor CLI has a stable documented `agent` command and Gemini CLI has a stable documented `gemini` command, so both now have Pickforge agent profiles and diagnostics coverage.
**Tasks**

- [x] Add Cursor CLI profile if stable CLI exists.
- [x] Add Gemini CLI profile.
- [x] Add test fixtures for each profile's invocation args and resume behavior.
- [x] Keep bring-your-own-auth; do not handle tokens.

### P4.T3 — Headless chat adapter mode

**Status:** Completed / feature-flagged
**Goal:** Render Pickforge-owned chat UI over structured CLI output instead of PTY UI.
**Why:** Added experimental Claude Code `stream-json`, Codex `exec --json`, and OpenCode `run --format json` adapters behind per-agent Dart-define feature flags. Pickforge now has a headless session pool, normalized `ChatMessage` stream, and alternate chat pane without replacing the default PTY workflow.

**Staging**

- [x] Claude Code stream-json adapter.
- [x] Codex exec JSON adapter.
- [x] OpenCode run JSON adapter.
- [x] Normalize output into `ChatMessage`.
- [x] Add per-agent feature flag.

**Non-goals**

- Do not remove PTY mode until headless mode reaches feature parity for required workflows.
- Do not store API keys.

### P4.T4 — Skill overrides and community registry

**Status:** Completed / design documented
**Why:** Project-local `.pickforge/skills/` overrides were already active in `SkillStore`; added a reusable skill-source resolver and Forge-panel source inspector so users can verify whether the active skill comes from a project override or bundled asset. Documented a markdown-only community registry and trust/safety model in `docs/architecture/skill-registry.md`.
**Tasks**

- [x] Ensure project-local `.pickforge/skills/` overrides bundled skills.
- [x] Add UI to inspect active skill source.
- [x] Design community skill registry.
- [x] Add trust/safety model for skill packs.

## 10. Visual picking and emulator mirror

### P5.T1 — Embedded emulator mirror

**Status:** Partial / strategy documented
**Goal:** Replace side-by-side external emulator dependence with an embedded live mirror.
**Why:** Documented a two-phase mirror strategy in `docs/architecture/emulator-mirror.md`: optional detached scrcpy window first, true embedded raw-stream rendering later, with explicit coordinate mapping, rotation, input-forwarding, and non-regression constraints.

**Tasks**

- [x] Evaluate scrcpy integration strategy.
- [x] Solve device pixel ratio, rotation, and input forwarding.
- [x] Keep existing VM Service inspector selection as the source of widget identity.
- [x] Ensure mirror is optional and does not regress Approach A.

### P5.T2 — True hover-over-live-emulator UX

**Status:** Partial / transform complete
**Why:** Added a tested `MirrorTransform` utility for mapping hover/local mirror coordinates onto device coordinates, including letterbox rejection and inverse 0/90/180/270 degree rotation. Flutter's inspector hit testing is currently exposed only inside the target app's select-mode overlay, not as a VM service coordinate query, so true hover preview/highlight remains blocked until Pickforge has an embedded mirror/input surface.
**Tasks**

- [x] Overlay hover target mapping onto mirrored emulator coordinates.
- [ ] Query/preview widget under pointer.
- [ ] Show highlight without interfering with app input.

**Blocked:** True hover preview/highlight needs an embedded mirror/input surface plus a reliable widget-under-coordinate query or app-side overlay channel. The current implementation can map coordinates but cannot ask the Flutter inspector for a passive hover target without entering the target app's select-mode overlay.

**Latest evidence**

- 2026-06-04: Added raw `selected-widget.json` and `inspector-root.json` artifacts to the widget-pick emulator E2E and ran it against `Pixel_10` on `emulator-5554`. The real Flutter inspector summary JSON exposes identity, creation location, and children, but no bounds, rect, size, transform, or render geometry fields; hover query/highlight remains blocked on an embedded mirror/input surface plus a coordinate-to-widget channel.

### P5.T3 — Widget-tree diffing and rebuild tracking

**Status:** Completed
**Why:** Added VM service wrappers for `ext.flutter.inspector.trackRebuildDirtyWidgets`, repository-level widget tree snapshots via `getRootWidgetSummaryTree`, decoding for `Flutter.RebuiltWidgets` extension events, picker-state propagation of the latest rebuild stats, and an inspector panel section that renders recent rebuilt widgets with counts and source locations.
**Tasks**

- [x] Use `ext.flutter.inspector.trackRebuildDirtyWidgets`.
- [x] Capture before/after widget tree snapshots.
- [x] Render changed widgets after hot reload.

### P5.T4 — Screenshot before/after loop

**Status:** Completed
**Why:** Pick-time inspector screenshots already write `.pickforge/screenshot.png`; successful hot reload/restart events now capture `.pickforge/device-screen-after-hot-reload.png` without overwriting the forge-time `device-screen.png`, IPC project context exposes the after-reload image, and forge prompts ask agents to run IPC hot reload plus compare before/after screenshots when possible.
**Tasks**

- [x] Capture before screenshot at pick time.
- [x] Capture after screenshot post hot reload.
- [x] Optionally prompt agent to self-check visual result.

## 11. Product polish and UX

### P6.T1 — Design-system polish pass

**Status:** Completed
**Why:** The inspector details panel now uses localized labels for empty states, ancestors, source, and recent rebuilds, and the panel/chip/source styling no longer relies on hardcoded Material grey colors. Pick history and run history now use compact themed headers, rows, and empty states instead of default `AppBar`/`Card`/`ListTile` layouts. Settings and device-run controls now use compact Pickforge section surfaces, field rows, toggles, and buttons instead of stock cards/list tiles/chips/text buttons. Connection pill primary actions now use compact icon buttons instead of plain `TextButton`s. Onboarding now uses compact token-based panels and tags instead of stock cards/chips/text buttons. Forge now uses compact token-based surfaces, tags, and action buttons instead of stock cards/chips/text buttons. App shell pane animation, connection pill content/status-dot animation, no-selection placeholder pulse, and chat auto-scroll now honor reduced motion. Settings, device-run, connection pill/menu/actions, manual VM URL, run logs, chat empty/roles, and widget-picker placeholder copy now use localized strings.
**Tasks**

- [x] Audit Material-default UI remnants.
- [x] Tighten density, spacing, typography, colors, and empty states.
- [x] Confirm reduce-motion behavior for all animations.
- [x] Add missing localized strings.

**Latest evidence**

- 2026-06-04: Added reduced-motion handling for connection pill `AnimatedSwitcher` and status-dot controller, no-selection placeholder pulse, and chat auto-scroll; verified with focused motion/widget tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.
- 2026-06-04: Reworked Settings and Device & Run into compact token-based sections, normalized typography letter spacing to zero, and removed audited stock `Card`/`SwitchListTile`/`ChoiceChip`/`ActionChip`/`TextButton` remnants from the settings feature; verified with focused settings/theme tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.
- 2026-06-04: Replaced connection pill `TextButton` primary actions with compact icon `FilledButton`/`OutlinedButton` controls; verified with focused connection pill tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.
- 2026-06-04: Reworked onboarding checklist/setup/demo surfaces into compact token-based panels and tags, replacing stock `Card`/`Chip`/`TextButton` patterns; verified with focused onboarding tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.
- 2026-06-04: Reworked Forge panel context tray, dirty-worktree summary, preview/forge actions, and dialogs into compact token-based surfaces, tags, and buttons; verified with focused Forge tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.
- 2026-06-04: Localized the remaining audited settings/device-run, connection pill/menu/action, manual URL, run logs, chat empty/role, and widget-picker placeholder copy; verified with focused localization widget tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.
- 2026-06-04: Increased the desktop default window size to `2160x1280` with a `900x640` minimum so the workbench opens with the sidebar, terminal, inspector, and Forge controls visible without manual resizing on a large desktop. Verified by restarting the Linux desktop app, capturing a desktop screenshot, and running `fvm dart format --set-exit-if-changed lib/core/window/window_bootstrap.dart` plus `fvm flutter analyze`.

**Audit findings — 2026-06-04**

- History and run-history density and localization remnants were resolved on 2026-06-04.
- Settings and device-run density and localization remnants were resolved on 2026-06-04.
- Connection pill action button density and menu/action localization remnants were resolved on 2026-06-04.
- Forge density remnants were resolved on 2026-06-04.
- Demo/onboarding density remnants were resolved on 2026-06-04; intentional sample literals were reviewed and remain as fixture/demo data rather than missing UI copy.

### P6.T2 — Command palette expansion

**Status:** Completed
**Why:** The workbench command palette includes quick actions and can now surface on-demand workspace search results from chats, recent pick history, widget classes, and transcript text.
**Tasks**

- [x] Add quick actions: new chat, add project, run app, hot reload, pick device, open settings.
- [x] Add fuzzy search across chats/history if history search is implemented.

**Latest evidence**

- 2026-06-04: Added dynamic command-palette search commands backed by `WorkspaceSearchService`; chat titles and pick-history fields use fuzzy token matching, while transcript text is searched on demand from project-local `.pickforge/chats/<chatId>/transcript.log` tails. Verified with focused search and workbench palette tests, `fvm dart format --set-exit-if-changed ...`, and `fvm flutter analyze`.

### P6.T3 — Search across transcripts and pick history

**Status:** Completed
**Tasks**

- [x] Index transcript text files or search on demand.
- [x] Include pick history and widget classes.
- [x] Surface results in command palette or dedicated search UI.

**Latest evidence**

- 2026-06-04: Added on-demand workspace search over chats, recent pick history, widget classes, and bounded transcript tails, surfaced as command-palette results. Verified with `test/core/search/workspace_search_service_test.dart`, `test/shared/command_palette/command_palette_test.dart`, and `test/features/workbench/view/workbench_command_palette_scope_test.dart`.

### P6.T4 — Left pane list/grid views with grouping

**Status:** Completed
**Why:** The left pane now supports list/grid modes, project/recent/pinned/agent/skill/custom grouping, project/chat pinning, collapsible groups, persisted density/view/group settings, keyboard navigation, fuzzy filtering, and compact/comfortable screenshot coverage.

**Goal:** Make the left pane a real workspace navigator, not just a project/chat list.

**Tasks**

- [x] Add a left-pane view mode toggle: **List** and **Grid**.
- [x] Add grouping modes available in both views:
  - [x] by project,
  - [x] by recent activity,
  - [x] by pinned/favorites,
  - [x] by agent,
  - [x] by skill,
  - [x] by custom user group.
- [x] Add project/chat pinning.
- [x] Add collapsible groups in list mode.
- [x] Add card density settings in grid mode.
- [x] Persist view mode, grouping mode, expanded groups, and pinned IDs.
- [x] Ship context-menu custom grouping first; keep drag/drop deferred unless it feels stable.
- [x] Add keyboard navigation inside the left pane.
- [x] Add fuzzy filtering inside the left pane.

**Data model**

- `WorkspaceSidebarSettings`: view mode, grouping mode, sort mode, density.
- Optional `ProjectGroup` table if custom grouping needs persistence beyond local preferences.
- Pinned state can initially live in Drift columns or JSON settings; prefer columns if it becomes queryable.

**Validation**

- [x] Cubit tests for grouping/sorting/pinning.
- [x] Widget tests for list mode, grid mode, empty state, pinned group, and group collapse/expand.
- [x] Golden/screenshot tests for dense and roomy layouts.

**Latest evidence**

- 2026-06-04: Added widget screenshot readback tests for compact list and comfortable grid sidebar layouts, including fixed-size render bounds and nonblank pixel/color checks; localized the sidebar density toggle tooltips. Verified with focused sidebar tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.

### P6.T5 — VS Code-style project file explorer

**Status:** Completed
**Why:** Pickforge should let users browse the active project without context-switching to a file manager or editor.

**Goal:** Add a file tree between navigation and work surfaces, similar to VS Code's Explorer, with safe default-app opening.

**Placement options**

- **Recommended MVP path:** add it as a collapsible tab/section inside the left pane below Projects/Chats.
- **Power-user path:** make it its own narrow resizable pane between the left sidebar and terminal.
- **Later path:** allow users to choose whether Explorer is docked left, middle-left, or hidden.

**Tasks**

- [x] Add `ProjectFileExplorerCubit` that scans the active project's directory tree.
- [x] Respect `.gitignore`, `.pickforge/.gitignore`, hidden files toggle, and common excludes (`build/`, `.dart_tool/`, `.git/`, platform build outputs).
- [x] Render expandable folders and file icons.
- [x] Add file search/filter.
- [x] Open files/folders with the system default app:
  - [x] Linux: `xdg-open`,
  - [x] macOS: `open`,
  - [x] Windows: `start`/ShellExecute.
- [x] Add "Reveal in file manager" action.
- [x] Add "Copy relative path" and "Copy absolute path" actions.
- [x] Add "Attach this file to next forge prompt" as a later enhancement.
- [x] Watch filesystem changes and refresh without rescanning too aggressively.

**Safety**

- Never delete, move, rename, or overwrite files from this explorer in the first version.
- Treat symlinks carefully; avoid recursive loops.
- Ask before opening very large/binary files if preview is added later.

**Validation**

- [x] Unit tests for tree scanning, ignore rules, symlink loops, and sorting.
- [x] Widget tests for folder expand/collapse and context actions.
- [x] Process-runner tests for platform open commands, using fakes.

### P6.T6 — Context attachments tray

**Status:** Completed
**Why:** A phenomenal agent workflow needs explicit control over what gets sent with a forge prompt.

**Tasks**

- [x] Let users attach files from the project explorer to the next forge prompt.
- [x] Show selected widget, screenshot(s), files, run logs, and custom notes as chips.
- [x] Show attached files as chips.
- [x] Add remove/reorder controls.
- [x] Add remove controls for attached files.
- [x] Persist only intentional attachments; avoid silently sending unrelated files.
- [x] Add token/size warnings for large context bundles.

### P6.T7 — Session/task organization

**Status:** Completed
**Why:** Chats now carry persisted task metadata and the left pane can group, search, archive, and restore chat tasks without leaving the existing workspace navigator.

**Tasks**

- [x] Add chat labels/tags.
- [x] Add status: active, waiting, done, archived.
- [x] Add "task brief" metadata per chat.
- [x] Add archive and restore.
- [x] Surface grouped tasks in the left pane list/grid views.

**Latest evidence**

- 2026-06-04: Added schema v7 chat task metadata (`labels_json`, `status`, `task_brief_text`), DAO/repository/Cubit update APIs, active/waiting/done/archived status handling, labels, task brief dialogs, archive/restore actions, and Status/Label grouping modes in list and grid sidebar views. Workspace search now matches chat task status, labels, and brief.
- 2026-06-04: Verified with `fvm dart run build_runner build --delete-conflicting-outputs`, `fvm flutter gen-l10n`, `fvm dart run drift_dev schema dump lib/core/drift/pickforge_database.dart test/core/drift/schema/pickforge_database_v7.json`, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, and focused Drift/search/sidebar/Cubit/widget tests for chat task metadata and v6 -> v7 migration.

### P6.T8 — First-run onboarding and demo mode

**Status:** Completed
**Why:** A great app should prove its value in the first five minutes, even before the user's own environment is perfectly configured.

**Tasks**

- [x] Add a first-run checklist: add project, pick device/manual URL, create chat, pick widget, forge.
- [x] Add a demo mode backed by fake project/emulator/widget data so the UI can be explored without Android tooling.
- [x] Add a demo-mode affordance/card explaining fake project/emulator/widget/chat data.
- [x] Add "Open sample Flutter app" flow using `fixtures/sample_flutter_app`.
- [x] Add inline setup checks for agent binaries, `adb`, Flutter/FVM, and emulator availability.
- [x] Add recoverable setup actions: copy command and retry detection.
- [x] Add recoverable setup action: open settings.
- [x] Make onboarding dismissible and restorable from command palette/help.

**Validation**

- [x] Widget tests for empty, partially configured, and fully configured onboarding states.
- [x] Desktop smoke test can launch into demo mode without external dependencies.

**Latest evidence**

- 2026-06-04: Reconciled stale status after verifying all P6.T8 tasks and validation boxes were already checked. Current validation includes onboarding widget coverage in `fvm flutter test --reporter=compact` and demo-mode desktop smoke coverage through `scripts/linux_smoke.sh`.

### P6.T9 — Agent change review and git safety

**Status:** Completed
**Why:** The agent edits the user's project. Pickforge should make changes visible, reversible, and safe without becoming a full IDE.

**Tasks**

- [x] Capture pre-forge git status and current branch for the project.
- [x] Warn before forging into a dirty worktree unless the user acknowledges.
- [x] After agent changes, show changed files and a concise diff summary.
- [x] Add action: copy diff.
- [x] Add action: open changed file.
- [x] Add action: run configured validator.
- [x] Add action: discard instructions.
- [x] Detect untracked files separately and never delete/move them.
- [x] Add optional "create checkpoint commit" or "stash before forge" workflow later.
- [x] Surface hot reload/test/analyze result alongside the diff.

**Done:** Visible/manual dogfood now covers a real dirty project through the disposable worktree prepared by `scripts/dirty_git_dogfood_setup.sh`.

**Validation**

- [x] Unit tests for git status parsing.
- [x] Widget tests for dirty worktree warning and post-forge diff summary.
- [x] Integration test with a real git repo containing staged, unstaged, and untracked files.
- [x] Manual dogfood with a real git repo containing staged, unstaged, and untracked files.

**Latest evidence**

- 2026-06-04: Added Forge panel widget coverage for the dirty-worktree confirmation dialog and post-forge project changes summary with changed files, branch, diff stat, and copy-diff action visible. Verified with focused Forge panel tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.
- 2026-06-04: Added project-change review actions to open changed files through `ProjectFileOpener` and show non-destructive discard instructions; verified with focused Forge panel tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.
- 2026-06-04: Added schema v8 `project_settings.validator_command`, Settings UI for an explicit per-project validator command, a manual **Run validator** action in the Project changes card, and pass/fail/output rendering alongside the diff. Verified with focused project-validator, Drift DAO/migration/schema, Settings Cubit/view, Forge panel, and settings golden tests; `fvm dart format --set-exit-if-changed .`; `fvm flutter analyze`; `fvm flutter test --reporter=compact` (586 passed, 2 skipped emulator E2E tests without `PICKFORGE_E2E_AVD`); and `scripts/emulator_e2e.sh Pixel_10`.
- 2026-06-04: Added last hot reload/restart outcome fields to running emulator state and surfaced pass/fail/duration/hint in the Project changes card beside the diff. The configured validator action covers explicit test/analyze commands in the same review surface. Verified with focused EmulatorSessionCubit and Forge panel tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact` (588 passed, 2 skipped emulator E2E tests without `PICKFORGE_E2E_AVD`), and `scripts/emulator_e2e.sh Pixel_10`.
- 2026-06-04: Added a dirty-worktree **Create checkpoint** action that runs `git add -u` plus `git commit -m "chore: pickforge checkpoint"` before forging, preserving untracked files unless users handle them manually. Verified with focused GitStatusService and Forge panel tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact` (591 passed, 2 skipped emulator E2E tests without `PICKFORGE_E2E_AVD`), and `scripts/emulator_e2e.sh Pixel_10`.
- 2026-06-04: Added real-repository GitStatusService coverage that creates staged, unstaged, and untracked files, creates a checkpoint commit, and verifies untracked files remain untouched. Verified with `fvm flutter test --reporter=compact test/core/projects/git_status_service_test.dart` and `fvm flutter test --reporter=compact` (593 passed, 2 skipped emulator E2E tests without `PICKFORGE_E2E_AVD`).
- 2026-06-04: Added ForgePanel widget coverage backed by a temporary real git repository with staged, unstaged, and untracked files. The test verifies real git status/diff parsing, drives the dirty-worktree checkpoint dialog, creates the checkpoint through the panel, and confirms untracked files remain untouched. Verified with focused ForgePanel tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact` (619 passed, 3 skipped emulator-gated tests), and `scripts/emulator_e2e.sh Pixel_10`.
- 2026-06-04: Added `scripts/dirty_git_dogfood_setup.sh` so visible manual dogfood can use a disposable git worktree from a real app, seeded with staged, unstaged, and untracked files, without mutating the original checkout. Verified against `/home/dev/Development/Personal/MyGamesList/app`; the generated dogfood worktree had the expected dirty status and cleanup path.
- 2026-06-04: Completed visible dirty-worktree dogfood against the disposable `/tmp/pickforge-dirty-git-project` copy of MyGamesList running on `emulator-5554`. Pickforge selected the app-owned `ElevatedButton` at `/tmp/pickforge-dirty-git-project/lib/features/auth/sign_in/sign_in_screen.dart:150`, showed the staged/unstaged/untracked dirty warning, preserved `pickforge-dirty-dogfood-untracked.txt`, and created checkpoint commit `f57d309` after local disposable git identity was configured. The first checkpoint attempt failed only because the disposable repo had no git author identity; the captured failure output is in `build/dogfood/dirty-git/manual-checkpoint-commit.txt`. Evidence artifacts include `build/dogfood/dirty-git/pickforge-after-reattach.png`, `build/dogfood/dirty-git/pickforge-dirty-dialog.png`, `build/dogfood/dirty-git/pickforge-after-successful-checkpoint-forge.png`, `.pickforge/widget-context.md`, `.pickforge/initial-prompt.md`, `.pickforge/screenshot.png`, `.pickforge/device-screen.png`, and `.pickforge/chats/dirty-dogfood-1780603207/transcript.log` with the `[Pickforge sent prompt]` marker.

### P6.T10 — Context preview, redaction, and prompt quality

**Status:** Completed
**Why:** Users should trust what Pickforge sends to agents, especially when project files and screenshots can be attached.

**Tasks**

- [x] Add a "Preview context" affordance before sending a forge prompt.
- [x] Show selected widget metadata, screenshots, attached files, skill text, and generated prompt.
- [x] Add redaction rules for common secrets: `.env`, tokens, private keys, API keys.
- [x] Block or warn on suspicious attachments.
- [x] Add size/token budget estimate.
- [x] Let users edit the final instruction while preserving generated context.
- [x] Add prompt templates per skill and agent profile.

**Validation**

- [x] Unit tests for secret-pattern redaction.
- [x] Unit tests for blocked file classes.
- [x] Snapshot tests for generated prompt preview.
- Manual review with fixtures containing fake secrets.

**Latest evidence**

- 2026-06-04: Added editable final-instruction handling in the Forge context preview; edited instructions are written to `initial-prompt.md` and sent while generated skill/widget context remains unchanged. Verified with focused AgentLauncher/Forge panel tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.
- 2026-06-04: Added bundled prompt templates for each supported agent/skill pair plus project-local prompt-template overrides, rendered prompt placeholders through `AgentLauncher`, and covered template rendering/source resolution in tests. Verified with focused prompt/skill/launcher/ForgeCubit tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.

### P6.T11 — In-app diagnostics and local support bundle

**Status:** Complete
**Why:** Before telemetry exists, users still need a way to understand and report failures.

**Tasks**

- [x] Add local structured app log with bounded retention.
- [x] Add diagnostics view: app version, OS, Flutter version, agent binary availability, adb status, emulator status, last VM error.
- [x] Add diagnostics card for OS, agent binary availability, `adb`, `git`, Android emulator, and Flutter/FVM availability.
- [x] Add "Export support bundle" that excludes source files, prompts, screenshots, and secrets by default.
- [x] Add copyable error details for connection/run/agent failures.
- [x] Include CI/build metadata in diagnostics when available.

**Validation**

- [x] Unit tests for redacted bundle generation.
- [x] Widget tests for diagnostics happy/error states.

**Latest evidence**

- 2026-06-04: Expanded the settings diagnostics view with app version, Flutter version text, and redacted last VM error, and wired VM connection errors from the emulator cubit into diagnostics/support bundles. Verified with focused diagnostics/settings/emulator tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.
- 2026-06-04: Added categorized, redacted connection/run/agent failure details to diagnostics snapshots, the support bundle, and the settings diagnostics UI with per-failure clipboard actions. Verified with focused diagnostics/settings/forge/emulator tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.
- 2026-06-04: Added optional CI/build metadata to diagnostics snapshots, settings diagnostics rows, and support bundles via `PICKFORGE_BUILD_*` defines and common CI environment fallbacks. Verified with focused diagnostics/settings tests, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.

## 12. Pro/cloud/distribution

### P7.T1 — Update check via Dio

**Status:** Completed / build-time endpoint
**Tasks**

- [x] Decide update metadata endpoint.
- [x] Add opt-out behavior.
- [x] Avoid blocking app startup.

**Latest evidence**

- 2026-06-04: Added a Dio-backed `UpdateCheckService` using the build-time `PICKFORGE_UPDATE_METADATA_URL` endpoint, documented the metadata schema in `docs/architecture/update-checks.md`, added Settings opt-out backed by SharedPreferences, and started checks fire-and-forget after `runApp` so startup is not blocked. Verified with focused update/DI/settings tests, `fvm flutter analyze`, `fvm flutter test --reporter=compact` (601 passed, 2 skipped emulator E2E tests without `PICKFORGE_E2E_AVD`), and `scripts/linux_smoke.sh`.

### P7.T2 — Telemetry and crash reports

**Status:** Completed / privacy-gated Sentry integration
**Tasks**

- [x] Add opt-in setting.
- [x] Define event schema with no source-code or prompt leakage.
- [x] Integrate Sentry or equivalent only after privacy review.

**Latest evidence**

- 2026-06-04: Added a default-off Settings privacy toggle backed by `TelemetrySettingsRepository` and documented the future telemetry/crash event envelope, allowed properties, forbidden data, and provider privacy gate in `docs/architecture/telemetry-and-crash-reports.md`. Verified with focused telemetry/update/DI/settings tests, `fvm flutter analyze`, and `fvm flutter test --reporter=compact` (605 passed, 2 skipped emulator E2E tests without `PICKFORGE_E2E_AVD`).
- 2026-06-04: Integrated `sentry_flutter` behind both the default-off telemetry setting and build-time `PICKFORGE_SENTRY_DSN`, preserved the keyboard assertion guard while allowing Sentry to install first, and added `beforeSend` redaction that drops user/request/breadcrumb/attachment data and sends only sanitized crash metadata. Documented the Sentry privacy review outcome in `docs/architecture/telemetry-and-crash-reports.md`. Verified with `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, focused telemetry/DI tests, `fvm flutter test --reporter=compact` (626 passed, 3 skipped emulator E2E tests without `PICKFORGE_E2E_AVD`), and `scripts/linux_smoke.sh` (passed with the existing non-fatal Xvfb blank-screenshot warning).

### P7.T3 — Auto-updater

**Status:** Partial / distribution strategy documented
**Tasks**

- [ ] macOS Sparkle.
- [x] Windows winget/scoop or updater strategy.
- [x] Linux `.deb`, AppImage, Flathub/Snap strategy.

**Latest evidence**

- 2026-06-04: Documented the update channel and per-platform packaging/update strategy in `docs/architecture/distribution.md`: macOS should use Sparkle 2 only after signing/notarization/appcast readiness, Windows should start with winget and optional Scoop instead of an MVP self-updater, and Linux should prioritize AppImage plus `.deb` with Flathub as the long-term store channel.

### P7.T4 — Codesigning, notarization, distribution

**Status:** Partial / release gates documented
**Tasks**

- [ ] macOS signing and notarization.
- [ ] Windows signing and SmartScreen reputation.
- [x] Linux `.deb` packaging.
- [x] Linux package signing.

**Latest evidence**

- 2026-06-04: Added distribution release gates for signing secrets, protected tags, diagnostics build metadata, Linux cold-install dogfood, macOS Gatekeeper validation, Windows SmartScreen review, and update metadata readiness in `docs/architecture/distribution.md`, and linked that review from `docs/release-checklist.md`.
- 2026-06-04: Added `scripts/package_linux_deb.sh`, Linux desktop metadata, a scalable app icon, and a tagged-release Linux `.deb` packaging step so release builds can produce `build/dist/linux/pickforge_<version>_amd64.deb` plus a SHA-256 checksum using base `ar`/`tar`/`gzip` tooling. Verified with release workflow YAML parsing, `bash -n scripts/package_linux_deb.sh`, debug-bundle package smoke, release `scripts/package_linux_deb.sh`, archive/control/data member inspection, `sha256sum -c`, `scripts/dogfood_preflight.sh`, `scripts/emulator_e2e.sh Pixel_10` against attached `emulator-5554`, and `scripts/linux_smoke.sh`.
- 2026-06-04: Added `scripts/sign_linux_deb.sh` and `scripts/linux_deb_signing_smoke.sh` for Linux package signing. The release workflow imports `PICKFORGE_GPG_PRIVATE_KEY_BASE64` only when present, then emits and verifies detached armored signatures for both the `.deb` and checksum. Verified locally with an ephemeral GPG key using `scripts/linux_deb_signing_smoke.sh --skip-build`, shell syntax checks, workflow YAML parsing, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and `scripts/emulator_e2e.sh Pixel_10`; public release signing still requires configuring the protected signing secret.
- 2026-06-04: Added `scripts/linux_deb_container_install_smoke.sh`, release CI coverage for clean Ubuntu 24.04 container installation of the Linux `.deb`, and pinned the Linux release build runner to `ubuntu-24.04`. The package now declares `libegl1`, `libgles2`, and `xdg-user-dirs` runtime dependencies in addition to GTK/glibc/libstdc++/lzma. Locally, the smoke passed with `--image ubuntu:26.04` against the CachyOS-built package, while the default Ubuntu 24.04 baseline correctly caught the local package's `GLIBC_2.43` requirement from `librive_native_plugin.so`. Release CI now builds on Ubuntu 24.04 and runs the default smoke there.
- 2026-06-04: Added `scripts/package_linux_appimage.sh` and `scripts/linux_appimage_smoke.sh` for broad Linux AppImage distribution. The release workflow now packages and smokes the AppImage on the Ubuntu 24.04 Linux leg after the `.deb` checks. Verified locally with `scripts/linux_appimage_smoke.sh --skip-build`, which generated `build/dist/linux/Pickforge-0.1.0+1-x86_64.AppImage`, verified checksum and extracted AppDir contents, and proved first-run liveness under Xvfb; also verified shell syntax, workflow YAML parsing, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and `scripts/emulator_e2e.sh Pixel_10`.

### P7.T5 — Pickforge Pro backend

**Status:** Partial / Supabase direction documented
**Committed backend direction:** Supabase

**Potential features**

- [ ] Google/GitHub auth.
- [ ] Cloud-synced context.
- [ ] Team sync.
- [ ] Premium skill packs.
- [ ] Multi-agent swarm orchestration.
- [ ] Stripe billing.

**Latest evidence**

- 2026-06-04: Documented the Supabase-backed Pro direction in `docs/architecture/pro-backend.md`, including local-first boundaries, Google/GitHub auth, RLS-first user/team tables, premium skill-pack storage, explicit opt-in cloud sync, server-side Stripe handling, and release gates for privacy/RLS/billing/offline behavior. No Pro backend code was added; the feature list remains future work.

## 13. Architecture refactors

### P8.T1 — Multi-package architecture

**Status:** Deferred
**Why:** Single-package feature-first is correct for MVP.

**Tasks**

- [ ] Reassess after MVP dogfood.
- [ ] Split only if package boundaries reduce complexity.
- [ ] Avoid premature VGV-style multi-package migration.

### P8.T2 — External terminal restoration, only if demanded

**Status:** Partial / embedded PTY retained
**Why:** Embedded PTY is the chosen direction.

**Tasks**

- [ ] Restore from git history only if users need external terminal workflows.
- [x] Keep embedded PTY default.

**Latest evidence**

- 2026-06-04: Reconciled this deferred checkbox against the current implementation: `docs/architecture/embedded-terminal.md` documents the PTY path, `ForgeCubit` sends prompts through `PtySessionPool`, and `ChatWorkbenchPanel` renders the embedded terminal. Verified with focused terminal and Forge tests: `fvm flutter test --reporter=compact test/core/terminal test/features/forge/cubit/forge_cubit_test.dart test/features/forge/view/forge_panel_test.dart` (53 passed). External terminal restoration remains unchecked and conditional on user demand.

## 14. QA, CI, and release

### P9.T1 — Emulator E2E in CI or scheduled/manual workflow

**Status:** Completed
**Why:** Required PR CI remains non-emulator; manual self-hosted workflow and an artifact-producing runner script cover Android E2E.

**Tasks**

- [x] Decide whether GitHub-hosted runners can reliably run emulator E2E.
- [x] If not, create documented manual/scheduled runner flow.
- [x] Capture logs and screenshots as artifacts.

**Latest evidence**

- 2026-06-04: Added `scripts/emulator_e2e.sh`, `docs/qa/emulator-e2e.md`, `.github/workflows/emulator-e2e.yml`, and E2E artifact hooks in both integration tests. Verified with `bash -n scripts/emulator_e2e.sh`, `scripts/emulator_e2e.sh Pixel_10` producing logs and inspector screenshot under `build/e2e/android/`, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, and `fvm flutter test --reporter=compact`.
- 2026-06-04: Extended widget-pick E2E artifacts with raw `selected-widget.json` and `inspector-root.json` inspector payloads for future hover/query debugging. Verified with `fvm flutter test --dart-define=PICKFORGE_E2E_AVD=Pixel_10 --dart-define=PICKFORGE_E2E_ARTIFACT_DIR=build/e2e/android/widget-pick test/integration/widget_pick_e2e_test.dart --reporter=compact`, `fvm flutter analyze`, and `fvm flutter test --reporter=compact` (593 passed, 2 skipped emulator E2E tests without `PICKFORGE_E2E_AVD`).

### P9.T2 — CI hardening

**Status:** Completed
**Tasks**

- [x] Keep format/analyze/test/codegen drift checks green.
- [x] Add platform-specific smoke checks where cheap.
- [x] Address GitHub Actions Node 20 deprecation before it becomes blocking.

**Latest evidence**

- 2026-06-04: Updated CI/release workflows to Node 24 action majors, added read-only workflow permissions, job timeouts, compact test output, and kept codegen drift checks in CI. Verified workflow YAML parsing with PyYAML, `fvm dart run build_runner build --delete-conflicting-outputs`, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.
- 2026-06-04: Added the existing Linux desktop smoke script to the Ubuntu CI leg with Linux desktop/Xvfb/ImageMagick dependencies and `build/smoke/linux/**` artifact upload. Verified workflow YAML parsing with PyYAML, `bash -n scripts/linux_smoke.sh`, `scripts/linux_smoke.sh`, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and `scripts/emulator_e2e.sh Pixel_10`.
- 2026-06-04: Added PR CI desktop build smoke coverage on `ubuntu-latest`, `macos-latest`, and `windows-latest` through `scripts/desktop_build_smoke.sh`, with build artifacts uploaded only on failure. Verified with workflow YAML parsing, `bash -n scripts/desktop_build_smoke.sh scripts/dogfood_preflight.sh scripts/web_demo_smoke.sh scripts/linux_smoke.sh scripts/emulator_e2e.sh`, `scripts/desktop_build_smoke.sh`, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and `scripts/emulator_e2e.sh Pixel_10`.
- 2026-06-04: Added macOS/Windows native desktop launch liveness smoke after desktop builds in CI and release workflows via `scripts/desktop_launch_smoke.sh`; PR CI uploads `build/smoke/desktop-launch/**` artifacts. Verified workflow syntax, shell syntax, Linux skip behavior, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and `scripts/emulator_e2e.sh Pixel_10`.

### P9.T3 — Release checklist execution

**Status:** Partial / Linux visible dogfood started
**Tasks**

- [x] Update checklist to current app.
- [ ] Run it on Linux.
- [ ] Run it on macOS before public release.
- [x] Record results and blockers.

**Latest evidence**

- 2026-06-04: Updated `docs/release-checklist.md` for current automated preflight, demo/project/device binding, current agent profiles, `.pickforge/` context outputs, workspace UX, hot reload/review, keyboard/accessibility, and release signoff. Recorded Linux automated results from `scripts/linux_smoke.sh` and `scripts/emulator_e2e.sh Pixel_10`, plus the headless Xvfb blocker for full visible desktop click-through.
- 2026-06-04: Added `docs/qa/manual-dogfood.md`, `scripts/dogfood_preflight.sh`, and desktop build smoke entries to the release checklist so visible-desktop and native-host preparation steps are explicit. Verified locally with `scripts/dogfood_preflight.sh`.
- 2026-06-04: Updated `docs/release-checklist.md` after the visible MyGamesList Linux pass resolved the project-binding and embedded-terminal prompt-delivery blocker. Linux signoff remains unchecked until cold-install artifact and real installed-agent profile passes are run.
- 2026-06-04: Added and ran `scripts/linux_visible_diagnostics_smoke.sh` in the visible KDE Wayland desktop session. It launched Pickforge onboarding with controlled PATH cases for all-present tools plus missing `claude`, `codex`, `opencode`, `agent`, `gemini`, and `adb`; each case wrote VM-service inspector JSON and a 3840x2160 screenshot under `build/dogfood/visible-diagnostics/`. Added exact widget coverage for each missing row and copy setup action, and expanded `scripts/missing_tool_smoke.sh` to cover Cursor/Gemini too. This resolves the Linux missing-binary recovery and `adb` unavailable setup-check gaps, but does not replace real installed-agent Forge passes or cold-install dogfood.
- 2026-06-04: Added and ran `scripts/agent_profile_pty_smoke.sh`, a Flutter test-backed Linux smoke for the installed Claude Code, Codex, and OpenCode profiles. It launches each real CLI through `FlutterPtyAdapter`, prepares disposable `.pickforge/` context, sends the same visible Pickforge prompt marker used by the embedded terminal, and writes transcripts plus copied context artifacts under `build/dogfood/agent-profile-pty/`. This resolves the local installed-profile PTY launch/prompt-delivery gap for those three profiles; it does not verify full agent response/edit behavior.
- 2026-06-04: Added and ran `scripts/linux_deb_smoke.sh --skip-build` against the generated Linux package. The smoke verifies `.deb` checksum and members, control metadata, extracted bundle files, launcher symlink, desktop/icon files, and clean-HOME first-run process liveness under Xvfb. It wrote artifacts under `build/smoke/linux-deb/`. Headless Xvfb still produced a blank screenshot and no discoverable X window, so this is package/liveness coverage rather than a true visual installed-system pass. Verified with shell syntax checks, workflow YAML parsing, `scripts/linux_deb_smoke.sh --skip-build`, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and `scripts/emulator_e2e.sh Pixel_10`.
- 2026-06-04: Added `scripts/desktop_launch_smoke.sh` to the release checklist and native-host dogfood notes so macOS/Windows hosts launch the built artifact before manual project binding/widget pick/Forge checks. Linux signoff remains unchecked until a true sudo install on a fresh VM or clean machine is completed.
- 2026-06-04: Added and ran `scripts/linux_deb_container_install_smoke.sh --skip-build --image ubuntu:26.04` with Docker. It installed the `.deb` through `apt`, verified package metadata/files/linkage, and proved installed-app first-run liveness under Xvfb after adding missing `libegl1`, `libgles2`, and `xdg-user-dirs` package dependencies. The default Ubuntu 24.04 baseline intentionally remains in release CI and caught the local rolling-distro package's `GLIBC_2.43` requirement; release CI is pinned to Ubuntu 24.04 so the shipped `.deb` is built and smoke-tested against that baseline.
- 2026-06-04: Added and ran `scripts/linux_appimage_smoke.sh --skip-build`. It uses `appimagetool` with `APPIMAGE_EXTRACT_AND_RUN=1`, verifies the generated AppImage checksum and extracted AppDir files, and proves first-run liveness under Xvfb. Release CI now runs the same smoke after the Linux release build. Verified with full local format/analyze/test plus `scripts/emulator_e2e.sh Pixel_10`.

**Blocked:** macOS and Windows checklist execution require native macOS/Windows hosts. Linux signoff is still incomplete only for a visible sudo install on a fresh VM or clean machine; rootless package extraction/liveness, clean-container apt install/liveness, and installed Claude Code/Codex/OpenCode PTY launch/prompt delivery are covered by smoke evidence.

### P9.T4 — Local app testing strategy

**Status:** Completed
**Why:** The app needs repeatable validation beyond unit/widget tests. The real runtime is Flutter desktop plus Android emulator/VM Service, so browser-only testing is insufficient.

**Testing layers**

- **Unit tests:** pure services, repositories, parsing, process command construction.
- **Widget tests:** panes, cubits, navigation, ForgePanel, file explorer, command palette.
- **Golden/screenshot tests:** left pane list/grid, file explorer, terminal shell, inspector states, settings.
- **Desktop smoke tests:** launch Linux desktop app under a virtual display, verify first frame/routes, and capture screenshots.
- **Runtime integration tests:** run against a fixture Flutter app and fake VM Service where possible.
- **Emulator E2E:** opt-in test against a real AVD for boot/run/hot reload/widget pick.
- **Manual dogfood:** real agent CLIs and real user projects before release.

**Web feasibility**

- [x] Do not assume the current app can run as Flutter web unchanged; it depends on desktop-only pieces (`dart:io`, PTY, window management, SQLite/native process execution).
- [x] If web-based visual testing is desired, create a **web-demo harness** with fake services and no PTY/process calls.
- [x] Use the web harness only for UI/layout review, not runtime correctness.

**Tasks**

- [x] Add a Linux desktop smoke test target.
- [x] Decide whether to use `integration_test` on Linux desktop, screenshot/golden tests, or an external virtual-display launcher.
- [x] Add deterministic fake services for VM Service, emulator state, file explorer, and chats.
- [x] Add CI artifacts for screenshots on failure.
- [x] Keep real AVD tests opt-in unless CI reliability is proven.

**Latest evidence**

- 2026-06-04: Added `scripts/linux_smoke.sh`, which launches Pickforge on the Linux desktop target inside Xvfb, starts directly on `/demo`, probes the Flutter VM Service inspector root tree for `DemoWorkspaceView`, and saves smoke artifacts under `build/smoke/linux/`. Verified locally with `scripts/linux_smoke.sh`; the VM-service assertion passed, while the root Xvfb screenshot artifact was captured but blank in this headless environment.
- 2026-06-04: Wired `scripts/linux_smoke.sh` into the Ubuntu CI leg and uploads `build/smoke/linux/**` so smoke failures retain `flutter-run.log`, `inspector-root.json`, and `first-frame.png`.
- 2026-06-04: Reused the existing VM Service replay fake in `lib/core/vm_service/testing/fake_vm_service.dart` and extracted deterministic workspace test fixtures for emulator/device settings, file explorer, projects, chats, and selected-widget state into `test/support/deterministic_workspace_fixtures.dart`. Updated visual regression tests to consume the shared fixtures and verified `fvm flutter test test/goldens/visual_regression_test.dart --reporter=compact`, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and `scripts/emulator_e2e.sh Pixel_10`.
- 2026-06-04: Added `lib/web_demo.dart`, minimal `web/` shell files, `scripts/web_demo_smoke.sh`, and `docs/qa/local-testing.md`. The web harness is a fake-services UI/layout harness only and intentionally avoids the desktop `lib/main.dart`, PTY/process, SQLite, `dart:io`, window-management, and Android tooling paths. Verified with `bash -n scripts/web_demo_smoke.sh`, `scripts/web_demo_smoke.sh`, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and `scripts/emulator_e2e.sh Pixel_10`.

### P9.T5 — Manual dogfood matrix

**Status:** Completed / Linux matrix covered
**Tasks**

- [x] Test with Claude Code installed.
- [x] Test with Codex installed.
- [x] Test with OpenCode installed.
- [x] Test when each agent binary is missing.
- [x] Test with `adb` available and unavailable.
- [x] Test on a small sample app and a larger real app.
- [x] Test with no emulator connection: chats and project browsing should still work.

**Latest evidence**

- 2026-06-04: Local preflight found Claude Code `2.1.161`, Codex CLI `0.136.0`, OpenCode `1.14.30`, `adb`, `fvm`, and `git` available on PATH; the standalone `emulator` command was missing. Existing diagnostics/onboarding tests cover available/missing tool display, but this is not a substitute for the full manual dogfood matrix.
- 2026-06-04: Added `scripts/dogfood_preflight.sh` and `docs/qa/manual-dogfood.md` to capture local tool/version/device availability and define the approved manual agent/model matrix: Codex with GPT 5.3 Codex Spark, OpenCode with DeepSeek V4 Flash, and Claude Code with Sonnet 4.6. Pickforge does not pass model flags yet, so the selected models must be configured in the CLIs before manual dogfood. `scripts/dogfood_preflight.sh` found `emulator-5554` and `emulator-5556` attached locally, with `claude`, `codex`, `opencode`, `adb`, `fvm`, and `git` available.
- 2026-06-04: Added widget coverage proving projects, chats, file browsing, and the no-device connection state render together without an `EmulatorSessionCubit` provider. Current `scripts/dogfood_preflight.sh` found `emulator-5554`, `claude`, `codex`, `opencode`, `adb`, `fvm`, and `git` available; `emulator`, `agent`, and `gemini` were missing. Verified with `fvm flutter analyze` and `fvm flutter test --reporter=compact` (592 passed, 2 skipped emulator E2E tests without `PICKFORGE_E2E_AVD`).
- 2026-06-04: Reconciled the small/large app dogfood axis from recorded visible-desktop evidence: `fixtures/sample_flutter_app` covered the small fixture target, and `/home/dev/Development/Personal/MyGamesList/app` covered the larger real Flutter target. This closes only the app-size axis; all-agent profile passes, controlled missing-binary cases, and `adb` unavailable dogfood remain open.
- 2026-06-04: Added `PICKFORGE_INHERITED_ENV_ONLY=1` support for deterministic diagnostics PATH dogfood, plus `tool/diagnostics_probe.dart` and `scripts/missing_tool_smoke.sh` to verify missing `claude`, `codex`, `opencode`, and `adb` availability detection with controlled fake command sets. Verified with focused environment/diagnostics/onboarding tests, `scripts/missing_tool_smoke.sh`, `fvm flutter analyze`, `fvm flutter test --reporter=compact` (607 passed, 2 skipped emulator E2E tests without `PICKFORGE_E2E_AVD`), and `scripts/emulator_e2e.sh Pixel_10` against attached `emulator-5554`.
- 2026-06-04: Added `scripts/linux_visible_diagnostics_smoke.sh` and `tool/visible_diagnostics_probe.dart` for visible desktop diagnostics dogfood, and expanded `scripts/missing_tool_smoke.sh` to include `agent` and `gemini`. The visible script runs Pickforge onboarding in a real desktop session with controlled PATH cases for all-present tools plus missing `claude`, `codex`, `opencode`, `agent`, `gemini`, and `adb`, probes the live Flutter inspector tree, and captures screenshots per case. Added widget tests that verify the exact missing row label and copy setup action for each agent binary plus `adb`. Verified with focused onboarding/diagnostics tests, `scripts/missing_tool_smoke.sh`, `scripts/linux_visible_diagnostics_smoke.sh`, `scripts/dogfood_preflight.sh`, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact` (618 passed, 2 skipped emulator E2E tests without `PICKFORGE_E2E_AVD`), and `scripts/emulator_e2e.sh Pixel_10`; real `adb` available remains covered by the Android E2E against `emulator-5554`.
- 2026-06-04: Added and ran `scripts/agent_profile_pty_smoke.sh`. The smoke found installed `claude`, `codex`, and `opencode`, launched each profile through the real `FlutterPtyAdapter`, generated disposable Pickforge context with project-local skill/template overrides, sent the Pickforge prompt marker into the running PTY session, and copied per-agent transcripts plus `skill-active.md`, `widget-context.md`, and `initial-prompt.md` artifacts under `build/dogfood/agent-profile-pty/`. Verified all three profile results as `ok: true`; no smoke-specific agent processes remained afterward.

**Caveat:** The installed-agent smoke verifies launch and prompt delivery through Pickforge's embedded PTY path. It intentionally does not wait for a model response or validate agent file edits.

### P9.T6 — Accessibility and keyboard-first audit

**Status:** Completed
**Why:** Dev tools live on keyboard speed. Accessibility also catches poor focus, contrast, and semantics early.

**Tasks**

- [x] Define keyboard shortcuts for major actions: command palette, new chat, add project, focus explorer, focus terminal, forge, run/hot reload.
- [x] Add visible focus states across panes.
- [x] Verify tab order in sidebar, file explorer, inspector, settings, and dialogs.
- [x] Support text scaling without overflow.
- [x] Add high-contrast checks for dark theme.
- [x] Add semantics labels for icon-only controls.

**Validation**

- Widget tests for shortcut dispatch where feasible.
- Golden/screenshot tests at larger text scale.
- Manual keyboard-only dogfood pass.

**Latest evidence**

- 2026-06-04: Added `test/features/workbench/view/workbench_accessibility_test.dart`, covering tooltip/semantics exposure for icon-only controls, tab traversal through sidebar dialog, file explorer, inspector, and settings, and 1.6x text-scaling smoke coverage across primary workbench panels. Hardened settings diagnostics labels against high text-scale overflow. Verified with `fvm flutter test test/features/workbench/view/workbench_accessibility_test.dart --reporter=compact`, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and `scripts/emulator_e2e.sh Pixel_10`.

- 2026-06-04: Added direct workbench shortcuts for Add Project (`Ctrl/Cmd+O`), New Chat (`Ctrl/Cmd+N`), Hot Reload (`Ctrl/Cmd+R`), and F5 as Run App when idle or Hot Reload while running. Added a focus-scoped Forge shortcut (`Ctrl/Cmd+Enter`) inside `ForgePanel`. Verified with `test/features/workbench/view/workbench_command_palette_scope_test.dart` and `test/features/forge/view/forge_panel_test.dart`.
- 2026-06-04: Added explicit tooltip and semantics labels for Forge context-tray icon-only removal controls: remove note, remove attachment, and dismiss warning. Verified with `test/features/forge/view/forge_panel_test.dart`.
- 2026-06-04: Added AA contrast tests for dark theme `surface/onSurface`, `primary/onPrimary`, `secondary/onSecondary`, and `error/onError`; updated accent foreground colors to near-black so bright action/error surfaces meet text contrast. Verified with `test/shared/theme/pickforge_theme_test.dart`.
- 2026-06-04: Added large-text sidebar screenshot coverage at 1.6 text scale for the compact projects/chats layout, including overflow and nonblank pixel checks. Verified with `test/features/workbench/view/projects_chats_panel_test.dart`.
- 2026-06-04: Added workbench focus shortcuts for explorer (`Ctrl/Cmd+Shift+E`) and terminal/chat (`Ctrl/Cmd+\``), plus visible focus frames for left, middle, and right panes. Verified shortcut dispatch and focus-frame color changes with `test/features/workbench/view/app_shell_view_test.dart`.

### P9.T7 — Performance and scalability budgets

**Status:** Completed
**Why:** The app must stay fast on real projects with thousands of files, many chats, and large transcripts.

**Budgets**

- App shell first usable frame: target under 1s after cold launch on a normal dev laptop.
- Left pane interactions: no perceptible jank with 100 projects/chats.
- File explorer: lazy load large folders; avoid full-tree blocking scans.
- Transcript replay: bounded memory and chunked rendering for large logs.
- Widget picker polling: pause when disconnected/collapsed where safe.

**Tasks**

- [x] Add benchmark-style tests or instrumentation for large sidebar state.
- [x] Add fixture project with many files for explorer tests.
- [x] Add transcript replay stress test.
- [x] Add performance counters in diagnostics.
- [x] Define and enforce file scan excludes.

**Latest evidence**

- 2026-06-04: Added a benchmark-style regression test for `buildWorkspaceSidebarSections` with 100 projects and 2,000 chats across project, recent, pinned, agent, skill, and custom grouping modes. The test enforces a conservative 500ms ceiling for the pure section-building path. Verified with `test/features/workbench/cubit/workspace_sidebar_sections_test.dart`.
- 2026-06-04: Added a generated large-project fixture test for `ProjectFileTreeScanner` with 600 scanned source/test files and 450 ignored files under `.git`, `.dart_tool`, and `build`. The test verifies sorted output, common excludes, and a conservative 2500ms scanner budget. Verified with `test/core/projects/project_file_tree_scanner_test.dart`.
- 2026-06-04: Added a transcript replay stress test with a 2 MiB log, 8 KiB chunks, checksum verification, max-chunk enforcement, and a conservative 2000ms replay budget. Verified with `test/core/terminal/transcript_replayer_test.dart`.
- 2026-06-04: Added bounded diagnostics performance counters, support-bundle output, settings UI rows, and `fileExplorer.scan` recording from `ProjectFileExplorerCubit`. Verified with `test/core/diagnostics/diagnostics_service_test.dart`, `test/features/workbench/cubit/project_file_explorer_cubit_test.dart`, and `test/features/settings/view/settings_view_test.dart`.
- 2026-06-04: Expanded `ProjectFileTreeScanner.commonExcludes` for heavyweight generated directories including `.fvm`, `coverage`, `node_modules`, Android build outputs, and Flutter platform ephemeral folders. Added a regression test that creates every common exclude and verifies the scanner omits each path and descendants even when hidden files are shown. Verified with `test/core/projects/project_file_tree_scanner_test.dart`.

### P9.T8 — Storage migration and backward-compatibility suite

**Status:** Completed
**Why:** Drift migrations, corrupted-settings recovery, storage retention policy, and tracked schema snapshot coverage are now in place for the current released schema baseline.

**Tasks**

- [x] Keep schema snapshots for each released DB version.
- [x] Add migration tests from every release schema to latest.
- [x] Add corrupted/partial settings recovery tests.
- [x] Add backup-before-migration policy once real users exist.
- [x] Document data retention and `.pickforge/` disk layout invariants.

**Latest evidence**

- 2026-06-04: Added missing v5-to-v6 Drift migration coverage for `project_settings.emulator_idle_shutdown`, preserving an existing `emulator_launch_options` value. Together with existing v1, v2, v3, and v4 migration tests, the suite now covers every released schema version opening on the current schema. Verified with `test/core/drift/migration_v5_to_v6_test.dart`.
- 2026-06-04: Added defensive recovery for corrupted database-backed JSON settings: malformed run args now preserve target file with empty extra args, invalid emulator launch options return defaults, and partial/corrupted idle shutdown JSON falls back safely. Verified with `test/core/settings/project_settings_repository_emulator_test.dart` and `test/core/settings/project_settings_repository_test.dart`.
- 2026-06-04: Documented Drift storage boundaries, `.pickforge/` disk layout, transcript/run retention, support-bundle exclusions, and backup-before-migration policy for user-facing schema bumps in `docs/architecture/storage.md`; linked it from `README.md`.
- 2026-06-04: Generated the first tracked Drift schema snapshot at `test/core/drift/schema/pickforge_database_v6.json`, documented the snapshot policy in `test/core/drift/schema/README.md`, and added a guard test that requires a snapshot for `PickforgeDatabase.schemaVersion`. Verified with `test/core/drift/pickforge_database_test.dart`, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.

### P9.T9 — Visual regression suite

**Status:** Completed
**Why:** Linux-canonical golden coverage now protects the primary polished surfaces, with deterministic font/theme setup, CI failure artifacts, and documented cross-OS policy.

**Tasks**

- [x] Add golden coverage for onboarding, sidebar list/grid, file explorer, terminal, inspector selected/empty states, settings, dialogs.
- [x] Add deterministic fonts/theme setup for goldens.
- [x] Add failure artifacts in CI.
- [x] Decide tolerance policy across Linux/macOS.

**Latest evidence**

- 2026-06-04: Added `test/goldens/visual_regression_test.dart` with golden baselines for onboarding, sidebar list/grid, project file explorer, demo terminal/workbench, inspector empty/selected states, settings, and the `.pickforge` gitignore dialog. Added deterministic golden font/theme setup in `test/support/golden_test_harness.dart`, documented the Linux-exact/macOS-skipped policy in `test/goldens/README.md`, and configured CI to upload Flutter golden `failures/` artifacts on test failure. Verified with `fvm flutter test --update-goldens test/goldens/visual_regression_test.dart --reporter=compact`, `fvm flutter test test/goldens/visual_regression_test.dart --reporter=compact`, visual inspection of generated baselines, `fvm dart format --set-exit-if-changed .`, `fvm flutter analyze`, `fvm flutter test --reporter=compact`, and both Android emulator E2Es against `Pixel_10`.

## 15. Deprecated or stale plan items not carried forward

Do not execute these historical items unless a new decision revives them:

- Terminal profile registry and external terminal launcher implementation.
- `ConnectionView` as a gateway route.
- DockView as the primary shell.
- Any old plan step that hardcodes stale Flutter/package versions.
- Old checkpoint unchecked boxes that correspond to already implemented code.

## 16. Recommended execution order

1. **P0:** land current core-loop working tree and confirm CI.
2. **P1:** finish MVP dogfood blockers: screenshot path, user-code gating, settings project scoping, command palette wiring, release checklist refresh.
3. **P6:** add the left-pane list/grid grouping and project file explorer; these are product-quality multipliers and should land before broad dogfood if possible.
4. **P6:** add onboarding/demo mode, context preview, and git safety before wider dogfood.
5. **P1/P9:** run manual dogfood with a real emulator and agent.
6. **P9:** add desktop smoke, accessibility, performance, and visual-regression testing paths so development can be validated continuously.
7. **P2:** harden emulator/run-session lifecycle.
8. **P4:** implement MCP server if agent-side re-query becomes the next highest-leverage improvement.
9. **P5:** attempt the embedded emulator mirror after the core desktop app is stable.
10. **P3/P7:** expand platforms and distribution only after the MVP loop is proven.

## 17. Completed execution log — workspace navigation and context safety

**Completed commit:** `bfed126 feat: add workspace navigation and context safety`

### Branch/worktree handling

- [x] Continued implementation in the existing repository-root worktree `.worktrees/pickforge-navigation`.
- [x] Committed the task branch changes on `task/pickforge-navigation`.
- [x] Fast-forward merged `task/pickforge-navigation` into `main`.
- [x] Removed the old `.worktrees/pickforge-navigation` worktree after confirming it was clean.
- [x] Deleted the merged local `task/pickforge-navigation` branch.
- [x] Confirmed `main` is clean and ahead of `origin/main` by one commit.

### Plan tracking updates

- [x] Marked already-landed MVP core-loop work as completed.
- [x] Marked completed P1 items for screenshot capture, user-code gating, active-project settings, command palette base wiring, MVP history decision, PTY project switching, and release checklist refresh.
- [x] Added partial completion checkboxes for the real widget-pick dogfood pass based on emulator E2E evidence.
- [x] Marked completed and remaining work for P6 left-pane navigation, project file explorer, context attachments, onboarding, git safety, context preview/redaction, and diagnostics.

### Workspace navigation

- [x] Added left-pane list/grid mode support.
- [x] Added grouping by project, recent activity, pinned/favorites, agent, skill, and custom group.
- [x] Added project/chat pinning.
- [x] Added collapsible groups and grid density controls.
- [x] Persisted sidebar view mode, grouping mode, density, collapsed groups, pinned IDs, and custom chat groups.
- [x] Added fuzzy filtering and keyboard navigation in the left pane.
- [x] Added tests for grouping, sorting, pinning, list/grid rendering, empty state, pinned group, and collapse/expand behavior.

### Project file explorer

- [x] Added `ProjectFileExplorerCubit` and state.
- [x] Added safe project tree scanning with sorting, common excludes, hidden-file toggle, `.gitignore`, and `.pickforge/.gitignore` handling.
- [x] Avoided symlink recursion and blocked symlink attachment reads.
- [x] Added expandable folder/file UI in the left pane.
- [x] Added file search/filter.
- [x] Added system default open and reveal actions for Linux, macOS, and Windows.
- [x] Added copy relative path and copy absolute path actions.
- [x] Added "Attach to next forge prompt" from the explorer.
- [x] Added debounced filesystem watching and refresh.
- [x] Added unit/widget/process-runner tests for scanning, ignore rules, symlink handling, sorting, explorer UI, and platform open commands.

### Context attachments and forge prompt safety

- [x] Added context attachment model, Cubit, state, renderer, policy, and redactor.
- [x] Added file attachment chips in `ForgePanel`.
- [x] Added selected widget, screenshot, device screenshot, run-log, and custom-note context chips.
- [x] Added remove and reorder controls for attachments.
- [x] Added custom notes to the generated context.
- [x] Added large-context size warnings.
- [x] Blocked suspicious attachments such as `.env`, private keys, images/binaries, `.pickforge/` context, and symlinks.
- [x] Redacted common secret assignments, prefixed env-style keys, JSON-style quoted keys, and private keys.
- [x] Included attachment content and custom notes in generated widget context.
- [x] Added tests for redaction, blocked files, symlink blocking, custom notes, attachment ordering, and context rendering.

### Context preview

- [x] Added "Preview context" affordance in `ForgePanel`.
- [x] Preview includes initial prompt, active skill text, and widget context.
- [x] Preview handles loading and error states.
- [x] Added widget tests covering preview rendering.

### Git safety and active-chat correctness

- [x] Added git status parsing for staged, unstaged, untracked, and branch state.
- [x] Warned before forging into dirty repositories.
- [x] Added project change summary with changed files and diff stat.
- [x] Added copy-diff action.
- [x] Prevented stale active chats from being used after project-only switches.
- [x] Restored or cleared active chat on project switches.
- [x] Added tests for git parsing, diff summary, copyable diff text, chat activation, and stale-chat filtering.

### Onboarding and setup checks

- [x] Added first-run checklist.
- [x] Added demo-mode affordance/card.
- [x] Added "Open sample Flutter app" action for `fixtures/sample_flutter_app`.
- [x] Added setup checks for Flutter/FVM, `adb`, emulator, Claude Code, Codex, and OpenCode.
- [x] Added retry and copy-command recovery actions.
- [x] Added onboarding widget tests for empty/demo/setup/sample-app flows.

### Diagnostics and support bundle

- [x] Added diagnostics service with bounded local log entries.
- [x] Registered diagnostics as a shared service.
- [x] Recorded Forge failures into diagnostics.
- [x] Added diagnostics card for OS, `adb`, `git`, emulator, Flutter/FVM, and agent binary availability.
- [x] Added copyable support bundle that excludes source files, prompts, screenshots, and secrets by default.
- [x] Added redaction in diagnostics logs and support bundles.
- [x] Added diagnostics unit and widget tests.

### CI and validation

- [x] Updated CI action versions.
- [x] Regenerated build-runner outputs.
- [x] Regenerated localization outputs.
- [x] Ran `fvm dart format --set-exit-if-changed .`.
- [x] Ran `fvm flutter analyze`.
- [x] Ran `fvm dart run build_runner build --delete-conflicting-outputs`.
- [x] Ran `fvm flutter test --coverage --reporter=compact`.
- [x] Ran emulator hot-reload E2E with `PICKFORGE_E2E_AVD=Pixel_10`.
- [x] Ran widget-pick emulator E2E with `PICKFORGE_E2E_AVD=Pixel_10`.
- [x] Ran focused tests for forge, attachments, redaction, file explorer, diagnostics, git safety, sidebar, onboarding, and chat switching.
- [x] Ran final Flutter and GPT review passes.
