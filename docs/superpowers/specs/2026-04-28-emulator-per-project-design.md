# Emulator-per-Project Connection — Design

Date: 2026-04-28
Status: Approved (brainstorm phase)
Successor to: ad-hoc `ConnectionBloc` + manual VM-service URL paste

## 1. Goals

A Pickforge "project" binds to **one Android emulator (AVD)** chosen by the user. Selecting a project auto-attempts emulator/run setup, the right-pane connection pill is the single control surface, and the agent ↔ run-session loop (hot reload, screenshots, widget pick) becomes invisible to the user.

### Success criteria

- User picks AVD once per project; it sticks across Pickforge restarts.
- Selecting a project boots the bound AVD silently in the background; `flutter run` is an explicit click.
- Inspector lights up automatically when the VM service is reachable. No URL paste required for the auto path.
- Manual VM-service URL remains available as an escape hatch (already-running app, headless CI scenarios).
- Hot reload triggered by user (pill) or agent (IPC) is unified through one daemon-owned channel; both are visible in run logs with attribution.
- Switching projects parks the active `flutter run` cleanly; AVD stays booted.

### Non-goals (MVP)

See `NOTES.md` → "Emulator-per-project — deferred items from 2026-04-28 design" for the full deferred list. Salient ones: iOS Simulator, physical Android, web/desktop targets, multi-project concurrent runs, run-logs disk persistence, build-flavor pickers, Pickforge MCP server, run-session crash adoption.

## 2. User Flow

### First-time on a project

1. User opens project P (no `avdId` saved).
2. Shell mounts `EmulatorSessionCubit` for P → state `.noDevicePicked`.
3. Pill renders `○ Pick device`.
4. User clicks → `DevicePickerMenu` lists running AVDs and available AVDs (from `flutter emulators --machine` + `adb devices`).
5. User picks `Pixel_5_API_34` → cubit persists `avdId` + `avdName`, transitions to `.cold` (or `.idle` if AVD already running).
6. Pill renders `◐ Pixel_5_API_34 · boot` with primary action `▶ Boot`.
7. User clicks Boot → `.booting` → `AvdLauncher` + `BootReadinessPoller` → `.idle` → primary action `▶ Run app`.
8. User clicks Run app → `.running` once VM service URL arrives → inspector auto-attaches.

### Returning to a configured project

1. User selects project P (already has `avdId` and `autoBootOnSelect=true`).
2. Cubit reads settings:
   - AVD already running (per `adb devices`) → `.idle`.
   - Otherwise → `.booting` → boot in background.
3. User clicks `▶ Run app` when ready.

### Manual escape hatch

1. From any state, pill menu → `Manual VM Service URL…`.
2. Modal: paste URL → submit → `connectionMode='manual'`, persists URL, transitions directly to `.running(manual=true)`.
3. Inspector auto-attaches.
4. Pill displays `● Manual · ws://…:port`. Menu offers `Edit URL`, `Disconnect`, `Switch to AVD…`, `Forget URL`.

### Project switch (single-active rule)

1. Old `EmulatorSessionCubit` is disposed.
2. If state was `.running` or `.reconnecting` → `RunSessionController.stop()` (3s grace, then SIGTERM, then SIGKILL).
3. Row appended to `run_session_log` with `exitReason='project_switch'`.
4. AVD left running.
5. Toast: "Stopped <project Y> run."
6. New cubit bootstrapped for incoming project.

## 3. Pill State Machine

Seven states + manual-mode collapse.

```
              ┌── pick AVD ──► Cold
NoDevicePicked┤
              └── manual URL ─► Running(manual=true)

Cold ── boot ─► Booting ── ready ─► Idle ── run ─► Running ◄┐
                  │                    │            │       │
                  │ timeout/cancel     │ stop       │ vm    │ vm reconnect
                  ▼                    ▼            ▼ drop  │
                Error                Cold         Reconnecting
                                                   │
                                                   ├ ok ──┘
                                                   └ fail ► Error

Any state ──► Error          (recoverable via menu actions)
Any state ──► NoDevicePicked (only via "Forget device")
Project switch from any state ─► [park: kill flutter run, leave AVD, save state]
```

