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

**Status:** Partial
**Why:** Unit/widget coverage exists, but the complete runtime loop needs manual evidence against a real Flutter app in an Android emulator.

**Tasks**

- [x] Launch the fixture or a real Flutter app in an Android emulator.
- [ ] Bind it to a Pickforge project.
- [x] Confirm the runtime reaches a running VM Service in emulator E2E.
- [x] Pick a user-code widget and verify inspector selection, source metadata, eligibility, and screenshot state.
- [ ] Press **Forge it** and verify the prompt appears in the active embedded terminal session.
- [ ] Verify agent context files under `.pickforge/`.
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

**Blocked:** Headless Xvfb launches the Linux app far enough to expose VM Service, but this environment has no lightweight X window manager and `import -window root` captures a blank desktop, so the live desktop click-through for project binding and visible terminal prompt remains unchecked.

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

**Status:** Deferred
**Tasks**

- [ ] Add optional per-project emulator launch flags: `-no-audio`, `-gpu`, `-no-snapshot-load`, custom port, cores.
- [ ] Validate flags against known emulator capabilities.
- [ ] Keep simple `flutter emulators --launch` path as default.

### P2.T4 — Run-session crash recovery/adoption

**Status:** Deferred
**Tasks**

- [ ] Persist PID/session metadata and IPC socket path.
- [ ] On Pickforge startup, detect orphaned `flutter run --machine`.
- [ ] Offer adoption or cleanup.
- [ ] Handle stale PID safely.

### P2.T5 — Per-project AVD auto-shutdown

**Status:** Deferred
**Tasks**

- [ ] Add per-project idle shutdown setting.
- [ ] Track last activity/run state.
- [ ] Prompt before destructive shutdown unless explicitly configured.

### P2.T6 — Inspector auto-attach optimization

**Status:** Deferred
**Tasks**

- [ ] Skip or pause inspector polling when right pane is collapsed.
- [ ] Resume cleanly when visible.
- [ ] Measure CPU savings before making this default.

## 8. Platform expansion

### P3.T1 — Windows IPC parity

**Status:** Deferred / Partial
**Why:** CI runs on Windows, but IPC server design is Unix-socket first.

**Tasks**

- [ ] Add named-pipe implementation for Windows.
- [ ] Preserve Unix socket path for Linux/macOS.
- [ ] Add platform-specific tests where possible.
- [ ] Verify ConPTY edge cases for embedded agent sessions.

### P3.T2 — Physical Android support

**Status:** Deferred
**Tasks**

- [ ] Detect physical devices separately from emulators.
- [ ] Respect adb serial selection.
- [ ] Validate screenshot and run-session behavior.

### P3.T3 — iOS Simulator support

**Status:** Deferred
**Tasks**

- [ ] Add iOS simulator discovery.
- [ ] Add `xcrun simctl` screenshot support.
- [ ] Validate VM Service and inspector extensions against iOS.

### P3.T4 — Flutter web target support

**Status:** Deferred
**Tasks**

- [ ] Support Chrome/web VM service connection.
- [ ] Handle web-specific inspector/source paths.
- [ ] Define screenshot behavior for browser targets.

### P3.T5 — Flutter desktop target support

**Status:** Deferred
**Tasks**

- [ ] Attach to desktop target VM services.
- [ ] Define screenshot path per platform.
- [ ] Validate with Linux first, then macOS/Windows.

## 9. Agent ecosystem and MCP

### P4.T1 — Pickforge MCP server

**Status:** Deferred / Phase 1.5
**Goal:** Let agents re-query Pickforge state after the initial prompt.

**Capabilities**

- [ ] `get_selected_widget`
- [ ] `list_pickforge_history`
- [ ] `capture_screenshot`
- [ ] `hot_reload`
- [ ] `get_run_logs`
- [ ] `get_project_context`

**Integration**

- [ ] Decide whether MCP server ships inside this repo, separate repo, or both.
- [ ] Document socket/transport discovery.
- [ ] Add agent-profile-specific MCP configuration guidance.

### P4.T2 — Agent expansion

**Status:** Deferred
**Tasks**

- [ ] Add Cursor CLI profile if stable CLI exists.
- [ ] Add Gemini CLI profile.
- [ ] Add test fixtures for each profile's invocation args and resume behavior.
- [ ] Keep bring-your-own-auth; do not handle tokens.

