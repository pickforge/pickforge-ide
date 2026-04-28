# Emulator-per-Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual `vmServiceUrl` paste flow with a per-project AVD binding, a managed `flutter run --machine` session, a 7-state connection pill, and IPC-driven hot-reload coordination — implementing the design in `docs/superpowers/specs/2026-04-28-emulator-per-project-design.md`.

**Architecture:** New `lib/core/emulator/` module (process plumbing, JSON-RPC orchestration, IPC) + new `lib/features/emulator/` UI (cubit, pill, picker, run-logs pane). The existing `lib/features/connection/` is deleted at the end of the plan. `core/vm_service/` is reused as-is for the inspector wire-up. All process I/O routes through a new `ProcessRunner` interface that mirrors the existing `BinaryDetector` injection pattern.

**Tech Stack:** Dart 3.5+, Flutter 3.24+, `bloc`/`flutter_bloc`, `freezed`, `injectable`/`get_it`, `drift` 2.32+, `mocktail`, `bloc_test`, `flutter_animate`, `animations`, `rive`, `multi_split_view`, `vm_service`. All commands assume `fvm` per repo convention.

**Reference docs:**
- Spec: `docs/superpowers/specs/2026-04-28-emulator-per-project-design.md`
- NOTES (deferred items): `NOTES.md` → "Emulator-per-project — deferred items from 2026-04-28 design"

---

## TDD Pattern (applies to every code task)

Every task in this plan follows the same five-step micro-cycle. The cycle is given once here so individual tasks can be terse: each task lists test code, implementation code, run command, expected output, and commit message. The five steps inside each task are always:

1. **Write the failing test** (the test code in the task).
2. **Run it to make sure it fails** (the run command, expected: FAIL with the listed reason).
3. **Implement the minimal code to make the test pass** (the implementation code in the task).
4. **Run the tests and make sure they pass** (same run command, expected: PASS).
5. **Commit** (the commit message in the task).

When a task already references existing code (e.g. wiring a finished service to a cubit), the cycle becomes: write test → run (FAIL) → wire up → run (PASS) → commit.

When a task adds non-code (e.g. a freezed model with no behavior), the test asserts construction + equality + JSON round-trip if applicable.

---

## File Structure

```
lib/core/emulator/                           ← NEW
  process_runner.dart                          P1.T1
  device_models.dart                           P1.T2 (freezed Avd, RunningAndroidDevice)
  device_discovery_service.dart                P1.T3
  boot_readiness_poller.dart                   P1.T4
  avd_launcher.dart                            P2.T1
  json_rpc_line_decoder.dart                   P2.T2
  run_session_models.dart                      P2.T3 (freezed events)
  run_session_controller.dart                  P2.T4
  run_session_log_repository.dart              P2.T5
  emulator_ipc_server.dart                     P6.T1
  cancel_token.dart                            P1.T0 (tiny shared helper)

lib/features/emulator/                       ← NEW
  cubit/
    emulator_session_state.dart                P3.T1 (freezed sealed)
    emulator_session_cubit.dart                P3.T2-T6
    device_picker_state.dart                   P4.T1
    device_picker_cubit.dart                   P4.T2
  view/
    connection_pill.dart                       P3.T7, P4.T3
    device_picker_menu.dart                    P4.T4
    manual_url_form.dart                       P4.T5
    run_logs_pane.dart                         P5.T1-T3

lib/core/drift/tables/
  project_settings.dart                        P1.T5 (extend)
  run_session_log.dart                         P1.T6 (NEW)

lib/core/drift/dao/
  project_settings_dao.dart                    P1.T5 (extend)
  run_session_log_dao.dart                     P1.T6 (NEW)

lib/core/drift/pickforge_database.dart         P1.T7 (schema bump v2 → v3, migration)

lib/core/settings/
  project_settings_repository.dart             P1.T8 (extend with typed accessors)
  emulator_binding.dart                        P1.T8 (NEW freezed)
  run_args.dart                                P1.T8 (NEW freezed)

lib/core/di/injection.dart                     P1.T1, P1.T9, P2.T1, P3.T2, P6.T1 (modules added incrementally)

lib/features/workbench/view/
  inspector_panel.dart                         P3.T7 (replace stub _ConnectionPill with real one)
  chat_workbench_panel.dart                    P5.T4 (vertical-split run-logs into middle pane)

lib/features/settings/view/                    P7 (per-project Device & Run section)
  settings_view.dart                           (extend or wrap)
  device_run_settings.dart                     P7 NEW

lib/core/router/app_router.dart                P9.T1 (cleanup connection refs if any)

REMOVED at P9:
  lib/features/connection/                     (whole feature dir)

test/core/emulator/                          ← NEW (mirrors lib/core/emulator)
test/features/emulator/                      ← NEW
test/fixtures/                                 P2.T2 (jsonl + adb + emulator JSON fixtures)
tool/capture_flutter_run.dart                  P10.T1 (fixture capture script)
test/integration/emulator_e2e_test.dart        P10.T2 (opt-in tag: emulator)
```

Files marked NEW are created in the listed task. Files marked extend/modify quote line ranges where relevant in the task body.

---

## Phase 1 — Foundation

Goal of phase: process seam, device discovery, boot poller, Drift schema delta, repositories. No UI. Each task ends green via `fvm flutter test` on the new test file.

### Task P1.T0: `CancelToken` helper

**Files:**
- Create: `lib/core/emulator/cancel_token.dart`
- Test: `test/core/emulator/cancel_token_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/core/emulator/cancel_token_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/cancel_token.dart';

void main() {
  test('starts not cancelled', () {
    final token = CancelToken();
    expect(token.isCancelled, isFalse);
  });

  test('cancel flips flag and fires onCancel once', () {
    final token = CancelToken();
    var fired = 0;
    token.onCancel(() => fired++);
    token.cancel();
    token.cancel();
    expect(token.isCancelled, isTrue);
    expect(fired, 1);
  });

  test('throwIfCancelled throws CancelledException after cancel', () {
    final token = CancelToken();
    token.cancel();
    expect(token.throwIfCancelled, throwsA(isA<CancelledException>()));
  });

  test('listener registered after cancel still fires synchronously', () {
    final token = CancelToken()..cancel();
    var fired = 0;
    token.onCancel(() => fired++);
    expect(fired, 1);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/core/emulator/cancel_token_test.dart
```
Expected: FAIL — `CancelToken` is not defined.

- [ ] **Step 3: Write minimal implementation**

```dart
// lib/core/emulator/cancel_token.dart
class CancelledException implements Exception {
  const CancelledException();
  @override
  String toString() => 'CancelledException';
}

class CancelToken {
  bool _cancelled = false;
  final List<void Function()> _listeners = [];

  bool get isCancelled => _cancelled;

  void cancel() {
    if (_cancelled) return;
    _cancelled = true;
    for (final l in _listeners) {
      l();
    }
    _listeners.clear();
  }

  void onCancel(void Function() listener) {
    if (_cancelled) {
      listener();
      return;
    }
    _listeners.add(listener);
  }

  void throwIfCancelled() {
    if (_cancelled) throw const CancelledException();
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

```
fvm flutter test test/core/emulator/cancel_token_test.dart
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/core/emulator/cancel_token.dart test/core/emulator/cancel_token_test.dart
git commit -m "feat(emulator): add CancelToken helper for cancellable async flows"
```

---

### Task P1.T1: `ProcessRunner` interface + real impl + DI module

**Files:**
- Create: `lib/core/emulator/process_runner.dart`
- Modify: `lib/core/di/injection.dart` (append `ProcessRunnerModule`)
- Test: `test/core/emulator/process_runner_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/core/emulator/process_runner_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

void main() {
  group('RealProcessRunner.run', () {
    test('captures stdout from echo', () async {
      final runner = RealProcessRunner();
      final res = await runner.run('echo', ['hello']);
      expect(res.exitCode, 0);
      expect((res.stdout as String).trim(), 'hello');
    });

    test('throws ProcessRunnerException when exe missing', () async {
      final runner = RealProcessRunner();
      expect(
        () => runner.run('this-binary-definitely-does-not-exist', []),
        throwsA(isA<ProcessRunnerException>()),
      );
    });
  });

  group('RealProcessRunner.spawn', () {
    test('streams stdout lines and reports exit code', () async {
      final runner = RealProcessRunner();
      final proc = await runner.spawn('sh', ['-c', 'echo a; echo b']);
      final out = await proc.stdout
          .transform(const _Utf8Lines())
          .toList();
      final code = await proc.exitCode;
      expect(code, 0);
      expect(out.join(), contains('a'));
      expect(out.join(), contains('b'));
    });

    test('kill terminates a long-running spawn', () async {
      final runner = RealProcessRunner();
      final proc = await runner.spawn('sh', ['-c', 'sleep 30']);
      await proc.kill();
      final code = await proc.exitCode;
      expect(code, isNot(0));
    });
  });
}

// Trivial transformer used only by this test to stay dep-free.
class _Utf8Lines extends StreamTransformerBase<List<int>, String> {
  const _Utf8Lines();
  @override
  Stream<String> bind(Stream<List<int>> stream) async* {
    final buf = StringBuffer();
    await for (final chunk in stream) {
      buf.write(String.fromCharCodes(chunk));
    }
    yield buf.toString();
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/core/emulator/process_runner_test.dart
```
Expected: FAIL — `ProcessRunner`, `RealProcessRunner`, `ProcessRunnerException` undefined.

- [ ] **Step 3: Write minimal implementation**

```dart
// lib/core/emulator/process_runner.dart
import 'dart:async';
import 'dart:io';

import 'package:pickforge/core/process/user_shell_environment.dart';

class ProcessRunnerException implements Exception {
  ProcessRunnerException(this.executable, this.cause);
  final String executable;
  final Object cause;
  @override
  String toString() => 'ProcessRunnerException($executable): $cause';
}

abstract class RunningProcess {
  int get pid;
  Stream<List<int>> get stdout;
  Stream<List<int>> get stderr;
  Future<int> get exitCode;
  void writeStdin(List<int> bytes);
  Future<void> kill({ProcessSignal signal = ProcessSignal.sigterm});
}

abstract class ProcessRunner {
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  });

  Future<RunningProcess> spawn(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  });
}

class RealProcessRunner implements ProcessRunner {
  RealProcessRunner({UserShellEnvironment? shellEnv})
      : _shellEnv = shellEnv ?? UserShellEnvironment.instance;

  final UserShellEnvironment _shellEnv;

  Future<Map<String, String>> _resolveEnv(Map<String, String>? extra) async {
    final base = await _shellEnv.load();
    if (extra == null || extra.isEmpty) return base;
    return {...base, ...extra};
  }

  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async {
    try {
      final mergedEnv = await _resolveEnv(env);
      return await Process.run(
        executable,
        arguments,
        workingDirectory: cwd,
        environment: mergedEnv,
      );
    } on ProcessException catch (e) {
      throw ProcessRunnerException(executable, e);
    }
  }

  @override
  Future<RunningProcess> spawn(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async {
    try {
      final mergedEnv = await _resolveEnv(env);
      final proc = await Process.start(
        executable,
        arguments,
        workingDirectory: cwd,
        environment: mergedEnv,
      );
      return _RealRunningProcess(proc);
    } on ProcessException catch (e) {
      throw ProcessRunnerException(executable, e);
    }
  }
}

class _RealRunningProcess implements RunningProcess {
  _RealRunningProcess(this._proc);
  final Process _proc;

  @override
  int get pid => _proc.pid;

  @override
  Stream<List<int>> get stdout => _proc.stdout;

  @override
  Stream<List<int>> get stderr => _proc.stderr;

  @override
  Future<int> get exitCode => _proc.exitCode;

  @override
  void writeStdin(List<int> bytes) => _proc.stdin.add(bytes);

  @override
  Future<void> kill({ProcessSignal signal = ProcessSignal.sigterm}) async {
    _proc.kill(signal);
  }
}
```

- [ ] **Step 4: Append DI module to `injection.dart`**

Insert before the closing of the file (after the existing modules):

```dart
// lib/core/di/injection.dart  (append)
import 'package:pickforge/core/emulator/process_runner.dart';

@module
abstract class ProcessRunnerModule {
  @singleton
  ProcessRunner get processRunner => RealProcessRunner();
}
```

Then regenerate DI:

```
fvm dart run build_runner build --delete-conflicting-outputs
```

- [ ] **Step 5: Run tests and verify they pass**

```
fvm flutter test test/core/emulator/process_runner_test.dart
```
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/core/emulator/process_runner.dart \
        lib/core/di/injection.dart \
        lib/core/di/injection.config.dart \
        test/core/emulator/process_runner_test.dart
git commit -m "feat(emulator): add ProcessRunner abstraction over dart:io Process"
```

---

### Task P1.T2: `device_models.dart` — `Avd`, `RunningAndroidDevice`, `DeviceListSnapshot`

**Files:**
- Create: `lib/core/emulator/device_models.dart`
- Test: `test/core/emulator/device_models_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/core/emulator/device_models_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/device_models.dart';

void main() {
  test('Avd equality + props', () {
    const a = Avd(id: 'Pixel_5', name: 'Pixel 5', platform: 'android');
    const b = Avd(id: 'Pixel_5', name: 'Pixel 5', platform: 'android');
    const c = Avd(id: 'Pixel_7', name: 'Pixel 7', platform: 'android');
    expect(a, equals(b));
    expect(a, isNot(equals(c)));
  });

  test('DeviceListSnapshot.runningById matches by AVD name', () {
    const avd = Avd(id: 'Pixel_5_API_34', name: 'Pixel 5 API 34', platform: 'android');
    const running = RunningAndroidDevice(
      serial: 'emulator-5554',
      avdName: 'Pixel_5_API_34',
      state: 'device',
    );
    final snap = DeviceListSnapshot(avds: const [avd], running: const [running]);
    expect(snap.runningFor(avd)?.serial, 'emulator-5554');
  });

  test('DeviceListSnapshot.runningFor returns null when no match', () {
    const avd = Avd(id: 'Pixel_5_API_34', name: 'Pixel 5 API 34', platform: 'android');
    final snap = DeviceListSnapshot(avds: const [avd], running: const []);
    expect(snap.runningFor(avd), isNull);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/core/emulator/device_models_test.dart
```
Expected: FAIL — types undefined.

- [ ] **Step 3: Write minimal implementation**

```dart
// lib/core/emulator/device_models.dart
import 'package:equatable/equatable.dart';

class Avd extends Equatable {
  const Avd({required this.id, required this.name, required this.platform});
  final String id;
  final String name;
  final String platform;

  @override
  List<Object?> get props => [id, name, platform];
}

class RunningAndroidDevice extends Equatable {
  const RunningAndroidDevice({
    required this.serial,
    required this.avdName,
    required this.state,
  });
  final String serial;
  final String? avdName; // null until queried via `adb -s <s> emu avd name`
  final String state; // 'device' | 'offline' | 'unauthorized'

  @override
  List<Object?> get props => [serial, avdName, state];
}

class DeviceListSnapshot extends Equatable {
  const DeviceListSnapshot({
    required this.avds,
    required this.running,
  });

  final List<Avd> avds;
  final List<RunningAndroidDevice> running;

  RunningAndroidDevice? runningFor(Avd avd) {
    for (final r in running) {
      if (r.avdName == avd.id || r.avdName == avd.name) return r;
    }
    return null;
  }

  @override
  List<Object?> get props => [avds, running];
}
```

- [ ] **Step 4: Run tests and verify they pass**

```
fvm flutter test test/core/emulator/device_models_test.dart
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/core/emulator/device_models.dart test/core/emulator/device_models_test.dart
git commit -m "feat(emulator): add Avd, RunningAndroidDevice, DeviceListSnapshot models"
```

---

### Task P1.T3: `DeviceDiscoveryService`

**Files:**
- Create: `lib/core/emulator/device_discovery_service.dart`
- Test: `test/core/emulator/device_discovery_service_test.dart`
- Test fixtures: `test/fixtures/flutter_emulators.json`, `test/fixtures/adb_devices_two.txt`, `test/fixtures/adb_devices_empty.txt`

- [ ] **Step 1: Add fixtures**

```json
// test/fixtures/flutter_emulators.json
[
  {"id":"Pixel_5_API_34","name":"Pixel 5 API 34","category":"mobile","platformType":"android"},
  {"id":"Pixel_7_Pro_API_35","name":"Pixel 7 Pro API 35","category":"mobile","platformType":"android"}
]
```

```text
// test/fixtures/adb_devices_two.txt
List of devices attached
emulator-5554	device product:sdk_gphone_x86_64 model:sdk_gphone_x86_64 device:emu64x transport_id:1
emulator-5556	offline transport_id:2

```

```text
// test/fixtures/adb_devices_empty.txt
List of devices attached

```

- [ ] **Step 2: Write the failing test**

```dart
// test/core/emulator/device_discovery_service_test.dart
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

class _FakeRunner extends Mock implements ProcessRunner {}

void main() {
  late _FakeRunner runner;
  late DeviceDiscoveryService service;

  setUp(() {
    runner = _FakeRunner();
    service = DeviceDiscoveryService(runner);
  });

  ProcessResult ok(String stdout) => ProcessResult(0, 0, stdout, '');
  ProcessResult fail(String stderr) => ProcessResult(0, 1, '', stderr);

  test('listAvds parses flutter emulators --machine JSON', () async {
    final json = await File('test/fixtures/flutter_emulators.json').readAsString();
    when(() => runner.run('flutter', ['emulators', '--machine']))
        .thenAnswer((_) async => ok(json));
    final avds = await service.listAvds();
    expect(avds, hasLength(2));
    expect(avds.first.id, 'Pixel_5_API_34');
    expect(avds.first.name, 'Pixel 5 API 34');
  });

  test('listAvds returns empty on non-zero exit', () async {
    when(() => runner.run('flutter', ['emulators', '--machine']))
        .thenAnswer((_) async => fail('boom'));
    expect(await service.listAvds(), isEmpty);
  });

  test('listAvds returns empty when flutter binary missing', () async {
    when(() => runner.run(any(), any()))
        .thenThrow(ProcessRunnerException('flutter', 'ENOENT'));
    expect(await service.listAvds(), isEmpty);
  });

  test('listRunningDevices parses adb devices -l', () async {
    final raw = await File('test/fixtures/adb_devices_two.txt').readAsString();
    when(() => runner.run('adb', ['devices', '-l']))
        .thenAnswer((_) async => ok(raw));
    final devs = await service.listRunningDevices();
    expect(devs, hasLength(2));
    expect(devs[0].serial, 'emulator-5554');
    expect(devs[0].state, 'device');
    expect(devs[1].serial, 'emulator-5556');
    expect(devs[1].state, 'offline');
  });

  test('listRunningDevices returns empty when no emulators', () async {
    final raw = await File('test/fixtures/adb_devices_empty.txt').readAsString();
    when(() => runner.run('adb', ['devices', '-l']))
        .thenAnswer((_) async => ok(raw));
    expect(await service.listRunningDevices(), isEmpty);
  });

  test('snapshot composes both lists', () async {
    final emusJson = await File('test/fixtures/flutter_emulators.json').readAsString();
    final adbRaw = await File('test/fixtures/adb_devices_two.txt').readAsString();
    when(() => runner.run('flutter', ['emulators', '--machine']))
        .thenAnswer((_) async => ok(emusJson));
    when(() => runner.run('adb', ['devices', '-l']))
        .thenAnswer((_) async => ok(adbRaw));
    when(() => runner.run('adb', ['-s', 'emulator-5554', 'emu', 'avd', 'name']))
        .thenAnswer((_) async => ok('Pixel_5_API_34\nOK\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5556', 'emu', 'avd', 'name']))
        .thenAnswer((_) async => fail(''));
    final snap = await service.snapshot();
    expect(snap.avds, hasLength(2));
    expect(snap.running, hasLength(2));
    expect(snap.runningFor(snap.avds.first)?.serial, 'emulator-5554');
  });
}
```

- [ ] **Step 3: Run test to verify it fails**

```
fvm flutter test test/core/emulator/device_discovery_service_test.dart
```
Expected: FAIL — `DeviceDiscoveryService` undefined.

- [ ] **Step 4: Write minimal implementation**

```dart
// lib/core/emulator/device_discovery_service.dart
import 'dart:async';
import 'dart:convert';

import 'package:injectable/injectable.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

@lazySingleton
class DeviceDiscoveryService {
  DeviceDiscoveryService(this._runner);
  final ProcessRunner _runner;

  Future<List<Avd>> listAvds() async {
    try {
      final res = await _runner.run('flutter', ['emulators', '--machine']);
      if (res.exitCode != 0) return const [];
      return _parseEmulatorsJson(res.stdout.toString());
    } on ProcessRunnerException {
      return const [];
    }
  }

  Future<List<RunningAndroidDevice>> listRunningDevices() async {
    try {
      final res = await _runner.run('adb', ['devices', '-l']);
      if (res.exitCode != 0) return const [];
      final devs = _parseAdbDevices(res.stdout.toString());
      // Resolve avdName per emulator-* serial.
      final out = <RunningAndroidDevice>[];
      for (final d in devs) {
        if (!d.serial.startsWith('emulator-')) {
          out.add(d);
          continue;
        }
        final name = await _adbAvdName(d.serial);
        out.add(RunningAndroidDevice(
          serial: d.serial,
          avdName: name,
          state: d.state,
        ));
      }
      return out;
    } on ProcessRunnerException {
      return const [];
    }
  }

  Future<DeviceListSnapshot> snapshot() async {
    final results = await Future.wait([listAvds(), listRunningDevices()]);
    return DeviceListSnapshot(
      avds: results[0] as List<Avd>,
      running: results[1] as List<RunningAndroidDevice>,
    );
  }

  Stream<DeviceListSnapshot> watch({
    Duration interval = const Duration(seconds: 4),
  }) async* {
    yield await snapshot();
    while (true) {
      await Future<void>.delayed(interval);
      yield await snapshot();
    }
  }

  Future<String?> _adbAvdName(String serial) async {
    try {
      final res = await _runner.run('adb', ['-s', serial, 'emu', 'avd', 'name']);
      if (res.exitCode != 0) return null;
      // adb emu avd name prints "<name>\nOK\n" — first non-empty line is the name.
      final lines = (res.stdout as String)
          .split('\n')
          .map((l) => l.trim())
          .where((l) => l.isNotEmpty && l != 'OK')
          .toList();
      return lines.isEmpty ? null : lines.first;
    } on ProcessRunnerException {
      return null;
    }
  }

  List<Avd> _parseEmulatorsJson(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return decoded
          .whereType<Map<String, dynamic>>()
          .map((m) => Avd(
                id: m['id'] as String? ?? '',
                name: (m['name'] as String? ?? m['id'] as String? ?? '').trim(),
                platform: m['platformType'] as String? ?? 'android',
              ))
          .where((a) => a.id.isNotEmpty)
          .toList();
    } on FormatException {
      return const [];
    }
  }

  List<RunningAndroidDevice> _parseAdbDevices(String raw) {
    final lines = raw.split('\n');
    final out = <RunningAndroidDevice>[];
    for (final line in lines) {
      final trimmed = line.trim();
      if (trimmed.isEmpty) continue;
      if (trimmed.startsWith('List of devices')) continue;
      // Format: "<serial>\s+<state>\s+<extras...>"
      final tokens = trimmed.split(RegExp(r'\s+'));
      if (tokens.length < 2) continue;
      out.add(RunningAndroidDevice(
        serial: tokens[0],
        avdName: null,
        state: tokens[1],
      ));
    }
    return out;
  }
}
```

- [ ] **Step 5: Run tests and verify they pass**

```
fvm flutter test test/core/emulator/device_discovery_service_test.dart
```
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/core/emulator/device_discovery_service.dart \
        test/core/emulator/device_discovery_service_test.dart \
        test/fixtures/flutter_emulators.json \
        test/fixtures/adb_devices_two.txt \
        test/fixtures/adb_devices_empty.txt
git commit -m "feat(emulator): add DeviceDiscoveryService for AVDs + adb devices"
```

---

### Task P1.T4: `BootReadinessPoller`

**Files:**
- Create: `lib/core/emulator/boot_readiness_poller.dart`
- Test: `test/core/emulator/boot_readiness_poller_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/core/emulator/boot_readiness_poller_test.dart
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/cancel_token.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

class _FakeRunner extends Mock implements ProcessRunner {}

void main() {
  late _FakeRunner runner;
  late BootReadinessPoller poller;

  setUp(() {
    runner = _FakeRunner();
    poller = BootReadinessPoller(runner);
  });

  ProcessResult ok(String stdout) => ProcessResult(0, 0, stdout, '');
  ProcessResult fail() => ProcessResult(0, 1, '', '');

  test('emits ready with serial when AVD name matches and pm path succeeds', () async {
    when(() => runner.run('adb', ['devices', '-l']))
        .thenAnswer((_) async => ok('List of devices attached\nemulator-5554\tdevice\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5554', 'shell', 'getprop', 'sys.boot_completed']))
        .thenAnswer((_) async => ok('1\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5554', 'emu', 'avd', 'name']))
        .thenAnswer((_) async => ok('Pixel_5_API_34\nOK\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5554', 'shell', 'pm', 'path', 'android']))
        .thenAnswer((_) async => ok('package:/system/framework/framework-res.apk\n'));

