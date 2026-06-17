# Plan 001: Make PickForge a multi-framework local agent suite

> **Executor instructions**: This is the source-of-truth roadmap for the
> multi-framework PickForge direction. Execute it top-to-bottom unless a later
> human decision explicitly changes a checked decision. Keep the checkboxes in
> this file current as work lands. Do not rely on chat history; this document is
> intentionally self-contained.
>
> **Drift check (run first before implementing any section)**:
>
> ```bash
> git diff --stat 31d8fb1..HEAD -- README.md docs/architecture lib/core lib/features pubspec.yaml test
> ```
>
> If any in-scope file changed since this plan was written, compare the
> "Current repo state" section against the live code before proceeding. If the
> current code contradicts this plan, stop and update the plan before coding.

## Status

- **Priority**: P1
- **Effort**: XL, split into milestones below
- **Risk**: HIGH because this changes storage, app architecture, and product scope
- **Depends on**: none
- **Category**: direction, architecture, migration, dx
- **Planned at**: commit `31d8fb1`, 2026-06-15
- **Owner**: PickForge maintainers

## North star

PickForge should evolve from a Flutter-only widget-context desktop app into a
local-first app-development agent workbench:

> PickForge lets AI agents see, run, inspect, and edit apps across Flutter,
> React Native, native Android, native iOS, and web — locally, safely, with the
> deepest possible context each framework exposes.

This is not a promise that every stack has equal depth. The product should use
capability badges and framework adapters so each target can ship useful support
without blocking on perfect source mapping.

## Product decisions already accepted

- [x] PickForge should become a broader mobile/app agent suite, not remain
      Flutter-only.
- [x] Flutter remains the gold-standard reference adapter because Flutter VM
      Service and Widget Inspector expose unusually rich widget/source context.
- [x] Context storage should no longer be project-local-only.
- [x] Default runtime context storage should move to a user-level PickForge home.
- [x] Project-local `.pickforge/` and custom-folder storage must remain options.
- [x] Agents must receive explicit context paths and environment variables so
      context outside the repo remains discoverable.
- [x] Multi-framework support should be adapter-based and capability-based.

## Key open decisions

Resolve these before coding the relevant milestone.

- [x] **PickForge home path**: visible user-home folder is the default:
      `~/.pickforge` on macOS/Linux and `%USERPROFILE%\.pickforge` on Windows.
      Chosen because it is easiest for developers and agents to inspect.
      _(Decision confirmed 2026-06-15.)_
- [x] **Repo discovery policy**: no repo writes by default. Embedded terminals
      and bundled MCP configs discover context through `PICKFORGE_*` env vars.
      An explicit opt-in project-local pointer file may be offered later for
      external tools, but is not written by default. _(Confirmed 2026-06-15.)_
- [x] **First non-Flutter adapter**: React Native Android (Milestone 4).
      _(Confirmed 2026-06-15.)_
- [x] **Telemetry/product analytics**: keep local-first/no-network defaults. Any
      remote telemetry or account-backed sync stays out of scope unless
      explicitly approved. _(Confirmed 2026-06-15.)_

### Decision record (2026-06-15)

| Decision | Choice | Rationale |
| --- | --- | --- |
| PickForge Home default | `~/.pickforge` (Win: `%USERPROFILE%\.pickforge`) | Visible, inspectable by devs and agents. |
| Default repo writes | None; discover via `PICKFORGE_*` env vars | Keep user repos untouched; opt-in pointer only. |
| First non-Flutter adapter | React Native Android | Reuses ADB tooling; rich Metro/DevTools ecosystem. |
| Telemetry | Local-first, no network | Matches product positioning. |

## Research summary

### What the research confirms

- Flutter can remain deep and surgical because official Flutter tooling exposes
  widget tree inspection, selected widgets, service extensions, VM Service, hot
  reload/attach, and screenshots.
- React Native is a strong second adapter because Metro, React Native DevTools,
  React DevTools, Fast Refresh, CDP-compatible debugger discovery endpoints, and
  Android/iOS dev workflows are first-class parts of the ecosystem.
- Native Android can provide useful context through ADB, screenshots, Logcat,
  UIAutomator/accessibility hierarchy, Gradle, and app/resource metadata, but
  exact source mapping is harder than Flutter.
- Native iOS can provide run/simulator/screenshot/log support through Xcode CLI
  and `simctl`, but exact UIKit/SwiftUI element-to-source mapping is harder and
  likely requires accessibility identifiers, conventions, or instrumentation.
- Web/React can be strong through Playwright and Chrome DevTools Protocol: DOM,
  accessibility tree, screenshots, console/network events, Runtime evaluation,
  source maps, and optional React DevTools integration.

### Research sources

Use these when implementing adapter-specific milestones.

| Area | Source | Relevance |
| --- | --- | --- |
| Flutter Inspector | <https://docs.flutter.dev/tools/devtools/inspector> | Official description of Flutter Inspector for visualizing and exploring widget trees. |
| Flutter WidgetInspectorService | <https://api.flutter.dev/flutter/widgets/WidgetInspectorService-mixin.html> | Official API exposing `getSelectedWidget`, `getRootWidgetSummaryTree`, `getSelectedSummaryWidget`, `screenshot`, and project root helpers. |
| Flutter VM Service | <https://api.flutter.dev/flutter/vm_service/VmService-class.html> | Official Dart VM Service client API used by PickForge through `vm_service`. |
| Flutter CLI | Context7 `/flutter/website` | Confirmed `flutter attach`, `flutter screenshot`, DevTools/Inspector, and hot reload workflows. |
| React Native DevTools | <https://reactnative.dev/docs/react-native-devtools> | Official modern debugger: Console, Sources, Network, Performance, Memory, React Components, Profiler. |
| React Native Metro | <https://reactnative.dev/docs/metro> | Official Metro role and config docs. |
| React Native debugging | <https://reactnative.dev/docs/debugging> | Dev Menu, LogBox, React Native DevTools, simulator shortcuts, release-build limitation. |
| React Native dev middleware | Context7 `/facebook/react-native` | Confirmed `@react-native-community/cli start`, `createDevMiddleware`, `/json/list`, `/json/version`, `/open-debugger`, and CDP target URLs. |
| Android ADB | <https://developer.android.com/studio/command-line/adb> | Official ADB docs: device communication, install/debug/shell, `screencap`, `exec-out screencap -p`. |
| Android Logcat | <https://developer.android.com/studio/debug/logcat> | Official device log/debugging workflow. |
| Android UIAutomator | <https://developer.android.com/reference/kotlin/androidx/test/uiautomator/UiDevice> | Official `UiDevice` APIs including `dumpWindowHierarchy(File)` and coordinate actions. |
| Android Compose tooling | <https://developer.android.com/develop/ui/compose/tooling/debug> | Layout Inspector can inspect Compose layouts in Android Studio; treat as useful evidence but not as a stable standalone PickForge API. |
| Xcode CLI | <https://developer.apple.com/library/archive/technotes/tn2339/_index.html> | Official `xcodebuild` command-line build/test guidance. |
| `xcrun` / `simctl` | `xcrun` man pages and `simctl` command docs | Supports simulator list/boot/install/launch/screenshot/log workflows; verify on macOS during implementation. |
| Chrome DevTools Protocol | <https://chromedevtools.github.io/devtools-protocol/> | Official CDP domains for DOM, Accessibility, Runtime, Page screenshots, Network, Debugger, etc. |
| Playwright | Context7 `/microsoft/playwright.dev` and <https://playwright.dev/docs/api/class-page> | Confirms locators/accessibility (`getByRole`), screenshots, console/page error/request events, and Chromium CDP sessions. |