### P4.T3 — Headless chat adapter mode

**Status:** Deferred / major post-MVP alternative
**Goal:** Render Pickforge-owned chat UI over structured CLI output instead of PTY UI.

**Staging**

- [ ] Claude Code stream-json adapter.
- [ ] Codex exec JSON adapter.
- [ ] OpenCode run JSON adapter.
- [ ] Normalize output into `ChatMessage`.
- [ ] Add per-agent feature flag.

**Non-goals**

- Do not remove PTY mode until headless mode reaches feature parity for required workflows.
- Do not store API keys.

### P4.T4 — Skill overrides and community registry

**Status:** Deferred / Partial
**Tasks**

- [ ] Ensure project-local `.pickforge/skills/` overrides bundled skills.
- [ ] Add UI to inspect active skill source.
- [ ] Design community skill registry.
- [ ] Add trust/safety model for skill packs.

## 10. Visual picking and emulator mirror

### P5.T1 — Embedded emulator mirror

**Status:** Deferred
**Goal:** Replace side-by-side external emulator dependence with an embedded live mirror.

**Tasks**

- [ ] Evaluate scrcpy integration strategy.
- [ ] Solve device pixel ratio, rotation, and input forwarding.
- [ ] Keep existing VM Service inspector selection as the source of widget identity.
- [ ] Ensure mirror is optional and does not regress Approach A.

### P5.T2 — True hover-over-live-emulator UX

**Status:** Deferred
**Tasks**

- [ ] Overlay hover target mapping onto mirrored emulator coordinates.
- [ ] Query/preview widget under pointer.
- [ ] Show highlight without interfering with app input.

### P5.T3 — Widget-tree diffing and rebuild tracking

**Status:** Deferred
**Tasks**

- [ ] Use `ext.flutter.inspector.trackRebuildDirtyWidgets`.
- [ ] Capture before/after widget tree snapshots.
- [ ] Render changed widgets after hot reload.

### P5.T4 — Screenshot before/after loop

**Status:** Deferred
**Tasks**

- [ ] Capture before screenshot at pick time.
- [ ] Capture after screenshot post hot reload.
- [ ] Optionally prompt agent to self-check visual result.

## 11. Product polish and UX

### P6.T1 — Design-system polish pass

**Status:** Partial
**Tasks**

- [ ] Audit Material-default UI remnants.
- [ ] Tighten density, spacing, typography, colors, and empty states.
- [ ] Confirm reduce-motion behavior for all animations.
- [ ] Add missing localized strings.

### P6.T2 — Command palette expansion

**Status:** Deferred after base wiring
**Tasks**

- [ ] Add quick actions: new chat, add project, run app, hot reload, pick device, open settings.
- [ ] Add fuzzy search across chats/history if history search is implemented.

### P6.T3 — Search across transcripts and pick history

**Status:** Deferred
**Tasks**

- [ ] Index transcript text files or search on demand.
- [ ] Include pick history and widget classes.
- [ ] Surface results in command palette or dedicated search UI.

### P6.T4 — Left pane list/grid views with grouping

**Status:** Partial / in progress
**Why:** The left pane should scale beyond a flat Warp-like sidebar. Users need to switch between dense list and visual grid modes and group workspaces/chats in ways that match their workflow.

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
- [ ] Golden/screenshot tests for dense and roomy layouts.

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

**Status:** Deferred
**Why:** Once users have many chats, they need stronger organization than project + chat.

**Tasks**

- [ ] Add chat labels/tags.
- [ ] Add status: active, waiting, done, archived.
- [ ] Add "task brief" metadata per chat.
- [ ] Add archive and restore.
- [ ] Surface grouped tasks in the left pane list/grid views.

### P6.T8 — First-run onboarding and demo mode

**Status:** Partial / in progress
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

### P6.T9 — Agent change review and git safety

**Status:** Partial / in progress
**Why:** The agent edits the user's project. Pickforge should make changes visible, reversible, and safe without becoming a full IDE.

**Tasks**

- [x] Capture pre-forge git status and current branch for the project.
- [x] Warn before forging into a dirty worktree unless the user acknowledges.
- [x] After agent changes, show changed files and a concise diff summary.
- [ ] Add actions: open changed file, copy diff, run configured validator, discard instructions.
- [x] Add action: copy diff.
- [x] Detect untracked files separately and never delete/move them.
- [ ] Add optional "create checkpoint commit" or "stash before forge" workflow later.
- [ ] Surface hot reload/test/analyze result alongside the diff.