### State definitions

| State | Description | Primary action | Menu items |
|---|---|---|---|
| `NoDevicePicked` | Project never bound to an AVD | Pick device | List AVDs / Manual URL / Refresh |
| `Cold` | Bound AVD, not running | Boot AVD | Pick different / Manual URL / Forget |
| `Booting` | AVD boot in flight | Cancel | — |
| `Idle` | AVD running, no `flutter run` | Run app | Stop AVD / Pick different / Edit run args / Manual URL |
| `Running` | `flutter run --machine` live, VM attached | Hot reload | Hot restart / Stop / View logs / Edit run args / Reattach inspector |
| `Reconnecting` | VM service dropped, `ReconnectPolicy` active | Cancel reconnect | Stop / View logs |
| `Error` | Recoverable failure | Retry | View logs / Pick different / Manual URL / Forget |

Manual mode skips Cold/Booting/Idle: jumps directly to `Running` (or `Error`) on URL submit. Pill renders `Manual` instead of AVD name.

### Pill visuals (per state)

| State | Dot | Animation |
|---|---|---|
| NoDevicePicked | `○` outline | none |
| Cold | `◐` half | none |
| Booting | `◐` pulsing | 1.4s pulse loop |
| Idle | `●` green | none |
| Running | `●` green | 200ms scale-pulse on every successful hot reload |
| Reconnecting | `↻` spinning | rotating arc |
| Error | `✕` red | none |

State transitions animate with 180ms `FadeThrough` between widgets. All animations gated by `kAnimationsEnabled` and OS reduce-motion.

## 4. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                       features/emulator (UI)                        │
│  ConnectionPill ─ DevicePickerMenu ─ ManualUrlForm ─ RunLogsPane    │
│              └──────────────┬──────────────┘                        │
│                  EmulatorSessionCubit (7-state)                     │
└────────────────────┬─────────────────┬─────────────────────────────┘
                     │ commands        │ events
┌────────────────────▼─────────────────▼─────────────────────────────┐
│                       core/emulator (logic)                         │
│  DeviceDiscoveryService ─ AvdLauncher ─ BootReadinessPoller         │
│  RunSessionController ─ RunSessionLogRepository ─ EmulatorIpcServer │
│                       │                                             │
│                       └─► ProcessRunner (interface)                 │
└────────────────────┬───────────────────────────────────────────────┘
                     │
┌────────────────────▼───────────────────────────────────────────────┐
│                      core/vm_service (existing)                     │
│  VmServiceClient ─ ReconnectPolicy ─ InspectorExtensions            │
└────────────────────────────────────────────────────────────────────┘
```

### File layout

```
lib/core/emulator/
  device_discovery_service.dart   // flutter emulators + adb devices
  device_models.dart              // Avd, RunningAndroidDevice, sealed Device
  process_runner.dart             // ProcessRunner interface + Real impl
  avd_launcher.dart               // flutter emulators --launch + readiness poll glue
  boot_readiness_poller.dart      // adb getprop sys.boot_completed loop + name match
  run_session_controller.dart     // flutter run --machine JSON-RPC orchestrator
  run_session_models.dart         // freezed events: Started, Log, Progress, Stop
  run_session_log_repository.dart // Drift writes
  emulator_ipc_server.dart        // Unix socket / named pipe for agent MCP

lib/features/emulator/
  cubit/
    emulator_session_cubit.dart   // 7-state machine, owns lifecycle
    emulator_session_state.dart   // freezed sealed states
    device_picker_cubit.dart      // owns the in-memory AVD-list snapshot for the dropdown:
                                  // subscribes to DeviceDiscoveryService.watch(), exposes
                                  // running/available/refreshing state to DevicePickerMenu
  view/
    connection_pill.dart          // pill widget
    device_picker_menu.dart       // dropdown content
    run_logs_pane.dart            // structured event renderer
    manual_url_form.dart          // moved from features/connection