## Current repo state

These facts were verified at commit `31d8fb1`.

- `README.md` describes PickForge as "Widget-level AI context for Flutter" and
  says runtime context is written to `<projectRoot>/.pickforge/`.
- `README.md` lists Android emulator as the current MVP target and says iOS
  Simulator, Flutter web, and Flutter desktop are planned.
- `docs/architecture/storage.md` defines two storage boundaries today:
  Drift app database plus active project `<projectRoot>/.pickforge/`.
- `docs/architecture/storage.md` requires PickForge to refuse an existing
  `.pickforge/` directory unless it contains PickForge's exact `.gitignore`
  marker (`*\n`). Preserve this safety behavior for project-local mode.
- `lib/core/projects/pickforge_project_directory.dart` currently always resolves
  runtime context to `p.join(projectRoot, '.pickforge')`.
- `lib/core/agent/pickforge_context_writer.dart` writes:
  - `skill-active.md`
  - `widget-context.md`
  - `initial-prompt.md`
  - `screenshot.png`
  - `device-screen.png`
- `lib/core/mcp/pickforge_mcp_server.dart` currently discovers IPC by reading
  `<projectRoot>/.pickforge/ipc.sock-path`.
- `lib/core/agent/agent_launcher.dart` currently renders prompt variables with
  `pickforgeDirRelative: '.pickforge'` and mentions `.pickforge/ipc.sock-path`
  in the visual self-check prompt.
- `lib/core/vm_service/inspector_extensions.dart` is Flutter-specific and calls
  `ext.flutter.inspector.show`, `ext.flutter.inspector.trackRebuildDirtyWidgets`,
  `ext.flutter.inspector.getSelectedWidget`,
  `ext.flutter.inspector.getRootWidgetSummaryTree`, and
  `ext.flutter.inspector.screenshot`.
- `lib/core/inspector/inspector_repository.dart` is Flutter-specific and turns
  Inspector extension data into `SelectedWidget` plus ancestor classes, source
  snippets, and widget screenshots.
- `lib/core/inspector/adb_screenshot_capturer.dart` already supports Android
  ADB screenshots, iOS Simulator screenshots through `xcrun simctl`, and
  Flutter desktop screenshots.
- `lib/core/terminal/pty_environment.dart` normalizes terminal env vars and is
  a good seam for adding `PICKFORGE_*` variables.
- Project conventions:
  - Single Flutter package.
  - Feature-first UI under `lib/features/<feature>/`.
  - Infrastructure under `lib/core/`.
  - `flutter_bloc`/Cubit for feature state.
  - `get_it` + `injectable` for DI.
  - Drift for persistence.
  - Freezed/JSON generated files are tracked.
  - Use FVM for all Flutter/Dart commands.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Format | `fvm dart format --set-exit-if-changed .` | exit 0; no formatting drift |
| Analyze | `fvm flutter analyze` | exit 0; no analyzer errors |
| Test | `fvm flutter test` | exit 0; all tests pass |
| Codegen | `fvm dart run build_runner build --delete-conflicting-outputs` | exit 0; generated files updated when models/DI/Drift change |
| L10n | `fvm flutter gen-l10n` | exit 0 when localization changes |
| Golden update | `fvm flutter test test/goldens/ --update-goldens` | exit 0; manually review PNG diffs |
| Diff hygiene | `git diff --check` | exit 0; no whitespace errors |

## Naming model

Use this vocabulary in code and UI unless a later plan changes it.

- **Project**: a user-selected repository/workspace root.
- **Target**: a runnable app target inside a project, such as Flutter Android,
  React Native Android, native iOS, or web.
- **Adapter**: implementation that detects, runs, inspects, and builds context
  for one target family.
- **Capability**: one supported operation, such as launch, screenshot, logs,
  inspect selection, source mapping, hot reload, or MCP tools.
- **Selection**: the current UI element/widget/component/node the user picked.
- **Context artifact**: a file, screenshot, log slice, source snippet, or JSON
  payload written for agents.
- **PickForge Home**: user-level runtime storage root, defaulting to the chosen
  home path from the open decision above.
- **Context Directory**: the concrete directory for the active project/target/run.

## Target architecture

```text
PickForge app
  ├─ Projects / chats / embedded terminal / MCP / settings
  ├─ Context storage service
  │    ├─ PickForge Home storage, default
  │    ├─ Project-local .pickforge storage, compatibility option
  │    └─ Custom-folder storage
  ├─ Target adapter registry
  │    ├─ GenericProjectAdapter
  │    ├─ FlutterTargetAdapter
  │    ├─ ReactNativeTargetAdapter
  │    ├─ AndroidNativeTargetAdapter
  │    ├─ IosNativeTargetAdapter
  │    └─ WebTargetAdapter
  └─ Agent workflows
       ├─ prepare context
       ├─ send prompt to chat
       ├─ expose MCP tools
       └─ verify with reload/screenshot/logs when available
```

Adapters should be capability-based. A target can be useful even if it only
supports terminal + logs + screenshot + manual attachments.

Example capability set:

```dart
enum TargetCapability {
  detect,
  launch,
  stop,
  hotReload,
  hotRestart,
  captureScreenshot,
  streamLogs,
  inspectSelection,
  mapSelectionToSource,
  exposeMcpTools,
}
```

## Storage design checklist

### Milestone 1: Configurable context storage

Goal: PickForge no longer assumes project-local `.pickforge/` for runtime state,
but project-local mode still works exactly as before.

- [x] Add a storage decision record to this plan: visible `~/.pickforge` vs
      OS-native app support directory. _(Slice 1A: chose `~/.pickforge`.)_
- [x] Define a `ContextStorageLocation` model with at least: _(Slice 1A)_
  - [x] `pickforgeHome`
  - [x] `projectLocal`
  - [x] `customPath`
- [x] Define a `ResolvedContextDirectory` model with: _(Slice 1A; also exposes
      `runsDir`, `chatsDir`, `ipcSockPath`)_
  - [x] `projectRoot`
  - [x] `projectId`
  - [x] `storageLocation`
  - [x] `contextDir`
  - [x] `isProjectLocal`
- [x] Add a stable project id strategy. _(Slice 1A: dependency-free FNV-1a 64-bit
      hash of canonical root + optional repo remote, prefixed with a folder slug.)_
  - Recommended: hash canonical project root + optional repo remote URL when
    available.
  - STOP if the strategy can collide across projects in normal use.
- [x] New default layout: _(Slices 1A–1D: home/custom resolve to
      `<home>/projects/<id>/{context,runs,chats,pastes,skills,prompt-templates}`;
      every writer rewired to it; project-local stays flat under `.pickforge/`.)_

  ```text
  <PickForgeHome>/
    projects/
      <projectId>/
        context/
          skill-active.md
          widget-context.md
          initial-prompt.md
          screenshot.png
          device-screen.png
          device-screen-after-hot-reload.png
          ipc.sock-path
        chats/
          <chatId>/
            transcript.log
            transcript.spans.bin
            meta.json
        runs/
          <sessionId>/
            log.jsonl
            session.json
        skills/
        prompt-templates/
  ```

- [x] Preserve current project-local layout when the user selects
      `<projectRoot>/.pickforge/`. _(Slice 1B: parity tests assert byte-identical
      legacy paths for every rewired writer; full suite green at 809 passing.)_
      _Resolved (1C): `skill_store.dart` now resolves `skillsDir` /
      `promptTemplatesDir` via `ContextStorageService`, and
      `context_attachment_policy.dart` is home-mode aware._