**Validation**

- [x] Unit tests for git status parsing.
- [ ] Widget tests for dirty worktree warning and post-forge diff summary.
- Manual dogfood with a real git repo containing staged, unstaged, and untracked files.

### P6.T10 — Context preview, redaction, and prompt quality

**Status:** Partial / in progress
**Why:** Users should trust what Pickforge sends to agents, especially when project files and screenshots can be attached.

**Tasks**

- [x] Add a "Preview context" affordance before sending a forge prompt.
- [x] Show selected widget metadata, screenshots, attached files, skill text, and generated prompt.
- [x] Add redaction rules for common secrets: `.env`, tokens, private keys, API keys.
- [x] Block or warn on suspicious attachments.
- [x] Add size/token budget estimate.
- [ ] Let users edit the final instruction while preserving generated context.
- [ ] Add prompt templates per skill and agent profile.

**Validation**

- [x] Unit tests for secret-pattern redaction.
- [x] Unit tests for blocked file classes.
- [x] Snapshot tests for generated prompt preview.
- Manual review with fixtures containing fake secrets.

### P6.T11 — In-app diagnostics and local support bundle

**Status:** Partial / in progress
**Why:** Before telemetry exists, users still need a way to understand and report failures.

**Tasks**

- [x] Add local structured app log with bounded retention.
- [ ] Add diagnostics view: app version, OS, Flutter version, agent binary availability, adb status, emulator status, last VM error.
- [x] Add diagnostics card for OS, agent binary availability, `adb`, `git`, Android emulator, and Flutter/FVM availability.
- [x] Add "Export support bundle" that excludes source files, prompts, screenshots, and secrets by default.
- [ ] Add copyable error details for connection/run/agent failures.
- [ ] Include CI/build metadata in diagnostics when available.

**Validation**

- [x] Unit tests for redacted bundle generation.
- [x] Widget tests for diagnostics happy/error states.

## 12. Pro/cloud/distribution

### P7.T1 — Update check via Dio

**Status:** Deferred
**Tasks**

- [ ] Decide update metadata endpoint.
- [ ] Add opt-out behavior.
- [ ] Avoid blocking app startup.

### P7.T2 — Telemetry and crash reports

**Status:** Deferred
**Tasks**

- [ ] Add opt-in setting.
- [ ] Define event schema with no source-code or prompt leakage.
- [ ] Integrate Sentry or equivalent only after privacy review.

### P7.T3 — Auto-updater

**Status:** Deferred
**Tasks**

- [ ] macOS Sparkle.
- [ ] Windows winget/scoop or updater strategy.
- [ ] Linux `.deb`, AppImage, Flathub/Snap strategy.

### P7.T4 — Codesigning, notarization, distribution

**Status:** Deferred
**Tasks**

- [ ] macOS signing and notarization.
- [ ] Windows signing and SmartScreen reputation.
- [ ] Linux packaging/signing.

### P7.T5 — Pickforge Pro backend

**Status:** Deferred
**Committed backend direction:** Supabase

**Potential features**

- [ ] Google/GitHub auth.
- [ ] Cloud-synced context.
- [ ] Team sync.
- [ ] Premium skill packs.
- [ ] Multi-agent swarm orchestration.
- [ ] Stripe billing.

## 13. Architecture refactors

### P8.T1 — Multi-package architecture

**Status:** Deferred
**Why:** Single-package feature-first is correct for MVP.

**Tasks**

- [ ] Reassess after MVP dogfood.
- [ ] Split only if package boundaries reduce complexity.
- [ ] Avoid premature VGV-style multi-package migration.

### P8.T2 — External terminal restoration, only if demanded

**Status:** Deferred / probably unnecessary
**Why:** Embedded PTY is the chosen direction.

**Tasks**

- [ ] Restore from git history only if users need external terminal workflows.
- [ ] Keep embedded PTY default.

## 14. QA, CI, and release

### P9.T1 — Emulator E2E in CI or scheduled/manual workflow

**Status:** Partial
**Why:** E2E test exists but skips unless `PICKFORGE_E2E_AVD` is set.

**Tasks**

- [ ] Decide whether GitHub-hosted runners can reliably run emulator E2E.
- [ ] If not, create documented manual/scheduled runner flow.
- [ ] Capture logs and screenshots as artifacts.