```

### Removed

- `lib/features/connection/` — `ConnectionBloc`, events, states, `vm_service_url_field.dart` (form moves to `features/emulator/view/manual_url_form.dart`).
- Any router routes pointing at the old `ConnectionView` (already removed; this just deletes lingering imports).

### Single source of truth

`EmulatorSessionCubit` is the only authority on session state. It composes stateless services (`AvdLauncher`, `RunSessionController`, etc.) and persists via `ProjectSettingsRepository` + `RunSessionLogRepository`. Scoped to the active project; recreated on project switch.

## 5. Process Orchestration

### `ProcessRunner` (test seam)

```dart
abstract class ProcessRunner {
  Future<ProcessResult> run(String exe, List<String> args, {String? cwd, Map<String, String>? env});
  Future<RunningProcess> spawn(String exe, List<String> args, {String? cwd, Map<String, String>? env});
}

abstract class RunningProcess {
  int get pid;
  Stream<List<int>> get stdout;
  Stream<List<int>> get stderr;
  Future<int> get exitCode;
  void writeStdin(List<int> bytes);
  Future<void> kill({ProcessSignal signal = ProcessSignal.sigterm});
}
```

Real impl wraps `dart:io` `Process`. Resolves executables via existing `UserShellEnvironment` so AVDs/Flutter resolved the same way as user shell. `FakeProcessRunner` (tests) replays canned responses or JSONL fixtures. DI: `@LazySingleton(as: ProcessRunner)`.

### `DeviceDiscoveryService`

```dart
class DeviceDiscoveryService {
  Future<List<Avd>> listAvds();
  Future<List<RunningAndroidDevice>> listRunningDevices();
  Stream<DeviceListSnapshot> watch({Duration interval = const Duration(seconds: 4)});
}
```

`watch()` polls only while pill menu is open. `listAvds` calls `flutter emulators --machine` (JSON). `listRunningDevices` calls `adb devices -l`. Snapshot composes both into `running`, `cold-only`, `running-only` views.

### `AvdLauncher`

Detached spawn of `flutter emulators --launch <id>`. Returned `RunningProcess` is held only for kill-on-cancel. Boot success/failure tracked by the next service.

### `BootReadinessPoller`

Polls `adb -s <serial> shell getprop sys.boot_completed` every 500ms (60s timeout). For each ready serial, calls `adb -s <serial> emu avd name` and matches against the requested `avdId`. Emits typed events: `pending`, `ready(serial)`, `timeout`, `cancelled`, `error`. After `boot_completed=1`, performs one extra `adb -s <serial> shell pm path android` check before declaring ready (covers AVDs that report boot complete before the package manager is up).

### `RunSessionController`

Heart of the run flow. Wraps `flutter run --machine` and exposes a typed `RunSession` handle.

```dart
class RunSession {
  String get sessionId;
  Stream<RunSessionEvent> get events;
  Future<void> hotReload();    // app.restart fullRestart=false
  Future<void> hotRestart();   // app.restart fullRestart=true
  Future<void> stop();         // app.stop, drain, exit
  Future<int> get exitCode;
  String? get appId;
  String? get vmServiceUri;
}

sealed class RunSessionEvent {
  // .stage(message)
  // .log(line, level)
  // .vmServiceReady(uri)
  // .stopped(exitCode, reason)
  // .reloadCompleted(success, fullRestart, durationMs, hint)
}
```

Pipeline:

```
flutter run --machine  →  stdout (lines)
                              │
                              ▼
                   JsonRpcLineDecoder  ← splits on \n, extracts envelope
                              │
                              ├──► request handler  (we send: app.restart, app.stop, app.detach)
                              ├──► event router    (app.start, app.started, app.progress, app.stop, daemon.logMessage)
                              └──► passthrough →   events stream
