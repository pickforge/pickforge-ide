# Pickforge — Embedded Terminal & Project Sidebar

**Status:** design (validated 2026-04-25)
**Author:** brainstormed with the project owner
**Supersedes:** the external-terminal launching half of `2026-04-23-pickforge-design.md`
**Companion mockup:** `.superpowers/brainstorm/.../three-pane-shell.html`

---

## 1. Goal

Replace today's "spawn an external terminal app (Ghostty / WezTerm / etc.) running the agent CLI as a child process" flow with a Pickforge-native three-pane shell:

- **Left rail** — projects (folders containing `pubspec.yaml`) and chats (per-project, persistent agent sessions).
- **Middle pane** — forge compose strip + embedded PTY terminal running the user's chosen agent CLI.
- **Right pane** — pure widget inspector (props, screenshot, tree).

The agent CLI runs *inside* Pickforge in a real PTY, so the user gets the same full TUI experience they get in Ghostty (colors, cursor, plan-mode dialogs, vim popping open, slash menus). No API keys are stored or transmitted by Pickforge — credentials remain in each agent CLI's own config dir (`~/.claude`, `~/.codex`, `~/.config/opencode`).

A Phase 2 alternative (chat-adapter UX over headless CLI invocations) is logged in `NOTES.md` and explicitly out of scope here.

## 2. User journeys

### J1 — Cold open

1. App boots, opens Drift, runs migrations.
2. If no projects exist → `/onboarding` (one-screen "pick a folder containing `pubspec.yaml`").
3. Otherwise → `/workbench`. Last-active project is pre-selected; its most recently-used chat is pre-opened. The chat's persisted scrollback is replayed into xterm. The agent PTY is spawned (lazy on first input if previously parked) using the CLI's `--resume <sessionId>` mechanism for multi-turn continuity.
4. VM service reconnect runs in background against the project's saved URL. Inspector pane shows live widget tree on success; falls back to inline discovery + manual URL on failure. Terminal pane is unaffected.

### J2 — Chat switch within a project

Active project's chats all keep live PTYs in the background. Clicking a chat re-binds xterm to that chat's existing PTY — instant.

### J3 — Project switch

All current PTYs SIGTERM (300 ms grace) → SIGKILL. Drift cubit rebuilds for the new project. New project's last chat replays scrollback; PTY spawns lazily on first input. VM client reconnects to the new URL.

### J4 — Forge It on a picked widget