- [x] Preserve conflict protection for project-local `.pickforge/`: _(Slice 1A:
      `ContextStorageService` delegates project-local to
      `PickforgeProjectDirectory`; home/custom create without a marker. Tested.)_
  - [x] Existing `.pickforge/` with exact `.gitignore` marker is accepted.
  - [x] Existing `.pickforge/` without marker is refused.
  - [x] Global/custom storage must not use the project-local marker rule unless
        it actually writes inside the repo.
- [x] Move `PickforgeProjectDirectory.ensure` responsibilities behind a new
      storage service instead of calling it directly from context writers.
      _(Slice 1B: all callers route through `ContextStorageService`.)_
- [x] Update `PickforgeContextWriter` to write to the resolved context dir. _(1B)_
- [x] Update screenshot paths to use the resolved context dir. _(1B: inspector
      widget shot + adb device shot, with `isProjectLocal` marker threading.)_
- [x] Update transcript paths to use the resolved context dir. _(1B: recorder,
      replayer, chats deletion, workspace transcript search.)_
- [x] Update run-log paths to use the resolved context dir. _(1B: run-session
      event-log writer + recovery store; also IPC sock-path, pasted images.)_
- [x] Add terminal environment variables for every embedded chat: _(Slice 1C:
      `pickforgeEnvVars` helper injected at the PTY create site; IPC endpoint set
      only when a socket is active.)_

  ```bash
  PICKFORGE_HOME=<absolute user-level home>
  PICKFORGE_PROJECT_ROOT=<absolute project root>
  PICKFORGE_CONTEXT_DIR=<absolute context dir>
  PICKFORGE_STORAGE_MODE=home|project-local|custom
  PICKFORGE_IPC_ENDPOINT=<socket or named pipe path when active>
  ```

- [x] Update prompt templates so agents receive absolute context paths, not only
      `.pickforge` relative paths. _(Slice 1C: `AgentLauncher` passes absolute
      `resolved.contextDir`; visual self-check uses absolute `ipcSockPath`.)_
- [x] Update MCP discovery: _(Slice 1C; injectable env for testability, tested
      per tier)_
  - [x] Prefer `PICKFORGE_IPC_ENDPOINT` if set.
  - [x] Then prefer `PICKFORGE_CONTEXT_DIR/ipc.sock-path` if set.
  - [x] Then fall back to `<projectRoot>/.pickforge/ipc.sock-path` for
        compatibility.
- [x] Add settings UI: _(Slice 1D: `context_storage_settings.dart` — a
      `SegmentedButton` storage-mode picker in Settings, validated via `ensure`
      before persisting to the new Drift columns. Golden-reviewed.)_
  - [x] default PickForge Home
  - [x] project-local `.pickforge/`
  - [x] custom folder chooser _(via `file_selector.getDirectoryPath`)_
  - [x] warning when project-local writes into the repo _(plus a custom-path
        inside-repo warning)_
- [x] Add migration behavior: _(Slice 1D)_
  - [x] Existing projects default to their current project-local storage until
        the user opts into migration, or migrate automatically only after a
        clear confirmation. _(Auto-detect keeps existing `.pickforge/` projects
        project-local; switching modes offers a copy-confirm dialog —
        `ContextStorageMigrator`, never deletes/clobbers.)_
  - [x] New projects use PickForge Home by default.
- [x] Update docs: _(Slice 1D)_
  - [x] `README.md`
  - [x] `docs/architecture/storage.md`
  - [x] `docs/architecture/pickforge-mcp.md`
  - [x] any user-facing onboarding copy _(also `docs/architecture/embedded-terminal.md`)_

Verification:

- [x] Unit tests cover resolving all storage locations. _(1A)_
- [x] Unit tests cover project-local conflict behavior. _(1A)_
- [x] Unit tests cover env var injection. _(1C: `pickforge_env_vars` + PTY env)_
- [x] Unit tests cover MCP endpoint discovery precedence. _(1C)_
- [x] `fvm dart format --set-exit-if-changed .` passes.
- [x] `fvm flutter analyze` passes. _(No issues found.)_
- [x] `fvm flutter test` passes. _(858 passing, 3 skipped.)_

STOP conditions:

- Storage migration risks deleting or overwriting existing user files.
- Context outside the repo cannot be discovered by the embedded terminal.
- MCP compatibility would break existing project-local users without fallback.

## Adapter architecture checklist

### Milestone 2: Adapter registry and generic project mode

Goal: PickForge can host targets through adapters while preserving current
Flutter behavior.

- [x] Create core adapter types under `lib/core/targets/`: _(2A — minimal set
      created. The three operation interfaces below were intentionally NOT built:
      M3–M8 each shipped a concrete per-adapter implementation, which proved the
      real cross-target shape; a speculative shared interface from one implementer
      was the documented risk.)_
  - [x] `TargetAdapter` _(2A)_
  - [x] `TargetDetector` _(2A, in `target_detection.dart`)_
  - [x] `TargetSession` _(2A)_
  - [x] `TargetCapabilities` _(2A; + `TargetCapability` enum)_
  - [x] `TargetSelection` _(2A)_
  - [ ] `TargetContextBuilder` — **NEVER (superseded)**: concrete
        `FlutterSelectionMapper` / `ReactNativeSelectionContextBuilder` /
        `Web`+`IosSourceCandidateFinder` cover this per adapter; no shared
        abstraction is built.
  - [ ] `TargetLogStream` — **NEVER (superseded)**: `RunSessionEvent.log` is the
        shared log stream; adapters emit into it directly.
  - [ ] `TargetScreenshotCapturer` — **NEVER (superseded)**: per-adapter capture
        (`AdbScreenshotCapturer`, `AndroidAdbService.captureScreenshot`).
- [x] Add `TargetAdapterRegistry` registered through `get_it`/`injectable`. _(2A:
      `@lazySingleton` via `TargetsModule`; priority sort + detectFor.)_
- [x] Add a `GenericProjectAdapter` that supports: _(2B: registered as the
      lowest-priority fallback.)_
  - [x] project detection fallback
  - [ ] embedded terminal — **NEVER (by design)**: a process/app-global service,
        not adapter-owned; the generic adapter declares only `detect`.
  - [ ] manual context attachments — **NEVER (by design)**: app-global service.
  - [ ] file tree/search — **NEVER (by design)**: app-global service.
  - [ ] prompt templates — **NEVER (by design)**: app-global service.
  - [x] no automatic UI inspection _(declares only the `detect` capability)_
- [x] Add capability badges in UI: _(`09db514` `TargetCapabilityBadges` on the
      `TargetSummaryPanel` — one pill per operation, lit when the adapter declares
      the capability and muted otherwise; golden-reviewed in `target_panels.png`,
      where Flutter lights all seven and React Native mutes source-map / hot-reload
      / MCP.)_
  - [x] Run _(`launch`)_
  - [x] Logs _(`streamLogs`)_
  - [x] Screenshot _(`captureScreenshot`)_
  - [x] Inspect _(`inspectSelection`)_
  - [x] Source map _(`mapSelectionToSource`)_
  - [x] Hot reload _(`hotReload`)_
  - [x] MCP _(`exposeMcpTools`)_
- [x] Refactor Flutter-specific names carefully: _(2A/2B: added generic
      `Target`/`Selection` core types; no existing Flutter code renamed.)_
  - [x] Keep user-facing "Widget" wording where Flutter-specific.
  - [x] Use generic "Selection"/"Target" in core APIs.
  - [x] Do not do broad renames in one giant diff.
- [x] Keep process execution, VM-service access, and filesystem writes in
      `lib/core/`, not widgets. _(adapter types live in `lib/core/targets/`)_