```

Plain non-JSON lines pre-bootstrap are tolerated and routed as `.log(line, info)`. Each request gets an incrementing id; a 30s soft timeout per request surfaces "still working…" without failing.

### `EmulatorIpcServer`

Local IPC for the agent MCP plugin. Unix socket on macOS/Linux at `$XDG_RUNTIME_DIR/pickforge-<pid>/agent.sock` (mode 0600). Windows named-pipe path designed but gated behind feature flag for v1.

Methods:

| Method | Returns | Notes |
|---|---|---|
| `getStatus` | `{state, vmServiceUri?, appId?}` | Cheap status check |
| `hotReload` | `{ok, durationMs, hint?}` | Routes to active `RunSession` |
| `hotRestart` | `{ok, durationMs}` | Same |
| `getVmServiceUri` | `string \| null` | For agents needing direct VM access |
| `getCurrentSelection` | `{path, line, widgetName} \| null` | Reads `WidgetPickerCubit` |

Each call publishes a `[agent]`-attributed event into `RunSessionEvent.log` so the user sees agent-driven activity in the same run-logs stream as their own.

Discovery: Pickforge writes the socket path to `<projectRoot>/.pickforge/ipc.sock-path` whenever a session binds. Agent MCP plugins read this path. Stale socket files cleaned up on `EmulatorIpcServer.start()`.

### Project-switch park-and-evict

```
1. Old EmulatorSessionCubit.dispose() called by shell
2. If state == .running or .reconnecting:
     a. await runSession.stop() with 3s timeout
     b. on timeout → SIGTERM, then SIGKILL after 1s
     c. write run_session_log row with exitReason='project_switch'
3. AvdLauncher detached process → leave alive
4. EmulatorIpcServer.bindActiveRunSession(null)
5. New cubit created → bootstrap
```

### Process supervision invariants

- No orphaned `flutter run` from Pickforge: cubit dispose, app quit, hot-restart-during-shutdown all path through `RunSessionController.stop()` + force-kill fallback.
- AVDs survive Pickforge crashes intentionally; on next launch `DeviceDiscoveryService` finds them and the cubit boots into `.idle`.
- Single global `flutter run`: second `.start()` throws `ConcurrentRunSessionError`; the cubit catches and stops the previous session first.

## 6. UI Surfaces

### `ConnectionPill`

Header of `InspectorPanel`. Single row, dense, monochrome with semantic accent. Compact label (AVD name or `Manual`), status verb, primary action button, dropdown menu (`▾`).

### `DevicePickerMenu`

Pill menu for picking AVDs. Sections: `RUNNING`, `AVAILABLE`. Dividers separate. Footer: `Manual VM Service URL…`, `Refresh list`. Empty state links to Android Studio docs and a refresh button.

Picking running AVD = bind + jump to `.idle`. Picking available AVD = bind + jump to `.cold`. Each choice persists `avdId` + `avdName`.

### `RunLogsPane`

Vertical split inside the middle pane (chat above, logs below; default 70/30; collapsible to 0). Renders `RunSessionEvent` stream as structured log:

- Categories: `build`, `vm`, `hot`, `log`, `err` — colored from terminal theme.
- Filter chips: `All`, `Build`, `Hot reload`, `Errors`. Per-project sticky.
- Auto-scroll-to-bottom when near bottom; pinned to top if user scrolled up.
- Right-click line: `Copy line` / `Copy from here` / `Send to agent` (drops the line into active chat compose).
- Header right buttons: `⊟` collapse, `⨯` stop run.
- 5k-event in-memory cap (per session). Persistence to disk is Phase 2.

### `ManualUrlForm`

Modal opened from pill menu. Single text field. Validates `ws://` or `wss://`, port range, basic format. Submit → `connectionMode='manual'`, persists, transitions to `.running(manual=true)`. Errors shown inline.

### Settings → Per-Project → Device & Run

New section in existing Settings page:

```
Device
─────
AVD                       [ Pixel_5_API_34          ▼ ]
Auto-boot on project select       [✓]

Run
───
Target file               [ lib/main.dart            ]
Extra arguments           (one per row, freeform)
                          [ --flavor dev             ]
                          [ --dart-define=FOO=bar    ]
                          [+ Add row]

Connection mode           ( ) AVD + auto-spawn
                          ( ) Manual URL
Manual URL                [ ws://...                 ]   (only when Manual)

[ Test connection ]                                  [ Reset device ]
```

