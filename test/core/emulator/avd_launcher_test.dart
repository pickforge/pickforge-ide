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
    when(
      () => runner.spawn('flutter', [
        'emulators',
        '--launch',
        'Pixel_5_API_34',
      ]),
    ).thenAnswer((_) async => proc);
  });

  test('launch returns a handle and spawns flutter emulators --launch',
      () async {
    final handle = await launcher.launch('Pixel_5_API_34');
    expect(handle.pid, 12345);
    verify(
      () => runner.spawn('flutter', [
        'emulators',
        '--launch',
        'Pixel_5_API_34',
      ]),
    ).called(1);
  });

  test('cancel kills the spawned process', () async {
    final handle = await launcher.launch('Pixel_5_API_34');
    await handle.cancel();
    expect(proc.killed, isTrue);
  });

  test('launch surfaces ProcessRunnerException', () async {
    when(() => runner.spawn('flutter', any<List<String>>()))
        .thenThrow(ProcessRunnerException('flutter', 'ENOENT'));
    expect(() => launcher.launch('X'), throwsA(isA<ProcessRunnerException>()));
  });
}