- [x] Add tests for adapter detection order and capability reporting. _(2A/2B)_

Verification:

- [x] Existing Flutter widget picking still works. _(full suite green; 2A/2B are
      additive with no behavior change)_
- [ ] A non-Flutter folder can be added and opened in Generic Project mode.
      — **BLOCKED (live app)**: the registry detects generic at the unit level;
      the adapter-mediated open UX needs the running workbench to verify.
- [ ] Generic Project mode can start an embedded chat and send a prompt with
      attachments. — **BLOCKED (live app)**: the app already does this for any
      folder; routing it through the adapter needs live workbench wiring.
- [x] `fvm flutter test` passes. _(883 passing)_

STOP conditions:

- Adapter abstraction requires rewriting unrelated UI or persistence in the same
  milestone.
- Flutter behavior changes before a parity test exists.

## Flutter reference adapter checklist

### Milestone 3: Move current Flutter support behind `FlutterTargetAdapter`

Goal: Flutter remains the reference implementation and still supports the
existing pick-forge-edit-reload loop.

_Delivered vs deferred: 3A (`0e811be`) added detection + capabilities; 3B added the
selection mapper; 3C added the generic MCP names; 3D documented deep support. The
existing Flutter inspector/run/screenshot flow is UNCHANGED (additive), so its output
fields are preserved. A stateful adapter-owned `TargetSession` that takes ownership of
those live services is deliberately deferred until M4 (React Native) proves the shared
operation surface — those boxes stay unchecked-with-reason rather than ticked on a
speculative refactor that would risk the STOP conditions._

- [ ] Create `FlutterTargetAdapter` owning the live services — **NEVER (by
      design)**. M4–M8 all shipped without any adapter-owned session, confirming
      the chosen architecture: the adapter is a `const` value
      (identity/capabilities/detection) and the live services below stay owned by
      the existing, unchanged IPC providers. Folding them into an adapter-held
      session would risk the milestone STOP conditions for no gain.
  - [ ] `InspectorExtensions` — **NEVER**: stays behind the IPC providers.
  - [ ] `InspectorRepository` — **NEVER**: stays behind the IPC providers.
  - [ ] `SelectionStream` — **NEVER**: stays behind the IPC providers.
  - [ ] `AdbScreenshotCapturer` — **NEVER**: stays a standalone service.
  - [ ] run-session/emulator services — **NEVER**: stay standalone services.
- [x] Keep VM Service inspector as source of truth for widget identity. _(Unchanged;
      `FlutterSelectionMapper` reads the VM-Service-derived `SelectedWidget`.)_
- [x] Keep selected widget output fields: _(preserved — the mapper retains the full
      `SelectedWidget` alongside the generic projection; the existing flow is
      untouched.)_
  - [x] class/description
  - [x] ancestor chain
  - [x] creation location
  - [x] source snippet
  - [x] properties JSON
  - [x] widget screenshot
  - [x] device screenshot when available _(retained as `adbScreenshotPath` in the
        Flutter detail; the single generic `screenshotPath` slot maps the widget
        screenshot.)_
- [x] Make Flutter context builder produce a generic `TargetSelection` plus
      Flutter-specific details. _(3B `FlutterSelectionMapper` →
      `FlutterSelectionContext`.)_
- [x] Ensure hot reload still goes through active Flutter run session. _(Unchanged;
      `hot_reload` IPC still delegates to the bound `RunSession`.)_
- [x] Ensure `get_selected_widget` MCP remains as compatibility alias.
- [x] Add new generic MCP method names while preserving existing names: _(3C)_
  - [x] `get_current_selection`
  - [x] `capture_target_screenshot`
  - [x] `hot_reload`
  - [x] `get_run_logs`
  - [x] `get_project_context`
- [x] Update docs to identify Flutter as "deep support". _(3D `pickforge-mcp.md`.)_

Verification:

- [x] Flutter selection captures source snippet and ancestor chain. _(Mapper test +
      unchanged inspector flow.)_
- [x] Widget screenshot still writes to resolved context dir. _(Unchanged
      `AdbScreenshotCapturer` path.)_
- [x] Device screenshot still writes to resolved context dir. _(Unchanged.)_
- [x] MCP old and new tool names work. _(IPC + MCP parity tests.)_
- [x] `fvm flutter test` passes. _(890 pass / 3 Windows-IPC skip.)_

STOP conditions:

- Widget selection data becomes less precise than current `SelectedWidget`.
- Existing `.pickforge` project-local users lose compatibility.

## React Native checklist

### Milestone 4: React Native Android MVP

Goal: Ship the first non-Flutter vertical slice with useful context, even before
perfect component-to-source mapping.

Recommended initial scope: Android emulator/device first. iOS comes later.

- [x] Detect React Native projects: _(4A `ReactNativeProjectDetector` +
      `ReactNativeTargetAdapter`, priority 80, `a6e3648`.)_
  - [x] `package.json` dependency/devDependency contains `react-native`
  - [x] `android/` directory exists for Android support _(adapter claims a
        project only when `android/` is present)_
  - [ ] optional `ios/` directory for future iOS support — **BLOCKED
        (M7-dependent)**: RN-on-iOS detection needs the `xcrun`/`simctl` iOS
        primitives from M7; the Android adapter deliberately doesn't gate on it.
- [x] Detect package manager from lockfiles: _(4A, precedence
      pnpm>yarn>npm>bun, default npm)_
  - [x] `pnpm-lock.yaml`
  - [x] `yarn.lock`
  - [x] `package-lock.json`
  - [x] `bun.lockb` / `bun.lock`
- [x] Start Metro through the project package manager. _(4B `b45a233` —
      `ReactNativeCommandBuilder.metroStart` + `ReactNativeMetroSession`.)_
  - Context7 confirmed `npx @react-native-community/cli start` and options
    such as `--port`, `--host`, `--projectRoot`, and `--reset-cache`. _(Metro
    uses this canonical, PM-agnostic launcher; the package manager governs the
    app-run script below.)_
- [x] Capture Metro logs as a PickForge run log stream. _(4B
      `ReactNativeLogParser` → `RunSessionEvent.log(source: 'metro')`.)_
- [x] List Android devices through ADB. _(4C `7572840`
      `ReactNativeAdbService.listDevices`, ignores adb daemon noise.)_
- [x] Launch Android app using the project's own script when available: _(4C
      `ReactNativeAppLauncher`)_
  - [x] prefer `npm/yarn/pnpm/bun run android` if present _(4B `androidRun` →
        `<pm> run android`; used when no device serial is selected)_
  - [x] fallback to React Native CLI only when safe _(4B `localCliRunAndroid`;
        also used when an explicit device serial needs reliable targeting)_
- [x] Capture device screenshots through `adb exec-out screencap -p`. _(4C
      `captureScreenshot`, binary-safe runner on the resolved shell PATH)_
- [x] Collect Android logs through `adb logcat`. _(4C `streamLogcat` +
      `ReactNativeLogParser.logcatEvent` → `RunSessionEvent.log(source:
      'logcat')`)_
- [x] Inspect visible UI through accessibility/UIAutomator hierarchy: _(4D
      `9718bfb`)_
  - [x] MVP can use device-side UIAutomator XML if available. _(`ReactNativeAdbService.dumpUiAutomatorXml` via `exec-out ... dump /dev/tty`, no on-device file; `ReactNativeUiInspector`)_
  - [x] Prefer a small, testable hierarchy parser in `lib/core/targets/react_native/` or shared Android support. _(`ReactNativeUiAutomatorParser` — parse/hitTest/ancestorHierarchy)_
  - [x] Include role/class, text/contentDescription, resource-id, bounds, enabled/clickable/selected flags. _(`ReactNativeA11yNode`)_