`Reset device` clears `avdId` + `vmServiceUrl`, returns to `.noDevicePicked`.

### Status surface rules

- Pill is the only persistent status surface — no global toolbar status, no toast spam.
- Toasts only for: project-switch eviction, fatal env errors not actionable from pill (e.g. `flutter` missing on first boot).
- Ambient: middle-pane border glows accent for 1500ms after a hot reload; peripheral cue.

### Animation moments

| Moment | Animation | Package |
|---|---|---|
| Pill state transition | 180ms `FadeThrough` | `animations` |
| Booting dot | 1.4s pulse loop | `flutter_animate` |
| Reconnecting dot | rotating arc | `flutter_animate` |
| Hot-reload landed | 200ms scale-pulse + middle-pane border glow | `flutter_animate` |
| Run logs new line | 120ms slide-in (8px) + fade | `flutter_animate` |
| Run-logs pane collapse/expand | 240ms `SizeTransition` (spring) | Flutter built-in |
| Device picker menu open | 160ms scale + fade | `animations` |
| Run-success hero | One-time confetti/spark via Rive on the first successful run *for a given project on this Pickforge install* (flagged via `project_settings.firstRunCelebrated`) | `rive` |

All gated by `kAnimationsEnabled` + `ReduceMotion.of(context)`.

### Keyboard / accessibility

- `⌘.` / `Ctrl+.` opens pill menu from anywhere.
- `⌘R` / `Ctrl+R` hot reload (only when state `Running`).
- `⌘⇧R` / `Ctrl+Shift+R` hot restart.
- Pill is `Tab`-navigable, menu items via arrows, `Enter`/`Esc` to confirm/cancel.
- Screen-reader labels: `"Connection: <AvdName>, running. Hot reload available. Activate to reload."`

## 7. Data Model

### `project_settings` (existing — added columns)

```dart
TextColumn get avdId            => text().nullable()();
TextColumn get avdName          => text().nullable()();
TextColumn get connectionMode   => text().withDefault(const Constant('auto'))();
                                            // 'auto' | 'manual'
TextColumn get flutterRunArgs   => text().nullable()();   // JSON array of strings
TextColumn get targetFile       => text().nullable()();
BoolColumn get autoBootOnSelect => boolean().withDefault(const Constant(true))();
BoolColumn get firstRunCelebrated => boolean().withDefault(const Constant(false))();
```

`flutterRunArgs` stored as JSON array (preserves quoting). Repository encodes/decodes via `jsonEncode/jsonDecode`. `firstRunCelebrated` is a one-shot flag flipped to `true` after the Rive run-success hero plays so it never replays.

### `run_session_log` (new)

```dart
@DataClassName('RunSessionLogRow')
class RunSessionLog extends Table {
  TextColumn get sessionId       => text()();             // ulid PK
  TextColumn get projectRoot     => text()();
  DateTimeColumn get startedAt   => dateTime()();
  DateTimeColumn get endedAt     => dateTime().nullable()();
  TextColumn get avdId           => text().nullable()();
  TextColumn get avdName         => text().nullable()();
  TextColumn get serial          => text().nullable()();
  TextColumn get vmServiceUrl    => text().nullable()();
  TextColumn get connectionMode  => text()();
  TextColumn get exitReason      => text().nullable()();
  IntColumn get exitCode         => integer().nullable()();
  IntColumn get hotReloadCount   => integer().withDefault(const Constant(0))();
  IntColumn get hotRestartCount  => integer().withDefault(const Constant(0))();
  IntColumn get errorCount       => integer().withDefault(const Constant(0))();
  TextColumn get lastError       => text().nullable()();  // truncated 500 chars

  @override Set<Column> get primaryKey => {sessionId};
}
```

`exitReason` values: `user_stop` | `crash` | `project_switch` | `pickforge_quit` | `boot_timeout` | `vm_unreachable` | `flutter_run_failed`.

Index: `(projectRoot, startedAt DESC)` for "last run" lookup.

Pruning: keep last 100 rows per `projectRoot`. Run on insert.

### Migration

Schema version +1.

