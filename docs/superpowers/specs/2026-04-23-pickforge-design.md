# Pickforge — Design Spec

**Date:** 2026-04-23
**Status:** Draft — pending user review
**Product name:** Pickforge
**Domain:** `pickforge.dev`
**Repo:** `vibe-flutter`
**License:** MIT (open core)

---

## 1. Overview

Pickforge is a local **Flutter desktop app** that lets developers visually select widgets in a running Flutter app and dispatch them as context to an AI coding CLI (Claude Code, Codex, or OpenCode) for surgical edits.

The loop: user runs their Flutter app in an Android emulator as they always do, launches Pickforge alongside, taps a widget in the emulator (Flutter's own Inspector draws the selection outline), clicks **Forge it** in Pickforge, and a new OS-native terminal opens running the chosen AI agent pre-loaded with the selected widget's source, tree context, and a screenshot. The agent edits the code; the user hot-reloads; the loop repeats.

Pickforge's novel contribution is **widget-level precision for AI coding**: nobody else plugs live Flutter Inspector context directly into an agent's prompt.

## 2. Goals & non-goals

### Goals (MVP)

- Attach to a running Flutter app via its VM Service + Flutter Inspector protocol.
- Let the user select a widget by tapping in the Android emulator, and expose the selection to Pickforge.
- Extract widget context: class, creation file:line, source snippet, ancestor chain, screenshot(s).
- Spawn a new terminal window in the user's preferred terminal, running their chosen agent CLI, pre-loaded with Pickforge-authored context files.
- Support Claude Code, Codex, and OpenCode from day one via an `AgentProfile` abstraction.
- Support major terminals (Ghostty, iTerm2, Warp, WezTerm, Alacritty, Kitty, Windows Terminal, gnome-terminal, Terminal.app) via a `TerminalProfile` abstraction, auto-detected.
- Never modify the user's own `CLAUDE.md` / `AGENTS.md`; write to a scoped `.pickforge/` folder instead.
- Ship a deliberately polished UI/UX on par with Linear, Raycast, and Arc.

### Non-goals (MVP)

- Embedded emulator mirror (scrcpy + custom overlay). Deferred to Phase 2.
- True hover-in-the-live-emulator UX. Deferred to Phase 2.
- iOS Simulator and Flutter web / desktop targets. Deferred post-MVP.
- Multi-agent orchestration / BridgeSwarm-style swarm. Deferred to Pickforge Pro.
- Multi-pane terminal workspaces, built-in editor, task board. Deferred to Pickforge Pro.
- API-key handling or credential storage. Pickforge is bring-your-own-agent-auth.
- Cloud services of any kind. MVP is strictly local.
- Automatic end-to-end emulator tests in CI. Manual dogfood checklist instead.

## 3. Target user

A Flutter developer who:

- Uses an AI coding CLI (Claude Code, Codex, or OpenCode) daily.
- Runs their app in an Android emulator during development.
- Wants surgical edits to specific widgets without writing a paragraph of context into the agent every time.
- Values polished dev tools and is willing to install a companion app that works alongside (not replaces) their existing IDE and terminal.

## 4. Core decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **MVP scope** = widget-picker + one embedded agent terminal. No swarm, no editor, no task board. | Ships the novel loop end-to-end in weeks, not months. Workspace features are deferred to Pickforge Pro. |
| D2 | **Widget-tree transport** = VM Service + Flutter Inspector protocol (`ext.flutter.inspector.*`). | Same mechanism DevTools uses. Zero user setup. |
| D3 | **License** = MIT, open core. | Developer trust + OSS distribution outweighs short-term paywall revenue for a novel tool. Pro tier deferred. |
| D4 | **Platform** = Android emulator first. | Widest install base on the user's Linux-primary dev environment; iOS/web/desktop are near-free follow-ups once the protocol is wired. |
| D5 | **Product name** = Pickforge, domain `pickforge.dev`. | "Pick" = the selection mechanic, "forge" = AI crafting/making. `.dev` TLD signals developer focus, $10-15/yr. |
| D6 | **Agent support** = Claude Code + Codex + OpenCode via `AgentProfile`. | Low marginal cost per agent given the profile abstraction. |
| D7 | **Context delivery** = scoped `.pickforge/` folder in project root. | Zero pollution of user's own `CLAUDE.md` / `AGENTS.md`; uses agents' native `Read` tool uniformly; debuggable by inspection. |
| D8 | **Skill licensing** = public (P1). Value is UX, not secret prompts. | Aider, Continue.dev, OpenCode all ship prompts in the open and monetize on experience. |
| D9 | **Architecture** = Approach A: external dock + on-device Select Widget Mode. | Approach B (embedded emulator mirror) is Phase 2; Approach A code is a strict subset. |
| D10 | **Storage** = Drift from day one. | User preference. Foundation for history, settings, logs; supports Phase 2 swarm/session needs without rework. |
| D11 | **Screenshots** = dual capture on Android. | Inspector gives a clean widget surface; `adb exec-out screencap` gives the device screen with the selection highlight box + system UI. Both go to the agent. |

## 5. Architecture

Pickforge is a Flutter desktop app with five cooperating components. It runs alongside (not inside) the user's normal Flutter dev workflow.

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Pickforge.app (Flutter desktop)                  │
│  ┌────────────┐   ┌────────────────┐   ┌───────────────────────┐     │
│  │   UI       │──▶│  InspectorCore │──▶│   AgentLauncher       │     │
│  │   Panel    │   │  (VM Service)  │   │  (terminal spawn)     │     │
│  └────────────┘   └────────────────┘   └───────────────────────┘     │
│        ▲                  │                       │                  │
│        │                  ▼                       ▼                  │
│  ┌────────────┐   ┌────────────────┐   ┌───────────────────────┐     │
│  │ SkillStore │   │ VmServiceClient│   │   AgentProfileRegistry│     │
│  │ (MIT repo) │   │ (ws://…)       │   │ + TerminalProfile     │     │
│  └────────────┘   └────────────────┘   │   Registry            │     │
│                                        └───────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
                             │                       │
                             ▼                       ▼
           ┌──────────────────────────┐   ┌──────────────────────────┐
           │ User's Flutter app       │   │ New OS terminal window   │
           │ (running in emulator)    │   │ running wrapper.sh →     │
           │ exposing VM Service WS   │   │ claude / codex / opencode│
           └──────────────────────────┘   └──────────────────────────┘
```

### Architectural principles

1. **Pickforge never modifies the user's source code directly.** Only the AI agent does, through its own file-editing tools. Pickforge is read-only w.r.t. the user's repo (except for writes into `.pickforge/`).
2. **One-way data flow.** Inspector events flow in, terminal spawns flow out. No bidirectional state sync with the running app.
3. **Bring-your-own-agent-auth.** Pickforge spawns the agent CLI; the CLI handles its own login. Pickforge never touches API keys.
4. **Stateless between widget picks.** Every "Forge it" click is an independent spawn. No long-lived agent pool in MVP.

## 6. Components

### 6.1 UI Panel — `lib/ui/`

Pure Flutter, no I/O. Three main views:

- **DockView** — the always-on-top main window: widget-tree panel (left), widget-details panel (right), skill picker + "Forge it" button (bottom).
- **ConnectionView** — "waiting for `flutter run`" state + manual VM Service URL paste.
- **HistoryView** — recent picks (persisted in Drift).

### 6.2 InspectorCore — `lib/core/inspector/`

Owns the logical model of "what Pickforge knows about the running app". Key service extensions called:

- `ext.flutter.inspector.getRootWidgetTree` — full widget tree with creation-location metadata.
- `ext.flutter.inspector.getSelectedWidget` — current selection as a diagnostic node.
- `ext.flutter.inspector.show` — toggles on-device Select Widget Mode.
- `ext.flutter.inspector.screenshot` — PNG of the Flutter render surface.
- `ext.flutter.inspector.trackRebuildDirtyWidgets` — Phase 2 (rebuild diffing).

Data model (freezed):

```
WidgetNode     { id, className, children, creationLocation(file, line, column) }
SelectedWidget { node, boundingRect, sourceSnippet, screenshotPath, adbScreenshotPath? }
InspectorStatus = Disconnected | Connecting | Connected(vmService, selectModeOn) | Error(msg)
```

Exposed as `InspectorRepository` consumed by cubits.

### 6.3 VmServiceClient — `lib/core/vm_service/`

Thin wrapper around `package:vm_service` (Dart-team canonical). Responsibilities:

- Manage the `VmService` instance.
- Reconnect with exponential backoff on drop (1s, 2s, 4s, 8s capped).
- Dispatch service-extension calls.
- Expose `Stream<InspectorStatus>` for the UI.

**URL discovery (MVP):** manual paste on first connect, saved per-project in Drift. Auto-discovery (port scan / `flutter daemon`) deferred.

### 6.4 SkillStore — `lib/core/skills/`

Loads prompt assets.

Asset layout:

```
assets/skills/edit-widget.md
assets/skills/extract-widget.md
assets/skills/explain-widget.md
assets/agents/AGENTS.md.tmpl        # shared (Codex, OpenCode)
assets/agents/CLAUDE.md.tmpl        # Claude Code variant
```

**Override path:** `<project>/.pickforge/skills/<name>.md` takes precedence over the bundled version. Community skill registry deferred.

### 6.5 AgentLauncher + AgentProfileRegistry — `lib/core/agent/`

Given `(SelectedWidget, Skill, AgentProfile, TerminalProfile, ProjectRoot)`:

1. Write scoped context files to `<project>/.pickforge/` (creating the folder + `.gitignore` on first use).
2. Generate a per-invocation wrapper script to a temp dir.
3. Spawn the selected terminal running the wrapper.
4. Record a history entry in Drift.

```dart
abstract class AgentProfile {
  String get id;
  String get binary;
  String get contextFile;
  List<String> buildArgs({required String initialPrompt, required String workingDir});
  Future<void> writeContext({required Directory tempDir, required String agentsMd, required String skill});
}
```

Three concrete implementations in MVP.

### 6.6 TerminalProfile registry — `lib/core/terminal/`

Mirror of `AgentProfile`.

```dart
abstract class TerminalProfile {
  String get id;
  String get displayName;
  Future<bool> isInstalled();
  Future<Process> launch({required String scriptPath, required String workingDir, Map<String, String>? env});
}
```

MVP bundles: Ghostty, iTerm2, Warp (URL-scheme), WezTerm, Alacritty, Kitty, Windows Terminal, gnome-terminal, Terminal.app, `$TERMINAL` fallback. Detected on first run; user can override in Settings.

## 7. Data flow

### 7.1 Initial connection

User launches Pickforge → loads saved VM Service URL per-project (Drift) → (first run) user pastes `ws://127.0.0.1:PORT/UUID=/ws` → WebSocket connects → `getVM` + `streamListen(Extension, Debug, Isolate)` → enable Select Widget Mode via `ext.flutter.inspector.show` → persist URL.

Status: `Disconnected → Connecting → Connected(vmService, selectModeOn) | Error(msg)`.

### 7.2 Widget pick → Forge it → terminal spawn

1. User taps in the emulator. Flutter Inspector draws the on-device highlight and dispatches a selection-changed event over the VM Service.
2. Pickforge receives the event, calls `getSelectedWidget` (with properties), `getRootWidgetSummaryTree` (for ancestor chain), `screenshot` (PNG), and reads the source file at the creation location (±20 lines).
3. Optionally (Android only, `adb` present): `adb exec-out screencap -p > .pickforge/device-screen.png`.
4. UI updates: details panel shows the selection.
5. User picks a skill + agent + terminal and clicks **Forge it**.
6. `AgentLauncher` writes `.pickforge/skill-active.md`, `.pickforge/widget-context.md`, `.pickforge/screenshot.png`, `.pickforge/device-screen.png`, `.pickforge/run-log.json`. Generates a wrapper script in a temp dir.
7. `TerminalProfile.launch()` spawns the user's terminal running the wrapper.
8. The wrapper `cd`s into the project root and invokes the agent CLI, pointing it at the initial prompt file. The agent's first action is to `Read` the `.pickforge/` files.
9. Drift records a history entry.

### 7.3 Hot reload / isolate refresh

On `Isolate.reload`: invalidate cached tree, re-fetch `getRootWidgetTree`, update UI. Optionally re-screenshot. Increments the agent-run-log reload counter (useful for Phase 2 rebuild diffing).

### 7.4 Initial prompt structure

The wrapper pipes this into the agent:

> I'm being invoked via Pickforge, a widget-picker for Flutter AI coding. Read these files in order:
> 1. `.pickforge/skill-active.md` — your directive for this task.
> 2. `.pickforge/widget-context.md` — the user's selected widget (class, file:line, source, ancestor chain).
> 3. `.pickforge/screenshot.png` — the widget's pixels.
> 4. `.pickforge/device-screen.png` — the device screen including the selection outline (Android only).
>
> Then proceed with the skill.

### 7.5 The "never touch user's CLAUDE.md" rule

Pickforge never writes to `CLAUDE.md`, `AGENTS.md`, or any file outside `.pickforge/`. User's own context files are read by the agent as normal; Pickforge's context is *additional*, not replacement. If `.pickforge/` already exists and doesn't look like Pickforge's, Pickforge refuses and asks the user to rename or delete.

## 8. Error handling

### 8.1 Principles

1. **Never block the core loop on a non-critical failure.** Screenshot fails → ship without it. DB write fails → ship anyway.
2. **Show the cause inline.** Every user-visible error names the file, URL, or binary that didn't work and offers at most one actionable button.
3. **Never destroy user data to recover.** Corrupt DB → back up, don't delete. Existing `.pickforge/` → refuse, don't overwrite. Existing `CLAUDE.md` → never touch.

### 8.2 VM Service failures

- **Malformed URL:** UI validation, reject before connecting.
- **Connection refused:** `Error("Couldn't reach VM Service. Is your app running?")` + Retry.
- **Mid-session drop:** auto-reconnect with exponential backoff; grey out stale tree.
- **Unsupported Flutter version:** degrade (hide missing features) or, if `ext.flutter.inspector.show` is unavailable, show "Unsupported Flutter version".
- **Hot restart / isolate reload:** handled in §7.3, not an error.

### 8.3 Terminal / agent launch failures

- **Selected terminal binary missing:** auto-fall-back to next detected terminal + toast.
- **Selected agent binary missing:** block spawn; show install-docs modal.
- **`adb` missing on Android:** skip dual-capture silently, keep Inspector shot.
- **Temp dir write failure:** block spawn; surface path + cause.
- **Wrapper exits non-zero:** terminal stays open (user reads error); history view flags red.
- **User closes Pickforge mid-session:** spawned terminals are orphaned by design; no cleanup needed.

### 8.4 Source extraction failures

- **No `creationLocation` (framework widget):** grey out Forge it; offer "Select parent instead" walking up to user-code.
- **File missing:** "Source file not found: `<path>`. Recompile and try again."
- **Line out of bounds (stale compile):** use nearest valid line + warn in context.
- **Screenshot fetch times out:** proceed without screenshot. Log, don't block.
- **Existing foreign `.pickforge/`:** refuse; ask user to rename or delete.

### 8.5 Drift storage failures

- **Corrupt DB:** on startup, rename to `pickforge.db.corrupt-<ts>`, create fresh, non-blocking toast.
- **Migration fails:** same recovery path.
- **Mid-session write fails:** log and continue. History is best-effort.

## 9. Testing

### 9.1 Strategy

| Layer | Coverage target | Approach |
|---|---|---|
| Models (freezed) | ~100% | `package:test` |
| Repositories | ~100% | `mocktail` for VmService / Process / filesystem |
| Blocs / Cubits | ~100% | `bloc_test` |
| Widgets | ~80% | `flutter_test` + bloc mocks; goldens only on hero components |
| Drift DAOs | ~100% | `NativeDatabase.memory()` |
| VM Service integration | one smoke | Fixture-replay harness + manual emulator run |
| Terminal spawn | per-OS smoke | CI matrix (Linux/macOS/Windows) |
| End-to-end | manual | Pre-release dogfood checklist |

### 9.2 Fixture-replay harness

The most valuable test infrastructure. `test/fixtures/vm_service/` holds `.jsonl` transcripts captured from real `flutter run` sessions. `FakeVmService` replays them. A one-time investment; enables ~90% of integration scenarios as fast unit tests with no emulator.

Capture tool: `tool/record_vm_service.dart`.

### 9.3 CI

GitHub Actions matrix: ubuntu-latest, macos-latest, windows-latest.

- `flutter analyze`
- `flutter test --coverage` (codecov upload)
- `dart run build_runner build --delete-conflicting-outputs` (catch generator breakage)
- `dart format --set-exit-if-changed .`
- `very_good_analysis` lint gate
- No real-emulator CI. Too expensive and flaky.

### 9.4 Release dogfood checklist

Lives in `docs/release-checklist.md`. Reviewed on every release PR. Covers: cold install, connect, widget pick, all three agents, all detected terminals, hot reload, disconnect recovery, projects with and without existing `CLAUDE.md` / `AGENTS.md`.

## 10. Design & motion

Design quality is a first-class requirement, not a polish pass. The moat for an OSS tool competing with a funded closed competitor is feel + polish.

### 10.1 Aesthetic direction

Target the 2026 power-user dev-tool aesthetic: Linear, Raycast, Arc, Cursor, Zed, Warp, Ghostty, BridgeSpace.

- **Dark-first** (near-black ~#0A0A0B, not pure black) with one chromatic accent (forge-ember orange or electric violet — to be decided in design phase). Light mode ships but dark is hero.
- **Liquid Glass** on floating panels, modal sheets, command palette. Subtle blur + 1-2px inner border + tiny drop shadow.
- **Dense but breathable.** 8px grid, ~13px body, tight line-heights, generous cluster spacing. No Material 3 defaults.
- **Typography.** Geist or Inter for chrome; Berkeley or JetBrains Mono for code and widget-tree. Variable fonts.
- **Micro-grain backgrounds.** 1-2% opacity noise overlay on dark surfaces to kill banding and add tactility.
- **Command palette (⌘K).** Primary nav for keyboard users. "Connect", "Forge it", "Change agent", "Change terminal", "Pick widget".
- **Semantic color.** Orange = user action / selection. Green = connected. Amber = warning. Red = error. Muted blue = links/info.

### 10.2 Motion principles

- Spring physics over linear; `Curves.easeInOutCubicEmphasized` as the workhorse curve.
- Motion explains causation: widget pick slides into details panel; "Forge it" morphs into a launching-terminal indicator; hot reload sweeps a shimmer across the tree.
- 120 Hz targets for chrome/UI motion; expensive effects (glass blur, noise) are static or capped.
- OS reduce-motion honored; falls back to cross-fades.
- Hero transitions between widget-tree items and the details panel.
- Empty/waiting states animate (pulsing dot, sliding underlines, shimmers).
- Loading is never a spinner — skeleton + shimmer first, progress bars for capture ops, animated dots only for connection attempts.

### 10.3 Design packages

Added to runtime deps: `flutter_animate`, `animations` (official Flutter team), `rive` (hero brand motion). `lottie` optional for commissioned assets.

### 10.4 Budget

~2 extra weeks of polish concentrated toward end-of-MVP. Dedicated design pass required — either the user delivers it or we spec the hire.

### 10.5 What we explicitly don't do

- No skeuomorphism. Liquid Glass is the only 3D metaphor.
- No decorative motion. Every animation communicates.
- No Material 3 defaults — `ThemeData` comprehensively overridden.
- No "AI sparkle" gradients everywhere.

## 11. Package stack

### Runtime

`flutter_bloc`, `bloc`, `equatable`, `freezed_annotation`, `json_annotation`, `get_it`, `injectable`, `go_router`, `drift`, `drift_flutter`, `sqlite3_flutter_libs`, `dio`, `vm_service`, `web_socket_channel`, `window_manager`, `path_provider`, `path`, `yaml`, `shared_preferences`, `flutter_animate`, `animations`, `rive`.

### Dev

`build_runner`, `freezed`, `json_serializable`, `injectable_generator`, `drift_dev`, `mocktail`, `bloc_test`, `very_good_analysis`, `test`, `flutter_test`.

### DI note

GetIt + Injectable own service/repo/bloc registration. `flutter_bloc`'s `BlocProvider` is still used inside the widget tree for scoping cubits to routes; repositories are resolved from GetIt, not `RepositoryProvider`. This is a deliberate hybrid and differs from stock VGV examples.

### Dio note

Dio is pre-vetted in the stack but has **no confirmed MVP use case** — the VM Service is WebSocket-based, the agent is a local process, skills are local files. First real use case is likely update-check on startup. Revisit when a real HTTP call appears.

## 12. Deferred to Phase 2 / post-MVP

Tracked explicitly so they're not forgotten after MVP ships.

- **Approach B:** embedded emulator mirror (scrcpy) + custom overlay + true hover-over-live-emulator.
- **Target expansion:** iOS Simulator, Flutter web (Chrome), Flutter desktop.
- **Agent expansion:** Cursor CLI, Gemini CLI, future CLIs.
- **Phase 1.5 — Pickforge MCP server** exposing `get_selected_widget`, `list_pickforge_history`, `capture_screenshot` so agents can re-query mid-task.
- **Pickforge Pro tier:** BridgeSwarm-style multi-agent orchestration, team sync, cloud-synced context, priority support, premium skill packs. Monetization model open (freemium vs paid) until MVP has users.
- **Dio wiring:** update-check first; later Pro auth and cloud skill packs.
- **Auto-discovery of VM Service URL:** port scanning and/or `flutter daemon` integration.
- **Rebuild tracking:** `ext.flutter.inspector.trackRebuildDirtyWidgets` to diff post-hot-reload.
- **Community skill registry.**
- **Telemetry + crash reports** (Sentry, opt-in).
- **Auto-updater:** Sparkle (macOS), winget/scoop (Windows), .deb/AppImage refresh (Linux).
- **Codesigning, notarization, distribution:** macOS notarization, Windows signing + SmartScreen reputation, Linux Flathub/Snap.
- **Screenshot before/after pair:** auto-capture after hot-reload and re-prompt the agent "did your change look right?".

## 13. Open questions (none blocking)

- **Accent color:** forge-ember orange vs electric violet. Decide in design phase with actual mockups.
- **Pro tier pricing model:** freemium vs flat paid. Revisit after MVP has users.
- **Design resourcing:** internal vs contracted. Commit to one before the polish phase.