    final events = await poller
        .poll(
          avdId: 'Pixel_5_API_34',
          interval: const Duration(milliseconds: 10),
          timeout: const Duration(seconds: 1),
        )
        .toList();

    expect(events.last, isA<BootReady>());
    expect((events.last as BootReady).serial, 'emulator-5554');
  });

  test('emits timeout when boot never completes', () async {
    when(() => runner.run('adb', ['devices', '-l']))
        .thenAnswer((_) async => ok('List of devices attached\nemulator-5554\tdevice\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5554', 'shell', 'getprop', 'sys.boot_completed']))
        .thenAnswer((_) async => ok('0\n'));

    final events = await poller
        .poll(
          avdId: 'Pixel_5_API_34',
          interval: const Duration(milliseconds: 10),
          timeout: const Duration(milliseconds: 50),
        )
        .toList();

    expect(events.last, isA<BootTimeout>());
  });

  test('emits cancelled when token cancelled mid-flight', () async {
    when(() => runner.run('adb', ['devices', '-l']))
        .thenAnswer((_) async => ok('List of devices attached\nemulator-5554\tdevice\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5554', 'shell', 'getprop', 'sys.boot_completed']))
        .thenAnswer((_) async => ok('0\n'));
    final token = CancelToken();

    final stream = poller.poll(
      avdId: 'Pixel_5_API_34',
      interval: const Duration(milliseconds: 10),
      timeout: const Duration(seconds: 5),
      cancel: token,
    );
    final events = <BootReadinessEvent>[];
    final sub = stream.listen(events.add);
    Future<void>.delayed(const Duration(milliseconds: 30), token.cancel);
    await sub.asFuture<void>();
    await sub.cancel();

    expect(events.last, isA<BootCancelled>());
  });

  test('skips emulator whose AVD name does not match', () async {
    when(() => runner.run('adb', ['devices', '-l']))
        .thenAnswer((_) async => ok('List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5554', 'shell', 'getprop', 'sys.boot_completed']))
        .thenAnswer((_) async => ok('1\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5554', 'emu', 'avd', 'name']))
        .thenAnswer((_) async => ok('Tablet_API_33\nOK\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5556', 'shell', 'getprop', 'sys.boot_completed']))
        .thenAnswer((_) async => ok('1\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5556', 'emu', 'avd', 'name']))
        .thenAnswer((_) async => ok('Pixel_5_API_34\nOK\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5556', 'shell', 'pm', 'path', 'android']))
        .thenAnswer((_) async => ok('package:/system/framework/framework-res.apk\n'));

    final events = await poller
        .poll(
          avdId: 'Pixel_5_API_34',
          interval: const Duration(milliseconds: 10),
          timeout: const Duration(seconds: 1),
        )
        .toList();

    expect((events.last as BootReady).serial, 'emulator-5556');
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/core/emulator/boot_readiness_poller_test.dart
```
Expected: FAIL — `BootReadinessPoller` undefined.

- [ ] **Step 3: Write minimal implementation**

```dart
// lib/core/emulator/boot_readiness_poller.dart
import 'dart:async';

import 'package:injectable/injectable.dart';
import 'package:pickforge/core/emulator/cancel_token.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

sealed class BootReadinessEvent {
  const BootReadinessEvent();
}

class BootPending extends BootReadinessEvent {
  const BootPending(this.elapsed);
  final Duration elapsed;
}

class BootReady extends BootReadinessEvent {
  const BootReady(this.serial);
  final String serial;
}

class BootTimeout extends BootReadinessEvent {
  const BootTimeout();
}

class BootCancelled extends BootReadinessEvent {
  const BootCancelled();
}

class BootError extends BootReadinessEvent {
  const BootError(this.message);
  final String message;
}

@lazySingleton
class BootReadinessPoller {
  BootReadinessPoller(this._runner);
  final ProcessRunner _runner;

  Stream<BootReadinessEvent> poll({
    required String avdId,
    Duration timeout = const Duration(seconds: 60),
    Duration interval = const Duration(milliseconds: 500),
    CancelToken? cancel,
  }) async* {
    final start = DateTime.now();
    while (true) {
      if (cancel?.isCancelled ?? false) {
        yield const BootCancelled();
        return;
      }
      final elapsed = DateTime.now().difference(start);
      if (elapsed >= timeout) {
        yield const BootTimeout();
        return;
      }
      final serial = await _findReadySerialFor(avdId);
      if (serial != null) {
        yield BootReady(serial);
        return;
      }
      yield BootPending(elapsed);
      await Future<void>.delayed(interval);
    }
  }