```dart
m.addColumn(projectSettings, projectSettings.avdId);
m.addColumn(projectSettings, projectSettings.avdName);
m.addColumn(projectSettings, projectSettings.connectionMode);
m.addColumn(projectSettings, projectSettings.flutterRunArgs);
m.addColumn(projectSettings, projectSettings.targetFile);
m.addColumn(projectSettings, projectSettings.autoBootOnSelect);
m.addColumn(projectSettings, projectSettings.firstRunCelebrated);
m.createTable(runSessionLog);
m.createIndex(Index('idx_run_session_log_project_started',
  'CREATE INDEX idx_run_session_log_project_started '
  'ON run_session_log (project_root, started_at DESC)'));
```

Backfill: `UPDATE project_settings SET connection_mode='manual' WHERE vm_service_url IS NOT NULL`. Pre-migration users were all manual-URL by definition; this preserves their flow.

### Repository surface

`ProjectSettingsRepository` adds:

```dart
Future<EmulatorBinding?> getEmulatorBinding(String projectRoot);
Future<void> setEmulatorBinding(String projectRoot, EmulatorBinding binding);
Future<void> clearEmulatorBinding(String projectRoot);

Future<RunArgs> getRunArgs(String projectRoot);
Future<void> setRunArgs(String projectRoot, RunArgs args);
```

Where:

```dart
@freezed
class EmulatorBinding with _$EmulatorBinding {
  const factory EmulatorBinding.avd({
    required String avdId,
    required String avdName,
    @Default(true) bool autoBootOnSelect,
  }) = _AvdBinding;
  const factory EmulatorBinding.manual({
    required String vmServiceUrl,
  }) = _ManualBinding;
}

@freezed
class RunArgs with _$RunArgs {
  const factory RunArgs({
    String? targetFile,
    @Default([]) List<String> extraArgs,
  }) = _RunArgs;
}
```

`RunSessionLogRepository`:

```dart
@lazySingleton
class RunSessionLogRepository {
  Future<void> recordStart(RunSessionLogRow row);
  Future<void> recordEnd({
    required String sessionId,
    required DateTime endedAt,
    required String exitReason,
    int? exitCode,
    int hotReloadCount = 0,
    int hotRestartCount = 0,
    int errorCount = 0,
    String? lastError,
  });
  Stream<List<RunSessionLogRow>> watchRecent(String projectRoot, {int limit = 20});
  Future<RunSessionLogRow?> latestFor(String projectRoot);
}
```

`recordEnd` is idempotent — re-applying the same `sessionId` updates the same row.

### Cache vs. authoritative

- AVD list = in-memory cache only, refreshed on demand. Never persisted.
- `avdName` is persisted alongside `avdId` so the pill renders instantly on project select. If the AVD has been renamed/removed, pill renders the cached name briefly, then `DeviceDiscoveryService` corrects state to `.error("AVD not found")`.

### Filesystem artifacts

`<projectRoot>/.pickforge/`:

```
ipc.sock-path     ← absolute path to current Pickforge IPC socket
run-state.json    ← {sessionId, vmServiceUri, appId, startedAt, avdName} live mirror
                   (deleted on session end)
```

Both match the existing auto-generated `.pickforge/.gitignore` rule.

### Scope split

| Where | What |
|---|---|
| Drift `project_settings` | Per-project: avdId, runArgs, target, mode, autoBoot |
| Drift `run_session_log` | Per-project run history |
| `shared_preferences` | Global last-active-project (existing); nothing new |
| `.pickforge/` files | Live runtime: socket path, run-state mirror |

### Not persisted

- `EmulatorSessionState` — reconstructed at bootstrap from `EmulatorBinding` + live `DeviceDiscoveryService` snapshot.
- `RunSessionEvent` log lines — in-memory only, capped 5k events. Drift only stores summary in `run_session_log`.
- AVD list — re-fetched.

## 8. Error Handling