### P9.T2 — CI hardening

**Status:** Partial
**Tasks**

- [ ] Keep format/analyze/test/codegen drift checks green.
- [ ] Add platform-specific smoke checks where cheap.
- [ ] Address GitHub Actions Node 20 deprecation before it becomes blocking.

### P9.T3 — Release checklist execution

**Status:** Not done
**Tasks**

- [ ] Update checklist to current app.
- [ ] Run it on Linux.
- [ ] Run it on macOS before public release.
- [ ] Record results and blockers.

### P9.T4 — Local app testing strategy

**Status:** Not started
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

- [ ] Do not assume the current app can run as Flutter web unchanged; it depends on desktop-only pieces (`dart:io`, PTY, window management, SQLite/native process execution).
- [ ] If web-based visual testing is desired, create a **web-demo harness** with fake services and no PTY/process calls.
- [ ] Use the web harness only for UI/layout review, not runtime correctness.

**Tasks**

- [ ] Add a Linux desktop smoke test target.
- [ ] Decide whether to use `integration_test` on Linux desktop, screenshot/golden tests, or an external virtual-display launcher.
- [ ] Add deterministic fake services for VM Service, emulator state, file explorer, and chats.
- [ ] Add CI artifacts for screenshots on failure.
- [ ] Keep real AVD tests opt-in unless CI reliability is proven.

### P9.T5 — Manual dogfood matrix

**Status:** Not started
**Tasks**

- [ ] Test with Claude Code installed.
- [ ] Test with Codex installed.
- [ ] Test with OpenCode installed.
- [ ] Test when each agent binary is missing.
- [ ] Test with `adb` available and unavailable.
- [ ] Test on a small sample app and a larger real app.
- [ ] Test with no emulator connection: chats and project browsing should still work.

### P9.T6 — Accessibility and keyboard-first audit

**Status:** Not started
**Why:** Dev tools live on keyboard speed. Accessibility also catches poor focus, contrast, and semantics early.

**Tasks**

- [ ] Define keyboard shortcuts for major actions: command palette, new chat, add project, focus explorer, focus terminal, forge, run/hot reload.
- [ ] Add visible focus states across panes.
- [ ] Verify tab order in sidebar, file explorer, inspector, settings, and dialogs.
- [ ] Support text scaling without overflow.
- [ ] Add high-contrast checks for dark theme.
- [ ] Add semantics labels for icon-only controls.

**Validation**

- Widget tests for shortcut dispatch where feasible.
- Golden/screenshot tests at larger text scale.
- Manual keyboard-only dogfood pass.

### P9.T7 — Performance and scalability budgets

**Status:** Not started
**Why:** The app must stay fast on real projects with thousands of files, many chats, and large transcripts.

**Budgets**

- App shell first usable frame: target under 1s after cold launch on a normal dev laptop.
- Left pane interactions: no perceptible jank with 100 projects/chats.
- File explorer: lazy load large folders; avoid full-tree blocking scans.
- Transcript replay: bounded memory and chunked rendering for large logs.
- Widget picker polling: pause when disconnected/collapsed where safe.

**Tasks**

- [ ] Add benchmark-style tests or instrumentation for large sidebar state.
- [ ] Add fixture project with many files for explorer tests.
- [ ] Add transcript replay stress test.
- [ ] Add performance counters in diagnostics.
- [ ] Define and enforce file scan excludes.

### P9.T8 — Storage migration and backward-compatibility suite

**Status:** Partial
**Why:** Drift migrations exist, but future confidence needs versioned fixtures and explicit compatibility testing.

**Tasks**

- [ ] Keep schema snapshots for each released DB version.
- [ ] Add migration tests from every release schema to latest.
- [ ] Add corrupted/partial settings recovery tests.
- [ ] Add backup-before-migration policy once real users exist.
- [ ] Document data retention and `.pickforge/` disk layout invariants.

### P9.T9 — Visual regression suite

**Status:** Not started
**Why:** The app's differentiator is UX polish; screenshots should prevent accidental regressions.

**Tasks**

- [ ] Add golden coverage for onboarding, sidebar list/grid, file explorer, terminal, inspector selected/empty states, settings, dialogs.
- [ ] Add deterministic fonts/theme setup for goldens.
- [ ] Add failure artifacts in CI.
- [ ] Decide tolerance policy across Linux/macOS.

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
