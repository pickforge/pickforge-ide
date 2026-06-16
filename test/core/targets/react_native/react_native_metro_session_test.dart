import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/targets/react_native/react_native_command.dart';
import 'package:pickforge/core/targets/react_native/react_native_metro_session.dart';
import 'package:pickforge/core/targets/react_native/react_native_project_detector.dart';

class _FakeRunner extends Mock implements ProcessRunner {}

class _FakeProc implements RunningProcess {
  final stdoutCtrl = StreamController<List<int>>();
  final stderrCtrl = StreamController<List<int>>();
  final exitCtrl = Completer<int>();
  bool killed = false;

  @override
  int get pid => 7777;

  @override
  Stream<List<int>> get stdout => stdoutCtrl.stream;

  @override
  Stream<List<int>> get stderr => stderrCtrl.stream;

  @override
  Future<int> get exitCode => exitCtrl.future;

  @override
  void writeStdin(List<int> bytes) {}

  @override
  Future<void> kill({ProcessSignal signal = ProcessSignal.sigterm}) async {
    killed = true;
    if (!exitCtrl.isCompleted) exitCtrl.complete(143);
  }
}

const _project = ReactNativeProjectInfo(
  projectRoot: '/app',
  packageManager: ReactNativePackageManager.yarn,
  hasAndroidProject: true,
  hasAndroidScript: true,
);

void main() {
  test('spawns Metro and streams parsed log + stopped events', () async {
    final runner = _FakeRunner();
    final proc = _FakeProc();
    when(
      () => runner.spawn(
        'npx',
        any<List<String>>(),
        cwd: any(named: 'cwd'),
        env: any(named: 'env'),
      ),
    ).thenAnswer((_) async => proc);

    final controller = ReactNativeMetroSessionController(runner);
    final session = await controller.start(project: _project);
    expect(session.targetId, 'react_native_android');
    expect(session.isRunning, isTrue);

    final events = <RunSessionEvent>[];
    final done = session.events.listen(events.add).asFuture<void>();

    proc.stdoutCtrl.add(utf8.encode('info Dev server ready\n'));
    proc.stderrCtrl.add(utf8.encode('warn deprecated API\n'));
    await Future<void>.delayed(const Duration(milliseconds: 5));
    await proc.stdoutCtrl.close();
    await proc.stderrCtrl.close();
    proc.exitCtrl.complete(0);
    await done;

    final logs = events.whereType<RunSessionEvent>().toList();
    expect(
      logs.any(
        (e) => e.maybeMap(
          log: (l) => l.source == 'metro' && l.level == LogLevel.info,
          orElse: () => false,
        ),
      ),
      isTrue,
    );
    expect(
      logs.any(
        (e) => e.maybeMap(
          log: (l) => l.level == LogLevel.warning,
          orElse: () => false,
        ),
      ),
      isTrue,
    );
    expect(
      events.any(
        (e) => e.maybeMap(
          stopped: (s) => s.exitCode == 0 && s.reason == 'metro_exited',
          orElse: () => false,
        ),
      ),
      isTrue,
    );
  });

  test('drains tail output and flips isRunning on natural exit', () async {
    final runner = _FakeRunner();
    final proc = _FakeProc();
    when(
      () => runner.spawn(
        'npx',
        any<List<String>>(),
        cwd: any(named: 'cwd'),
        env: any(named: 'env'),
      ),
    ).thenAnswer((_) async => proc);

    final session = await ReactNativeMetroSessionController(runner)
        .start(project: _project);
    final events = <RunSessionEvent>[];
    final done = session.events.listen(events.add).asFuture<void>();

    proc.stdoutCtrl.add(utf8.encode('info ready\n'));
    proc.exitCtrl.complete(0); // process exits while output is still pending
    proc.stdoutCtrl.add(utf8.encode('info final tail line\n'));
    await proc.stdoutCtrl.close();
    await proc.stderrCtrl.close();
    await done;

    expect(session.isRunning, isFalse);

    final tailIndex = events.indexWhere(
      (e) => e.maybeMap(
        log: (l) => l.line.contains('final tail line'),
        orElse: () => false,
      ),
    );
    final stoppedIndex = events.indexWhere(
      (e) => e.maybeMap(stopped: (_) => true, orElse: () => false),
    );
    expect(tailIndex, greaterThanOrEqualTo(0));
    expect(stoppedIndex, greaterThan(tailIndex));
  });

  test('does not hang when an output stream stays open after exit', () async {
    final runner = _FakeRunner();
    final proc = _FakeProc();
    when(
      () => runner.spawn(
        'npx',
        any<List<String>>(),
        cwd: any(named: 'cwd'),
        env: any(named: 'env'),
      ),
    ).thenAnswer((_) async => proc);

    // Short drain timeout so the lingering-pipe guard is exercised fast.
    final session = await ReactNativeMetroSessionController(
      runner,
      drainTimeout: const Duration(milliseconds: 20),
    ).start(project: _project);
    final events = <RunSessionEvent>[];
    final done = session.events.listen(events.add).asFuture<void>();

    proc.stdoutCtrl.add(utf8.encode('info ready\n'));
    proc.exitCtrl.complete(0); // exits, but streams are never closed
    await done.timeout(const Duration(seconds: 2));

    expect(session.isRunning, isFalse);
    expect(
      events.any((e) => e.maybeMap(stopped: (_) => true, orElse: () => false)),
      isTrue,
    );
  });

  test('discoverDebugTargets queries the launched host and port', () async {
    final runner = _FakeRunner();
    final proc = _FakeProc();
    when(
      () => runner.spawn(
        'npx',
        any<List<String>>(),
        cwd: any(named: 'cwd'),
        env: any(named: 'env'),
      ),
    ).thenAnswer((_) async => proc);

    final requested = <Uri>[];
    final controller = ReactNativeMetroSessionController(
      runner,
      metroHttpFetcher: (uri) async {
        requested.add(uri);
        return '[{"id":"1","type":"node","vm":"Hermes",'
            '"webSocketDebuggerUrl":"ws://x/1"}]';
      },
    );
    final session = await controller.start(
      project: _project,
      options: const ReactNativeMetroOptions(port: 9000, host: '0.0.0.0'),
    );
    unawaited(session.events.drain<void>());

    final targets = await session.discoverDebugTargets();
    expect(targets.single.isReactNativeHermesDebuggerTarget, isTrue);
    expect(requested.first.host, '127.0.0.1');
    expect(requested.first.port, 9000);

    await session.stop();
  });

  test('stop kills the process and flips isRunning', () async {
    final runner = _FakeRunner();
    final proc = _FakeProc();
    when(
      () => runner.spawn(
        'npx',
        any<List<String>>(),
        cwd: any(named: 'cwd'),
        env: any(named: 'env'),
      ),
    ).thenAnswer((_) async => proc);

    final session = await ReactNativeMetroSessionController(runner)
        .start(project: _project);
    unawaited(session.events.drain<void>());

    await session.stop();
    expect(proc.killed, isTrue);
    expect(session.isRunning, isFalse);
  });
}