| Error | Surface | Block? |
|---|---|---|
| `flutter` not on PATH | First-run banner + Settings "Flutter SDK" field | Block all auto modes |
| `adb` not on PATH | Pill error + Settings "Android SDK" field | Block AVD list, allow manual URL |
| No AVDs found | Pill menu shows "No AVDs — create one in Android Studio" link | Allow manual URL |
| AVD boot timeout (60s) | Pill `.error` + run-logs error toast | Don't block, retry |
| `flutter run --machine` exits non-zero | Run-logs pane shows last N stderr + `.error` | Don't block, "View logs" |
| VM URL never arrives (90s after `app.start`) | `.error`, kill `flutter run`, "Likely build failure — see logs" | Don't block |
| VM service drops mid-run | `.reconnecting` via existing `ReconnectPolicy`, fall to `.running` or `.error` | Don't block |
| Manual URL invalid | Inline form error | Don't block |
| Disk full / permission writing `.pickforge/` | Modal dialog | Block project until resolved |

Principle: only environment misconfig (no `flutter`/`adb`, no disk) blocks. Everything runtime is recoverable + visible in logs.

## 9. Testing

### Unit (CI, every push, <2s)

| Subject | Fakes | Coverage |
|---|---|---|
| `DeviceDiscoveryService` | `FakeProcessRunner` returning canned `flutter emulators --machine` JSON + `adb devices` text | parse happy path, malformed JSON, empty list, ENOENT, AVD↔running merge |
| `RunSessionController` | `FakeProcessRunner` replaying `test/fixtures/flutter_run_machine_pixel5.jsonl` | event sequencing, vmServiceUri extraction, app.restart, daemon.logMessage routing, non-JSON tolerance, exit-code propagation |
| `BootReadinessPoller` | `FakeProcessRunner` scripted: `0\n` 5x then `1\n`, then `Pixel_5_API_34\n` | timeout, cancel, success, AVD-name mismatch, multiple-emulator race |
| `AvdLauncher` | `FakeProcessRunner` | launch detached, kill-on-cancel cleanup |
| `EmulatorIpcServer` | in-memory localhost socket pair | request routing, agent attribution, `getStatus`, `hotReload` routes to bound session, error when unbound |
| `EmulatorSessionCubit` | mock services | every transition (Section 3 graph), bootstrap branches, project-switch dispose, cancel during boot/run, error states |
| `ProjectSettingsRepository` (delta) | in-memory Drift | new typed accessors round-trip, manual-URL backfill migration |
| `RunSessionLogRepository` | in-memory Drift | recordStart/End idempotency, watchRecent ordering, prune cap |

### Widget (CI, <10s)

- `ConnectionPill` golden snapshot per state (7 + manual + reload-pulse mid-frame).
- `DevicePickerMenu` goldens: empty, running-only, mixed, refreshing.
- `RunLogsPane` golden on canned 50-event stream + filter chips toggle.
- `ManualUrlForm` validation + submit.
- Animation budget tests with `kAnimationsEnabled=false` → instant transitions, no leaked controllers.

### Integration (opt-in, `flutter test --tags emulator`, ~60s)

- Live AVD `Pickforge_Test_API_34` (created once via `tool/setup_test_avd.dart`).
- Round trip: pick → boot → run sample app under `test/fixtures/sample_flutter_app/` → assert `vmServiceUri` arrives → fire hot reload → assert `RunStats.hotReloadCount == 1` → stop → assert `run_session_log` row.
- Error path: kill `flutter run` mid-flight via PID, assert `.error` with `exitReason='crash'`.

### Smoke (manual, pre-release)

- Real AVD on macOS + Linux (Windows deferred per Section 12 risk).
- Project switch with active run → assert clean park, AVD survives.
- Pickforge SIGKILL during run → relaunch → AVD detected, state `.idle`.

### Fixtures