- [x] Build React Native selection context: _(4E `314c767`
      `ReactNativeSelectionContextBuilder` + `ReactNativeContextRenderer`)_
  - [x] screenshot path
  - [x] selected accessibility node
  - [x] ancestor hierarchy
  - [x] Metro/logcat excerpts _(tailed to the last 20 lines each)_
  - [x] likely source files from text/resource-id/testID search _(word-boundary
        search, ranked high>medium>low, `node_modules` skipped)_
  - [x] clear disclaimer when exact source mapping is not available _(always
        rendered; `TargetSelection.sourcePath` stays null)_
- [x] Add optional DevTools/CDP discovery spike: _(delivered in M5 5A `2c3041d`
      `MetroCdpDiscovery`; the MVP itself did not block on it.)_
  - [x] query Metro `/json/list` _(5A — `/json/list`→`/json` fallback)_
  - [x] record available `webSocketDebuggerUrl` _(5A — surfaces the RN/Hermes
        debugger target)_
  - [x] do not block MVP on React component source mapping _(honored — likely
        candidates + disclaimer instead of exact mapping)_
- [ ] Add Fast Refresh/reload support only after run/log/screenshot/inspect MVP:
      — **BLOCKED (live device)**: the trigger can't be verified non-brittle
      without a running Metro + device, which the STOP condition guards.
  - [x] document whether it uses Metro, Dev Menu, ADB key events, or a debugger
        endpoint. _(Decision: trigger reload over the Metro/CDP debugger session
        (`Page.reload` on the discovered `webSocketDebuggerUrl` from 5A), with an
        `adb shell input` Dev-Menu fallback — no foreground-app assumptions.)_
  - [ ] STOP if implementation requires brittle foreground-app assumptions.
        — **acknowledged**: the documented mechanism avoids them; this guard
        stays in force for the live slice.