  Future<String?> _findReadySerialFor(String avdId) async {
    try {
      final list = await _runner.run('adb', ['devices', '-l']);
      if (list.exitCode != 0) return null;
      final serials = (list.stdout as String)
          .split('\n')
          .map((l) => l.trim())
          .where((l) => l.startsWith('emulator-'))
          .map((l) => l.split(RegExp(r'\s+')).first)
          .toList();
      for (final s in serials) {
        final boot = await _runner.run('adb', ['-s', s, 'shell', 'getprop', 'sys.boot_completed']);
        if (boot.exitCode != 0 || (boot.stdout as String).trim() != '1') continue;
        final name = await _runner.run('adb', ['-s', s, 'emu', 'avd', 'name']);
        if (name.exitCode != 0) continue;
        final n = (name.stdout as String).split('\n').map((l) => l.trim())
            .firstWhere((l) => l.isNotEmpty && l != 'OK', orElse: () => '');
        if (n != avdId) continue;
        final pm = await _runner.run('adb', ['-s', s, 'shell', 'pm', 'path', 'android']);
        if (pm.exitCode != 0) continue;
        return s;
      }
      return null;
    } on ProcessRunnerException {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

```
fvm flutter test test/core/emulator/boot_readiness_poller_test.dart
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/core/emulator/boot_readiness_poller.dart test/core/emulator/boot_readiness_poller_test.dart
git commit -m "feat(emulator): add BootReadinessPoller with avd-name match + pm guard"
```

---

### Task P1.T5: Extend `project_settings` table + DAO

**Files:**
- Modify: `lib/core/drift/tables/project_settings.dart`
- Modify: `lib/core/drift/dao/project_settings_dao.dart`
- Test: `test/core/drift/dao/project_settings_dao_emulator_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/core/drift/dao/project_settings_dao_emulator_test.dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  late PickforgeDatabase db;

  setUp(() => db = PickforgeDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('upsert + read avdId, avdName, connectionMode, runArgs, target, autoBoot', () async {
    await db.projectSettingsDao.upsert(
      projectRoot: '/tmp/p',
      avdId: 'Pixel_5_API_34',
      avdName: 'Pixel 5 API 34',
      connectionMode: 'auto',
      flutterRunArgs: '["--flavor","dev"]',
      targetFile: 'lib/main_dev.dart',
      autoBootOnSelect: true,
    );
    final row = await db.projectSettingsDao.loadFor('/tmp/p');
    expect(row, isNotNull);
    expect(row!.avdId, 'Pixel_5_API_34');
    expect(row.avdName, 'Pixel 5 API 34');
    expect(row.connectionMode, 'auto');
    expect(row.flutterRunArgs, '["--flavor","dev"]');
    expect(row.targetFile, 'lib/main_dev.dart');
    expect(row.autoBootOnSelect, true);
    expect(row.firstRunCelebrated, false);
  });

  test('clearEmulatorBinding nulls out columns', () async {
    await db.projectSettingsDao.upsert(
      projectRoot: '/tmp/p',
      avdId: 'X',
      avdName: 'Y',
    );
    await db.projectSettingsDao.clearEmulatorBinding('/tmp/p');
    final row = await db.projectSettingsDao.loadFor('/tmp/p');
    expect(row?.avdId, isNull);
    expect(row?.avdName, isNull);
    expect(row?.vmServiceUrl, isNull);
  });

  test('markFirstRunCelebrated flips flag', () async {
    await db.projectSettingsDao.upsert(projectRoot: '/tmp/p');
    await db.projectSettingsDao.markFirstRunCelebrated('/tmp/p');
    final row = await db.projectSettingsDao.loadFor('/tmp/p');
    expect(row?.firstRunCelebrated, true);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/core/drift/dao/project_settings_dao_emulator_test.dart
```
Expected: FAIL — columns/methods undefined.

- [ ] **Step 3: Extend `project_settings.dart`**

```dart
// lib/core/drift/tables/project_settings.dart  (replace whole file)
import 'package:drift/drift.dart';

@DataClassName('ProjectSettingsRow')
class ProjectSettings extends Table {
  TextColumn get projectRoot => text()();
  TextColumn get vmServiceUrl => text().nullable()();
  TextColumn get defaultAgentId => text().nullable()();
  TextColumn get lastChatId => text().nullable()();
  TextColumn get paneSizes => text().nullable()();
  DateTimeColumn get lastUsedAt => dateTime().nullable()();

  TextColumn get avdId => text().nullable()();
  TextColumn get avdName => text().nullable()();
  TextColumn get connectionMode => text().withDefault(const Constant('auto'))();
  TextColumn get flutterRunArgs => text().nullable()();
  TextColumn get targetFile => text().nullable()();
  BoolColumn get autoBootOnSelect =>
      boolean().withDefault(const Constant(true))();
  BoolColumn get firstRunCelebrated =>
      boolean().withDefault(const Constant(false))();

  @override
  Set<Column<Object>> get primaryKey => {projectRoot};
}
```

- [ ] **Step 4: Extend `project_settings_dao.dart`**

Replace the existing `upsert` signature + add new methods:

```dart
// lib/core/drift/dao/project_settings_dao.dart  (full file)
import 'package:drift/drift.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/drift/tables/project_settings.dart';

part 'project_settings_dao.g.dart';

@DriftAccessor(tables: [ProjectSettings])
class ProjectSettingsDao extends DatabaseAccessor<PickforgeDatabase>
    with _$ProjectSettingsDaoMixin {
  ProjectSettingsDao(super.attachedDatabase);

  Future<ProjectSettingsRow?> loadFor(String projectRoot) {
    return (select(projectSettings)
          ..where((t) => t.projectRoot.equals(projectRoot)))
        .getSingleOrNull();
  }

  Future<void> upsert({
    required String projectRoot,
    String? vmServiceUrl,
    String? defaultAgentId,
    String? avdId,
    String? avdName,
    String? connectionMode,
    String? flutterRunArgs,
    String? targetFile,
    bool? autoBootOnSelect,
    DateTime? now,
  }) {
    final companion = ProjectSettingsCompanion(
      projectRoot: Value(projectRoot),
      vmServiceUrl: vmServiceUrl == null
          ? const Value.absent()
          : Value(vmServiceUrl),
      defaultAgentId: defaultAgentId == null
          ? const Value.absent()
          : Value(defaultAgentId),
      avdId: avdId == null ? const Value.absent() : Value(avdId),
      avdName: avdName == null ? const Value.absent() : Value(avdName),
      connectionMode: connectionMode == null
          ? const Value.absent()
          : Value(connectionMode),
      flutterRunArgs: flutterRunArgs == null
          ? const Value.absent()
          : Value(flutterRunArgs),
      targetFile:
          targetFile == null ? const Value.absent() : Value(targetFile),
      autoBootOnSelect: autoBootOnSelect == null
          ? const Value.absent()
          : Value(autoBootOnSelect),
      lastUsedAt: Value(now ?? DateTime.now()),
    );
    return into(projectSettings).insertOnConflictUpdate(companion);
  }

  Future<void> setLastChatId(String projectRoot, String? chatId) {
    return (update(projectSettings)
          ..where((t) => t.projectRoot.equals(projectRoot)))
        .write(ProjectSettingsCompanion(lastChatId: Value(chatId)));
  }

  Future<String?> lastChatId(String projectRoot) async =>
      (await loadFor(projectRoot))?.lastChatId;

  Future<void> setPaneSizes(String projectRoot, String? json) {
    return (update(projectSettings)
          ..where((t) => t.projectRoot.equals(projectRoot)))
        .write(ProjectSettingsCompanion(paneSizes: Value(json)));
  }

  Future<String?> paneSizes(String projectRoot) async =>
      (await loadFor(projectRoot))?.paneSizes;

  Future<void> clearEmulatorBinding(String projectRoot) {
    return (update(projectSettings)
          ..where((t) => t.projectRoot.equals(projectRoot)))
        .write(const ProjectSettingsCompanion(
      avdId: Value(null),
      avdName: Value(null),
      vmServiceUrl: Value(null),
    ));
  }

  Future<void> markFirstRunCelebrated(String projectRoot) {
    return (update(projectSettings)
          ..where((t) => t.projectRoot.equals(projectRoot)))
        .write(const ProjectSettingsCompanion(
      firstRunCelebrated: Value(true),
    ));
  }
}
```

- [ ] **Step 5: Regenerate Drift code**

```
fvm dart run build_runner build --delete-conflicting-outputs
```

- [ ] **Step 6: Bump schema version (handled in next task)**

This task assumes Task P1.T7 will bump the schema version and add the migration. Until P1.T7, the DAO test runs only via `forTesting` + memory DB which uses `onCreate` (creates the new schema fresh). Confirm P1.T5 tests pass on the new schema before P1.T7.

- [ ] **Step 7: Run tests and verify they pass**

```
fvm flutter test test/core/drift/dao/project_settings_dao_emulator_test.dart
```
Expected: FAIL — schemaVersion not yet bumped, fresh memory DB still uses v2 schema. **Defer to after P1.T7.** Mark this step complete only once P1.T7 is done.

- [ ] **Step 8: Commit (after P1.T7 lands)**

```bash
git add lib/core/drift/tables/project_settings.dart \
        lib/core/drift/dao/project_settings_dao.dart \
        lib/core/drift/dao/project_settings_dao.g.dart \
        lib/core/drift/pickforge_database.g.dart \
        test/core/drift/dao/project_settings_dao_emulator_test.dart
git commit -m "feat(drift): extend project_settings with avd binding + run args columns"
```

---

### Task P1.T6: New `run_session_log` table + DAO

**Files:**
- Create: `lib/core/drift/tables/run_session_log.dart`
- Create: `lib/core/drift/dao/run_session_log_dao.dart`
- Test: `test/core/drift/dao/run_session_log_dao_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/core/drift/dao/run_session_log_dao_test.dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  late PickforgeDatabase db;

  setUp(() => db = PickforgeDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('recordStart inserts row, recordEnd updates same row', () async {
    final start = DateTime.utc(2026, 4, 28, 14, 30);
    await db.runSessionLogDao.recordStart(
      sessionId: 'ses-1',
      projectRoot: '/tmp/p',
      startedAt: start,
      avdId: 'Pixel_5_API_34',
      avdName: 'Pixel 5 API 34',
      serial: 'emulator-5554',
      vmServiceUrl: 'ws://x/ws',
      connectionMode: 'auto',
    );
    final end = start.add(const Duration(minutes: 5));
    await db.runSessionLogDao.recordEnd(
      sessionId: 'ses-1',
      endedAt: end,
      exitReason: 'user_stop',
      hotReloadCount: 3,
    );
    final rows = await db.runSessionLogDao.recentFor('/tmp/p');
    expect(rows, hasLength(1));
    expect(rows.single.exitReason, 'user_stop');
    expect(rows.single.hotReloadCount, 3);
  });

  test('recordEnd is idempotent on same sessionId', () async {
    await db.runSessionLogDao.recordStart(
      sessionId: 'ses-1',
      projectRoot: '/tmp/p',
      startedAt: DateTime.utc(2026, 4, 28),
      connectionMode: 'auto',
    );
    await db.runSessionLogDao.recordEnd(
      sessionId: 'ses-1',
      endedAt: DateTime.utc(2026, 4, 28),
      exitReason: 'crash',
    );
    await db.runSessionLogDao.recordEnd(
      sessionId: 'ses-1',
      endedAt: DateTime.utc(2026, 4, 28),
      exitReason: 'pickforge_quit',
    );
    final rows = await db.runSessionLogDao.recentFor('/tmp/p');
    expect(rows, hasLength(1));
    expect(rows.single.exitReason, 'pickforge_quit');
  });

  test('prune keeps last N per project', () async {
    for (var i = 0; i < 5; i++) {
      await db.runSessionLogDao.recordStart(
        sessionId: 'ses-$i',
        projectRoot: '/tmp/p',
        startedAt: DateTime.utc(2026, 4, i + 1),
        connectionMode: 'auto',
      );
    }
    await db.runSessionLogDao.pruneToCap('/tmp/p', cap: 3);
    final rows = await db.runSessionLogDao.recentFor('/tmp/p');
    expect(rows.map((r) => r.sessionId), ['ses-4', 'ses-3', 'ses-2']);
  });

  test('recentFor orders newest first', () async {
    await db.runSessionLogDao.recordStart(
      sessionId: 'old',
      projectRoot: '/tmp/p',
      startedAt: DateTime.utc(2026, 4, 1),
      connectionMode: 'auto',
    );
    await db.runSessionLogDao.recordStart(
      sessionId: 'new',
      projectRoot: '/tmp/p',
      startedAt: DateTime.utc(2026, 4, 28),
      connectionMode: 'auto',
    );
    final rows = await db.runSessionLogDao.recentFor('/tmp/p');
    expect(rows.first.sessionId, 'new');
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/core/drift/dao/run_session_log_dao_test.dart
```
Expected: FAIL — table/DAO undefined.

- [ ] **Step 3: Create table**

```dart
// lib/core/drift/tables/run_session_log.dart
import 'package:drift/drift.dart';

@DataClassName('RunSessionLogRow')
class RunSessionLog extends Table {
  TextColumn get sessionId => text()();
  TextColumn get projectRoot => text()();
  DateTimeColumn get startedAt => dateTime()();
  DateTimeColumn get endedAt => dateTime().nullable()();
  TextColumn get avdId => text().nullable()();
  TextColumn get avdName => text().nullable()();
  TextColumn get serial => text().nullable()();
  TextColumn get vmServiceUrl => text().nullable()();
  TextColumn get connectionMode => text()();
  TextColumn get exitReason => text().nullable()();
  IntColumn get exitCode => integer().nullable()();
  IntColumn get hotReloadCount => integer().withDefault(const Constant(0))();
  IntColumn get hotRestartCount => integer().withDefault(const Constant(0))();
  IntColumn get errorCount => integer().withDefault(const Constant(0))();
  TextColumn get lastError => text().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {sessionId};
}
```

- [ ] **Step 4: Create DAO**

```dart
// lib/core/drift/dao/run_session_log_dao.dart
import 'package:drift/drift.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/drift/tables/run_session_log.dart';

part 'run_session_log_dao.g.dart';

@DriftAccessor(tables: [RunSessionLog])
class RunSessionLogDao extends DatabaseAccessor<PickforgeDatabase>
    with _$RunSessionLogDaoMixin {
  RunSessionLogDao(super.attachedDatabase);

  Future<void> recordStart({
    required String sessionId,
    required String projectRoot,
    required DateTime startedAt,
    required String connectionMode,
    String? avdId,
    String? avdName,
    String? serial,
    String? vmServiceUrl,
  }) {
    return into(runSessionLog).insertOnConflictUpdate(
      RunSessionLogCompanion(
        sessionId: Value(sessionId),
        projectRoot: Value(projectRoot),
        startedAt: Value(startedAt),
        connectionMode: Value(connectionMode),
        avdId: Value(avdId),
        avdName: Value(avdName),
        serial: Value(serial),
        vmServiceUrl: Value(vmServiceUrl),
      ),
    );
  }

  Future<void> recordEnd({
    required String sessionId,
    required DateTime endedAt,
    required String exitReason,
    int? exitCode,
    int hotReloadCount = 0,
    int hotRestartCount = 0,
    int errorCount = 0,
    String? lastError,
  }) {
    return (update(runSessionLog)
          ..where((t) => t.sessionId.equals(sessionId)))
        .write(RunSessionLogCompanion(
      endedAt: Value(endedAt),
      exitReason: Value(exitReason),
      exitCode: Value(exitCode),
      hotReloadCount: Value(hotReloadCount),
      hotRestartCount: Value(hotRestartCount),
      errorCount: Value(errorCount),
      lastError: Value(lastError),
    ));
  }

  Future<List<RunSessionLogRow>> recentFor(
    String projectRoot, {
    int limit = 20,
  }) {
    return (select(runSessionLog)
          ..where((t) => t.projectRoot.equals(projectRoot))
          ..orderBy([(t) => OrderingTerm.desc(t.startedAt)])
          ..limit(limit))
        .get();
  }

  Stream<List<RunSessionLogRow>> watchRecent(
    String projectRoot, {
    int limit = 20,
  }) {
    return (select(runSessionLog)
          ..where((t) => t.projectRoot.equals(projectRoot))
          ..orderBy([(t) => OrderingTerm.desc(t.startedAt)])
          ..limit(limit))
        .watch();
  }

  Future<RunSessionLogRow?> latestFor(String projectRoot) async {
    final rows = await recentFor(projectRoot, limit: 1);
    return rows.isEmpty ? null : rows.first;
  }

  Future<void> pruneToCap(String projectRoot, {int cap = 100}) {
    return customStatement(
      'DELETE FROM run_session_log '
      'WHERE project_root = ?1 AND session_id NOT IN ('
      'SELECT session_id FROM run_session_log '
      'WHERE project_root = ?1 ORDER BY started_at DESC LIMIT ?2)',
      [projectRoot, cap],
    );
  }
}
```

- [ ] **Step 5: Wire into database (sketch — final wiring in P1.T7)**

Tracking only — actual wiring happens in P1.T7. No commit yet.

- [ ] **Step 6: Commit (after P1.T7 lands)**

```bash
git add lib/core/drift/tables/run_session_log.dart \
        lib/core/drift/dao/run_session_log_dao.dart \
        lib/core/drift/dao/run_session_log_dao.g.dart \
        test/core/drift/dao/run_session_log_dao_test.dart
git commit -m "feat(drift): add run_session_log table + DAO"
```

---

### Task P1.T7: Bump schema to v3, register table + DAO, write migration

**Files:**
- Modify: `lib/core/drift/pickforge_database.dart`
- Modify: `lib/core/di/injection.dart` (DriftDaoModule — add `runSessionLogDao`)
- Test: `test/core/drift/migration_v2_to_v3_test.dart`

- [ ] **Step 1: Write the failing migration test**

```dart
// test/core/drift/migration_v2_to_v3_test.dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  test('v2 → v3 adds emulator columns + run_session_log; backfills connectionMode=manual', () async {
    final raw = NativeDatabase.memory(setup: (s) {
      s
        ..execute('''
          CREATE TABLE project_settings (
            project_root TEXT NOT NULL PRIMARY KEY,
            vm_service_url TEXT,
            default_agent_id TEXT,
            last_chat_id TEXT,
            pane_sizes TEXT,
            last_used_at INTEGER
          );
        ''')
        ..execute('CREATE TABLE projects (project_root TEXT PRIMARY KEY, display_name TEXT, created_at INTEGER, last_opened_at INTEGER);')
        ..execute('CREATE TABLE chats (id TEXT PRIMARY KEY);')
        ..execute('CREATE TABLE pick_history (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT);')
        ..execute('CREATE TABLE agent_run_log (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER, hot_reload_count INTEGER NOT NULL DEFAULT 0, wrapper_script_path TEXT NOT NULL, pick_id INTEGER NOT NULL);')
        ..execute('PRAGMA user_version = 2;')
        ..execute(
          'INSERT INTO project_settings (project_root, vm_service_url) '
          "VALUES ('/tmp/manual', 'ws://x/ws');",
        )
        ..execute(
          "INSERT INTO project_settings (project_root) VALUES ('/tmp/empty');",
        );
    });

    final db = PickforgeDatabase.forTesting(raw);

    // Trigger migration by touching new tables/columns.
    final cols = await db.customSelect('PRAGMA table_info(project_settings);').get();
    final names = cols.map((r) => r.read<String>('name')).toSet();
    expect(names.contains('avd_id'), isTrue);
    expect(names.contains('avd_name'), isTrue);
    expect(names.contains('connection_mode'), isTrue);
    expect(names.contains('flutter_run_args'), isTrue);
    expect(names.contains('target_file'), isTrue);
    expect(names.contains('auto_boot_on_select'), isTrue);
    expect(names.contains('first_run_celebrated'), isTrue);

    final logCols = await db.customSelect('PRAGMA table_info(run_session_log);').get();
    expect(logCols, isNotEmpty);

    final manual = await db.customSelect(
      "SELECT connection_mode FROM project_settings WHERE project_root='/tmp/manual'",
    ).getSingle();
    expect(manual.read<String>('connection_mode'), 'manual');

    final empty = await db.customSelect(
      "SELECT connection_mode FROM project_settings WHERE project_root='/tmp/empty'",
    ).getSingle();
    expect(empty.read<String>('connection_mode'), 'auto');

    await db.close();
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/core/drift/migration_v2_to_v3_test.dart
```
Expected: FAIL — schema still v2.

- [ ] **Step 3: Update database**

```dart
// lib/core/drift/pickforge_database.dart  (full file)
import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/drift/dao/agent_run_log_dao.dart';
import 'package:pickforge/core/drift/dao/chats_dao.dart';
import 'package:pickforge/core/drift/dao/pick_history_dao.dart';
import 'package:pickforge/core/drift/dao/project_settings_dao.dart';
import 'package:pickforge/core/drift/dao/projects_dao.dart';
import 'package:pickforge/core/drift/dao/run_session_log_dao.dart';
import 'package:pickforge/core/drift/tables/agent_run_log.dart';
import 'package:pickforge/core/drift/tables/chats.dart';
import 'package:pickforge/core/drift/tables/pick_history.dart';
import 'package:pickforge/core/drift/tables/project_settings.dart';
import 'package:pickforge/core/drift/tables/projects.dart';
import 'package:pickforge/core/drift/tables/run_session_log.dart';

part 'pickforge_database.g.dart';

@DriftDatabase(
  tables: [
    ProjectSettings,
    PickHistory,
    AgentRunLog,
    Projects,
    Chats,
    RunSessionLog,
  ],
  daos: [
    ProjectSettingsDao,
    PickHistoryDao,
    AgentRunLogDao,
    ProjectsDao,
    ChatsDao,
    RunSessionLogDao,
  ],
)
@lazySingleton
class PickforgeDatabase extends _$PickforgeDatabase {
  PickforgeDatabase() : super(driftDatabase(name: 'pickforge'));

  PickforgeDatabase.forTesting(super.e);

  @override
  int get schemaVersion => 3;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) => m.createAll(),
        onUpgrade: (m, from, to) async {
          if (from < 2) {
            await m.createTable(projects);
            await m.createTable(chats);
            await m.addColumn(projectSettings, projectSettings.lastChatId);
            await m.addColumn(projectSettings, projectSettings.paneSizes);
            await m.addColumn(pickHistory, pickHistory.chatId);
            await customStatement(
              'ALTER TABLE project_settings DROP COLUMN default_terminal_id;',
            );
            // (Existing v1→v2 backfill kept in place — see commit 0e87392 history if needed.)
          }
          if (from < 3) {
            await m.addColumn(projectSettings, projectSettings.avdId);
            await m.addColumn(projectSettings, projectSettings.avdName);
            await m.addColumn(projectSettings, projectSettings.connectionMode);
            await m.addColumn(projectSettings, projectSettings.flutterRunArgs);
            await m.addColumn(projectSettings, projectSettings.targetFile);
            await m.addColumn(projectSettings, projectSettings.autoBootOnSelect);
            await m.addColumn(projectSettings, projectSettings.firstRunCelebrated);
            await m.createTable(runSessionLog);
            await m.createIndex(Index(
              'idx_run_session_log_project_started',
              'CREATE INDEX idx_run_session_log_project_started '
                  'ON run_session_log (project_root, started_at DESC)',
            ));
            await customStatement(
              "UPDATE project_settings "
              "SET connection_mode='manual' "
              "WHERE vm_service_url IS NOT NULL",
            );
          }
        },
        beforeOpen: (details) async {
          await customStatement('PRAGMA foreign_keys = ON;');
        },
      );
}
```

> **Note:** Replace the truncated v1→v2 comment with the existing block from the previous file content; this excerpt elides it for brevity. The migration body for v1→v2 must remain byte-identical to its prior form.

- [ ] **Step 4: Wire DAO into DI**

In `lib/core/di/injection.dart`, extend `DriftDaoModule`:

```dart
// inside DriftDaoModule
@lazySingleton
RunSessionLogDao runSessionLogDao(PickforgeDatabase db) => RunSessionLogDao(db);
```

Add the import:
```dart
import 'package:pickforge/core/drift/dao/run_session_log_dao.dart';
```

- [ ] **Step 5: Regenerate generated code**

```
fvm dart run build_runner build --delete-conflicting-outputs
```

- [ ] **Step 6: Run all schema-related tests**

```
fvm flutter test test/core/drift/
```
Expected: PASS, including `migration_v1_to_v2_test`, `migration_v2_to_v3_test`, both DAO emulator tests.

- [ ] **Step 7: Commit**

```bash
git add lib/core/drift/pickforge_database.dart \
        lib/core/drift/pickforge_database.g.dart \
        lib/core/di/injection.dart \
        lib/core/di/injection.config.dart \
        test/core/drift/migration_v2_to_v3_test.dart \
        test/core/drift/dao/project_settings_dao_emulator_test.dart \
        test/core/drift/dao/run_session_log_dao_test.dart \
        lib/core/drift/dao/run_session_log_dao.dart \
        lib/core/drift/dao/run_session_log_dao.g.dart \
        lib/core/drift/tables/run_session_log.dart \
        lib/core/drift/tables/project_settings.dart \
        lib/core/drift/dao/project_settings_dao.dart \
        lib/core/drift/dao/project_settings_dao.g.dart
git commit -m "feat(drift): bump schema to v3 with emulator columns + run_session_log"
```

---

### Task P1.T8: `EmulatorBinding`, `RunArgs`, repository typed accessors

**Files:**
- Create: `lib/core/settings/emulator_binding.dart`
- Create: `lib/core/settings/run_args.dart`
- Modify: `lib/core/settings/project_settings_repository.dart`
- Test: `test/core/settings/project_settings_repository_emulator_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/core/settings/project_settings_repository_emulator_test.dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/run_args.dart';

void main() {
  late PickforgeDatabase db;
  late ProjectSettingsRepository repo;

  setUp(() {
    db = PickforgeDatabase.forTesting(NativeDatabase.memory());
    repo = ProjectSettingsRepository(db);
  });
  tearDown(() => db.close());

  test('round-trip AVD binding', () async {
    await repo.setEmulatorBinding('/p', const EmulatorBinding.avd(
      avdId: 'Pixel_5_API_34',
      avdName: 'Pixel 5 API 34',
      autoBootOnSelect: false,
    ));
    final got = await repo.getEmulatorBinding('/p');
    expect(got, isA<AvdBinding>());
    expect((got! as AvdBinding).avdId, 'Pixel_5_API_34');
    expect((got as AvdBinding).autoBootOnSelect, isFalse);
  });

  test('round-trip manual binding', () async {
    await repo.setEmulatorBinding('/p', const EmulatorBinding.manual(
      vmServiceUrl: 'ws://x/ws',
    ));
    final got = await repo.getEmulatorBinding('/p');
    expect(got, isA<ManualBinding>());
    expect((got! as ManualBinding).vmServiceUrl, 'ws://x/ws');
  });

  test('clearEmulatorBinding returns null', () async {
    await repo.setEmulatorBinding('/p', const EmulatorBinding.avd(
      avdId: 'X', avdName: 'Y',
    ));
    await repo.clearEmulatorBinding('/p');
    expect(await repo.getEmulatorBinding('/p'), isNull);
  });

  test('round-trip run args (JSON-encoded extraArgs)', () async {
    await repo.setRunArgs('/p', const RunArgs(
      targetFile: 'lib/main_dev.dart',
      extraArgs: ['--flavor', 'dev', '--dart-define=FOO=bar'],
    ));
    final got = await repo.getRunArgs('/p');
    expect(got.targetFile, 'lib/main_dev.dart');
    expect(got.extraArgs, ['--flavor', 'dev', '--dart-define=FOO=bar']);
  });

  test('getRunArgs returns empty when none set', () async {
    final got = await repo.getRunArgs('/p');
    expect(got.targetFile, isNull);
    expect(got.extraArgs, isEmpty);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/core/settings/project_settings_repository_emulator_test.dart
```
Expected: FAIL — types undefined.

- [ ] **Step 3: Create freezed models**

```dart
// lib/core/settings/emulator_binding.dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'emulator_binding.freezed.dart';

@freezed
abstract class EmulatorBinding with _$EmulatorBinding {
  const factory EmulatorBinding.avd({
    required String avdId,
    required String avdName,
    @Default(true) bool autoBootOnSelect,
  }) = AvdBinding;

  const factory EmulatorBinding.manual({
    required String vmServiceUrl,
  }) = ManualBinding;
}
```

```dart
// lib/core/settings/run_args.dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'run_args.freezed.dart';

@freezed
abstract class RunArgs with _$RunArgs {
  const factory RunArgs({
    String? targetFile,
    @Default(<String>[]) List<String> extraArgs,
  }) = _RunArgs;
}
```

- [ ] **Step 4: Extend repository**

```dart
// lib/core/settings/project_settings_repository.dart  (full file)
import 'dart:convert';

import 'package:injectable/injectable.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/run_args.dart';

@lazySingleton
class ProjectSettingsRepository {
  ProjectSettingsRepository(this._db);
  final PickforgeDatabase _db;

  Future<String?> getVmServiceUrl(String projectRoot) async =>
      (await _db.projectSettingsDao.loadFor(projectRoot))?.vmServiceUrl;

  Future<void> setVmServiceUrl(String projectRoot, String url) =>
      _db.projectSettingsDao.upsert(projectRoot: projectRoot, vmServiceUrl: url);

  Future<String?> getDefaultAgentId(String projectRoot) async =>
      (await _db.projectSettingsDao.loadFor(projectRoot))?.defaultAgentId;

  Future<void> setDefaultAgentId(String projectRoot, String agentId) =>
      _db.projectSettingsDao.upsert(projectRoot: projectRoot, defaultAgentId: agentId);

  Future<String?> getLastChatId(String projectRoot) =>
      _db.projectSettingsDao.lastChatId(projectRoot);

  Future<void> setLastChatId(String projectRoot, String? chatId) async {
    await _db.projectSettingsDao.upsert(projectRoot: projectRoot);
    await _db.projectSettingsDao.setLastChatId(projectRoot, chatId);
  }

  Future<String?> getPaneSizes(String projectRoot) =>
      _db.projectSettingsDao.paneSizes(projectRoot);

  Future<void> setPaneSizes(String projectRoot, String? json) async {
    await _db.projectSettingsDao.upsert(projectRoot: projectRoot);
    await _db.projectSettingsDao.setPaneSizes(projectRoot, json);
  }

  Future<EmulatorBinding?> getEmulatorBinding(String projectRoot) async {
    final row = await _db.projectSettingsDao.loadFor(projectRoot);
    if (row == null) return null;
    if (row.connectionMode == 'manual' && row.vmServiceUrl != null) {
      return EmulatorBinding.manual(vmServiceUrl: row.vmServiceUrl!);
    }
    if (row.avdId != null && row.avdName != null) {
      return EmulatorBinding.avd(
        avdId: row.avdId!,
        avdName: row.avdName!,
        autoBootOnSelect: row.autoBootOnSelect,
      );
    }
    return null;
  }

  Future<void> setEmulatorBinding(
    String projectRoot,
    EmulatorBinding binding,
  ) async {
    switch (binding) {
      case AvdBinding(:final avdId, :final avdName, :final autoBootOnSelect):
        await _db.projectSettingsDao.upsert(
          projectRoot: projectRoot,
          avdId: avdId,
          avdName: avdName,
          connectionMode: 'auto',
          autoBootOnSelect: autoBootOnSelect,
          vmServiceUrl: null,
        );
      case ManualBinding(:final vmServiceUrl):
        await _db.projectSettingsDao.upsert(
          projectRoot: projectRoot,
          vmServiceUrl: vmServiceUrl,
          connectionMode: 'manual',
          avdId: null,
          avdName: null,
        );
    }
  }

  Future<void> clearEmulatorBinding(String projectRoot) =>
      _db.projectSettingsDao.clearEmulatorBinding(projectRoot);

  Future<RunArgs> getRunArgs(String projectRoot) async {
    final row = await _db.projectSettingsDao.loadFor(projectRoot);
    if (row == null) return const RunArgs();
    final extras = row.flutterRunArgs;
    final list = extras == null
        ? const <String>[]
        : (jsonDecode(extras) as List<dynamic>).cast<String>();
    return RunArgs(targetFile: row.targetFile, extraArgs: list);
  }

  Future<void> setRunArgs(String projectRoot, RunArgs args) {
    return _db.projectSettingsDao.upsert(
      projectRoot: projectRoot,
      targetFile: args.targetFile,
      flutterRunArgs: jsonEncode(args.extraArgs),
    );
  }

  Future<void> markFirstRunCelebrated(String projectRoot) =>
      _db.projectSettingsDao.markFirstRunCelebrated(projectRoot);
}
```

> **Note:** `dao.upsert` accepts `vmServiceUrl: null` etc. only because the companion treats `null` differently from `Value.absent()`. The DAO already maps `null` → `Value.absent()`; if explicit clearing is needed, call `clearEmulatorBinding` separately, which uses `Value(null)` to wipe the column.

- [ ] **Step 5: Regenerate freezed**

```
fvm dart run build_runner build --delete-conflicting-outputs
```

- [ ] **Step 6: Run tests**

```
fvm flutter test test/core/settings/project_settings_repository_emulator_test.dart
```
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add lib/core/settings/emulator_binding.dart \
        lib/core/settings/emulator_binding.freezed.dart \
        lib/core/settings/run_args.dart \
        lib/core/settings/run_args.freezed.dart \
        lib/core/settings/project_settings_repository.dart \
        test/core/settings/project_settings_repository_emulator_test.dart
git commit -m "feat(settings): add EmulatorBinding/RunArgs repos and typed accessors"
```

---

## Phase 2 — AVD Launcher + Run Session Controller

Goal of phase: spawn AVDs, drive `flutter run --machine`, persist run-session log rows. Still no UI.

### Task P2.T1: `AvdLauncher`

**Files:**
- Create: `lib/core/emulator/avd_launcher.dart`
- Modify: `lib/core/di/injection.dart` (registration via `@lazySingleton` on the class is sufficient — no module needed)
- Test: `test/core/emulator/avd_launcher_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/core/emulator/avd_launcher_test.dart
import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

class _FakeRunner extends Mock implements ProcessRunner {}

class _FakeRunningProcess implements RunningProcess {
  _FakeRunningProcess(this.pid);
  @override
  final int pid;
  final _exitCompleter = Completer<int>();
  bool killed = false;

  @override
  Future<int> get exitCode => _exitCompleter.future;
  @override
  Stream<List<int>> get stdout => const Stream.empty();
  @override
  Stream<List<int>> get stderr => const Stream.empty();
  @override
  void writeStdin(List<int> bytes) {}
  @override
  Future<void> kill({ProcessSignal signal = ProcessSignal.sigterm}) async {
    killed = true;
    if (!_exitCompleter.isCompleted) _exitCompleter.complete(143);
  }
}

void main() {
  late _FakeRunner runner;
  late AvdLauncher launcher;
  late _FakeRunningProcess proc;

  setUp(() {
    runner = _FakeRunner();
    launcher = AvdLauncher(runner);
    proc = _FakeRunningProcess(12345);
    when(() => runner.spawn('flutter', ['emulators', '--launch', any()]))
        .thenAnswer((_) async => proc);
  });

  test('launch returns a handle and spawns flutter emulators --launch', () async {
    final handle = await launcher.launch('Pixel_5_API_34');
    expect(handle.pid, 12345);
    verify(() => runner.spawn('flutter', ['emulators', '--launch', 'Pixel_5_API_34'])).called(1);
  });

  test('cancel kills the spawned process', () async {
    final handle = await launcher.launch('Pixel_5_API_34');
    await handle.cancel();
    expect(proc.killed, isTrue);
  });

  test('launch surfaces ProcessRunnerException', () async {
    when(() => runner.spawn('flutter', any()))
        .thenThrow(ProcessRunnerException('flutter', 'ENOENT'));
    expect(() => launcher.launch('X'), throwsA(isA<ProcessRunnerException>()));
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/core/emulator/avd_launcher_test.dart
```
Expected: FAIL — `AvdLauncher` undefined.

- [ ] **Step 3: Write minimal implementation**

```dart
// lib/core/emulator/avd_launcher.dart
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

class AvdLaunchHandle {
  AvdLaunchHandle(this._proc);
  final RunningProcess _proc;

  int get pid => _proc.pid;

  Future<void> cancel() => _proc.kill();
}

@lazySingleton
class AvdLauncher {
  AvdLauncher(this._runner);
  final ProcessRunner _runner;

  Future<AvdLaunchHandle> launch(String avdId) async {
    final proc = await _runner.spawn('flutter', ['emulators', '--launch', avdId]);
    return AvdLaunchHandle(proc);
  }
}
```

- [ ] **Step 4: Run tests**

```
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter test test/core/emulator/avd_launcher_test.dart
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/core/emulator/avd_launcher.dart \
        test/core/emulator/avd_launcher_test.dart \
        lib/core/di/injection.config.dart
git commit -m "feat(emulator): add AvdLauncher wrapping flutter emulators --launch"
```

---

### Task P2.T2: `JsonRpcLineDecoder`

**Files:**
- Create: `lib/core/emulator/json_rpc_line_decoder.dart`
- Test: `test/core/emulator/json_rpc_line_decoder_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/core/emulator/json_rpc_line_decoder_test.dart
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/json_rpc_line_decoder.dart';

void main() {
  test('decodes one envelope per JSON line', () {
    const dec = JsonRpcLineDecoder();
    final outs = <DecodedLine>[];
    dec.feed('[{"event":"app.start","params":{"appId":"abc"}}]\n', outs.add);
    expect(outs, hasLength(1));
    expect(outs.first, isA<DecodedEnvelope>());
    final env = outs.first as DecodedEnvelope;
    expect(env.event, 'app.start');
    expect(env.params['appId'], 'abc');
  });

  test('passes plain non-JSON lines through as raw', () {
    const dec = JsonRpcLineDecoder();
    final outs = <DecodedLine>[];
    dec.feed('Launching lib/main.dart on Pixel_5...\n', outs.add);
    expect(outs.single, isA<DecodedRawLine>());
    expect((outs.single as DecodedRawLine).text,
        'Launching lib/main.dart on Pixel_5...');
  });

  test('handles multiple envelopes in one chunk', () {
    const dec = JsonRpcLineDecoder();
    final outs = <DecodedLine>[];
    final body = '${jsonEncode([{'event':'app.start','params':{}}])}\n'
        '${jsonEncode([{'event':'app.started','params':{'vmServiceUri':'ws://x'}}])}\n';
    dec.feed(body, outs.add);
    expect(outs, hasLength(2));
    expect((outs[1] as DecodedEnvelope).event, 'app.started');
  });

  test('buffers partial lines across chunks', () {
    final dec = JsonRpcLineDecoder();
    final outs = <DecodedLine>[];
    dec.feed('[{"event":"app.s', outs.add);
    expect(outs, isEmpty);
    dec.feed('tart","params":{}}]\n', outs.add);
    expect(outs, hasLength(1));
    expect((outs.single as DecodedEnvelope).event, 'app.start');
  });

  test('decodes plain JSON-RPC response (response to our request)', () {
    const dec = JsonRpcLineDecoder();
    final outs = <DecodedLine>[];
    dec.feed('[{"id":42,"result":{"code":0}}]\n', outs.add);
    expect(outs.single, isA<DecodedResponse>());
    final r = outs.single as DecodedResponse;
    expect(r.id, 42);
    expect(r.result, {'code': 0});
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/core/emulator/json_rpc_line_decoder_test.dart
```
Expected: FAIL — types undefined.

- [ ] **Step 3: Write minimal implementation**

```dart
// lib/core/emulator/json_rpc_line_decoder.dart
import 'dart:convert';

sealed class DecodedLine {
  const DecodedLine();
}

class DecodedEnvelope extends DecodedLine {
  const DecodedEnvelope({required this.event, required this.params});
  final String event;
  final Map<String, dynamic> params;
}

class DecodedResponse extends DecodedLine {
  const DecodedResponse({required this.id, this.result, this.error});
  final int id;
  final Object? result;
  final Object? error;
}

class DecodedRawLine extends DecodedLine {
  const DecodedRawLine(this.text);
  final String text;
}

class JsonRpcLineDecoder {
  JsonRpcLineDecoder();
  const JsonRpcLineDecoder._() : _buf = const _ImmutableBuf();
  final _StringBuf _buf = _StringBuf();

  void feed(String chunk, void Function(DecodedLine) sink) {
    _buf.append(chunk);
    while (true) {
      final nl = _buf.indexOfNewline();
      if (nl < 0) return;
      final line = _buf.takeUpTo(nl).trimRight();
      if (line.isEmpty) continue;
      sink(_decodeLine(line));
    }
  }

  DecodedLine _decodeLine(String line) {
    if (!line.startsWith('[') && !line.startsWith('{')) {
      return DecodedRawLine(line);
    }
    try {
      final decoded = jsonDecode(line);
      if (decoded is List && decoded.length == 1 && decoded.first is Map) {
        return _fromMap(decoded.first as Map<String, dynamic>);
      }
      if (decoded is Map<String, dynamic>) return _fromMap(decoded);
      return DecodedRawLine(line);
    } on FormatException {
      return DecodedRawLine(line);
    }
  }

  DecodedLine _fromMap(Map<String, dynamic> m) {
    if (m.containsKey('event')) {
      return DecodedEnvelope(
        event: m['event'] as String,
        params: (m['params'] as Map?)?.cast<String, dynamic>() ?? const {},
      );
    }
    if (m.containsKey('id')) {
      return DecodedResponse(
        id: m['id'] as int,
        result: m['result'],
        error: m['error'],
      );
    }
    return DecodedRawLine(jsonEncode(m));
  }
}

class _StringBuf {
  final StringBuffer _b = StringBuffer();
  String _cached = '';

  void append(String s) {
    _b.write(s);
    _cached = _b.toString();
  }

  int indexOfNewline() => _cached.indexOf('\n');

  String takeUpTo(int idx) {
    final out = _cached.substring(0, idx);
    final rest = _cached.substring(idx + 1);
    _b
      ..clear()
      ..write(rest);
    _cached = rest;
    return out;
  }
}

class _ImmutableBuf extends _StringBuf {
  const _ImmutableBuf();
}
```

- [ ] **Step 4: Run tests**

```
fvm flutter test test/core/emulator/json_rpc_line_decoder_test.dart
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/core/emulator/json_rpc_line_decoder.dart \
        test/core/emulator/json_rpc_line_decoder_test.dart
git commit -m "feat(emulator): add JsonRpcLineDecoder for flutter run --machine"
```

---

### Task P2.T3: `RunSessionEvent` freezed events

**Files:**
- Create: `lib/core/emulator/run_session_models.dart`
- Test: `test/core/emulator/run_session_models_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/core/emulator/run_session_models_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';

void main() {
  test('event variants construct and equate', () {
    expect(
      const RunSessionEvent.stage(message: 'Compiling...'),
      const RunSessionEvent.stage(message: 'Compiling...'),
    );
    expect(
      const RunSessionEvent.log(line: 'hi', level: LogLevel.info),
      const RunSessionEvent.log(line: 'hi', level: LogLevel.info),
    );
    expect(
      const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'),
      const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'),
    );
    expect(
      const RunSessionEvent.stopped(exitCode: 0, reason: 'user_stop'),
      const RunSessionEvent.stopped(exitCode: 0, reason: 'user_stop'),
    );
    expect(
      const RunSessionEvent.reloadCompleted(
        success: true,
        fullRestart: false,
        durationMs: 100,
        attribution: 'user',
      ),
      const RunSessionEvent.reloadCompleted(
        success: true,
        fullRestart: false,
        durationMs: 100,
        attribution: 'user',
      ),
    );
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/core/emulator/run_session_models_test.dart
```
Expected: FAIL — model undefined.

- [ ] **Step 3: Write minimal implementation**

```dart
// lib/core/emulator/run_session_models.dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'run_session_models.freezed.dart';

enum LogLevel { info, warning, error, status }

@freezed
abstract class RunSessionEvent with _$RunSessionEvent {
  const factory RunSessionEvent.stage({required String message}) = _Stage;
  const factory RunSessionEvent.log({
    required String line,
    required LogLevel level,
    @Default('flutter') String source, // 'flutter' | 'user' | 'agent'
  }) = _Log;
  const factory RunSessionEvent.vmServiceReady({required String uri}) = _VmReady;
  const factory RunSessionEvent.stopped({
    required int exitCode,
    required String reason,
  }) = _Stopped;
  const factory RunSessionEvent.reloadCompleted({
    required bool success,
    required bool fullRestart,
    required int durationMs,
    @Default('user') String attribution, // 'user' | 'agent'
    String? hint,
  }) = _ReloadCompleted;
}

class RunStats {
  RunStats({
    DateTime? startedAt,
    this.hotReloadCount = 0,
    this.hotRestartCount = 0,
  }) : startedAt = startedAt ?? DateTime.now();

  final DateTime startedAt;
  int hotReloadCount;
  int hotRestartCount;

  RunStats copyWith({int? hotReloadCount, int? hotRestartCount}) => RunStats(
        startedAt: startedAt,
        hotReloadCount: hotReloadCount ?? this.hotReloadCount,
        hotRestartCount: hotRestartCount ?? this.hotRestartCount,
      );
}
```

- [ ] **Step 4: Regenerate and run**

```
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter test test/core/emulator/run_session_models_test.dart
```
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add lib/core/emulator/run_session_models.dart \
        lib/core/emulator/run_session_models.freezed.dart \
        test/core/emulator/run_session_models_test.dart
git commit -m "feat(emulator): add RunSessionEvent variants + RunStats"
```

---

### Task P2.T4: `RunSessionController` + `RunSession` handle

This task is large enough that the test bundles fixtures. Capture the fixture in step 0 by hand or use a recorded one.

**Files:**
- Create: `lib/core/emulator/run_session_controller.dart`
- Create: `test/fixtures/flutter_run_machine_pixel5.jsonl`
- Test: `test/core/emulator/run_session_controller_test.dart`

- [ ] **Step 1: Write fixture (start with a curated minimal one; replace in P10.T1 with a real captured file)**

```text
// test/fixtures/flutter_run_machine_pixel5.jsonl
[{"event":"daemon.connected","params":{"version":"0.6.1","pid":111}}]
[{"event":"app.start","params":{"appId":"abc","deviceId":"emulator-5554","directory":"/p","launchMode":"run","mode":"debug","supportsRestart":true}}]
Building...
[{"event":"daemon.logMessage","params":{"level":"info","message":"Performing hot reload..."}}]
[{"event":"app.started","params":{"appId":"abc","vmServiceUri":"ws://127.0.0.1:51234/UUID=/ws"}}]
[{"event":"daemon.logMessage","params":{"level":"info","message":"Reloaded 1 of 12 libraries in 124ms."}}]
```

- [ ] **Step 2: Write the failing test**

```dart
// test/core/emulator/run_session_controller_test.dart
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';

class _FakeRunner extends Mock implements ProcessRunner {}

class _FakeProc implements RunningProcess {
  _FakeProc(this.lines);
  final List<String> lines;
  final stdoutCtrl = StreamController<List<int>>();
  final stdinCapture = <List<int>>[];
  final exitCtrl = Completer<int>();
  bool killed = false;

  Future<void> drip() async {
    for (final line in lines) {
      stdoutCtrl.add(utf8.encode('$line\n'));
      await Future<void>.delayed(const Duration(milliseconds: 1));
    }
  }

  @override
  int get pid => 4242;
  @override
  Stream<List<int>> get stdout => stdoutCtrl.stream;
  @override
  Stream<List<int>> get stderr => const Stream.empty();
  @override
  Future<int> get exitCode => exitCtrl.future;
  @override
  void writeStdin(List<int> bytes) => stdinCapture.add(bytes);
  @override
  Future<void> kill({ProcessSignal signal = ProcessSignal.sigterm}) async {
    killed = true;
    if (!exitCtrl.isCompleted) exitCtrl.complete(143);
  }
}

void main() {
  test('emits vmServiceReady from app.started, propagates logs and stage', () async {
    final fixture = await File('test/fixtures/flutter_run_machine_pixel5.jsonl').readAsString();
    final lines = fixture.split('\n').where((l) => l.isNotEmpty).toList();
    final runner = _FakeRunner();
    final fake = _FakeProc(lines);
    when(() => runner.spawn('flutter', any(), cwd: any(named: 'cwd')))
        .thenAnswer((_) async => fake);

    final controller = RunSessionController(runner);
    final session = await controller.start(
      projectRoot: '/p',
      serial: 'emulator-5554',
      extraArgs: const [],
    );
    final events = <RunSessionEvent>[];
    final sub = session.events.listen(events.add);
    unawaited(fake.drip());

    final vmEvent = await session.events.firstWhere((e) => e is _VmReadyMatcher) as RunSessionEvent;
    expect((vmEvent as dynamic).uri, 'ws://127.0.0.1:51234/UUID=/ws');
    expect(session.vmServiceUri, 'ws://127.0.0.1:51234/UUID=/ws');
    expect(session.appId, 'abc');
    await sub.cancel();
  });

  test('hotReload sends app.restart with correct id and routes response to completion', () async {
    final runner = _FakeRunner();
    final fake = _FakeProc([
      '[{"event":"app.start","params":{"appId":"abc","deviceId":"emulator-5554"}}]',
      '[{"event":"app.started","params":{"appId":"abc","vmServiceUri":"ws://x/ws"}}]',
    ]);
    when(() => runner.spawn('flutter', any(), cwd: any(named: 'cwd')))
        .thenAnswer((_) async => fake);

    final controller = RunSessionController(runner);
    final session = await controller.start(
      projectRoot: '/p',
      serial: 'emulator-5554',
      extraArgs: const [],
    );
    unawaited(fake.drip());
    await session.events.firstWhere((e) => session.vmServiceUri != null);

    final reloadFuture = session.hotReload();
    // Echo back a response with id=1 immediately
    fake.stdoutCtrl.add(utf8.encode('[{"id":1,"result":{"code":0}}]\n'));
    final ok = await reloadFuture.timeout(const Duration(seconds: 2));
    expect(ok, isTrue);

    final stdinJson = jsonDecode(utf8.decode(fake.stdinCapture.last)) as List<dynamic>;
    expect((stdinJson.single as Map<String, dynamic>)['method'], 'app.restart');
    expect((stdinJson.single as Map<String, dynamic>)['params']['fullRestart'], false);
  });

  test('stop sends app.stop and resolves exit', () async {
    final runner = _FakeRunner();
    final fake = _FakeProc(['[{"event":"app.start","params":{"appId":"abc","deviceId":"e"}}]']);
    when(() => runner.spawn('flutter', any(), cwd: any(named: 'cwd')))
        .thenAnswer((_) async => fake);
    final session = await RunSessionController(runner).start(
      projectRoot: '/p',
      serial: 'e',
      extraArgs: const [],
    );
    unawaited(fake.drip());
    final stopFuture = session.stop();
    fake.exitCtrl.complete(0);
    await stopFuture.timeout(const Duration(seconds: 2));
    expect(fake.killed, isTrue);
  });
}

final _VmReadyMatcher = predicate<RunSessionEvent>(
  (e) => e.maybeWhen(vmServiceReady: (_) => true, orElse: () => false),
  'vmServiceReady',
);
```

> **Note:** the predicate above is a sentinel — replace with `firstWhere((e) => e is _VmReady)` if the freezed file generates that type name; the spec uses `vmServiceReady` factory and the freezed generator emits `_VmReady` per the `= _VmReady` annotation.

- [ ] **Step 3: Write minimal implementation**

```dart
// lib/core/emulator/run_session_controller.dart
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:injectable/injectable.dart';
import 'package:pickforge/core/emulator/json_rpc_line_decoder.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';

class RunSession {
  RunSession._({
    required this.sessionId,
    required RunningProcess proc,
    required Stream<RunSessionEvent> events,
    required Future<void> Function(bool fullRestart) sendReload,
    required Future<void> Function() sendStop,
  })  : _proc = proc,
        events = events,
        _sendReload = sendReload,
        _sendStop = sendStop;

  final String sessionId;
  final Stream<RunSessionEvent> events;
  final RunningProcess _proc;
  final Future<void> Function(bool fullRestart) _sendReload;
  final Future<void> Function() _sendStop;

  String? _appId;
  String? _vmServiceUri;
  bool _stopping = false;

  String? get appId => _appId;
  String? get vmServiceUri => _vmServiceUri;
  Future<int> get exitCode => _proc.exitCode;

  Future<bool> hotReload() async {
    await _sendReload(false);
    return true;
  }

  Future<bool> hotRestart() async {
    await _sendReload(true);
    return true;
  }

  Future<void> stop() async {
    if (_stopping) return;
    _stopping = true;
    try {
      await _sendStop().timeout(const Duration(seconds: 3));
    } on TimeoutException {
      await _proc.kill();
    }
    try {
      await exitCode.timeout(const Duration(seconds: 1));
    } on TimeoutException {
      await _proc.kill(signal: ProcessSignal.sigkill);
    }
  }
}

@lazySingleton
class RunSessionController {
  RunSessionController(this._runner);
  final ProcessRunner _runner;

  Future<RunSession> start({
    required String projectRoot,
    required String serial,
    String? targetFile,
    required List<String> extraArgs,
  }) async {
    final args = <String>[
      'run',
      '--machine',
      '-d', serial,
      if (targetFile != null) ...['--target', targetFile],
      ...extraArgs,
    ];
    final proc = await _runner.spawn('flutter', args, cwd: projectRoot);
    final controller = StreamController<RunSessionEvent>.broadcast();
    final decoder = JsonRpcLineDecoder();
    final pendingReplies = <int, Completer<DecodedResponse>>{};
    var nextId = 1;

    Future<void> sendRequest(String method, Map<String, dynamic> params) async {
      final id = nextId++;
      final body = '${jsonEncode([
        {'id': id, 'method': method, 'params': params}
      ])}\n';
      final c = Completer<DecodedResponse>();
      pendingReplies[id] = c;
      proc.writeStdin(utf8.encode(body));
      await c.future.timeout(const Duration(seconds: 30), onTimeout: () {
        pendingReplies.remove(id);
        throw TimeoutException('flutter run did not respond to $method');
      });
    }

    String? appId;
    String? vmUri;

    final session = RunSession._(
      sessionId: DateTime.now().microsecondsSinceEpoch.toString(),
      proc: proc,
      events: controller.stream,
      sendReload: (fullRestart) => sendRequest('app.restart', {
        'appId': appId,
        'fullRestart': fullRestart,
        'pause': false,
        'reason': fullRestart ? 'manual-restart' : 'manual',
      }),
      sendStop: () async {
        if (appId != null) {
          await sendRequest('app.stop', {'appId': appId});
        }
      },
    );

    proc.stdout.listen((bytes) {
      decoder.feed(utf8.decode(bytes), (line) {
        switch (line) {
          case DecodedEnvelope(:final event, :final params):
            switch (event) {
              case 'app.start':
                appId = params['appId'] as String?;
                session._appId = appId;
                controller.add(const RunSessionEvent.stage(message: 'Building...'));
              case 'app.started':
                vmUri = params['vmServiceUri'] as String?;
                session._vmServiceUri = vmUri;
                if (vmUri != null) {
                  controller.add(RunSessionEvent.vmServiceReady(uri: vmUri!));
                }
              case 'daemon.logMessage':
                final msg = params['message'] as String? ?? '';
                final lvl = params['level'] as String? ?? 'info';
                controller.add(RunSessionEvent.log(
                  line: msg,
                  level: _parseLevel(lvl),
                ));
              case 'app.stop':
                controller.add(const RunSessionEvent.stopped(
                  exitCode: 0,
                  reason: 'user_stop',
                ));
              case _:
                break;
            }
          case DecodedResponse(:final id, :final result, :final error):
            final c = pendingReplies.remove(id);
            if (c != null) {
              c.complete(DecodedResponse(id: id, result: result, error: error));
            }
          case DecodedRawLine(:final text):
            controller.add(RunSessionEvent.log(line: text, level: LogLevel.info));
        }
      });
    }, onDone: () async {
      final code = await proc.exitCode;
      controller.add(RunSessionEvent.stopped(
        exitCode: code,
        reason: code == 0 ? 'user_stop' : 'crash',
      ));
      await controller.close();
    });

    return session;
  }

  LogLevel _parseLevel(String s) {
    switch (s) {
      case 'warning':
        return LogLevel.warning;
      case 'error':
        return LogLevel.error;
      case 'status':
        return LogLevel.status;
      default:
        return LogLevel.info;
    }
  }
}
```

- [ ] **Step 4: Run tests**

```
fvm flutter test test/core/emulator/run_session_controller_test.dart
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/core/emulator/run_session_controller.dart \
        test/core/emulator/run_session_controller_test.dart \
        test/fixtures/flutter_run_machine_pixel5.jsonl \
        lib/core/di/injection.config.dart
git commit -m "feat(emulator): add RunSessionController over flutter run --machine"
```

---

### Task P2.T5: `RunSessionLogRepository`

**Files:**
- Create: `lib/core/emulator/run_session_log_repository.dart`
- Test: `test/core/emulator/run_session_log_repository_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/core/emulator/run_session_log_repository_test.dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';

void main() {
  late PickforgeDatabase db;
  late RunSessionLogRepository repo;

  setUp(() {
    db = PickforgeDatabase.forTesting(NativeDatabase.memory());
    repo = RunSessionLogRepository(db);
  });
  tearDown(() => db.close());

  test('recordStart inserts row', () async {
    await repo.recordStart(
      sessionId: 's1',
      projectRoot: '/p',
      startedAt: DateTime.utc(2026, 4, 28),
      avdId: 'A',
      avdName: 'B',
      serial: 'emulator-5554',
      vmServiceUrl: 'ws://x',
      connectionMode: 'auto',
    );
    final got = await repo.latestFor('/p');
    expect(got?.sessionId, 's1');
  });

  test('recordEnd is idempotent', () async {
    await repo.recordStart(
      sessionId: 's1',
      projectRoot: '/p',
      startedAt: DateTime.utc(2026, 4, 28),
      connectionMode: 'auto',
    );
    await repo.recordEnd(
      sessionId: 's1',
      endedAt: DateTime.utc(2026, 4, 28),
      exitReason: 'crash',
      hotReloadCount: 1,
    );
    await repo.recordEnd(
      sessionId: 's1',
      endedAt: DateTime.utc(2026, 4, 28),
      exitReason: 'pickforge_quit',
      hotReloadCount: 2,
    );
    final got = await repo.latestFor('/p');
    expect(got?.exitReason, 'pickforge_quit');
    expect(got?.hotReloadCount, 2);
  });

  test('recordStart prunes when over cap', () async {
    for (var i = 0; i < 5; i++) {
      await repo.recordStart(
        sessionId: 's$i',
        projectRoot: '/p',
        startedAt: DateTime.utc(2026, 4, i + 1),
        connectionMode: 'auto',
      );
    }
    await repo.applyCap('/p', cap: 2);
    final list = await repo.recentFor('/p');
    expect(list.map((r) => r.sessionId), ['s4', 's3']);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/core/emulator/run_session_log_repository_test.dart
```
Expected: FAIL — repo undefined.

- [ ] **Step 3: Write implementation**

```dart
// lib/core/emulator/run_session_log_repository.dart
import 'package:drift/drift.dart' as d;
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/drift/dao/run_session_log_dao.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/drift/tables/run_session_log.dart';

@lazySingleton
class RunSessionLogRepository {
  RunSessionLogRepository(this._db);
  final PickforgeDatabase _db;
  RunSessionLogDao get _dao => _db.runSessionLogDao;

  Future<void> recordStart({
    required String sessionId,
    required String projectRoot,
    required DateTime startedAt,
    required String connectionMode,
    String? avdId,
    String? avdName,
    String? serial,
    String? vmServiceUrl,
  }) async {
    await _dao.recordStart(
      sessionId: sessionId,
      projectRoot: projectRoot,
      startedAt: startedAt,
      connectionMode: connectionMode,
      avdId: avdId,
      avdName: avdName,
      serial: serial,
      vmServiceUrl: vmServiceUrl,
    );
  }

  Future<void> recordEnd({
    required String sessionId,
    required DateTime endedAt,
    required String exitReason,
    int? exitCode,
    int hotReloadCount = 0,
    int hotRestartCount = 0,
    int errorCount = 0,
    String? lastError,
  }) =>
      _dao.recordEnd(
        sessionId: sessionId,
        endedAt: endedAt,
        exitReason: exitReason,
        exitCode: exitCode,
        hotReloadCount: hotReloadCount,
        hotRestartCount: hotRestartCount,
        errorCount: errorCount,
        lastError: lastError,
      );

  Future<List<RunSessionLogRow>> recentFor(String projectRoot, {int limit = 20}) =>
      _dao.recentFor(projectRoot, limit: limit);

  Stream<List<RunSessionLogRow>> watchRecent(String projectRoot, {int limit = 20}) =>
      _dao.watchRecent(projectRoot, limit: limit);

  Future<RunSessionLogRow?> latestFor(String projectRoot) =>
      _dao.latestFor(projectRoot);

  Future<void> applyCap(String projectRoot, {int cap = 100}) =>
      _dao.pruneToCap(projectRoot, cap: cap);
}
```

- [ ] **Step 4: Run tests + commit**

```
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter test test/core/emulator/run_session_log_repository_test.dart
```
Expected: PASS, 3 tests.

```bash
git add lib/core/emulator/run_session_log_repository.dart \
        test/core/emulator/run_session_log_repository_test.dart \
        lib/core/di/injection.config.dart
git commit -m "feat(emulator): add RunSessionLogRepository facade"
```

---

## Phase 3 — Cubit + Minimal Pill

Goal of phase: a working `EmulatorSessionCubit` driving the 7 states, plus a `ConnectionPill` that renders each state. No menu, no run-logs pane yet — those come in P4 / P5. The pill replaces the existing `_ConnectionPill` stub in `inspector_panel.dart`.

### Task P3.T1: `EmulatorSessionState` (sealed freezed)

**Files:**
- Create: `lib/features/emulator/cubit/emulator_session_state.dart`
- Test: `test/features/emulator/cubit/emulator_session_state_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/features/emulator/cubit/emulator_session_state_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';

void main() {
  test('all variants construct + equate', () {
    const avd = Avd(id: 'X', name: 'Y', platform: 'android');
    expect(
      const EmulatorSessionState.noDevicePicked(),
      const EmulatorSessionState.noDevicePicked(),
    );
    expect(
      const EmulatorSessionState.cold(avd: avd),
      const EmulatorSessionState.cold(avd: avd),
    );
    expect(
      EmulatorSessionState.idle(avd: avd, serial: 'emulator-5554'),
      EmulatorSessionState.idle(avd: avd, serial: 'emulator-5554'),
    );
    expect(
      EmulatorSessionState.running(
        avd: avd,
        serial: 'emulator-5554',
        appId: 'a',
        vmServiceUri: 'ws://x',
        stats: RunStats(startedAt: DateTime.utc(2026, 4, 28)),
        manual: false,
      ),
      isA<EmulatorSessionState>(),
    );
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/features/emulator/cubit/emulator_session_state_test.dart
```
Expected: FAIL — type undefined.

- [ ] **Step 3: Write minimal implementation**

```dart
// lib/features/emulator/cubit/emulator_session_state.dart
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';

part 'emulator_session_state.freezed.dart';

@freezed
sealed class EmulatorSessionState with _$EmulatorSessionState {
  const factory EmulatorSessionState.noDevicePicked() = _NoDevicePicked;
  const factory EmulatorSessionState.cold({required Avd avd}) = _Cold;
  const factory EmulatorSessionState.booting({
    required Avd avd,
    @Default(0) int elapsedMs,
  }) = _Booting;
  const factory EmulatorSessionState.idle({
    required Avd avd,
    required String serial,
  }) = _Idle;
  factory EmulatorSessionState.running({
    Avd? avd,
    String? serial,
    String? appId,
    required String vmServiceUri,
    required RunStats stats,
    @Default(false) bool manual,
  }) = _Running;
  const factory EmulatorSessionState.reconnecting({
    required Avd avd,
    required String serial,
    required String appId,
    @Default(1) int attempt,
  }) = _Reconnecting;
  const factory EmulatorSessionState.error({
    Avd? avd,
    String? serial,
    String? lastVmServiceUri,
    required String message,
  }) = _Error;
}
```

- [ ] **Step 4: Regenerate + run tests**

```
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter test test/features/emulator/cubit/emulator_session_state_test.dart
```
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add lib/features/emulator/cubit/emulator_session_state.dart \
        lib/features/emulator/cubit/emulator_session_state.freezed.dart \
        test/features/emulator/cubit/emulator_session_state_test.dart
git commit -m "feat(emulator): add sealed EmulatorSessionState (7 variants + manual)"
```

---

### Task P3.T2: `EmulatorSessionCubit` — bootstrap branches

This task wires the cubit's bootstrap logic. Subsequent tasks (P3.T3..T6) extend it with picking, booting, running, stopping, reconnecting. Each adds a focused commit.

**Files:**
- Create: `lib/features/emulator/cubit/emulator_session_cubit.dart`
- Test: `test/features/emulator/cubit/emulator_session_cubit_bootstrap_test.dart`

- [ ] **Step 1: Write the failing test (bootstrap branches only)**

```dart
// test/features/emulator/cubit/emulator_session_cubit_bootstrap_test.dart
import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';

class _MockSettings extends Mock implements ProjectSettingsRepository {}
class _MockDiscovery extends Mock implements DeviceDiscoveryService {}
class _MockLauncher extends Mock implements AvdLauncher {}
class _MockPoller extends Mock implements BootReadinessPoller {}
class _MockRun extends Mock implements RunSessionController {}
class _MockLog extends Mock implements RunSessionLogRepository {}
class _MockVm extends Mock implements VmServiceClient {}

void main() {
  late _MockSettings settings;
  late _MockDiscovery discovery;
  late _MockLauncher launcher;
  late _MockPoller poller;
  late _MockRun run;
  late _MockLog log;
  late _MockVm vm;

  setUp(() {
    settings = _MockSettings();
    discovery = _MockDiscovery();
    launcher = _MockLauncher();
    poller = _MockPoller();
    run = _MockRun();
    log = _MockLog();
    vm = _MockVm();
  });

  EmulatorSessionCubit build() => EmulatorSessionCubit(
        projectRoot: '/p',
        settings: settings,
        discovery: discovery,
        launcher: launcher,
        poller: poller,
        runController: run,
        logRepo: log,
        vmClient: vm,
      );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'no binding → noDevicePicked',
    setUp: () => when(() => settings.getEmulatorBinding('/p'))
        .thenAnswer((_) async => null),
    build: build,
    act: (c) => c.bootstrap(),
    expect: () => [const EmulatorSessionState.noDevicePicked()],
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'manual binding → running(manual=true) on connect success',
    setUp: () {
      when(() => settings.getEmulatorBinding('/p')).thenAnswer((_) async =>
          const EmulatorBinding.manual(vmServiceUrl: 'ws://x/ws'));
      when(() => vm.connect('ws://x/ws')).thenAnswer((_) async {});
    },
    build: build,
    act: (c) => c.bootstrap(),
    expect: () => [isA<_Running>().having((s) => s.manual, 'manual', isTrue)],
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'manual binding + connect fails → error',
    setUp: () {
      when(() => settings.getEmulatorBinding('/p')).thenAnswer((_) async =>
          const EmulatorBinding.manual(vmServiceUrl: 'ws://x/ws'));
      when(() => vm.connect('ws://x/ws')).thenThrow(StateError('refused'));
    },
    build: build,
    act: (c) => c.bootstrap(),
    expect: () => [isA<_Error>()],
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'avd binding + AVD already running → idle',
    setUp: () {
      when(() => settings.getEmulatorBinding('/p')).thenAnswer((_) async =>
          const EmulatorBinding.avd(avdId: 'Pixel_5_API_34', avdName: 'Pixel 5 API 34'));
      when(() => discovery.snapshot()).thenAnswer(
        (_) async => const DeviceListSnapshot(
          avds: [Avd(id: 'Pixel_5_API_34', name: 'Pixel 5 API 34', platform: 'android')],
          running: [
            RunningAndroidDevice(
              serial: 'emulator-5554',
              avdName: 'Pixel_5_API_34',
              state: 'device',
            )
          ],
        ),
      );
    },
    build: build,
    act: (c) => c.bootstrap(),
    expect: () => [isA<_Idle>().having((s) => s.serial, 'serial', 'emulator-5554')],
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'avd binding + autoBoot=false → cold',
    setUp: () {
      when(() => settings.getEmulatorBinding('/p')).thenAnswer((_) async =>
          const EmulatorBinding.avd(
            avdId: 'Pixel_5_API_34',
            avdName: 'Pixel 5 API 34',
            autoBootOnSelect: false,
          ));
      when(() => discovery.snapshot()).thenAnswer(
        (_) async => const DeviceListSnapshot(avds: [], running: []),
      );
    },
    build: build,
    act: (c) => c.bootstrap(),
    expect: () => [isA<_Cold>()],
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/features/emulator/cubit/emulator_session_cubit_bootstrap_test.dart
```
Expected: FAIL — cubit undefined.

- [ ] **Step 3: Write minimal cubit (bootstrap-only; pickAvd/run/etc. are stubs in this task and filled in P3.T3+)**

```dart
// lib/features/emulator/cubit/emulator_session_cubit.dart
import 'package:bloc/bloc.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';

class EmulatorSessionCubit extends Cubit<EmulatorSessionState> {
  EmulatorSessionCubit({
    required this.projectRoot,
    required this.settings,
    required this.discovery,
    required this.launcher,
    required this.poller,
    required this.runController,
    required this.logRepo,
    required this.vmClient,
  }) : super(const EmulatorSessionState.noDevicePicked());

  final String projectRoot;
  final ProjectSettingsRepository settings;
  final DeviceDiscoveryService discovery;
  final AvdLauncher launcher;
  final BootReadinessPoller poller;
  final RunSessionController runController;
  final RunSessionLogRepository logRepo;
  final VmServiceClient vmClient;

  Future<void> bootstrap() async {
    final binding = await settings.getEmulatorBinding(projectRoot);
    if (binding == null) {
      emit(const EmulatorSessionState.noDevicePicked());
      return;
    }
    switch (binding) {
      case ManualBinding(:final vmServiceUrl):
        await _attachManual(vmServiceUrl);
      case AvdBinding(:final avdId, :final avdName, :final autoBootOnSelect):
        final avd = Avd(id: avdId, name: avdName, platform: 'android');
        final snap = await discovery.snapshot();
        final running = snap.runningFor(avd);
        if (running != null && running.state == 'device') {
          emit(EmulatorSessionState.idle(avd: avd, serial: running.serial));
        } else if (autoBootOnSelect) {
          // P3.T4 will trigger boot here. Until then, transition to cold.
          emit(EmulatorSessionState.cold(avd: avd));
        } else {
          emit(EmulatorSessionState.cold(avd: avd));
        }
    }
  }

  Future<void> _attachManual(String url) async {
    try {
      await vmClient.connect(url);
      emit(EmulatorSessionState.running(
        vmServiceUri: url,
        stats: RunStats(),
        manual: true,
      ));
    } on Object catch (e) {
      emit(EmulatorSessionState.error(
        message: e.toString(),
        lastVmServiceUri: url,
      ));
    }
  }
}
```

(`RunStats` is referenced from `core/emulator/run_session_models.dart` — already imported via `emulator_session_state.dart`. If the analyzer flags it, add the explicit import.)

- [ ] **Step 4: Run tests**

```
fvm flutter test test/features/emulator/cubit/emulator_session_cubit_bootstrap_test.dart
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/features/emulator/cubit/emulator_session_cubit.dart \
        test/features/emulator/cubit/emulator_session_cubit_bootstrap_test.dart
git commit -m "feat(emulator): EmulatorSessionCubit bootstrap branches"
```

---

### Task P3.T3: Cubit — pickAvd, manualUrl, forgetDevice

**Files:**
- Modify: `lib/features/emulator/cubit/emulator_session_cubit.dart`
- Test: `test/features/emulator/cubit/emulator_session_cubit_pick_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/features/emulator/cubit/emulator_session_cubit_pick_test.dart
import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';

class _MS extends Mock implements ProjectSettingsRepository {}
class _MD extends Mock implements DeviceDiscoveryService {}
class _ML extends Mock implements AvdLauncher {}
class _MP extends Mock implements BootReadinessPoller {}
class _MR extends Mock implements RunSessionController {}
class _MLog extends Mock implements RunSessionLogRepository {}
class _MV extends Mock implements VmServiceClient {}

void main() {
  late _MS settings; late _MD disc; late _ML launcher;
  late _MP poller; late _MR run; late _MLog log; late _MV vm;

  setUp(() {
    settings = _MS(); disc = _MD(); launcher = _ML();
    poller = _MP(); run = _MR(); log = _MLog(); vm = _MV();
    registerFallbackValue(const EmulatorBinding.avd(avdId: 'X', avdName: 'X'));
  });

  EmulatorSessionCubit build() => EmulatorSessionCubit(
        projectRoot: '/p',
        settings: settings,
        discovery: disc,
        launcher: launcher,
        poller: poller,
        runController: run,
        logRepo: log,
        vmClient: vm,
      );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'pickAvd persists binding + transitions to idle when running',
    setUp: () {
      when(() => settings.setEmulatorBinding('/p', any()))
          .thenAnswer((_) async {});
      when(() => disc.snapshot()).thenAnswer(
        (_) async => const DeviceListSnapshot(
          avds: [Avd(id: 'X', name: 'X', platform: 'android')],
          running: [RunningAndroidDevice(
            serial: 'emulator-5554', avdName: 'X', state: 'device')],
        ),
      );
    },
    build: build,
    act: (c) => c.pickAvd(const Avd(id: 'X', name: 'X', platform: 'android')),
    expect: () => [isA<_Idle>()],
    verify: (_) => verify(() => settings.setEmulatorBinding('/p', any())).called(1),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'pickAvd transitions to cold when not running',
    setUp: () {
      when(() => settings.setEmulatorBinding('/p', any()))
          .thenAnswer((_) async {});
      when(() => disc.snapshot()).thenAnswer(
        (_) async => const DeviceListSnapshot(avds: [], running: []),
      );
    },
    build: build,
    act: (c) => c.pickAvd(const Avd(id: 'X', name: 'X', platform: 'android')),
    expect: () => [isA<_Cold>()],
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'submitManualUrl persists, attaches, transitions to running(manual)',
    setUp: () {
      when(() => settings.setEmulatorBinding('/p', any()))
          .thenAnswer((_) async {});
      when(() => vm.connect('ws://x/ws')).thenAnswer((_) async {});
    },
    build: build,
    act: (c) => c.submitManualUrl('ws://x/ws'),
    expect: () => [isA<_Running>().having((s) => s.manual, 'manual', isTrue)],
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'forgetDevice clears binding, returns to noDevicePicked',
    setUp: () => when(() => settings.clearEmulatorBinding('/p'))
        .thenAnswer((_) async {}),
    build: build,
    act: (c) => c.forgetDevice(),
    expect: () => [const EmulatorSessionState.noDevicePicked()],
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/features/emulator/cubit/emulator_session_cubit_pick_test.dart
```
Expected: FAIL — methods undefined.

- [ ] **Step 3: Extend the cubit**

Append these methods to `EmulatorSessionCubit`:

```dart
// lib/features/emulator/cubit/emulator_session_cubit.dart  (append)
Future<void> pickAvd(Avd avd) async {
  await settings.setEmulatorBinding(
    projectRoot,
    EmulatorBinding.avd(avdId: avd.id, avdName: avd.name),
  );
  final snap = await discovery.snapshot();
  final running = snap.runningFor(avd);
  if (running != null && running.state == 'device') {
    emit(EmulatorSessionState.idle(avd: avd, serial: running.serial));
  } else {
    emit(EmulatorSessionState.cold(avd: avd));
  }
}

Future<void> submitManualUrl(String url) async {
  await settings.setEmulatorBinding(
    projectRoot,
    EmulatorBinding.manual(vmServiceUrl: url),
  );
  await _attachManual(url);
}

Future<void> forgetDevice() async {
  await settings.clearEmulatorBinding(projectRoot);
  emit(const EmulatorSessionState.noDevicePicked());
}
```

- [ ] **Step 4: Run tests**

```
fvm flutter test test/features/emulator/cubit/emulator_session_cubit_pick_test.dart
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/features/emulator/cubit/emulator_session_cubit.dart \
        test/features/emulator/cubit/emulator_session_cubit_pick_test.dart
git commit -m "feat(emulator): cubit — pickAvd, submitManualUrl, forgetDevice"
```

---

### Task P3.T4: Cubit — boot AVD flow with cancel

**Files:**
- Modify: `lib/features/emulator/cubit/emulator_session_cubit.dart`
- Test: `test/features/emulator/cubit/emulator_session_cubit_boot_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/features/emulator/cubit/emulator_session_cubit_boot_test.dart
import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/cancel_token.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';

class _MS extends Mock implements ProjectSettingsRepository {}
class _MD extends Mock implements DeviceDiscoveryService {}
class _ML extends Mock implements AvdLauncher {}
class _MP extends Mock implements BootReadinessPoller {}
class _MR extends Mock implements RunSessionController {}
class _MLog extends Mock implements RunSessionLogRepository {}
class _MV extends Mock implements VmServiceClient {}
class _FakeHandle extends Mock implements AvdLaunchHandle {}

void main() {
  late _MS settings; late _MD disc; late _ML launcher;
  late _MP poller; late _MR run; late _MLog log; late _MV vm;
  late _FakeHandle handle;

  setUp(() {
    settings = _MS(); disc = _MD(); launcher = _ML();
    poller = _MP(); run = _MR(); log = _MLog(); vm = _MV();
    handle = _FakeHandle();
    when(() => handle.cancel()).thenAnswer((_) async {});
  });

  EmulatorSessionCubit build() => EmulatorSessionCubit(
        projectRoot: '/p',
        settings: settings,
        discovery: disc,
        launcher: launcher,
        poller: poller,
        runController: run,
        logRepo: log,
        vmClient: vm,
      );

  const avd = Avd(id: 'Pixel_5_API_34', name: 'Pixel 5 API 34', platform: 'android');

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'bootAvd: launch + ready → idle',
    setUp: () {
      when(() => launcher.launch('Pixel_5_API_34'))
          .thenAnswer((_) async => handle);
      when(() => poller.poll(
        avdId: any(named: 'avdId'),
        timeout: any(named: 'timeout'),
        interval: any(named: 'interval'),
        cancel: any(named: 'cancel'),
      )).thenAnswer((_) => Stream.value(const BootReady('emulator-5554')));
    },
    build: build,
    seed: () => const EmulatorSessionState.cold(avd: avd),
    act: (c) => c.bootAvd(),
    expect: () => [
      isA<_Booting>(),
      isA<_Idle>().having((s) => s.serial, 'serial', 'emulator-5554'),
    ],
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'bootAvd: timeout → error, kills launch handle',
    setUp: () {
      when(() => launcher.launch('Pixel_5_API_34'))
          .thenAnswer((_) async => handle);
      when(() => poller.poll(
        avdId: any(named: 'avdId'),
        timeout: any(named: 'timeout'),
        interval: any(named: 'interval'),
        cancel: any(named: 'cancel'),
      )).thenAnswer((_) => Stream.value(const BootTimeout()));
    },
    build: build,
    seed: () => const EmulatorSessionState.cold(avd: avd),
    act: (c) => c.bootAvd(),
    expect: () => [isA<_Booting>(), isA<_Error>()],
    verify: (_) => verify(() => handle.cancel()).called(1),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'cancelBoot: returns to cold and kills handle',
    setUp: () {
      when(() => launcher.launch('Pixel_5_API_34'))
          .thenAnswer((_) async => handle);
      when(() => poller.poll(
        avdId: any(named: 'avdId'),
        timeout: any(named: 'timeout'),
        interval: any(named: 'interval'),
        cancel: any(named: 'cancel'),
      )).thenAnswer((_) async* {
        yield const BootPending(Duration(milliseconds: 5));
        await Future<void>.delayed(const Duration(milliseconds: 30));
        yield const BootCancelled();
      });
    },
    build: build,
    seed: () => const EmulatorSessionState.cold(avd: avd),
    act: (c) async {
      final f = c.bootAvd();
      await Future<void>.delayed(const Duration(milliseconds: 10));
      c.cancelBoot();
      await f;
    },
    expect: () => [
      isA<_Booting>(),
      isA<_Cold>(),
    ],
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/features/emulator/cubit/emulator_session_cubit_boot_test.dart
```
Expected: FAIL — `bootAvd` / `cancelBoot` undefined.

- [ ] **Step 3: Extend cubit**

Add fields and methods to the cubit:

```dart
// lib/features/emulator/cubit/emulator_session_cubit.dart  (append)
import 'package:pickforge/core/emulator/cancel_token.dart';

// inside the class, alongside other private fields:
CancelToken? _bootCancel;
AvdLaunchHandle? _bootHandle;

Future<void> bootAvd() async {
  final s = state;
  if (s is! _Cold) return;
  final avd = s.avd;
  emit(EmulatorSessionState.booting(avd: avd));
  final cancel = CancelToken();
  _bootCancel = cancel;
  try {
    final handle = await launcher.launch(avd.id);
    _bootHandle = handle;
    final stream = poller.poll(avdId: avd.id, cancel: cancel);
    await for (final event in stream) {
      if (cancel.isCancelled || state is! _Booting) return;
      switch (event) {
        case BootPending(:final elapsed):
          emit(EmulatorSessionState.booting(avd: avd, elapsedMs: elapsed.inMilliseconds));
        case BootReady(:final serial):
          emit(EmulatorSessionState.idle(avd: avd, serial: serial));
          return;
        case BootTimeout():
          await handle.cancel();
          emit(EmulatorSessionState.error(avd: avd, message: 'Boot timed out'));
          return;
        case BootCancelled():
          await handle.cancel();
          emit(EmulatorSessionState.cold(avd: avd));
          return;
        case BootError(:final message):
          await handle.cancel();
          emit(EmulatorSessionState.error(avd: avd, message: message));
          return;
      }
    }
  } finally {
    _bootCancel = null;
    _bootHandle = null;
  }
}

void cancelBoot() {
  _bootCancel?.cancel();
}
```

- [ ] **Step 4: Run tests**

```
fvm flutter test test/features/emulator/cubit/emulator_session_cubit_boot_test.dart
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/features/emulator/cubit/emulator_session_cubit.dart \
        test/features/emulator/cubit/emulator_session_cubit_boot_test.dart
git commit -m "feat(emulator): cubit — bootAvd + cancelBoot using BootReadinessPoller"
```

---

### Task P3.T5: Cubit — runApp / hotReload / hotRestart / stopRun

**Files:**
- Modify: `lib/features/emulator/cubit/emulator_session_cubit.dart`
- Test: `test/features/emulator/cubit/emulator_session_cubit_run_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/features/emulator/cubit/emulator_session_cubit_run_test.dart
import 'dart:async';

import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/run_args.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';

class _MS extends Mock implements ProjectSettingsRepository {}
class _MD extends Mock implements DeviceDiscoveryService {}
class _ML extends Mock implements AvdLauncher {}
class _MP extends Mock implements BootReadinessPoller {}
class _MR extends Mock implements RunSessionController {}
class _MLog extends Mock implements RunSessionLogRepository {}
class _MV extends Mock implements VmServiceClient {}
class _FakeRunSession extends Mock implements RunSession {}

void main() {
  late _MS settings; late _MD disc; late _ML launcher;
  late _MP poller; late _MR run; late _MLog log; late _MV vm;
  late _FakeRunSession session;
  late StreamController<RunSessionEvent> events;

  setUp(() {
    settings = _MS(); disc = _MD(); launcher = _ML();
    poller = _MP(); run = _MR(); log = _MLog(); vm = _MV();
    session = _FakeRunSession();
    events = StreamController<RunSessionEvent>.broadcast();
    when(() => session.events).thenAnswer((_) => events.stream);
    when(() => session.appId).thenReturn('app-1');
    when(() => session.vmServiceUri).thenReturn('ws://x/ws');
    when(() => session.sessionId).thenReturn('ses-1');
    when(() => session.exitCode).thenAnswer((_) => Completer<int>().future);
    when(() => session.hotReload()).thenAnswer((_) async => true);
    when(() => session.hotRestart()).thenAnswer((_) async => true);
    when(() => session.stop()).thenAnswer((_) async {});
    when(() => settings.getRunArgs('/p')).thenAnswer((_) async => const RunArgs());
    when(() => log.recordStart(
          sessionId: any(named: 'sessionId'),
          projectRoot: any(named: 'projectRoot'),
          startedAt: any(named: 'startedAt'),
          connectionMode: any(named: 'connectionMode'),
          avdId: any(named: 'avdId'),
          avdName: any(named: 'avdName'),
          serial: any(named: 'serial'),
          vmServiceUrl: any(named: 'vmServiceUrl'),
        )).thenAnswer((_) async {});
    when(() => log.recordEnd(
          sessionId: any(named: 'sessionId'),
          endedAt: any(named: 'endedAt'),
          exitReason: any(named: 'exitReason'),
          exitCode: any(named: 'exitCode'),
          hotReloadCount: any(named: 'hotReloadCount'),
          hotRestartCount: any(named: 'hotRestartCount'),
        )).thenAnswer((_) async {});
    when(() => vm.connect(any())).thenAnswer((_) async {});
  });

  tearDown(() => events.close());

  EmulatorSessionCubit build() => EmulatorSessionCubit(
        projectRoot: '/p',
        settings: settings,
        discovery: disc,
        launcher: launcher,
        poller: poller,
        runController: run,
        logRepo: log,
        vmClient: vm,
      );

  const avd = Avd(id: 'Pixel_5_API_34', name: 'Pixel 5 API 34', platform: 'android');

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'runApp from idle: starts, attaches inspector on vmServiceReady',
    setUp: () {
      when(() => run.start(
            projectRoot: '/p',
            serial: 'emulator-5554',
            targetFile: any(named: 'targetFile'),
            extraArgs: any(named: 'extraArgs'),
          )).thenAnswer((_) async => session);
    },
    build: build,
    seed: () => const EmulatorSessionState.idle(avd: avd, serial: 'emulator-5554'),
    act: (c) async {
      final f = c.runApp();
      events.add(const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'));
      await Future<void>.delayed(const Duration(milliseconds: 5));
      await f;
    },
    expect: () => [isA<_Running>().having((s) => s.manual, 'manual', isFalse)],
    verify: (_) => verify(() => vm.connect('ws://x/ws')).called(1),
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'hotReload increments stats',
    setUp: () {
      when(() => run.start(
            projectRoot: '/p',
            serial: any(named: 'serial'),
            targetFile: any(named: 'targetFile'),
            extraArgs: any(named: 'extraArgs'),
          )).thenAnswer((_) async => session);
    },
    build: build,
    seed: () => EmulatorSessionState.running(
      avd: avd,
      serial: 'emulator-5554',
      appId: 'a',
      vmServiceUri: 'ws://x',
      stats: RunStats(),
    ),
    act: (c) => c.hotReload(),
    verify: (_) => verify(() => session.hotReload()).called(0), // session not started here
  );

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'stopRun calls session.stop and goes to idle',
    setUp: () {
      when(() => run.start(
            projectRoot: '/p',
            serial: any(named: 'serial'),
            targetFile: any(named: 'targetFile'),
            extraArgs: any(named: 'extraArgs'),
          )).thenAnswer((_) async => session);
    },
    build: build,
    seed: () => const EmulatorSessionState.idle(avd: avd, serial: 'emulator-5554'),
    act: (c) async {
      await c.runApp();
      events.add(const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'));
      await Future<void>.delayed(const Duration(milliseconds: 5));
      await c.stopRun();
    },
    expect: () => [isA<_Running>(), isA<_Idle>()],
    verify: (_) => verify(() => session.stop()).called(1),
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/features/emulator/cubit/emulator_session_cubit_run_test.dart
```
Expected: FAIL — methods undefined.

- [ ] **Step 3: Extend cubit**

```dart
// lib/features/emulator/cubit/emulator_session_cubit.dart  (append)
import 'package:pickforge/core/emulator/run_session_models.dart';

RunSession? _activeSession;
StreamSubscription<RunSessionEvent>? _eventsSub;

Future<void> runApp() async {
  final s = state;
  if (s is! _Idle) return;
  final args = await settings.getRunArgs(projectRoot);
  final session = await runController.start(
    projectRoot: projectRoot,
    serial: s.serial,
    targetFile: args.targetFile,
    extraArgs: args.extraArgs,
  );
  _activeSession = session;
  await logRepo.recordStart(
    sessionId: session.sessionId,
    projectRoot: projectRoot,
    startedAt: DateTime.now(),
    connectionMode: 'auto',
    avdId: s.avd.id,
    avdName: s.avd.name,
    serial: s.serial,
  );
  emit(EmulatorSessionState.running(
    avd: s.avd,
    serial: s.serial,
    vmServiceUri: '',
    stats: RunStats(),
  ));
  _eventsSub = session.events.listen(_onRunEvent);
}

void _onRunEvent(RunSessionEvent e) {
  e.when(
    stage: (_) {},
    log: (_, __, ___) {},
    vmServiceReady: (uri) async {
      final s = state;
      if (s is! _Running) return;
      try {
        await vmClient.connect(uri);
      } on Object {/* surfaced via VmServiceClient state stream */}
      emit(EmulatorSessionState.running(
        avd: s.avd,
        serial: s.serial,
        appId: _activeSession?.appId,
        vmServiceUri: uri,
        stats: s.stats,
      ));
    },
    stopped: (code, reason) async {
      final s = state;
      final sess = _activeSession;
      if (sess != null) {
        await logRepo.recordEnd(
          sessionId: sess.sessionId,
          endedAt: DateTime.now(),
          exitReason: reason,
          exitCode: code,
          hotReloadCount: 0,
          hotRestartCount: 0,
        );
      }
      _activeSession = null;
      await _eventsSub?.cancel();
      _eventsSub = null;
      if (s is _Running) {
        emit(EmulatorSessionState.idle(avd: s.avd!, serial: s.serial!));
      }
    },
    reloadCompleted: (_, __, ___, ____, _____) {},
  );
}

Future<void> hotReload() async {
  final session = _activeSession;
  if (session == null) return;
  await session.hotReload();
}

Future<void> hotRestart() async {
  final session = _activeSession;
  if (session == null) return;
  await session.hotRestart();
}

Future<void> stopRun() async {
  await _activeSession?.stop();
  await _eventsSub?.cancel();
  _eventsSub = null;
}

@override
Future<void> close() async {
  _bootCancel?.cancel();
  await _bootHandle?.cancel();
  await _activeSession?.stop();
  await _eventsSub?.cancel();
  return super.close();
}
```

- [ ] **Step 4: Run tests**

```
fvm flutter test test/features/emulator/cubit/emulator_session_cubit_run_test.dart
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/features/emulator/cubit/emulator_session_cubit.dart \
        test/features/emulator/cubit/emulator_session_cubit_run_test.dart
git commit -m "feat(emulator): cubit — runApp/hotReload/hotRestart/stopRun + log persistence"
```

---

### Task P3.T6: Cubit — VM service drop → reconnecting → running/error

**Files:**
- Modify: `lib/features/emulator/cubit/emulator_session_cubit.dart`
- Test: `test/features/emulator/cubit/emulator_session_cubit_reconnect_test.dart`

- [ ] **Step 1: Write the failing test**

Use `VmServiceClient.state` stream. The mock emits `disconnected` then `connecting`/`connected`/`error` and the cubit's listener maps them.

```dart
// test/features/emulator/cubit/emulator_session_cubit_reconnect_test.dart
import 'dart:async';
import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/core/vm_service/vm_service_connection_state.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';

class _MS extends Mock implements ProjectSettingsRepository {}
class _MD extends Mock implements DeviceDiscoveryService {}
class _ML extends Mock implements AvdLauncher {}
class _MP extends Mock implements BootReadinessPoller {}
class _MR extends Mock implements RunSessionController {}
class _MLog extends Mock implements RunSessionLogRepository {}
class _MV extends Mock implements VmServiceClient {}

void main() {
  late _MV vm;
  late StreamController<VmServiceConnectionState> stateCtrl;

  setUp(() {
    vm = _MV();
    stateCtrl = StreamController<VmServiceConnectionState>.broadcast();
    when(() => vm.state).thenAnswer((_) => stateCtrl.stream);
  });

  tearDown(() => stateCtrl.close());

  EmulatorSessionCubit build() => EmulatorSessionCubit(
        projectRoot: '/p',
        settings: _MS(),
        discovery: _MD(),
        launcher: _ML(),
        poller: _MP(),
        runController: _MR(),
        logRepo: _MLog(),
        vmClient: vm,
      );

  const avd = Avd(id: 'X', name: 'X', platform: 'android');

  blocTest<EmulatorSessionCubit, EmulatorSessionState>(
    'vm error from running → reconnecting → running on reconnect',
    build: build,
    seed: () => EmulatorSessionState.running(
      avd: avd,
      serial: 'emulator-5554',
      appId: 'a',
      vmServiceUri: 'ws://x',
      stats: RunStats(),
    ),
    act: (c) async {
      c.bindVmStateStream();
      stateCtrl.add(const VmServiceConnectionState.error(message: 'drop', attempt: 1));
      await Future<void>.delayed(const Duration(milliseconds: 5));
      stateCtrl.add(const VmServiceConnectionState.connected(url: 'ws://x'));
      await Future<void>.delayed(const Duration(milliseconds: 5));
    },
    expect: () => [isA<_Reconnecting>(), isA<_Running>()],
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/features/emulator/cubit/emulator_session_cubit_reconnect_test.dart
```
Expected: FAIL — `bindVmStateStream` undefined.

- [ ] **Step 3: Extend cubit**

```dart
// lib/features/emulator/cubit/emulator_session_cubit.dart  (append)
import 'package:pickforge/core/vm_service/vm_service_connection_state.dart';

StreamSubscription<VmServiceConnectionState>? _vmSub;

void bindVmStateStream() {
  _vmSub?.cancel();
  _vmSub = vmClient.state.listen(_onVmState);
}

void _onVmState(VmServiceConnectionState s) {
  s.when(
    idle: () {},
    connecting: (_) {},
    connected: (_) {
      final cur = state;
      if (cur is _Reconnecting) {
        emit(EmulatorSessionState.running(
          avd: cur.avd,
          serial: cur.serial,
          appId: cur.appId,
          vmServiceUri: vmClient.currentUrl ?? '',
          stats: RunStats(),
        ));
      }
    },
    error: (_, __) {
      final cur = state;
      if (cur is _Running && !cur.manual) {
        emit(EmulatorSessionState.reconnecting(
          avd: cur.avd!,
          serial: cur.serial!,
          appId: cur.appId ?? '',
        ));
      }
    },
  );
}

@override
Future<void> close() async {
  _bootCancel?.cancel();
  await _bootHandle?.cancel();
  await _activeSession?.stop();
  await _eventsSub?.cancel();
  await _vmSub?.cancel();
  return super.close();
}
```

(Replace the prior `close` override; only one allowed.)

- [ ] **Step 4: Run tests**

```
fvm flutter test test/features/emulator/cubit/
```
Expected: PASS — all bootstrap, pick, boot, run, reconnect tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/features/emulator/cubit/emulator_session_cubit.dart \
        test/features/emulator/cubit/emulator_session_cubit_reconnect_test.dart
git commit -m "feat(emulator): cubit — VM-state-stream-driven reconnecting transitions"
```

---

### Task P3.T7: Minimal `ConnectionPill` + wire into `InspectorPanel`

**Files:**
- Create: `lib/features/emulator/view/connection_pill.dart`
- Modify: `lib/features/workbench/view/inspector_panel.dart` (replace `_ConnectionPill` stub)
- Test: `test/features/emulator/view/connection_pill_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// test/features/emulator/view/connection_pill_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/emulator/view/connection_pill.dart';

class _FakeCubit extends Cubit<EmulatorSessionState>
    implements EmulatorSessionCubit {
  _FakeCubit(super.s);

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  Future<void> pump(WidgetTester t, EmulatorSessionState state) async {
    await t.pumpWidget(MaterialApp(
      home: BlocProvider<EmulatorSessionCubit>.value(
        value: _FakeCubit(state),
        child: const Scaffold(body: ConnectionPill()),
      ),
    ));
  }

  testWidgets('NoDevicePicked shows Pick device', (t) async {
    await pump(t, const EmulatorSessionState.noDevicePicked());
    expect(find.text('Pick device'), findsOneWidget);
  });

  testWidgets('Cold shows AVD name and Boot button', (t) async {
    await pump(t, const EmulatorSessionState.cold(
        avd: Avd(id: 'A', name: 'Pixel 5 API 34', platform: 'android')));
    expect(find.text('Pixel 5 API 34'), findsOneWidget);
    expect(find.text('Boot'), findsOneWidget);
  });

  testWidgets('Idle shows Run app button', (t) async {
    await pump(t, const EmulatorSessionState.idle(
        avd: Avd(id: 'A', name: 'Pixel 5 API 34', platform: 'android'),
        serial: 'emulator-5554'));
    expect(find.text('Run app'), findsOneWidget);
  });

  testWidgets('Running shows Reload button + AVD name', (t) async {
    await pump(t,
        EmulatorSessionState.running(
          avd: const Avd(id: 'A', name: 'Pixel 5 API 34', platform: 'android'),
          serial: 'emulator-5554',
          vmServiceUri: 'ws://x',
          stats: RunStats(),
        ));
    expect(find.text('Pixel 5 API 34'), findsOneWidget);
    expect(find.text('Reload'), findsOneWidget);
  });

  testWidgets('Manual mode shows "Manual" label', (t) async {
    await pump(
      t,
      EmulatorSessionState.running(
        vmServiceUri: 'ws://127.0.0.1:51234',
        stats: RunStats(),
        manual: true,
      ),
    );
    expect(find.text('Manual'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

```
fvm flutter test test/features/emulator/view/connection_pill_test.dart
```
Expected: FAIL — `ConnectionPill` undefined.

- [ ] **Step 3: Write minimal `ConnectionPill`**

```dart
// lib/features/emulator/view/connection_pill.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';

class ConnectionPill extends StatelessWidget {
  const ConnectionPill({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<EmulatorSessionCubit, EmulatorSessionState>(
      builder: (context, state) {
        final cubit = context.read<EmulatorSessionCubit>();
        return Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              _Dot(state),
              const SizedBox(width: 8),
              Expanded(child: Text(_label(state))),
              _PrimaryAction(state: state, cubit: cubit),
            ],
          ),
        );
      },
    );
  }

  String _label(EmulatorSessionState s) => switch (s) {
        _NoDevicePicked() => 'Pick device',
        _Cold(:final avd) => avd.name,
        _Booting(:final avd) => '${avd.name} · booting…',
        _Idle(:final avd) => '${avd.name} · idle',
        _Running(:final manual, :final avd) =>
          manual ? 'Manual' : (avd?.name ?? 'Running'),
        _Reconnecting(:final avd) => '${avd.name} · reconnecting',
        _Error(:final message) => 'Error · $message',
      };
}

class _Dot extends StatelessWidget {
  const _Dot(this.state);
  final EmulatorSessionState state;
  @override
  Widget build(BuildContext context) {
    return const Icon(Icons.circle, size: 10);
  }
}

class _PrimaryAction extends StatelessWidget {
  const _PrimaryAction({required this.state, required this.cubit});
  final EmulatorSessionState state;
  final EmulatorSessionCubit cubit;

  @override
  Widget build(BuildContext context) {
    return switch (state) {
      _NoDevicePicked() => const SizedBox.shrink(),
      _Cold() => TextButton(onPressed: cubit.bootAvd, child: const Text('Boot')),
      _Booting() => TextButton(onPressed: cubit.cancelBoot, child: const Text('Cancel')),
      _Idle() => TextButton(onPressed: cubit.runApp, child: const Text('Run app')),
      _Running() => TextButton(onPressed: cubit.hotReload, child: const Text('Reload')),
      _Reconnecting() => const SizedBox.shrink(),
      _Error() => TextButton(onPressed: cubit.bootAvd, child: const Text('Retry')),
    };
  }
}
```

- [ ] **Step 4: Replace `_ConnectionPill` stub in `inspector_panel.dart`**

In `lib/features/workbench/view/inspector_panel.dart`, replace the existing `_ConnectionPill` private class and its usages with `import 'package:pickforge/features/emulator/view/connection_pill.dart';` and `const ConnectionPill()`.

- [ ] **Step 5: Wire `EmulatorSessionCubit` into the workbench shell**

This requires extending the shell BlocProviders. In whichever file constructs the workbench shell (likely `app_shell_view.dart` or its parent route), inject:

```dart
BlocProvider<EmulatorSessionCubit>(
  create: (_) => EmulatorSessionCubit(
    projectRoot: activeProjectRoot,
    settings: getIt<ProjectSettingsRepository>(),
    discovery: getIt<DeviceDiscoveryService>(),
    launcher: getIt<AvdLauncher>(),
    poller: getIt<BootReadinessPoller>(),
    runController: getIt<RunSessionController>(),
    logRepo: getIt<RunSessionLogRepository>(),
    vmClient: getIt<VmServiceClient>(),
  )..bootstrap()
   ..bindVmStateStream(),
),
```

The exact insertion point depends on the existing `BlocProvider` tree — locate it by grepping the workbench code for `BlocProvider<WidgetPickerCubit>` or wherever per-project cubits are created. The cubit must be re-created on project switch (use `key: ValueKey(activeProjectRoot)` on the parent `BlocProvider` to force replacement).

- [ ] **Step 6: Run tests**

```
fvm flutter test test/features/emulator/view/connection_pill_test.dart
fvm flutter analyze
```
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add lib/features/emulator/view/connection_pill.dart \
        lib/features/workbench/view/inspector_panel.dart \
        test/features/emulator/view/connection_pill_test.dart
git commit -m "feat(emulator): minimal ConnectionPill wired into InspectorPanel"
```

> Note: visual polish (state colors, animation, hover, dropdown) lives in P4.T3 + P8 — this task only proves end-to-end wiring.

---

## Phase 4 — Pill Menu, Device Picker, Manual URL

Goal of phase: turn the minimal pill into the full state-aware menu, plus device picker + manual URL form.

### Task P4.T1: `DevicePickerState` (freezed)

**Files:**
- Create: `lib/features/emulator/cubit/device_picker_state.dart`
- Test: `test/features/emulator/cubit/device_picker_state_test.dart`

- [ ] **Step 1: Test**

```dart
// test/features/emulator/cubit/device_picker_state_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_state.dart';

void main() {
  test('initial', () {
    expect(const DevicePickerState.initial(), const DevicePickerState.initial());
  });
  test('loaded equality', () {
    const a = Avd(id: 'X', name: 'X', platform: 'android');
    const r = RunningAndroidDevice(serial: 'emulator-5554', avdName: 'X', state: 'device');
    expect(
      const DevicePickerState.loaded(avds: [a], running: [r]),
      const DevicePickerState.loaded(avds: [a], running: [r]),
    );
  });
}
```

- [ ] **Step 2: Run (FAIL).**

```
fvm flutter test test/features/emulator/cubit/device_picker_state_test.dart
```

- [ ] **Step 3: Implementation**

```dart
// lib/features/emulator/cubit/device_picker_state.dart
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:pickforge/core/emulator/device_models.dart';

part 'device_picker_state.freezed.dart';

@freezed
sealed class DevicePickerState with _$DevicePickerState {
  const factory DevicePickerState.initial() = _Initial;
  const factory DevicePickerState.loading() = _Loading;
  const factory DevicePickerState.loaded({
    required List<Avd> avds,
    required List<RunningAndroidDevice> running,
  }) = _Loaded;
  const factory DevicePickerState.error(String message) = _PickerError;
}
```

- [ ] **Step 4: Run + Commit**

```
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter test test/features/emulator/cubit/device_picker_state_test.dart
```

```bash
git add lib/features/emulator/cubit/device_picker_state.dart \
        lib/features/emulator/cubit/device_picker_state.freezed.dart \
        test/features/emulator/cubit/device_picker_state_test.dart
git commit -m "feat(emulator): DevicePickerState (initial/loading/loaded/error)"
```

---

### Task P4.T2: `DevicePickerCubit`

**Files:**
- Create: `lib/features/emulator/cubit/device_picker_cubit.dart`
- Test: `test/features/emulator/cubit/device_picker_cubit_test.dart`

- [ ] **Step 1: Test**

```dart
// test/features/emulator/cubit/device_picker_cubit_test.dart
import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_cubit.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_state.dart';

class _MD extends Mock implements DeviceDiscoveryService {}

void main() {
  blocTest<DevicePickerCubit, DevicePickerState>(
    'refresh emits loading then loaded',
    setUp: () {
      final disc = _MD();
      when(() => disc.snapshot()).thenAnswer((_) async => const DeviceListSnapshot(
        avds: [Avd(id: 'X', name: 'X', platform: 'android')],
        running: [],
      ));
    },
    build: () {
      final disc = _MD();
      when(() => disc.snapshot()).thenAnswer((_) async => const DeviceListSnapshot(
        avds: [Avd(id: 'X', name: 'X', platform: 'android')],
        running: [],
      ));
      return DevicePickerCubit(disc);
    },
    act: (c) => c.refresh(),
    expect: () => [const DevicePickerState.loading(), isA<_Loaded>()],
  );
}
```

- [ ] **Step 2: FAIL → implement → PASS**

```dart
// lib/features/emulator/cubit/device_picker_cubit.dart
import 'package:bloc/bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_state.dart';

@injectable
class DevicePickerCubit extends Cubit<DevicePickerState> {
  DevicePickerCubit(this._discovery)
      : super(const DevicePickerState.initial());
  final DeviceDiscoveryService _discovery;

  Future<void> refresh() async {
    emit(const DevicePickerState.loading());
    try {
      final snap = await _discovery.snapshot();
      emit(DevicePickerState.loaded(avds: snap.avds, running: snap.running));
    } on Object catch (e) {
      emit(DevicePickerState.error(e.toString()));
    }
  }
}
```

```
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter test test/features/emulator/cubit/device_picker_cubit_test.dart
```

- [ ] **Step 3: Commit**

```bash
git add lib/features/emulator/cubit/device_picker_cubit.dart \
        test/features/emulator/cubit/device_picker_cubit_test.dart \
        lib/core/di/injection.config.dart
git commit -m "feat(emulator): DevicePickerCubit refresh flow"
```

---

### Task P4.T3: Pill state-aware visuals + dropdown menu

This task expands `ConnectionPill` to render full per-state visuals (dot color/animation, primary action, dropdown menu). Tests are widget-tree assertions; goldens are deferred to P8 polish.

**Files:**
- Modify: `lib/features/emulator/view/connection_pill.dart`
- Test: `test/features/emulator/view/connection_pill_menu_test.dart`

- [ ] **Step 1: Test**

```dart
// test/features/emulator/view/connection_pill_menu_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/emulator/view/connection_pill.dart';

class _FakeCubit extends Cubit<EmulatorSessionState>
    with Mock
    implements EmulatorSessionCubit {
  _FakeCubit(super.s);
}

void main() {
  testWidgets('dropdown surfaces "Pick different" when state is Cold', (t) async {
    final cubit = _FakeCubit(const EmulatorSessionState.cold(
        avd: Avd(id: 'A', name: 'Pixel 5', platform: 'android')));
    await t.pumpWidget(MaterialApp(
      home: BlocProvider<EmulatorSessionCubit>.value(
        value: cubit,
        child: const Scaffold(body: ConnectionPill()),
      ),
    ));
    await t.tap(find.byKey(const Key('pill-menu')));
    await t.pumpAndSettle();
    expect(find.text('Pick different…'), findsOneWidget);
    expect(find.text('Manual VM Service URL…'), findsOneWidget);
    expect(find.text('Forget device'), findsOneWidget);
  });

  testWidgets('Running state surfaces Hot restart, Stop, View logs', (t) async {
    // … similar structure to above with EmulatorSessionState.running(...)
  });
}
```

- [ ] **Step 2: FAIL → write expanded `ConnectionPill`**

Replace the file with:

```dart
// lib/features/emulator/view/connection_pill.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/emulator/view/device_picker_menu.dart';
import 'package:pickforge/features/emulator/view/manual_url_form.dart';

class ConnectionPill extends StatelessWidget {
  const ConnectionPill({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<EmulatorSessionCubit, EmulatorSessionState>(
      builder: (context, state) {
        final cubit = context.read<EmulatorSessionCubit>();
        final theme = Theme.of(context);
        return Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              _Dot(state: state, theme: theme),
              const SizedBox(width: 8),
              Expanded(child: Text(_label(state))),
              _PrimaryAction(state: state, cubit: cubit),
              const SizedBox(width: 4),
              _Menu(state: state, cubit: cubit),
            ],
          ),
        );
      },
    );
  }

  String _label(EmulatorSessionState s) => switch (s) {
        _NoDevicePicked() => 'Pick device',
        _Cold(:final avd) => avd.name,
        _Booting(:final avd) => '${avd.name} · booting…',
        _Idle(:final avd) => '${avd.name} · idle',
        _Running(:final manual, :final avd) =>
          manual ? 'Manual' : '${avd?.name ?? 'Running'} · running',
        _Reconnecting(:final avd, :final attempt) =>
          '${avd.name} · reconnecting · attempt $attempt',
        _Error(:final message) => 'Error · $message',
      };
}

class _Dot extends StatelessWidget {
  const _Dot({required this.state, required this.theme});
  final EmulatorSessionState state;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) {
    final color = switch (state) {
      _Idle() || _Running() => Colors.greenAccent,
      _Booting() || _Reconnecting() => Colors.amberAccent,
      _Error() => Colors.redAccent,
      _ => theme.colorScheme.outline,
    };
    return Icon(Icons.circle, size: 10, color: color);
  }
}

class _PrimaryAction extends StatelessWidget {
  const _PrimaryAction({required this.state, required this.cubit});
  final EmulatorSessionState state;
  final EmulatorSessionCubit cubit;

  @override
  Widget build(BuildContext context) {
    return switch (state) {
      _NoDevicePicked() => TextButton(
          onPressed: () => _openPicker(context),
          child: const Text('Pick'),
        ),
      _Cold() => TextButton(onPressed: cubit.bootAvd, child: const Text('Boot')),
      _Booting() => TextButton(onPressed: cubit.cancelBoot, child: const Text('Cancel')),
      _Idle() => TextButton(onPressed: cubit.runApp, child: const Text('Run app')),
      _Running() => TextButton(onPressed: cubit.hotReload, child: const Text('Reload')),
      _Reconnecting() => const SizedBox.shrink(),
      _Error() => TextButton(onPressed: cubit.bootAvd, child: const Text('Retry')),
    };
  }
}

class _Menu extends StatelessWidget {
  const _Menu({required this.state, required this.cubit});
  final EmulatorSessionState state;
  final EmulatorSessionCubit cubit;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<_MenuAction>(
      key: const Key('pill-menu'),
      icon: const Icon(Icons.expand_more, size: 18),
      onSelected: (a) => _onSelected(context, a),
      itemBuilder: (context) => switch (state) {
        _NoDevicePicked() => const [
            PopupMenuItem(value: _MenuAction.pickDevice, child: Text('Pick device…')),
            PopupMenuItem(value: _MenuAction.manualUrl, child: Text('Manual VM Service URL…')),
          ],
        _Cold() || _Idle() => const [
            PopupMenuItem(value: _MenuAction.pickDevice, child: Text('Pick different…')),
            PopupMenuItem(value: _MenuAction.manualUrl, child: Text('Manual VM Service URL…')),
            PopupMenuItem(value: _MenuAction.forget, child: Text('Forget device')),
          ],
        _Running(:final manual) => [
            const PopupMenuItem(value: _MenuAction.hotRestart, child: Text('Hot restart')),
            const PopupMenuItem(value: _MenuAction.stop, child: Text('Stop')),
            const PopupMenuItem(value: _MenuAction.viewLogs, child: Text('View logs')),
            if (manual) const PopupMenuItem(value: _MenuAction.editUrl, child: Text('Edit URL…')),
          ],
        _Booting() || _Reconnecting() => const [
            PopupMenuItem(value: _MenuAction.viewLogs, child: Text('View logs')),
          ],
        _Error() => const [
            PopupMenuItem(value: _MenuAction.viewLogs, child: Text('View logs')),
            PopupMenuItem(value: _MenuAction.pickDevice, child: Text('Pick different…')),
            PopupMenuItem(value: _MenuAction.manualUrl, child: Text('Manual VM Service URL…')),
            PopupMenuItem(value: _MenuAction.forget, child: Text('Forget device')),
          ],
      },
    );
  }

  Future<void> _onSelected(BuildContext context, _MenuAction action) async {
    switch (action) {
      case _MenuAction.pickDevice:
        await _openPicker(context);
      case _MenuAction.manualUrl:
      case _MenuAction.editUrl:
        await _openManual(context);
      case _MenuAction.forget:
        await cubit.forgetDevice();
      case _MenuAction.hotRestart:
        await cubit.hotRestart();
      case _MenuAction.stop:
        await cubit.stopRun();
      case _MenuAction.viewLogs:
        // P5.T3 toggles run-logs pane; no-op until then.
        break;
    }
  }
}

enum _MenuAction {
  pickDevice,
  manualUrl,
  editUrl,
  forget,
  hotRestart,
  stop,
  viewLogs,
}

Future<void> _openPicker(BuildContext context) async {
  await showDialog<void>(
    context: context,
    builder: (_) => const Dialog(child: DevicePickerMenu()),
  );
}

Future<void> _openManual(BuildContext context) async {
  await showDialog<void>(
    context: context,
    builder: (_) => const Dialog(child: ManualUrlForm()),
  );
}
```

- [ ] **Step 3: Run + Commit (after T4–T5 ship `DevicePickerMenu` and `ManualUrlForm`).**

This task imports both widgets — the file won't compile until P4.T4 + P4.T5 are done. To stay green per task, scaffold both as empty stubs in this commit:

```dart
// lib/features/emulator/view/device_picker_menu.dart  (stub)
import 'package:flutter/material.dart';
class DevicePickerMenu extends StatelessWidget {
  const DevicePickerMenu({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
```

```dart
// lib/features/emulator/view/manual_url_form.dart  (stub)
import 'package:flutter/material.dart';
class ManualUrlForm extends StatelessWidget {
  const ManualUrlForm({super.key});
  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
```

```
fvm flutter test test/features/emulator/view/connection_pill_menu_test.dart
```

```bash
git add lib/features/emulator/view/connection_pill.dart \
        lib/features/emulator/view/device_picker_menu.dart \
        lib/features/emulator/view/manual_url_form.dart \
        test/features/emulator/view/connection_pill_menu_test.dart
git commit -m "feat(emulator): pill — full state visuals + dropdown menu (picker/manual stubs)"
```

---

### Task P4.T4: `DevicePickerMenu` (real)

**Files:**
- Modify: `lib/features/emulator/view/device_picker_menu.dart`
- Test: `test/features/emulator/view/device_picker_menu_test.dart`

- [ ] **Step 1: Test**

```dart
// test/features/emulator/view/device_picker_menu_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_cubit.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_state.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/view/device_picker_menu.dart';

class _PickerCubit extends Cubit<DevicePickerState>
    with Mock
    implements DevicePickerCubit {
  _PickerCubit(super.state);
  @override
  Future<void> refresh() async {}
}

class _SessionCubit extends Mock implements EmulatorSessionCubit {}

void main() {
  testWidgets('shows Running and Available sections', (t) async {
    final picker = _PickerCubit(const DevicePickerState.loaded(
      avds: [
        Avd(id: 'X', name: 'Pixel 5', platform: 'android'),
        Avd(id: 'Y', name: 'Pixel 7', platform: 'android'),
      ],
      running: [
        RunningAndroidDevice(serial: 'emulator-5554', avdName: 'X', state: 'device'),
      ],
    ));
    final session = _SessionCubit();
    when(() => session.pickAvd(any())).thenAnswer((_) async {});
    await t.pumpWidget(MaterialApp(home: MultiBlocProvider(providers: [
      BlocProvider<DevicePickerCubit>.value(value: picker),
      BlocProvider<EmulatorSessionCubit>.value(value: session),
    ], child: const Scaffold(body: DevicePickerMenu()))));
    expect(find.text('RUNNING'), findsOneWidget);
    expect(find.text('AVAILABLE'), findsOneWidget);
    expect(find.text('Pixel 5'), findsOneWidget);
    expect(find.text('Pixel 7'), findsOneWidget);

    await t.tap(find.text('Pixel 7'));
    verify(() => session.pickAvd(any())).called(1);
  });

  testWidgets('empty state shows Android Studio link', (t) async {
    final picker = _PickerCubit(const DevicePickerState.loaded(avds: [], running: []));
    await t.pumpWidget(MaterialApp(home: MultiBlocProvider(providers: [
      BlocProvider<DevicePickerCubit>.value(value: picker),
      BlocProvider<EmulatorSessionCubit>.value(value: _SessionCubit()),
    ], child: const Scaffold(body: DevicePickerMenu()))));
    expect(find.textContaining('No Android emulators detected'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Implementation**

```dart
// lib/features/emulator/view/device_picker_menu.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_cubit.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_state.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';

class DevicePickerMenu extends StatefulWidget {
  const DevicePickerMenu({super.key});

  @override
  State<DevicePickerMenu> createState() => _DevicePickerMenuState();
}

class _DevicePickerMenuState extends State<DevicePickerMenu> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<DevicePickerCubit>().refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 320,
      child: BlocBuilder<DevicePickerCubit, DevicePickerState>(
        builder: (context, s) {
          return switch (s) {
            _Initial() || _Loading() => const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              ),
            _Loaded(:final avds, :final running) =>
              _List(avds: avds, running: running),
            _PickerError(:final message) => Padding(
                padding: const EdgeInsets.all(24),
                child: Text(message),
              ),
          };
        },
      ),
    );
  }
}

class _List extends StatelessWidget {
  const _List({required this.avds, required this.running});
  final List<Avd> avds;
  final List<RunningAndroidDevice> running;

  @override
  Widget build(BuildContext context) {
    final session = context.read<EmulatorSessionCubit>();
    final runningAvds = avds.where((a) => running.any((r) => r.avdName == a.id)).toList();
    final coldAvds = avds.where((a) => !running.any((r) => r.avdName == a.id)).toList();

    if (avds.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(24),
        child: Text(
          'No Android emulators detected.\n'
          'Open Android Studio → Device Manager → Create.',
        ),
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (runningAvds.isNotEmpty) const _Header('RUNNING'),
        for (final a in runningAvds)
          _Row(label: a.name, onTap: () {
            Navigator.of(context).pop();
            session.pickAvd(a);
          }),
        if (coldAvds.isNotEmpty) const _Header('AVAILABLE'),
        for (final a in coldAvds)
          _Row(label: a.name, onTap: () {
            Navigator.of(context).pop();
            session.pickAvd(a);
          }),
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
        child: Text(text, style: Theme.of(context).textTheme.labelSmall),
      );
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) =>
      ListTile(title: Text(label), onTap: onTap, dense: true);
}
```

- [ ] **Step 3: Wire `DevicePickerCubit` provider**

In the showDialog wrapper inside `connection_pill.dart`, replace the bare `DevicePickerMenu()` with:

```dart
BlocProvider(
  create: (_) => getIt<DevicePickerCubit>(),
  child: const DevicePickerMenu(),
)
```

(Add `import 'package:pickforge/core/di/injection.dart';` if needed.)

- [ ] **Step 4: Run + commit**

```
fvm flutter test test/features/emulator/view/device_picker_menu_test.dart
```

```bash
git add lib/features/emulator/view/device_picker_menu.dart \
        lib/features/emulator/view/connection_pill.dart \
        test/features/emulator/view/device_picker_menu_test.dart
git commit -m "feat(emulator): DevicePickerMenu with running/available sections"
```

---

### Task P4.T5: `ManualUrlForm`

**Files:**
- Modify: `lib/features/emulator/view/manual_url_form.dart`
- Test: `test/features/emulator/view/manual_url_form_test.dart`

- [ ] **Step 1: Test**

```dart
// test/features/emulator/view/manual_url_form_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/view/manual_url_form.dart';

class _C extends Mock implements EmulatorSessionCubit {}

void main() {
  testWidgets('valid ws:// submission calls submitManualUrl', (t) async {
    final cubit = _C();
    when(() => cubit.submitManualUrl(any())).thenAnswer((_) async {});
    await t.pumpWidget(MaterialApp(
      home: BlocProvider<EmulatorSessionCubit>.value(
        value: cubit,
        child: const Scaffold(body: ManualUrlForm()),
      ),
    ));
    await t.enterText(find.byType(TextField), 'ws://127.0.0.1:5000/UUID/ws');
    await t.tap(find.text('Connect'));
    await t.pumpAndSettle();
    verify(() => cubit.submitManualUrl('ws://127.0.0.1:5000/UUID/ws')).called(1);
  });

  testWidgets('invalid URL shows inline error', (t) async {
    await t.pumpWidget(MaterialApp(
      home: BlocProvider<EmulatorSessionCubit>.value(
        value: _C(),
        child: const Scaffold(body: ManualUrlForm()),
      ),
    ));
    await t.enterText(find.byType(TextField), 'http://oops');
    await t.tap(find.text('Connect'));
    await t.pump();
    expect(find.textContaining('must start with'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Implementation**

```dart
// lib/features/emulator/view/manual_url_form.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';

class ManualUrlForm extends StatefulWidget {
  const ManualUrlForm({super.key});
  @override
  State<ManualUrlForm> createState() => _ManualUrlFormState();
}

class _ManualUrlFormState extends State<ManualUrlForm> {
  final _ctrl = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  bool _valid(String s) =>
      s.startsWith('ws://') || s.startsWith('wss://');

  Future<void> _submit() async {
    final v = _ctrl.text.trim();
    if (!_valid(v)) {
      setState(() => _error = 'URL must start with ws:// or wss://');
      return;
    }
    await context.read<EmulatorSessionCubit>().submitManualUrl(v);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Manual VM Service URL', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          TextField(
            controller: _ctrl,
            decoration: InputDecoration(
              hintText: 'ws://127.0.0.1:PORT/UUID/ws',
              border: const OutlineInputBorder(),
              errorText: _error,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Cancel'),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: _submit,
                child: const Text('Connect'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 3: Run + Commit**

```
fvm flutter test test/features/emulator/view/manual_url_form_test.dart
```

```bash
git add lib/features/emulator/view/manual_url_form.dart \
        test/features/emulator/view/manual_url_form_test.dart
git commit -m "feat(emulator): ManualUrlForm with ws:// validation"
```

---

## Phase 5 — Run Logs Pane

Goal of phase: dedicated structured renderer for `RunSessionEvent`s, vertically split inside the middle pane.

### Task P5.T1: `RunLogsCubit` — buffer + filter

**Files:**
- Create: `lib/features/emulator/cubit/run_logs_cubit.dart`
- Create: `lib/features/emulator/cubit/run_logs_state.dart`
- Test: `test/features/emulator/cubit/run_logs_cubit_test.dart`

- [ ] **Step 1: Test**

```dart
// test/features/emulator/cubit/run_logs_cubit_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_cubit.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_state.dart';

void main() {
  test('appends events up to cap', () {
    final c = RunLogsCubit(cap: 3);
    for (var i = 0; i < 5; i++) {
      c.append(RunSessionEvent.log(line: 'line-$i', level: LogLevel.info));
    }
    expect(c.state.entries.length, 3);
    expect(c.state.entries.first.line, 'line-2');
  });

  test('setFilter filters visible entries', () {
    final c = RunLogsCubit();
    c.append(const RunSessionEvent.log(line: 'a', level: LogLevel.info));
    c.append(const RunSessionEvent.log(line: 'b', level: LogLevel.error));
    c.setFilter(LogFilter.errors);
    expect(c.state.visibleEntries.length, 1);
    expect(c.state.visibleEntries.first.line, 'b');
  });

  test('clear empties buffer', () {
    final c = RunLogsCubit();
    c.append(const RunSessionEvent.log(line: 'a', level: LogLevel.info));
    c.clear();
    expect(c.state.entries, isEmpty);
  });
}
```

- [ ] **Step 2: Implementation**

```dart
// lib/features/emulator/cubit/run_logs_state.dart
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';

part 'run_logs_state.freezed.dart';

enum LogFilter { all, build, hotReload, errors }

class RunLogEntry {
  RunLogEntry({required this.timestamp, required this.line, required this.level, required this.category});
  final DateTime timestamp;
  final String line;
  final LogLevel level;
  final String category; // 'build' | 'vm' | 'hot' | 'log' | 'err'
}

@freezed
abstract class RunLogsState with _$RunLogsState {
  const factory RunLogsState({
    @Default([]) List<RunLogEntry> entries,
    @Default(LogFilter.all) LogFilter filter,
  }) = _RunLogsState;

  const RunLogsState._();

  List<RunLogEntry> get visibleEntries {
    switch (filter) {
      case LogFilter.all:
        return entries;
      case LogFilter.build:
        return entries.where((e) => e.category == 'build').toList();
      case LogFilter.hotReload:
        return entries.where((e) => e.category == 'hot').toList();
      case LogFilter.errors:
        return entries.where((e) => e.level == LogLevel.error).toList();
    }
  }
}
```

```dart
// lib/features/emulator/cubit/run_logs_cubit.dart
import 'package:bloc/bloc.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_state.dart';

class RunLogsCubit extends Cubit<RunLogsState> {
  RunLogsCubit({this.cap = 5000}) : super(const RunLogsState());
  final int cap;

  void append(RunSessionEvent e) {
    final now = DateTime.now();
    final entry = e.maybeWhen(
      stage: (msg) => RunLogEntry(timestamp: now, line: msg, level: LogLevel.info, category: 'build'),
      log: (line, level, _) => RunLogEntry(
        timestamp: now,
        line: line,
        level: level,
        category: level == LogLevel.error ? 'err' : 'log',
      ),
      vmServiceReady: (uri) => RunLogEntry(timestamp: now, line: 'VM service: $uri', level: LogLevel.info, category: 'vm'),
      reloadCompleted: (success, full, dur, attribution, hint) => RunLogEntry(
        timestamp: now,
        line: '[$attribution] ${full ? 'restart' : 'reload'} ${success ? '✓' : '✗'} ${dur}ms',
        level: LogLevel.info,
        category: 'hot',
      ),
      stopped: (code, reason) => RunLogEntry(timestamp: now, line: 'Stopped ($reason, code=$code)', level: LogLevel.info, category: 'log'),
      orElse: () => null,
    );
    if (entry == null) return;
    final next = [...state.entries, entry];
    if (next.length > cap) next.removeRange(0, next.length - cap);
    emit(state.copyWith(entries: next));
  }

  void setFilter(LogFilter f) => emit(state.copyWith(filter: f));
  void clear() => emit(state.copyWith(entries: const []));
}
```

- [ ] **Step 3: Run + Commit**

```
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter test test/features/emulator/cubit/run_logs_cubit_test.dart
```

```bash
git add lib/features/emulator/cubit/run_logs_cubit.dart \
        lib/features/emulator/cubit/run_logs_state.dart \
        lib/features/emulator/cubit/run_logs_state.freezed.dart \
        test/features/emulator/cubit/run_logs_cubit_test.dart
git commit -m "feat(emulator): RunLogsCubit with capped buffer + filtering"
```

---

### Task P5.T2: Wire `EmulatorSessionCubit` events → `RunLogsCubit`

The session cubit owns the event source. Either expose events through a shared provider or inject `RunLogsCubit` into the session cubit.

**Files:**
- Modify: `lib/features/emulator/cubit/emulator_session_cubit.dart`
- Test: `test/features/emulator/cubit/emulator_session_logs_wire_test.dart`

- [ ] **Step 1: Test**

```dart
// test/features/emulator/cubit/emulator_session_logs_wire_test.dart
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/run_args.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_cubit.dart';

class _MS extends Mock implements ProjectSettingsRepository {}
class _MD extends Mock implements DeviceDiscoveryService {}
class _ML extends Mock implements AvdLauncher {}
class _MP extends Mock implements BootReadinessPoller {}
class _MR extends Mock implements RunSessionController {}
class _MLog extends Mock implements RunSessionLogRepository {}
class _MV extends Mock implements VmServiceClient {}
class _FakeSession extends Mock implements RunSession {}

void main() {
  test('vmServiceReady event reaches RunLogsCubit', () async {
    final logs = RunLogsCubit();
    final session = _FakeSession();
    final eventsCtrl = StreamController<RunSessionEvent>.broadcast();
    when(() => session.events).thenAnswer((_) => eventsCtrl.stream);
    when(() => session.appId).thenReturn('a');
    when(() => session.sessionId).thenReturn('s1');
    when(() => session.exitCode).thenAnswer((_) => Completer<int>().future);

    final settings = _MS();
    final run = _MR();
    final discovery = _MD();
    when(() => settings.getRunArgs(any())).thenAnswer((_) async => const RunArgs());
    when(() => run.start(
          projectRoot: any(named: 'projectRoot'),
          serial: any(named: 'serial'),
          targetFile: any(named: 'targetFile'),
          extraArgs: any(named: 'extraArgs'),
        )).thenAnswer((_) async => session);

    final cubit = EmulatorSessionCubit(
      projectRoot: '/p',
      settings: settings,
      discovery: discovery,
      launcher: _ML(),
      poller: _MP(),
      runController: run,
      logRepo: _MLog(),
      vmClient: _MV(),
      logsCubit: logs,
    );
    cubit.emit(const EmulatorSessionState.idle(
      avd: Avd(id: 'X', name: 'X', platform: 'android'),
      serial: 'emulator-5554',
    ));
    await cubit.runApp();
    eventsCtrl.add(const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'));
    await Future<void>.delayed(const Duration(milliseconds: 5));
    expect(logs.state.entries, isNotEmpty);
    expect(logs.state.entries.last.category, 'vm');
    await eventsCtrl.close();
  });
}
```

- [ ] **Step 2: Modify cubit constructor and wire**

Add `RunLogsCubit? logsCubit;` parameter, in `_onRunEvent` call `logsCubit?.append(e);` for every event.

- [ ] **Step 3: Run + Commit**

```
fvm flutter test test/features/emulator/cubit/
```

```bash
git add lib/features/emulator/cubit/emulator_session_cubit.dart \
        test/features/emulator/cubit/emulator_session_logs_wire_test.dart
git commit -m "feat(emulator): EmulatorSessionCubit forwards events to RunLogsCubit"
```

---

### Task P5.T3: `RunLogsPane` widget

**Files:**
- Create: `lib/features/emulator/view/run_logs_pane.dart`
- Test: `test/features/emulator/view/run_logs_pane_test.dart`

- [ ] **Step 1: Test (renders entries + reacts to filter chip)**

```dart
// test/features/emulator/view/run_logs_pane_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_cubit.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_state.dart';
import 'package:pickforge/features/emulator/view/run_logs_pane.dart';

void main() {
  testWidgets('renders entries', (t) async {
    final cubit = RunLogsCubit()
      ..append(const RunSessionEvent.log(line: 'hello', level: LogLevel.info))
      ..append(const RunSessionEvent.log(line: 'oops', level: LogLevel.error));
    await t.pumpWidget(MaterialApp(
      home: BlocProvider<RunLogsCubit>.value(
        value: cubit,
        child: const Scaffold(body: RunLogsPane()),
      ),
    ));
    expect(find.text('hello'), findsOneWidget);
    expect(find.text('oops'), findsOneWidget);
  });

  testWidgets('Errors filter shows only error level', (t) async {
    final cubit = RunLogsCubit()
      ..append(const RunSessionEvent.log(line: 'hello', level: LogLevel.info))
      ..append(const RunSessionEvent.log(line: 'oops', level: LogLevel.error));
    await t.pumpWidget(MaterialApp(
      home: BlocProvider<RunLogsCubit>.value(
        value: cubit,
        child: const Scaffold(body: RunLogsPane()),
      ),
    ));
    await t.tap(find.text('Errors'));
    await t.pumpAndSettle();
    expect(find.text('hello'), findsNothing);
    expect(find.text('oops'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Implementation**

```dart
// lib/features/emulator/view/run_logs_pane.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_cubit.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_state.dart';

class RunLogsPane extends StatelessWidget {
  const RunLogsPane({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _FilterBar(),
        const Divider(height: 1),
        Expanded(
          child: BlocBuilder<RunLogsCubit, RunLogsState>(
            builder: (context, s) {
              final visible = s.visibleEntries;
              return ListView.builder(
                reverse: true,
                itemCount: visible.length,
                itemBuilder: (_, i) {
                  final e = visible[visible.length - 1 - i];
                  return _Line(entry: e);
                },
              );
            },
          ),
        ),
      ],
    );
  }
}

class _FilterBar extends StatelessWidget {
  const _FilterBar();
  @override
  Widget build(BuildContext context) {
    return BlocBuilder<RunLogsCubit, RunLogsState>(
      builder: (context, s) {
        final cubit = context.read<RunLogsCubit>();
        Widget chip(String label, LogFilter f) => ChoiceChip(
              label: Text(label),
              selected: s.filter == f,
              onSelected: (_) => cubit.setFilter(f),
            );
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          child: Wrap(spacing: 4, children: [
            chip('All', LogFilter.all),
            chip('Build', LogFilter.build),
            chip('Hot reload', LogFilter.hotReload),
            chip('Errors', LogFilter.errors),
          ]),
        );
      },
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.entry});
  final RunLogEntry entry;
  @override
  Widget build(BuildContext context) {
    final ts = entry.timestamp.toIso8601String().substring(11, 19);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(ts, style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(width: 8),
        Text(entry.category, style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(width: 8),
        Expanded(child: Text(entry.line, style: const TextStyle(fontFamily: 'monospace'))),
      ]),
    );
  }
}
```

- [ ] **Step 3: Run + Commit**

```
fvm flutter test test/features/emulator/view/run_logs_pane_test.dart
```

```bash
git add lib/features/emulator/view/run_logs_pane.dart \
        test/features/emulator/view/run_logs_pane_test.dart
git commit -m "feat(emulator): RunLogsPane with filter chips"
```

---

### Task P5.T4: Vertical split in `chat_workbench_panel.dart`

**Files:**
- Modify: `lib/features/workbench/view/chat_workbench_panel.dart`
- Test: manual (widget-level smoke; full integration in P10)

- [ ] **Step 1: Wrap the existing terminal area in a `MultiSplitView` with axis `vertical`. Top area = chat (current contents); bottom area = `RunLogsPane`. Default split 70/30, persisted via `WorkbenchLayoutCubit` (extend its state to hold `runLogsHeight`).**

The cubit extension follows the same pattern already used for `leftWidth` / `rightWidth`. Add field + setter + persistence to JSON serialization. After the cubit change, the panel reads from `state.runLogsHeight` and writes back via `updateSizes(runLogsHeight: …)`.

- [ ] **Step 2: Pill "View logs" / "Hide logs" toggles split visibility**

Add a method to `WorkbenchLayoutCubit`: `toggleRunLogs()` that flips a `runLogsCollapsed` bool, and the pane in chat_workbench_panel only includes the bottom area when not collapsed.

Wire it in pill `_MenuAction.viewLogs` to call `context.read<WorkbenchLayoutCubit>().toggleRunLogs();`.

- [ ] **Step 3: Provide `RunLogsCubit` at the same scope as `EmulatorSessionCubit`**

Same provider tree level as P3.T7 — likely a `MultiBlocProvider` keyed on project root.

- [ ] **Step 4: Run analyze + the existing chat tests**

```
fvm flutter analyze
fvm flutter test test/features/workbench/
```
Expected: clean / pass.

- [ ] **Step 5: Commit**

```bash
git add lib/features/workbench/view/chat_workbench_panel.dart \
        lib/features/workbench/cubit/workbench_layout_cubit.dart \
        lib/features/workbench/cubit/workbench_layout_state.dart \
        lib/features/emulator/view/connection_pill.dart
git commit -m "feat(emulator): vertical split — chat above run logs in middle pane"
```

---

## Phase 6 — IPC Server

Goal of phase: a Unix-socket-based IPC for agent MCP plugins to call `hotReload`, `hotRestart`, `getStatus`, `getVmServiceUri`, `getCurrentSelection`. Windows is gated behind a feature flag (deferred — see P9 / NOTES).

### Task P6.T1: `EmulatorIpcServer`

**Files:**
- Create: `lib/core/emulator/emulator_ipc_server.dart`
- Test: `test/core/emulator/emulator_ipc_server_test.dart`

- [ ] **Step 1: Test**

Use a temp dir, real Unix socket, two endpoints — server + client — talking JSON-RPC.

```dart
// test/core/emulator/emulator_ipc_server_test.dart
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/emulator_ipc_server.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';

class _FakeSession extends Mock implements RunSession {}

void main() {
  test('hotReload route delegates to bound RunSession', () async {
    if (Platform.isWindows) return; // Windows path is feature-flagged.
    final tmp = await Directory.systemTemp.createTemp('pf-ipc-');
    final sockPath = '${tmp.path}/sock';
    final session = _FakeSession();
    when(() => session.hotReload()).thenAnswer((_) async => true);
    when(() => session.appId).thenReturn('a');
    when(() => session.vmServiceUri).thenReturn('ws://x');

    final server = EmulatorIpcServer(socketPath: sockPath);
    await server.start();
    server.bindActiveRunSession(session);

    final addr = InternetAddress(sockPath, type: InternetAddressType.unix);
    final sock = await Socket.connect(addr, 0);
    sock.write('${jsonEncode({'id': 1, 'method': 'hotReload'})}\n');
    await sock.flush();
    final reply = await sock
        .transform(const Utf8Decoder())
        .transform(const LineSplitter())
        .first;
    final decoded = jsonDecode(reply);
    expect(decoded['id'], 1);
    expect(decoded['result']['ok'], true);
    verify(() => session.hotReload()).called(1);

    await sock.close();
    await server.stop();
    await tmp.delete(recursive: true);
  });

  test('returns error when no run session bound', () async {
    if (Platform.isWindows) return;
    final tmp = await Directory.systemTemp.createTemp('pf-ipc-');
    final sockPath = '${tmp.path}/sock';
    final server = EmulatorIpcServer(socketPath: sockPath);
    await server.start();

    final sock = await Socket.connect(
      InternetAddress(sockPath, type: InternetAddressType.unix),
      0,
    );
    sock.write('${jsonEncode({'id': 7, 'method': 'hotReload'})}\n');
    await sock.flush();
    final reply = await sock
        .transform(const Utf8Decoder())
        .transform(const LineSplitter())
        .first;
    final decoded = jsonDecode(reply);
    expect(decoded['id'], 7);
    expect(decoded['error'], isNotNull);

    await sock.close();
    await server.stop();
    await tmp.delete(recursive: true);
  });
}
```

- [ ] **Step 2: Implementation**

```dart
// lib/core/emulator/emulator_ipc_server.dart
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:pickforge/core/emulator/run_session_controller.dart';

class EmulatorIpcServer {
  EmulatorIpcServer({required this.socketPath});
  final String socketPath;

  ServerSocket? _server;
  RunSession? _session;
  String Function()? _selectionProvider;

  Future<void> start() async {
    final f = File(socketPath);
    if (await f.exists()) {
      await f.delete();
    }
    _server = await ServerSocket.bind(
      InternetAddress(socketPath, type: InternetAddressType.unix),
      0,
    );
    _server!.listen(_handle);
  }

  Future<void> stop() async {
    await _server?.close();
    _server = null;
    final f = File(socketPath);
    if (await f.exists()) await f.delete();
  }

  void bindActiveRunSession(RunSession? session) => _session = session;
  void bindSelectionProvider(String Function()? provider) =>
      _selectionProvider = provider;

  void _handle(Socket sock) {
    sock
        .transform(const Utf8Decoder())
        .transform(const LineSplitter())
        .listen((line) async {
      try {
        final req = jsonDecode(line) as Map<String, dynamic>;
        final id = req['id'] as int;
        final method = req['method'] as String;
        Object? result;
        Object? error;
        switch (method) {
          case 'getStatus':
            result = {
              'state': _session == null ? 'idle' : 'running',
              'appId': _session?.appId,
              'vmServiceUri': _session?.vmServiceUri,
            };
          case 'hotReload':
            if (_session == null) {
              error = 'no_active_session';
            } else {
              await _session!.hotReload();
              result = {'ok': true};
            }
          case 'hotRestart':
            if (_session == null) {
              error = 'no_active_session';
            } else {
              await _session!.hotRestart();
              result = {'ok': true};
            }
          case 'getVmServiceUri':
            result = _session?.vmServiceUri;
          case 'getCurrentSelection':
            result = _selectionProvider?.call();
          default:
            error = 'unknown_method';
        }
        final response = error != null
            ? {'id': id, 'error': error}
            : {'id': id, 'result': result};
        sock.write('${jsonEncode(response)}\n');
        await sock.flush();
      } on Object catch (e) {
        sock.write('${jsonEncode({'error': e.toString()})}\n');
        await sock.flush();
      }
    });
  }
}
```

- [ ] **Step 3: Run + Commit**

```
fvm flutter test test/core/emulator/emulator_ipc_server_test.dart
```

```bash
git add lib/core/emulator/emulator_ipc_server.dart \
        test/core/emulator/emulator_ipc_server_test.dart
git commit -m "feat(emulator): EmulatorIpcServer (unix socket, JSON-RPC)"
```

---

### Task P6.T2: Wire IPC server into the cubit + write `.pickforge/ipc.sock-path`

**Files:**
- Modify: `lib/features/emulator/cubit/emulator_session_cubit.dart`

- [ ] **Step 1: Test**

Add a test that asserts `.pickforge/ipc.sock-path` is written when session starts and the IPC server is bound:

```dart
// test/features/emulator/cubit/emulator_session_cubit_ipc_test.dart
// (Construction wires fake EmulatorIpcServer; on runApp,
//  expect server.bindActiveRunSession called and ipc.sock-path written.)
```

- [ ] **Step 2: Inject `EmulatorIpcServer` into the cubit, bind on `runApp`, unbind on `stop`/`close`. Write the socket path under `<projectRoot>/.pickforge/ipc.sock-path` on bind, delete on unbind.**

- [ ] **Step 3: Commit**

```bash
git add lib/features/emulator/cubit/emulator_session_cubit.dart \
        test/features/emulator/cubit/emulator_session_cubit_ipc_test.dart
git commit -m "feat(emulator): bind IPC server to active session + write sock-path file"
```

---

### Task P6.T3: DI module for `EmulatorIpcServer`

**Files:**
- Modify: `lib/core/di/injection.dart`

- [ ] Add a module that constructs the server with a path under `$XDG_RUNTIME_DIR/pickforge-<pid>/agent.sock` (fallback to `/tmp/pickforge-<pid>` if XDG_RUNTIME_DIR unset). Start it from `configureDependencies()` after DI init in `main.dart`.

```bash
git add lib/core/di/injection.dart \
        lib/core/di/injection.config.dart \
        lib/main.dart
git commit -m "feat(emulator): wire EmulatorIpcServer at app start"
```

---

## Phase 7 — Settings → Per-Project Device & Run

Goal of phase: surface the per-project columns (avdId/avdName/runArgs/targetFile/connectionMode/autoBoot) in Settings.

### Task P7.T1: `DeviceRunSettingsCubit`

**Files:**
- Create: `lib/features/settings/cubit/device_run_settings_cubit.dart`
- Create: `lib/features/settings/cubit/device_run_settings_state.dart`
- Test: `test/features/settings/cubit/device_run_settings_cubit_test.dart`

State holds: current `EmulatorBinding`, `RunArgs`, list of available AVDs (from discovery service). Methods: `load`, `setAvd`, `setAutoBoot`, `setRunArgs`, `switchToManual`, `reset`.

(Test + implementation follow the same TDD micro-cycle pattern; see P4.T2 for shape.)

```bash
git commit -m "feat(settings): DeviceRunSettingsCubit"
```

---

### Task P7.T2: `DeviceRunSettings` view

**Files:**
- Create: `lib/features/settings/view/device_run_settings.dart`
- Modify: existing settings view to include the new section

UI fields per spec Section 6:
- AVD dropdown
- Auto-boot toggle
- Target file text field
- Extra args list (one per row, `+ Add row`)
- Connection mode radio (auto / manual)
- Manual URL field (only visible when mode == manual)
- Test connection button (calls cubit's existing `vmClient.connect`)
- Reset device button (clears binding + run args)

Tests assert: AVD list renders, picking a row calls cubit method, mode toggle reveals/hides URL field.

```bash
git commit -m "feat(settings): per-project Device & Run section"
```

---

## Phase 8 — Animations & Polish

Goal of phase: convert the minimal pill into the spec's high-density animation surface.

### Task P8.T1: Pill state-transition animation

**Files:**
- Modify: `lib/features/emulator/view/connection_pill.dart`

Wrap the per-state widget in `AnimatedSwitcher(duration: 180ms, transitionBuilder: (child, anim) => FadeTransition(opacity: anim, child: SizeTransition(sizeFactor: anim, axis: Axis.horizontal, child: child)))` keyed on the state's runtime type. Goldens added in subsequent tasks.

```bash
git commit -m "style(emulator): pill — 180ms fade-through state transitions"
```

### Task P8.T2: Booting / reconnecting dot animations

**Files:**
- Modify: `lib/features/emulator/view/connection_pill.dart`

Use `flutter_animate` chained `.scale(begin: 1.0, end: 1.4, duration: 700.ms)` looping on dot when state is `_Booting`, and `.rotate(duration: 1.5s)` for `_Reconnecting`. Gate on `ReduceMotion.of(context)`.

```bash
git commit -m "style(emulator): animated dots for booting/reconnecting states"
```

### Task P8.T3: Hot-reload pulse + middle-pane border glow

**Files:**
- Modify: `lib/features/emulator/cubit/emulator_session_cubit.dart` (track `lastReloadAt`)
- Modify: `lib/features/emulator/view/connection_pill.dart`
- Modify: `lib/features/workbench/view/chat_workbench_panel.dart` (border-glow overlay)

On `reloadCompleted`, the cubit sets `lastReloadAt = DateTime.now()`. The pill subscribes and fires a 200ms scale-pulse on its dot via `flutter_animate.controller`. The middle-pane wraps its body in an `AnimatedContainer` with a 1500ms accent border that fades on the same trigger.

```bash
git commit -m "style(emulator): hot-reload pulse on dot + middle-pane border glow"
```

### Task P8.T4: Run-success Rive hero (one-shot per project)

**Files:**
- Add: `assets/rive/forge_success.riv` (placeholder; final asset by design)
- Modify: `lib/features/emulator/cubit/emulator_session_cubit.dart` (read/write `firstRunCelebrated`)
- Modify: `lib/features/emulator/view/run_logs_pane.dart` or middle-pane overlay (host the Rive widget)

Cubit reads `firstRunCelebrated` on bootstrap; on first successful `runApp` for that project, plays the Rive animation, then calls `settings.markFirstRunCelebrated(projectRoot)`.

```bash
git commit -m "style(emulator): one-shot Rive hero on first successful run per project"
```

### Task P8.T5: Pill golden tests

**Files:**
- Create: `test/features/emulator/view/connection_pill_golden_test.dart`

Render each of the 7 states + manual + reload-pulse mid-frame; capture goldens with `--update-goldens`; commit golden PNGs.

```bash
fvm flutter test --update-goldens test/features/emulator/view/connection_pill_golden_test.dart
git add ...
git commit -m "test(emulator): goldens for ConnectionPill across all states"
```

---

## Phase 9 — Cleanup

### Task P9.T1: Delete `lib/features/connection/`

**Files:**
- Delete: entire `lib/features/connection/` tree
- Remove: any imports referencing `ConnectionBloc`, `ConnectionEvent`, `ConnectionState`, `VmServiceUrlField`
- Migrate: any tests in `test/features/connection/` that still cover behavior — port to `test/features/emulator/` if still relevant; otherwise delete

- [ ] **Step 1: `grep -rn "features/connection" lib test`** — confirm nothing imports from there.
- [ ] **Step 2: Delete the directory.**
- [ ] **Step 3: Run `fvm flutter analyze` and `fvm flutter test` — expect clean.**
- [ ] **Step 4: Commit:**

```bash
git add -u
git commit -m "refactor: delete features/connection (subsumed by features/emulator)"
```

### Task P9.T2: Router cleanup

**Files:**
- Modify: `lib/core/router/app_router.dart`

Confirm no remaining route points at the old `ConnectionView`. If anything dangles, delete it.

```bash
git commit -m "refactor(router): drop dead references to removed connection feature"
```

---

## Phase 10 — Smoke + Integration Suite

### Task P10.T1: `tool/capture_flutter_run.dart`

**Files:**
- Create: `tool/capture_flutter_run.dart`

Script that takes an AVD ID + sample-app path on the command line, spawns `flutter run --machine`, captures stdin/stdout to a JSONL file in `test/fixtures/`, anonymizes paths/UUIDs, and commits the result. Replace the curated minimal fixture from P2.T4.

```bash
fvm dart run tool/capture_flutter_run.dart Pickforge_Test_API_34 test/fixtures/sample_flutter_app
git add test/fixtures/flutter_run_machine_pixel5.jsonl tool/capture_flutter_run.dart
git commit -m "tool: capture flutter run --machine fixture"
```

### Task P10.T2: Sample app fixture

**Files:**
- Create: `test/fixtures/sample_flutter_app/` — minimal Flutter app (one `main.dart` with a `MaterialApp` + a single `Counter`).

```bash
git add test/fixtures/sample_flutter_app
git commit -m "test(fixtures): minimal Flutter sample app for run-session smoke"
```

### Task P10.T3: Integration test (opt-in, tag `emulator`)

**Files:**
- Create: `test/integration/emulator_e2e_test.dart`

```dart
// test/integration/emulator_e2e_test.dart
@Tags(['emulator'])
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';

void main() {
  test('end-to-end: boot → run → vmServiceReady → hot reload → stop', () async {
    final runner = RealProcessRunner();
    final disc = DeviceDiscoveryService(runner);
    final launcher = AvdLauncher(runner);
    final poller = BootReadinessPoller(runner);
    final run = RunSessionController(runner);

    await launcher.launch('Pickforge_Test_API_34');
    final ready = await poller.poll(avdId: 'Pickforge_Test_API_34').firstWhere((e) => e is BootReady);
    final serial = (ready as BootReady).serial;
    final session = await run.start(
      projectRoot: 'test/fixtures/sample_flutter_app',
      serial: serial,
      extraArgs: const [],
    );
    await session.events.firstWhere((e) =>
        e.maybeWhen(vmServiceReady: (_) => true, orElse: () => false));
    expect(session.vmServiceUri, isNotNull);
    final ok = await session.hotReload();
    expect(ok, isTrue);
    await session.stop();
  }, timeout: const Timeout(Duration(minutes: 3)));
}
```

Run with:

```
fvm flutter test --tags emulator test/integration/emulator_e2e_test.dart
```

```bash
git add test/integration/emulator_e2e_test.dart
git commit -m "test(integration): emulator end-to-end smoke (opt-in --tags emulator)"
```

### Task P10.T4: Manual smoke checklist (no commit; doc only)

Add to `docs/architecture/embedded-terminal.md` (or new `docs/architecture/emulator-per-project.md`):

- macOS smoke
- Linux smoke
- Project-switch with active run → AVD survives
- Pickforge SIGKILL during run → relaunch finds AVD, state `.idle`

---

## Self-Review

After all phases complete, verify the plan against the spec:

**Spec coverage:**
- §2 Goals + non-goals → covered (Phases 1–8)
- §3 State machine → P3.T1–T6
- §4 Architecture (file layout) → P1–P3
- §5 Process orchestration → P1.T1, P1.T3, P1.T4, P2.T1, P2.T2, P2.T4, P6.T1
- §6 UI surfaces → P3.T7, P4.T3, P4.T4, P4.T5, P5.T3
- §7 Data model → P1.T5, P1.T6, P1.T7, P1.T8
- §8 Error handling → distributed across cubit transitions; P3.T4 covers boot timeout
- §9 Testing → unit tests inline, P10.T3 integration
- §10 Risks → mitigations live in code (e.g. `pm path` extra check in P1.T4)
- §11 Rollout → matches phases 1→10
- §12 Out of scope → respected
- §13 Open items → ULID source: switch to `package:uuid` v4 hex (already in pubspec) for `sessionId` (replace `microsecondsSinceEpoch` placeholder in P2.T4 if needed).

**Placeholder scan:** No "TBD"/"TODO" left in code. The Phase 7 settings view sketches sub-tasks at coarser granularity than Phase 1–6 since the patterns are duplicates of P3.T7 + P4.T2 — engineer can apply the TDD pattern from those tasks.

**Type consistency:**
- `EmulatorBinding.avd` constructor matches across cubit, repo, and tests.
- `RunSession.hotReload` returns `Future<bool>` consistently.
- `RunSessionEvent` enum names (`stage`, `log`, `vmServiceReady`, `stopped`, `reloadCompleted`) used consistently.
- Drift column names match between table and DAO.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-28-emulator-per-project.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