- `test/fixtures/flutter_run_machine_pixel5.jsonl` — captured via `dart tool/capture_flutter_run.dart`. Re-record on Flutter SDK minor bumps; CI lint warns if older than 12 weeks.
- `test/fixtures/adb_devices_*.txt` — parser variants.
- `test/fixtures/flutter_emulators.json` — captured `flutter emulators --machine`.

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `flutter run --machine` event shape changes between Flutter versions | Med | High | Re-record fixtures + diff in CI lint; integration test catches end-to-end |
| `adb` output format drift across versions | Low-Med | Med | Tolerant parser (regex on `\S+\s+device` lines, ignore extras); fixtures cover platform-tools 33+, 34+ |
| AVD boots but `sys.boot_completed=1` fires before `pm` is up | Med | Med | Extra `pm path android` check before `.idle` (one extra adb call, ~100ms) |
| Multiple Flutter installs (system + fvm) — wrong `flutter` resolved | Med | High | `ProcessRunner` resolves via `UserShellEnvironment.resolveExecutable('flutter')`; logs path in `run_session_log`; Settings shows resolved path |
| Windows ConPTY / named-pipe IPC quirks | Med | Med | Phase Windows behind feature flag; macOS + Linux first; documented in NOTES |
| `$ANDROID_HOME` unset → `flutter emulators` returns empty | Med | Low | Empty-state UI links to Android Studio docs; Settings field to set `ANDROID_HOME` manually |
| Hot-reload race: user clicks reload while previous still pending | Low | Low | `RunSessionController.hotReload()` queues at most 1 pending; second call coalesces, returns the same Future |
| Agent IPC + UI fire reload simultaneously | Low | Med | Same queue handles both; attribution preserved (first wins, second tagged `coalesced=true` in log) |
| `flutter run` hangs on install (large app, slow emulator) | Med | Low | 90s `app.started` timeout; pill shows "Likely build failure — see logs" with run-logs auto-revealed |
| User deletes AVD between project select and Run click | Low | Low | `flutter emulators --launch` returns non-zero; cubit catches, refreshes list, transitions to `.error("AVD not found")`, forces re-pick |
| IPC socket leak across crashes | Low | Low | `EmulatorIpcServer.start()` removes stale sockets at boot; pid-suffixed dir avoids collision |

## 11. Rollout

Implementation phasing is the job of the writing-plans skill (next step). Tentative order:

1. Foundation — `ProcessRunner`, `DeviceDiscoveryService`, `BootReadinessPoller`, Drift schema + migration.
2. Run controller — `RunSessionController`, `AvdLauncher`. Recorded fixture-driven tests.
3. Cubit + minimal pill — `EmulatorSessionCubit`, `ConnectionPill` (states only). Wires `VmServiceClient.connect` on `vmServiceReady`.
4. Pill menu + DevicePicker + ManualUrlForm.
5. Run-logs pane (vertical split inside middle pane, structured renderer).
6. IPC server + `.pickforge/ipc.sock-path`.
7. Settings page additions.
8. Animations + polish.
9. Delete dead code (`lib/features/connection/`).
10. Smoke + integration suite.

Each phase ends green: analyze + unit + widget passing.

## 12. Out of Scope

See `NOTES.md` → "Emulator-per-project — deferred items from 2026-04-28 design" for the canonical deferred list:

- Multi-project parallel runs.
- Run-logs persistence to disk + Run History UI.
- Build-flavor / target picker UI (text-only in MVP).
- Power AVD flags (`-no-audio`, `-gpu swiftshader`, etc.).
- Windows IPC named pipes (gated behind feature flag for v1).
- Inspector auto-attach short-circuit when right pane collapsed.
- iOS Simulator, physical Android, web, desktop targets.
- Pickforge MCP server consuming the IPC contract (separate repo).
- Run-session crash recovery via adoption.
- Per-project AVD auto-shutdown.

## 13. Open Items for Plan

- Decide whether the `EmulatorIpcServer` socket-path file lives in `<projectRoot>/.pickforge/` (project-scoped, easy for agents to find via cwd) or in a global Pickforge runtime dir (single, even when no project selected). Current design picks per-project; revisit during implementation if the agent MCP plugin needs cross-project discovery.
- Confirm whether `DeviceDiscoveryService.watch()`'s 4s poll interval is sufficient or needs `inotify`/`adb track-devices` upgrade in the same MVP; current design says yes-poll.
- ULID generator: pick `package:ulid` vs. inline implementation; tiny dependency call, decide in plan.