- [x] UI copy should label this as "React Native Android — useful support" not
      "deep source mapping". _(4E renderer header; adapter `displayName` "React
      Native (Android)". The full target-selector surfacing is M10.)_

Verification:

- [x] Fixture RN project detection test passes. _(4A
      `react_native_target_adapter_test.dart`)_
- [x] ADB parser tests pass using saved `uiautomator` XML fixture. _(4D
      `react_native_uiautomator_parser_test.dart`, inline fixtures)_
- [x] Screenshot capturer tests use fake process runner. _(4C
      `react_native_adb_service_test.dart`, injected binary runner)_
- [x] Log parser tests use saved Metro/logcat fixtures. _(4B/4C
      `react_native_log_parser_test.dart`)_
- [ ] Manual smoke: RN Android app launches, screenshot captures, context prompt
      includes selected accessibility node and likely files. — **BLOCKED (live
      device/emulator)**: not runnable in a fixture-only environment.

STOP conditions:

- React Native support requires invasive changes to user RN projects.
- Component-to-source mapping is assumed exact without evidence.
- Release builds are treated as debuggable; React Native docs say debugging
  features are disabled in release builds.

### Milestone 5: React Native deepening

Only start after Milestone 4 ships.

- [x] Integrate React Native DevTools/CDP target discovery more deeply. _(5A
      `2c3041d` — `MetroCdpDiscovery` queries `/json/list`→`/json`, parses CDP
      targets, surfaces the RN/Hermes `webSocketDebuggerUrl`;
      `ReactNativeMetroSession.discoverDebugTargets()`.)_
- [ ] Explore React Components tree access without depending on private unstable
      DevTools internals. — **NEVER (no stable API)**: no public RN API exposes the
      component tree without `react-devtools-core` internals, which the STOP
      condition forbids. The source-candidate finder is the supported substitute.
- [x] Add source-map-aware JavaScript stack/source context where available. _(The
      `.map` parse layer shipped: `54deaf2` `SourceMap` — a v3 Base64-VLQ resolver
      with `originalPositionFor`. Correlating it against a live Metro bundle URL
      via a CDP session is **BLOCKED (live CDP)**; the resolver is ready for that
      wiring.)_
- [ ] Add iOS Simulator support for RN using the iOS adapter primitives.
      — **BLOCKED (M7 + macOS)**: depends on the iOS `simctl` inspection
      primitives, whose accessibility layer is itself blocked on macOS + the
      product decision recorded in M7.
- [x] Add Expo-specific detection and launch paths if product demand warrants it.
      _(5B `1620a50` — Expo detected via the `expo` dep; `expo start` /
      `expo run:android` through the package manager.)_

## Native Android checklist

### Milestone 6: Native Android MVP

Goal: Support Android Studio-style projects with run/log/screenshot/hierarchy
context and best-effort source hints.

- [x] Detect Android projects: _(6-1 `84864e9` `NativeAndroidProjectDetector` +
      `NativeAndroidTargetAdapter`, id `native_android`, priority 60.)_
  - [x] `settings.gradle` or `settings.gradle.kts`
  - [x] root `build.gradle` or `build.gradle.kts`
  - [x] `app/build.gradle` or Android application plugin in modules _(structured
        application-plugin match, comment-stripped; library modules excluded)_
- [x] Detect Gradle wrapper and prefer `./gradlew` / `gradlew.bat`. _(6-1 detects
      the wrapper (`hasGradleWrapper`); per-platform preference lands with the
      Gradle command builder, slice 6-3.)_
- [x] List connected devices with ADB. _(6-2/6-4 shared `AndroidAdbService.listDevices`)_
- [x] Install/run debug app with Gradle and/or ADB. _(6-3 `b0374f0`
      `NativeAndroidCommandBuilder` + `NativeAndroidAppLauncher`: gradlew
      installDebug + ADB monkey LAUNCHER, install-only on ambiguous appId)_
- [x] Capture screenshots with ADB. _(6-2/6-4 shared `AndroidAdbService.captureScreenshot`)_
- [x] Stream logs with `adb logcat`. _(6-4 shared `streamLogcat` +
      `AndroidLogcatParser`)_
- [x] Parse UIAutomator/accessibility hierarchy. _(6-2 shared
      `AndroidUiAutomatorParser` + `AndroidUiInspector`)_
- [x] Source hint strategy: _(6-5 `a1904af` `NativeAndroidSourceCandidateFinder`)_
  - [x] resource id -> XML/layout/search results for Views _(word-boundary search
        covers `@+id/`, `R.id.`, `testTag("...")`)_
  - [x] text/contentDescription -> search project files
  - [x] Compose semantics/test tags -> search Kotlin sources
  - [x] include confidence levels in context _(high/medium/low + signal)_
- [x] Avoid claiming full Compose source mapping in MVP. _(adapter never declares
      `mapSelectionToSource`; renderer is "best-effort support" + disclaimer)_
  - Android Layout Inspector helps inside Android Studio, but this plan does not
    assume a stable standalone external API for PickForge.
- [ ] Add optional future spike for debug-only instrumentation that exposes
      Compose/View metadata to PickForge. — **NEVER (out of scope)**: would inject
      a debug agent into the user's app; the MVP relies on UIAutomator + source
      hints instead, keeping the no-source-modification rule.

Verification:

- [x] Android project detection fixture tests pass. _(6-1
      `native_android_target_adapter_test.dart`)_
- [x] Gradle command builder tests pass on Linux/macOS/Windows path variants. _(6-3
      `native_android_command_builder_test.dart`, injectable `isWindows`)_
- [x] UIAutomator hierarchy parser tests pass. _(shared
      `android_uiautomator_parser_test.dart` + RN parity tests)_
- [ ] Manual smoke on a native Android sample app: run, screenshot, logcat,
      select hierarchy node, context prompt generated. — **BLOCKED (live
      device)**: not runnable in a fixture-only environment.

STOP conditions:

- MVP requires modifying the user's Android source code.
- Exact Compose source mapping is required before basic support can ship.

## Native iOS checklist

### Milestone 7: Native iOS MVP

Goal: Support Xcode/iOS Simulator projects on macOS with run/log/screenshot and
best-effort accessibility/source hints.

- [x] Gate all iOS adapter runtime features behind `Platform.isMacOS`. _(7B —
      `IosTargetAdapter` declares launch/screenshot/log caps only on macOS;
      detection stays cross-platform)_
- [x] Detect iOS projects: _(7A `ff0b585` `IosProjectDetector` +
      `IosTargetAdapter`, id `native_ios`, priority 55)_
  - [x] `.xcworkspace`
  - [x] `.xcodeproj`
  - [x] `Package.swift` only if it has an app target strategy _(executable/app
        target, comment-stripped)_
- [x] Use `xcodebuild` for build/test/run-related workflows. _(7B `b0749d0`
      `IosCommandBuilder.build`/`listSchemes`, workspace preferred)_
- [x] Use `xcrun simctl` for simulator workflows: _(7B command builders + 7C
      `fed1496` `IosSimulatorListParser`)_
  - [x] list devices
  - [x] boot simulator
  - [x] install app
  - [x] launch app
  - [x] capture screenshot
  - [x] collect logs
- [x] Build context from: _(deliverable via the manual-selection MVP decided
      below — screenshot + logs + a source search; only the programmatic a11y
      element capture stays BLOCKED.)_
  - [x] simulator screenshot _(7B/7C `simctl` screenshot primitive)_
  - [x] app/simulator logs _(7B `simctl log` primitive)_
  - [ ] selected accessibility element when available — **BLOCKED (no API +
        macOS)**: no stable external hierarchy API; the MVP uses manual selection.
  - [ ] accessibility identifier/label/value/traits/frame — **BLOCKED (no API +
        macOS)**: programmatic element capture needs the blocked hierarchy; under
        the MVP the user supplies the identifier/label, which feeds the search.
  - [x] likely Swift/SwiftUI/UIKit files from identifier/text search _(`b43e207`
        `IosSourceCandidateFinder` — confidence-ranked
        `.swift`/`.m`/`.h`/`.xib`/`.storyboard` search; fixture-tested)_
- [x] Decide how to obtain accessibility hierarchy: **DECISION** — no programmatic
      option has a stable external API PickForge can depend on, so the MVP uses the
      **manual selection fallback**; the others stay future spikes gated on macOS.
  - [ ] XCTest/UI test runner — **BLOCKED (macOS + heavy)**: needs building and
        running a UI test target against the app; future spike only.
  - [ ] Apple accessibility tooling — **NEVER (no stable API)**: no supported
        external hierarchy-dump API.
  - [ ] optional debug helper app — **NEVER (invasive)**: would inject a helper
        into the user's app, against the no-source-modification rule.
  - [x] manual selection fallback if none is stable — **chosen MVP**: the user
        identifies the element; PickForge attaches screenshot + logs + the
        `IosSourceCandidateFinder` search over identifier/label/text.
- [x] Label source mapping as best-effort unless instrumentation exists. _(adapter
      never declares `mapSelectionToSource`)_

Verification:

- [x] iOS project detection tests pass on non-macOS without requiring Xcode. _(7A
      `ios_target_adapter_test.dart`, filesystem-only)_
- [x] Command builder tests cover workspace/project/scheme/destination. _(7B
      `ios_command_builder_test.dart`)_
- [ ] macOS manual smoke: simulator list, boot, screenshot, log collection.
      — **BLOCKED (macOS + Xcode)**: not runnable in a fixture-only Linux
      environment.

STOP conditions:

- Implementation assumes iOS support can run on Linux/Windows.
- Implementation requires private Apple APIs or brittle UI scripting without a
  reviewed product decision.

## Web / React checklist

### Milestone 8: Web adapter MVP

Goal: Support web apps with DOM/accessibility/source-map context through browser
automation.

- [x] Detect web projects: _(8A `15db72d` `WebProjectDetector` +
      `WebTargetAdapter`, id `web`, priority 50)_
  - [x] `package.json` with common scripts (`dev`, `start`)
  - [x] React/Vite/Next/Remix/etc. dependencies as hints, not hard requirement
        _(excludes react-native always; expo unless a real web bundler is
        present)_
- [x] Start the dev server through the detected package manager and script. _(8B
      `ff362d4` `WebCommandBuilder.devServer` = `<pm> run <dev|start>`)_
- [x] Launch/connect a browser through Playwright or CDP. _(8C `abe370f` —
      shared `CdpDiscovery` over the browser's built-in remote-debugging port; NO
      Playwright dep, per the STOP condition)_
- [ ] Capture screenshots. — **BLOCKED (live CDP)**: needs a CDP `Page` session
      against a running browser.
- [ ] Capture console messages, page errors, request failures, and responses.
      — **BLOCKED (live CDP)**: CDP Runtime/Network event subscriptions against a
      running page.
  - Context7 Playwright docs confirm `page.on('console')`, `page.on('pageerror')`,
    `page.on('requestfailed')`, and `page.on('response')`.
- [x] Inspect DOM/accessibility selection: _(parse layer shipped — `106d918`
      `WebAccessibilityParser` parses a CDP `getFullAXTree` payload into a queryable
      node tree; only the live-geometry items below stay browser-live.)_
  - [x] DOM node path _(AX `ancestorPath` + `backendDomNodeId` cross-ref; exact
        `DOM.getDocument` traversal is browser-live)_
  - [x] accessible role/name _(`WebAxNode.role`/`name`)_
  - [ ] bounding box — **BLOCKED (live CDP)**: needs `DOM.getBoxModel` against a
        running page.
  - [x] text/attributes _(`WebAxNode.name`/`value`)_
  - [ ] screenshot crop/highlight — **BLOCKED (live CDP)**: needs a live page
        screenshot + overlay.
- [x] Use Chromium CDP sessions where needed. _(8C `CdpDiscovery` connects via the
      `/json/list` debug endpoint and surfaces the page `webSocketDebuggerUrl`;
      per-domain CDP sessions over that socket are the browser-live next step)_
  - Context7 confirms `browserContext.newCDPSession(page)` for Chromium.
  - CDP docs confirm protocol domains for DOM, Runtime, Network, Page,
    Accessibility, and Debugger.
- [x] Source hint strategy: _(both fixture-testable layers shipped; only the
      dev-overlay capture stays browser-live.)_
  - [x] source maps when available _(`54deaf2` `SourceMap` v3 resolver —
        `originalPositionFor`)_
  - [ ] React component stack/dev overlays when available — **BLOCKED (live
        app)**: dev overlays only exist in a running dev build.
  - [x] text/attribute/class search fallback _(`54deaf2`
        `WebSourceCandidateFinder` — testid/id/class/name/text search)_
- [ ] Optional later: React DevTools integration. — **NEVER (unstable
      internal)**: the backend/frontend bridge protocol is internal and unstable;
      the source-candidate finder is the supported substitute.
  - React DevTools has a backend/frontend bridge, but treat direct integration as
    a spike because internal protocols can be unstable.

Verification:

- [x] Web project detection fixture tests pass. _(8A
      `web_target_adapter_test.dart`)_
- [x] Browser automation abstraction tests use fakes where possible. _(8C
      `cdp_discovery_test.dart` injects the HTTP fetcher; 8B command builder)_
- [ ] Manual smoke on a Vite/React sample: start, screenshot, select DOM node,
      collect console/network logs, generate prompt. — **BLOCKED (live browser)**:
      not runnable in a fixture-only environment.

STOP conditions:

- Web adapter requires adding browser automation dependencies without reviewing
  binary size and desktop packaging impact.
- Source maps are assumed present in all projects.

## Agent workflow checklist

### Milestone 9: Framework-aware agent workflows

Goal: Build higher-level workflows on top of adapters only after storage and
adapter foundations are stable.

- [x] Keep existing "Forge it" flow for Flutter. _(unchanged; the Flutter
      pick→forge→reload loop is untouched)_
- [x] Add generic workflow labels: _(9A `cbea612` `TargetWorkflow` enum +
      `TargetWorkflowPolicy.availableWorkflows` capability-gates them)_
  - [x] Explain selected UI
  - [x] Fix selected UI
  - [x] Improve selected UI
  - [x] Generate tests for selected UI
  - [x] Compare screenshot after reload _(gated on hotReload + screenshot)_
  - [x] Run logs triage _(gated on streamLogs)_
- [x] Prompt templates must branch on adapter capability: _(9A
      `TargetWorkflowPolicy.sourceContextTier` + `certaintyGuidance`; the live
      agent-launcher prompt wiring is the M10 UI/integration step)_
  - [x] deep source mapping available
  - [x] best-effort source hints only
  - [x] screenshot/logs only
- [x] MCP tools should expose generic target operations: _(M3 3C + 9B `cf75af2`)_
  - [x] `get_current_selection`
  - [x] `list_pick_history`
  - [x] `capture_screenshot`
  - [x] `hot_reload` when capability exists
  - [x] `get_run_logs`
  - [x] `get_project_context`
  - [x] `list_target_capabilities`
- [x] Preserve compatibility aliases for existing tools. _(get_selected_widget /
      list_pickforge_history / capture_screenshot all retained)_
- [x] Add clear prompt language so agents do not overstate certainty. _(9A
      `certaintyGuidance` per tier)_

Verification:

- [x] Prompt rendering tests cover Flutter deep context and non-Flutter
      best-effort context. _(9A `target_workflows_test.dart` asserts deep tier for
      Flutter, best-effort for native Android)_
- [x] MCP tool list tests cover capability-gated tools. _(9B MCP/IPC tests)_
- [ ] Manual smoke: unsupported Generic Project mode still produces useful
      agent prompt. — **BLOCKED (live app)**: needs the running workbench.

## UI / settings checklist

### Milestone 10: Productize the suite UI

Goal: Make the expanded product understandable without overwhelming the current
Flutter workflow.

- [x] Add target selector/capability summary to the workbench. _(`253b6b2`
      `TargetSummaryPanel` — active target + `TargetSupportBadge` (M2-deferred) +
      capability-gated workflow chips; binding it to the live active-target
      stream is the remaining app-wiring step)_
- [x] Add storage location selector in settings and onboarding. _(M1 1D
      `context_storage_settings.dart`, with a golden)_
- [x] Add adapter health/doctor panel: _(`253b6b2` `AdapterDoctorPanel` widget +
      `96d8942` `AdapterDoctor` service runs the real binary checks via
      `BinaryDetector`; rendered as OK/Missing/Unknown status pills)_
  - [x] Flutter VM Service connection _(toolchain: Flutter SDK check; live
        VM-Service connection state comes from the run session)_
  - [x] ADB availability
  - [x] Xcode availability on macOS _(checked on macOS; Unknown elsewhere)_
  - [x] Node/package manager availability
  - [x] browser automation availability _(a Chromium binary for CDP)_
- [x] Add clear labels: _(`TargetSupportLevel` + `TargetSupportBadge`)_
  - [x] Deep support
  - [x] Useful support
  - [x] Experimental
  - [x] Manual-only
- [x] Follow the design system: _(panels reuse `HairlinePanel`/`MonoEyebrow`/
      `StatusPill`)_
  - [x] Use tokens only.
  - [x] One ember per composition.
  - [x] Use existing shared components first.
  - [x] Honor reduced motion. _(via `StatusPill`/`EmberDot`)_
- [x] Run and review goldens after UI changes. _(`test/goldens/baselines/
      target_panels.png` generated and visually reviewed)_

Verification:

- [x] `fvm flutter test test/goldens/ --update-goldens` runs after visual work.
- [x] PNG diffs under `test/goldens/baselines/` are manually reviewed. _(the
      `target_panels.png` baseline was reviewed: capability-gating is visible —
      Flutter shows all 6 workflows + deep badge, RN omits compare-after-reload)_
- [x] Standard validation passes. _(analyze 0, `fvm flutter test` 1090 green)_

## Documentation checklist

- [ ] Rewrite README positioning: — **BLOCKED (overstating risk until live)**:
      the user-facing README was just standardized; broadening it to claim React
      Native / Android / iOS / Web support before the live manual smokes pass
      would overstate support depth, which the global STOP conditions forbid. The
      tiers are documented internally in `docs/architecture/target-adapters.md`
      meanwhile; the README rewrite lands with live adapter verification.
  - [ ] PickForge as local-first agent workbench. — **BLOCKED**: see above.
  - [ ] Flutter deep support. — **BLOCKED**: lands with the README rewrite.
  - [ ] Generic project mode. — **BLOCKED**: lands with the README rewrite.
  - [ ] Roadmap support tiers for React Native, Android, iOS, Web. — **BLOCKED**:
        documented in `target-adapters.md`; user-facing copy waits for live.
- [x] Update `docs/architecture/storage.md` for user-level PickForge Home. _(Slice 1D)_
- [x] Update `docs/architecture/pickforge-mcp.md` for env-based discovery. _(Slices 1C/1D)_
- [x] Add `docs/architecture/target-adapters.md`. _(`c6b5eba` — vocabulary,
      capability model, support tiers, per-adapter status table, shared layers.)_
- [ ] Add `docs/architecture/context-storage.md` if storage docs become too large.
      — **NEVER (condition unmet)**: `storage.md` remains small enough; no split
      is warranted.
- [x] Add adapter-specific docs as they ship: _(consolidated into the single
      `target-adapters.md` rather than five stubs — the chosen doc structure.)_
  - [ ] `docs/architecture/flutter-adapter.md` — **NEVER (consolidated)** into
        `target-adapters.md`.
  - [ ] `docs/architecture/react-native-adapter.md` — **NEVER (consolidated)**.
  - [ ] `docs/architecture/android-adapter.md` — **NEVER (consolidated)**.
  - [ ] `docs/architecture/ios-adapter.md` — **NEVER (consolidated)**.
  - [ ] `docs/architecture/web-adapter.md` — **NEVER (consolidated)**.

## Testing strategy checklist

- [x] Unit tests for pure path/storage logic. _(M1 storage-resolution tests)_
- [x] Unit tests for adapter detection using fixture project directories. _(every
      adapter has a detection fixture test)_
- [x] Unit tests for command builders; no real device required. _(RN/Android/iOS/
      web command-builder tests)_
- [x] Unit tests for log parsers and hierarchy parsers using saved fixtures. _(log
      parsers + UIAutomator parsers + web AX parser)_
- [ ] Cubit tests for target selection, capability state, and storage settings.
      — **BLOCKED (live wiring)**: storage settings ships with widget/golden
      coverage, but target-selection / capability cubits don't exist yet — they
      arrive with the live workbench wiring (M10).
- [x] Widget tests for settings/onboarding/workbench capability UI. _(target-panels
      widget test + storage-settings golden)_
- [x] Golden tests for any UI change. _(storage-settings + `target_panels.png`,
      both reviewed)_
- [ ] Manual smoke scripts for device-backed flows. — **BLOCKED (live devices)**:
      need real devices/emulators/browser.
- [ ] E2E tests remain opt-in through environment variables such as
      `PICKFORGE_E2E_AVD`. — **BLOCKED (live emulator + harness)**: needs a live
      AVD and an E2E harness not buildable in a fixture-only environment.

## Suggested execution order

| Order | Milestone | Priority | Effort | Dependency | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Configurable context storage | P1 | L | none | DONE — Slices 1A–1D complete; suite green (858); Codex-reviewed PASS |
| 2 | Adapter registry + Generic Project mode | P1 | L | 1 | CORE DONE — 2A (types+registry, `0d0d398`) + 2B (GenericProjectAdapter, `6f5a1a2`) committed. Capability badges built in `09db514` (`TargetCapabilityBadges`, golden-reviewed). The three operation interfaces are NEVER (superseded by concrete per-adapter mappers); generic-adapter terminal/attachments are NEVER (app-global by design). |
| 3 | FlutterTargetAdapter parity | P1 | M | 2 | CORE DONE — 3A detection (`0e811be`), 3B selection mapper, 3C generic MCP aliases, 3D deep-support docs; suite green (890), Codex-reviewed PASS-WITH-NITS (addressed). Adapter-owned `TargetSession` deferred → post-M4. |
| 4 | React Native Android MVP | P2 | L | 1-3 | CORE DONE — 4A detect (`a6e3648`), 4B Metro/logs (`b45a233`), 4C ADB devices/launch/screenshot/logcat (`7572840`), 4D UIAutomator (`9718bfb`), 4E selection context (`314c767`); suite green (964), each slice Codex-reviewed to PASS. Fixture/fake-tested (no live device); reload + DevTools/CDP deferred to M5. |
| 5 | React Native deepening | P3 | M/L | 4 | CORE DONE (fixture-testable scope) — 5A Metro CDP discovery (`2c3041d`), 5B Expo detect+launch (`1620a50`); source-map parse layer `SourceMap` resolver (`54deaf2`), both Codex-reviewed PASS. React-components-tree is NEVER (no stable API); source-map↔live-CDP correlation BLOCKED (live CDP); iOS sim BLOCKED → M7. |
| 6 | Native Android MVP | P2 | L | 1-3 | CORE DONE — 6-1 detect (`84864e9`), 6-2 shared Android ADB/UIAutomator extraction (`0e971bd`), 6-3 Gradle launch (`b0374f0`), 6-4 device/logcat/inspect reuse (`911a2ca`), 6-5 best-effort source hints (`a1904af`); suite green (1036), each slice Codex-reviewed PASS. Fixture/fake-tested (no live device); never claims Compose mapping. |
| 7 | Native iOS MVP | P3 | L | 1-3 | CORE DONE (fixture-testable scope) — 7A detect (`ff0b585`), 7B xcodebuild/simctl command builders + macOS-gated caps (`b0749d0`), 7C simctl device-list parser (`fed1496`), source-candidate finder (`b43e207`), Codex-reviewed PASS. DECISION: accessibility hierarchy uses the manual-selection MVP (no stable external API). Programmatic a11y element capture BLOCKED (macOS + no API). |
| 8 | Web adapter MVP | P2 | L | 1-3 | CORE DONE (fixture-testable scope) — 8A detect (`15db72d`), 8B dev-server command (`ff362d4`), 8C shared CdpDiscovery (`abe370f`); accessibility-tree parser (`106d918`), source-map resolver + source-candidate finder (`54deaf2`), all Codex-reviewed PASS. NO Playwright dep (STOP honored). Browser-live screenshot/console/network capture + DOM box-model BLOCKED (live browser). |
| 9 | Framework-aware agent workflows | P2 | M | 1-4 plus any adapter | CORE DONE — 9A capability→workflow/prompt-tier policy (`cbea612`), 9B generic MCP ops + list_target_capabilities (`cf75af2`); suite green (1082). The live agent-launcher prompt-template wiring + workflow buttons are the M10 UI/integration step. |
| 10 | Suite UI productization | P2 | M | ongoing | CORE DONE — support-level model + badge (`8ee8793`), `TargetSummaryPanel` + `AdapterDoctorPanel` with a reviewed golden (`253b6b2`), `AdapterDoctor` binary checks (`96d8942`), storage selector (M1 1D); suite green (1093). Only remaining: binding the panels to the live active-target stream in the running workbench (app wiring, needs the live app to verify). |

Recommended immediate next implementation slice:

1. Resolve the PickForge Home path decision.
2. Implement configurable context storage without changing Flutter behavior.
3. Add env-based MCP/context discovery.
4. Add adapter interfaces and Generic Project mode.
5. Move current Flutter flow behind `FlutterTargetAdapter`.
6. Start React Native Android MVP.

## Done criteria for the whole roadmap

All must be true before this roadmap can be marked complete.

- [x] New projects default to user-level PickForge Home storage. _(M1)_
- [x] Users can choose project-local `.pickforge/` or a custom context folder. _(M1)_
- [x] Existing project-local users remain compatible. _(M1: auto-detect + parity tests)_
- [x] Embedded terminal sessions receive `PICKFORGE_*` env vars. _(M1)_
- [x] MCP discovery works without assuming repo-local `.pickforge/`. _(M1)_
- [x] Flutter behavior has parity with current widget selection/context/reload flow. _(M1)_
- [ ] Generic Project mode works for unsupported projects. — **BLOCKED (live
      app)**: the generic adapter + detection ship and are tested; the
      adapter-mediated open UX needs the running workbench.
- [ ] At least one non-Flutter adapter ships with run/log/screenshot/context.
      — **BLOCKED (live device)**: the RN Android adapter's command builders, log
      parsers, UIAutomator inspection, and selection-context builder all ship and
      are fixture-tested; the end-to-end "ships" gate is the BLOCKED manual smoke.
- [x] Adapter capability badges prevent overstating support depth. _(`09db514`
      `TargetCapabilityBadges` — muted pills for unsupported operations; only
      Flutter declares `mapSelectionToSource`.)_
- [x] Docs accurately describe support tiers and storage behavior. _(storage docs
      in M1; support tiers in `docs/architecture/target-adapters.md`.)_
- [x] Standard validation passes on supported development platforms. _(M1: 858 tests green, analyze + format clean on Linux)_

## Global STOP conditions

Stop and update this plan before continuing if any of these happen:

- A change risks deleting, overwriting, or exposing user project files.
- A milestone requires modifying user app source code by default.
- A platform API turns out to be private, unstable, or license-incompatible.
- The implementation would make Flutter support worse before replacement parity
  tests are in place.
- Context outside the repo cannot be reliably discovered by PickForge-launched
  agents.
- The work requires a new remote service, account system, or telemetry path that
  conflicts with local-first positioning.

## Maintenance notes

- Keep this file current. When a task lands, check it off in this file in the
  same PR.
- Prefer small PRs that land one seam at a time: storage seam, env discovery,
  adapter types, Flutter migration, then new adapters.
- Do not add framework-specific hacks to the generic core. Put stack-specific
  behavior behind adapters.
- Do not claim exact source mapping unless the adapter has direct evidence.
- Preserve the current safety rule: PickForge must never modify project source
  files as part of context preparation.
