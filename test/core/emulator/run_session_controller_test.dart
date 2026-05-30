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
  test('emits vmServiceReady from app.started, propagates logs and stage',
      () async {
    final fixture = await File('test/fixtures/flutter_run_machine_pixel5.jsonl')
        .readAsString();
    final lines = fixture.split('\n').where((line) => line.isNotEmpty).toList();
    final runner = _FakeRunner();
    final fake = _FakeProc(lines);
    when(
      () => runner.spawn(
        'flutter',
        any<List<String>>(),
        cwd: any(named: 'cwd'),
      ),
    ).thenAnswer((_) async => fake);

    final controller = RunSessionController(runner);
    final session = await controller.start(
      projectRoot: '/p',
      serial: 'emulator-5554',
      extraArgs: const [],
    );
    final events = <RunSessionEvent>[];
    final sub = session.events.listen(events.add);
    unawaited(fake.drip());

    final vmEvent = await session.events.firstWhere(_isVmReady);
    final vmUri = vmEvent.whenOrNull(vmServiceReady: (uri) => uri);
    expect(vmUri, 'ws://127.0.0.1:51234/UUID=/ws');
    expect(session.vmServiceUri, 'ws://127.0.0.1:51234/UUID=/ws');
    expect(session.appId, 'abc');
    await sub.cancel();
  });

  test(
    'hotReload sends app.restart with correct id and routes response',
    () async {
      final runner = _FakeRunner();
      final fake = _FakeProc([
        jsonEncode([
          {
            'event': 'app.start',
            'params': {'appId': 'abc', 'deviceId': 'emulator-5554'},
          },
        ]),
        jsonEncode([
          {
            'event': 'app.started',
            'params': {'appId': 'abc', 'vmServiceUri': 'ws://x/ws'},
          },
        ]),
      ]);
      when(
        () => runner.spawn(
          'flutter',
          any<List<String>>(),
          cwd: any(named: 'cwd'),
        ),
      ).thenAnswer((_) async => fake);

      final controller = RunSessionController(runner);
      final session = await controller.start(
        projectRoot: '/p',
        serial: 'emulator-5554',
        extraArgs: const [],
      );
      unawaited(fake.drip());
      await session.events.firstWhere((_) => session.vmServiceUri != null);

      final reloadFuture = session.hotReload();
      fake.stdoutCtrl.add(utf8.encode('[{"id":1,"result":{"code":0}}]\n'));
      final ok = await reloadFuture.timeout(const Duration(seconds: 2));
      expect(ok, isTrue);

      final stdinJson =
          jsonDecode(utf8.decode(fake.stdinCapture.last)) as List<dynamic>;
      final restartRequest = stdinJson.single as Map<String, Object?>;
      expect(restartRequest['method'], 'app.restart');
      switch (restartRequest['params']) {
        case final Map<String, Object?> params:
          expect(params['fullRestart'], false);
        default:
          fail('Expected params map');
      }
    },
  );

  test('stop sends app.stop and resolves exit', () async {
    final runner = _FakeRunner();
    final fake = _FakeProc([
      '[{"event":"app.start","params":{"appId":"abc","deviceId":"e"}}]',
    ]);
    when(
      () => runner.spawn(
        'flutter',
        any<List<String>>(),
        cwd: any(named: 'cwd'),
      ),
    ).thenAnswer((_) async => fake);
    final session = await RunSessionController(runner).start(
      projectRoot: '/p',
      serial: 'e',
      extraArgs: const [],
    );
    unawaited(fake.drip());
    final stopFuture = session.stop();
    if (!fake.exitCtrl.isCompleted) fake.exitCtrl.complete(0);
    await stopFuture.timeout(const Duration(seconds: 2));
    expect(fake.killed, isTrue);
  });
}

bool _isVmReady(RunSessionEvent event) =>
    event.maybeWhen(vmServiceReady: (_) => true, orElse: () => false);