1. User toggles select-mode in the inspector header → taps in the emulator → `SelectionStream` emits a `SelectedWidget`.
2. User picks a skill (defaults to last-used per chat) and an agent (defaults to project's `defaultAgentId`).
3. Click **Forge It** → `ForgeCubit`:
   - `AdbScreenshotCapturer` captures device shot (best-effort).
   - `WidgetContextRenderer` renders selection to markdown.
   - `AgentLauncher.prepareContext` writes `.pickforge/skill-active.md`, `widget-context.md`, `screenshot.png`, `device-screen.png`, returns the initial-prompt string.
   - `PtySessionPool.sendPrompt(activeChatId, prompt)` writes the prompt to the chat's PTY stdin (with trailing `\r`) — the agent CLI sees it in its REPL just like the user typed it.
4. Agent reads the `.pickforge/` files via its own `Read` tool and makes its edits. Output streams normally; user watches it happen.

## 3. Architecture

### 3.1 New components

**`lib/features/workbench/`**

| File | Responsibility |
|---|---|
| `view/app_shell_view.dart` | Three-pane Scaffold. Persistent across "in-project" routes. |
| `view/projects_chats_panel.dart` | Left rail (projects list + chats list + add buttons). |
| `view/chat_workbench_panel.dart` | Middle pane (forge compose strip + xterm `TerminalView`). |
| `view/inspector_panel.dart` | Right pane (connection pill, props, screenshot, tree). |
| `cubit/projects_cubit.dart` | Project list, current selection, create / rename / remove. |
| `cubit/chats_cubit.dart` | Active project's chats, selection, create / rename / duplicate / delete. |
| `cubit/workbench_layout_cubit.dart` | Pane sizes, right-pane collapse, persistence. |

**`lib/core/terminal/`** (replaces today's external-terminal code)

| File | Responsibility |
|---|---|
| `pty_session.dart` | Owns one `flutter_pty.Pty` lifecycle. Wraps it as a Dart-friendly stream interface. |
| `pty_session_pool.dart` | Holds the live `PtySession` map keyed by `chatId`. Applies the "all chats in active project alive" policy. |
| `transcript_recorder.dart` | Taps a `PtySession`'s output, strips ANSI to UTF-8 + sidecar spans, appends to disk. |
| `transcript_replayer.dart` | Reads persisted transcript on activate, feeds bytes to xterm. |
| `embedded_terminal_settings.dart` | Font / size / theme model + persistence. |

### 3.2 Refactored or kept components

- `AgentLauncher.launch` becomes `AgentLauncher.prepareContext` — same `.pickforge/` writing, returns the initial prompt instead of spawning a process.
- `WrapperScriptGenerator` is split: the terminal-launching half is deleted; the `.pickforge/`-writer half is renamed `pickforge_context_writer.dart`.
- `AgentProfile` and the three concrete profiles (Codex, OpenCode, ClaudeCode) keep their invocation args — the args become the `Pty.start` command line instead of being baked into a wrapper script.
- VM service layer, `WidgetPickerCubit`, screenshot capturer, skill store, widget-context renderer, source-snippet extractor — unchanged.

### 3.3 Removed components

- `lib/features/connection/view/connection_view.dart` — connection moves into the inspector pill inside the shell. Route `/connect` deleted.
- `lib/features/widget_picker/view/dock_view.dart` — content distributes into the new shell. Route `/` redirects to `/workbench`.
- `lib/core/terminal/profiles/*` (the *old* TerminalProfile family) — Ghostty / WezTerm / iTerm / Warp / Windows Terminal / Alacritty / Kitty / gnome-terminal / Terminal.app profiles, detector, registry, picker UI, all tests.
- `defaultTerminalId` column in `ProjectSettings`.
- `/history` route — chats are the new history; existing `PickHistory` data stays in Drift, exposed later via ⌘K cross-chat search (Phase 2).

## 4. Data model

### 4.1 New Drift tables

```dart
class Projects extends Table {
  TextColumn get projectRoot => text()();              // PK, absolute canonicalized path
  TextColumn get displayName => text()();              // defaults to basename(projectRoot)
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get lastOpenedAt => dateTime()();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();
  @override Set<Column> get primaryKey => {projectRoot};
}

class Chats extends Table {
  TextColumn get chatId => text().clientDefault(() => Uuid().v4())();   // PK
  TextColumn get projectRoot =>
      text().references(Projects, #projectRoot, onDelete: KeyAction.cascade)();
  TextColumn get title => text()();                    // user-editable, defaults to "Chat <n>"
  TextColumn get agentId => text()();                  // claude-code | codex | opencode
  TextColumn get skillId => text().nullable()();       // last skill used in this chat
  TextColumn get sessionId => text().nullable()();     // CLI's own session id for `--resume`
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get lastActivityAt => dateTime()();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();
  @override Set<Column> get primaryKey => {chatId};
}
```

### 4.2 Existing tables — minor changes

- `ProjectSettings`:
  - **Drop** `defaultTerminalId`.
  - **Add** `lastChatId TEXT NULL`, `paneSizes TEXT NULL` (JSON-encoded `[leftPx, rightPx]`).
- `PickHistory`: add optional `chatId TEXT NULL` for future cross-referencing (no UI consumes it in v1).
- `AgentRunLog`: unchanged.

### 4.3 Transcript files (outside Drift)

```
<projectRoot>/.pickforge/chats/<chatId>/
  transcript.log         # append-only UTF-8 stripped text, ~5 MB rolling cap
  transcript.spans.bin   # append-only varint-framed color/style sidecar
  meta.json              # last-truncation marker, byte counts, schema version
```

`<projectRoot>/.pickforge/.gitignore` (auto-generated, contains `*`) covers these.

### 4.4 Migrations

Single Drift `schemaVersion` bump in one transaction:
1. Drop `defaultTerminalId`.
2. Add `lastChatId`, `paneSizes` to `ProjectSettings`.
3. Create `Projects` and `Chats`.
4. Create one `Projects` row per existing `ProjectSettings.projectRoot` (synthetic `displayName = basename(...)`, `lastOpenedAt = ProjectSettings.lastUsedAt`).

## 5. Layout

`multi_split_view ^3.6.1` provides resizable panes.

- **Left rail** — default 220 px (min 180, max 360).
- **Middle pane** — flexible.
- **Right pane** — default 320 px (min 240, max 480), collapsible to a 24 px gutter chevron.

Sizes persist per user in `ProjectSettings.paneSizes`.

### 5.1 Left rail — `ProjectsChatsPanel`

- **Projects section.** Header `PROJECTS` + `+` button (opens `file_selector.getDirectoryPath()`; rejects folders without `pubspec.yaml`). Each row: folder glyph + display name. Active row highlighted. `⋯` menu: Rename, Reveal in Finder/Explorer, Remove from list (does not delete files; cascades Drift rows).
- **Chats section.** Header `CHATS — <activeProjectName>` + `+ New chat`. Each row: status dot (running / parked / failed / exited) + title + relative timestamp. `⋯` menu: Rename, Duplicate, Export transcript, Delete. Virtualized via `ListView.builder`.
- **Connection status indicator** at the rail bottom mirrors the right-pane pill.

### 5.2 Middle pane — `ChatWorkbenchPanel`

- **Forge compose strip** (`appBar`, ~52 px). Chat title (inline-editable), skill chip, attached-widget chip when something is picked, **Forge It** button.
- **Terminal body.** `xterm.TerminalView` full-bleed. Right-click menu: Copy, Paste, Clear, Send Ctrl+C, Restart agent, Open transcript folder. Status overlay (bottom-right) when PTY isn't `running` (spawning, parked, exited). Cold-start replay streams persisted scrollback in 64 KB chunks dispatched at frame boundaries (see §10) before PTY respawn — typical user-perceived replay 200–400 ms.
- **Drag-and-drop**: dropping a file pastes its absolute path.

### 5.3 Right pane — `InspectorPanel`

- **Header**: connection pill (`● connected · Pixel_5` / `↻ reconnecting…` / `○ disconnected`) + select-widget toggle.
- **Body (connected, selection)**: props block, device screenshot, widget tree — same content as today's `WidgetDetailsPanel`, restyled for the narrower rail.
- **Body (connected, no selection)**: "Tap a widget on the device to inspect it" empty state.
- **Body (disconnected)**: inline `DiscoveredDevicesList` + manual URL field. Subsumes the deleted `ConnectionView`.

## 6. Animations

User directive (2026-04-25): "add animations to the app, a lot, where you think it can fit for better UX." Always causal, always respects OS reduce-motion.

### 6.1 Stack

| Package | Version | Purpose |
|---|---|---|
| `flutter_animate` | `^4.5.2` | Chainable one-shot effects (fadeIn, slideX, shimmer, scale, blur, GLSL shaders) |
| `animations` | `^2.2.0` | Material Motion (OpenContainer, FadeThrough, SharedAxis, ContainerTransform) |
| `rive` | `^0.14.6` | 3–5 hero micro-assets (state machines) |

### 6.2 Inventory (defaults: 220 ms micro, 360 ms layout, 480 ms hero; spring physics)

**Shell-wide.** First-mount three-pane stagger fade-and-slide (60 ms). Right-pane collapse via `AnimatedContainer` 320 ms. `MultiSplitView` divider snap cue at min/max bounds.

**Left rail.** Active-row highlight slides between rows. `AnimatedList.insertItem` for new chats with elastic overshoot. `AnimatedList.removeItem` slide-out + 2 s undo snackbar with progress bar. Status-dot color tween 280 ms; spawning state shimmers at 1 Hz. Hover-reveal on `⋯` icons via `AnimatedOpacity`.

**Middle pane.** Forge strip "armed" divider transitions to brand-ember with soft glow when a widget is picked. Forge It button has slow ambient shimmer; press scales 1.0 → 0.96; success morph plays a Rive checkmark. Skill chip indicator slides between segments. Inline title edit expands via `AnimatedSize`. Terminal mount on chat switch wraps in `AnimatedSwitcher` with `FadeThroughTransition` (240 ms). PTY status overlay slides up from below with a 3-dot Rive bouncer for spawning state. Forge result triggers a tiny breathing pulse on the right-pane widget chip.

**Right pane.** Connection pill color tween (gray → amber → green) with a one-shot brand-ember radar ping on connect. Select-widget toggle pulses at 1.5 Hz when armed. New widget selection: props block fade-up (8 px slide + opacity, 240 ms); tree highlight slides between nodes with `AnimatedPositioned` 200 ms. Screenshot swap cross-fades with a blur falloff (4 → 0 px). Lightbox open is a `Hero` with custom `flightShuttleBuilder`. Tree expand/collapse via `AnimatedSize`. Discovered-devices list rows stagger-fade in.

**Cross-cutting.** Snackbars slide-up 280 ms with auto-dismiss progress bar. Modals scale-from-center 0.96 → 1.0 + fade. Empty states animate on mount. Skeletons shimmer at 1.6 s while loading.

### 6.3 Reduce-motion

Single global wrap: `MediaQuery.disableAnimations` short-circuits all `flutter_animate` chains, sets `Duration.zero` on `AnimatedContainer` / `AnimatedSwitcher`, pauses all `rive` state machines on the end frame. One widget test verifies this on `AppShellView`.

### 6.4 Performance budget

60 fps target. `RepaintBoundary` around terminal view, chats list, widget tree. Max two simultaneous hero animations; a third snaps the older to its end state. Total `.riv` payload < 200 KB.

## 7. Dependencies

Verified on pub.dev / Context7 on 2026-04-25. All `^MAJOR.MINOR.PATCH` to match repo convention.

| Package | Version | Publisher | License | Use |
|---|---|---|---|---|
| `xterm` | `^4.0.0` | terminal.studio | MIT | Terminal renderer |
| `flutter_pty` | `^0.4.2` | terminal.studio | MIT | Native PTY |
| `multi_split_view` | `^3.6.1` | caduandrade.net | MIT | Resizable panes |
| `file_selector` | `^1.1.0` | flutter.dev | BSD-3 | Folder picker |
| `flutter_animate` | `^4.5.2` | gskinner.com | BSD-3 | One-shot effects |
| `animations` | `^2.2.0` | flutter.dev | BSD-3 | Material Motion |
| `rive` | `^0.14.6` | rive.app | MIT | Hero state machines |

No new ANSI parser package — xterm has its own; if standalone stripping is needed, regex inline (~5 LoC).

`rive 0.14.6` brings `rive_native: 0.1.6` (native renderer with CMake build steps on Linux/Windows). Acceptable cost; first-party support means breakages get fixed fast.

## 8. Error handling

### PTY failures

- **Binary not on PATH** → `failed(BinaryNotFound)`. Status overlay shows install link for the agent. Other chats unaffected.
- **Agent crashes mid-session** → `failed(exitCode + lastOutputTail)` (PTY merges stdout and stderr — capture the last ~200 stripped chars from the unified stream) with Restart button. Persisted transcript intact; restart uses `--resume <sessionId>`.
- **Spawn timeout (> 8 s)** → `failed(SpawnTimeout)` with Retry.
- **Write to closed PTY** → toast "Agent isn't running — restart it first."

### VM service failures

- ECONNREFUSED / drop → existing reconnect loop with exponential backoff. Pill animates `↻ reconnecting…`. Active selection preserved.
- Stale token / wrong scheme → already fixed.

### Filesystem failures

- **Project root deleted on disk** → row stays in Drift, badge shows "missing folder," chat actions disabled until "Locate folder…" or "Remove from list."
- **Transcript write failure** (disk full, permissions) → recorder switches to in-memory ring buffer, non-blocking warning toast, PTY keeps working.
- **Transcript file corruption** on replay → skip bad tail, log warning, surface "earlier scrollback unavailable" notice.

### Drift migration failure

Wrapped in a transaction. On failure: rollback, recovery dialog with "Reset settings (keeps chats and history)" — quarantines old `pickforge.db` with a timestamp suffix. Transcript files survive any DB reset.

### File picker errors

`getDirectoryPath()` returning null is silent. Real errors surface as toasts.

### Edge cases

- Same `projectRoot` added twice → idempotent select.
- 30+ chats per project → soft warning at 50 live PTYs.
- Project switch while Forge is in flight → cancel the prompt-write, toast "Switched away — Forge cancelled," `.pickforge/` files untouched.
- Zero installed agent CLIs → onboarding shows install links + "Continue without agent" path. Inspector still works.
- Cross-platform path normalization → `path.canonicalize()` at insert time.
- Pickforge crash with running PTYs → OS reaps children. Transcripts are append-only with `fsync` at line boundaries; at most last partial line lost. Next launch shows chats as `parked`; activate replays + `--resume`.

## 9. Security

**Credential isolation is the load-bearing security property.** Pickforge never sees, stores, or transits agent credentials. Every CLI manages its own auth in its own config dir; OAuth and API-key prompts happen inside the agent's TUI. Documented as a non-goal: this design adds no credential management features.

**Transcript content** can contain user-pasted secrets or agent-read file contents. `.pickforge/.gitignore` is `*`. Transcripts never leave the device. "Export transcript" goes only to user-chosen local paths.

**Prompt injection via PTY output** — xterm renders ANSI but cannot escape into host-app context (it's a `CustomPainter`, not HTML). xterm's hardening defaults (OSC 52 clipboard hijack disabled, bracketed-paste echo disabled) are kept.

**File paths in widget context** — widget context is written to disk and read by the agent's own tools; no shell metacharacters reach argv. `Pty.start` takes `arguments` as an `execv`-style list — no shell, no quoting needed.

**Drift database** lives in the standard `path_provider` app-support dir.

**`file_selector.getDirectoryPath()`** returns absolute paths from native dialogs — `path.canonicalize()` is the only normalization needed.

## 10. Performance

- **Frame target** 60 fps. Debug assertion logs warning if any animation drops > 2 frames in 1 s; CI smoke-tests profile mode.
- **`RepaintBoundary`** around terminal view, chats list, widget tree, each pane's chrome.
- **PTY throughput** — recorder runs on dedicated `Isolate` (or microtask-queue `asyncMap`, profile-driven choice). Backpressure: recorder's write sink buffered; full buffer holds in memory rather than blocking the read end.
- **Replay** streams persisted bytes in 64 KB chunks at frame boundaries.
- **Per-chat memory** — ~10–40 MB (dominated by agent CLI subprocess); xterm buffer ~1–3 MB. Bounded by "all chats in active project alive."
- **Rive** — < 200 KB on disk; ~5 MB resident when state machines run.
- **Cold-start** target < 800 ms to first painted shell on 2019 baseline.
- **Project switch** target < 200 ms perceived (existing PTY SIGTERM grace runs in background).
- **Disk** — per-chat transcript cap 5 MB stripped + ~500 KB sidecar; head-truncate at 6 MB.

## 11. Testing

### 11.1 Unit (`test` + `mocktail`)

`PtySession`, `PtySessionPool`, `TranscriptRecorder` (ANSI corpus), `TranscriptReplayer` (truncation), `EmbeddedTerminalSettingsRepository`, `ProjectsRepository`, `ChatsRepository`, `ProjectsCubit`, `ChatsCubit`, `WorkbenchLayoutCubit`, refactored `ForgeCubit`. `flutter_pty.Pty` hidden behind a `PtyProcess` interface for mockability.

### 11.2 Bloc tests (`bloc_test`)

Same pattern as today. New cubits get `blocTest<T, S>(...)` suites covering happy path + each error branch.

### 11.3 Widget tests (`flutter_test`)

`AppShellView`, `ProjectsChatsPanel`, `ChatWorkbenchPanel`, `InspectorPanel`. Animation packages are mocked or short-circuited via reduce-motion.

### 11.4 Golden tests

Three-pane shell at default / narrow / right-collapsed; light + dark theme. Inspector panel for each pill state. Empty states. Generated on Linux for determinism, validated on Linux runner.

### 11.5 Integration test (`integration_test`)

Single happy-path: project select → chat select → write to PTY (stub agent script) → output appears in xterm → transcript file on disk contains stripped text. Skipped on default CI; runnable locally and in dedicated CI job.

### 11.6 Manual QA checklist

In implementation plan, not the spec. Covers: cold start, warm restart, project switch, chat switch, new chat, delete chat, agent crash + restart, VM disconnect during forge, very long output burst, reduce-motion behavior, light/dark theme, all three desktop platforms.

## 12. Rollout

Pre-1.0, no users — no feature flags, no staged rollout. Single PR (Approach 1 from brainstorming). Logical sub-commits:

1. Schema bump + new repositories.
2. New core terminal subsystem + unit tests (no UI yet).
3. Refactor `AgentLauncher.launch` → `prepareContext`. Rename wrapper-script-generator's surviving half.
4. Delete external-terminal subsystem + drop `defaultTerminalId` migration.
5. Add new packages; verify build on macOS / Linux / Windows.
6. New `lib/features/workbench/` shell, panels, cubits.
7. Animation pass. Author and commit Rive assets.
8. Wire router: remove `/connect`; redirect `/` to `/workbench` (or `/onboarding` if no projects exist); add `/workbench` and `/onboarding`.
9. Settings additions for embedded-terminal preferences.
10. Goldens + integration test.

Each sub-commit is independently buildable and testable.

## 13. Documentation

- README quick-start updated: drops terminal-profile detection; adds "Pickforge is the terminal" framing.
- One file `docs/architecture/embedded-terminal.md` summarizing PTY pool, scrollback persistence, and chat lifecycle for future contributors.
- Decision rationale lives in `NOTES.md` (multiple new entries dated 2026-04-25).

## 14. Out of scope

- Option B headless chat-adapter UX (logged in `NOTES.md`).
- ⌘K cross-chat search.
- Telemetry / Sentry crash reports.
- Phase 1.5 Pickforge MCP server.
- Multi-pane terminal splits / swarm UI.
- Auto-updater / codesigning / distribution.

## 15. Success criteria

- Forge It on a picked widget delivers the prompt to an embedded PTY; agent CLI's full TUI experience visible.
- Chat switch within active project < 100 ms perceived (no PTY respawn).
- Quitting and reopening Pickforge restores chat scrollback within 400 ms per chat.
- All tests green on macOS / Linux / Windows.
- No regressions in `WidgetPickerCubit`, VM service layer, or screenshot capture.
- Reduce-motion users see no animation, identical functional behavior.
