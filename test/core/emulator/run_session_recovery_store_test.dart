import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/run_session_recovery_store.dart';

class _Probe extends RunProcessProbe {
  _Probe(this.inspections);

  final Map<int, RunProcessInspection> inspections;
  final terminated = <int>[];

  @override
  Future<RunProcessInspection> inspect(int pid) async {
    return inspections[pid] ?? const RunProcessInspection(running: false);
  }

  @override
  Future<bool> terminate(int pid) async {
    terminated.add(pid);
    return true;
  }
}

void main() {
  late Directory project;

  setUp(() async {
    project = await Directory.systemTemp.createTemp('pf-recovery-');
  });

  tearDown(() async {
    if (project.existsSync()) {
      await project.delete(recursive: true);
    }
  });

  test('persist + findRecoverable returns live flutter run metadata', () async {
    final metadata = _metadata(project.path);
    final probe = _Probe({
      4242: RunProcessInspection(
        running: true,
        commandLine: const [
          'flutter',
          'run',
          '--machine',
          '-d',
          'emulator-5554',
        ],
        cwd: project.path,
      ),
    });
    final store = RunSessionRecoveryStore(probe: probe);

    await store.persist(metadata);

    final file = File(
      p.join(project.path, '.pickforge', 'runs', 'session-1', 'session.json'),
    );
    expect(file.existsSync(), isTrue);
    final recovered = await store.findRecoverable(project.path);
    expect(recovered, metadata);
    expect(recovered?.avdPlatform, androidEmulatorPlatform);
  });

  test('findRecoverable deletes stale metadata without terminating PID',
      () async {
    final metadata = _metadata(project.path);
    final probe = _Probe({
      4242: const RunProcessInspection(running: false),
    });
    final store = RunSessionRecoveryStore(probe: probe);
    await store.persist(metadata);

    expect(await store.findRecoverable(project.path), isNull);

    expect(probe.terminated, isEmpty);
    expect(
      File(
        p.join(project.path, '.pickforge', 'runs', 'session-1', 'session.json'),
      ).existsSync(),
      isFalse,
    );
  });

  test('cleanup terminates only matching flutter run process', () async {
    final metadata = _metadata(project.path);
    final probe = _Probe({
      4242: RunProcessInspection(
        running: true,
        commandLine: const [
          'dart',
          'flutter_tools.snapshot',
          'run',
          '--machine',
        ],
        cwd: project.path,
      ),
    });
    final store = RunSessionRecoveryStore(probe: probe);
    await store.persist(metadata);

    await store.cleanup(metadata);

    expect(probe.terminated, [4242]);
  });

  test('cleanup refuses to terminate mismatched recycled PID', () async {
    final metadata = _metadata(project.path);
    final probe = _Probe({
      4242: RunProcessInspection(
        running: true,
        commandLine: const ['flutter', 'run', '--machine'],
        cwd: Directory.systemTemp.path,
      ),
    });
    final store = RunSessionRecoveryStore(probe: probe);
    await store.persist(metadata);

    await store.cleanup(metadata);

    expect(probe.terminated, isEmpty);
  });
}

RunSessionRecoveryMetadata _metadata(String projectRoot) {
  return RunSessionRecoveryMetadata(
    sessionId: 'session-1',
    projectRoot: projectRoot,
    pid: 4242,
    serial: 'emulator-5554',
    startedAt: DateTime.utc(2026, 6, 3),
    avdId: 'Pixel_10',
    avdName: 'Pixel 10',
    avdPlatform: androidEmulatorPlatform,
    targetFile: 'lib/main_dev.dart',
    extraArgs: const ['--flavor', 'dev'],
    vmServiceUri: 'ws://127.0.0.1:1234/ws',
    appId: 'app-1',
    ipcSocketPath: '/tmp/pickforge.sock',
  );
}
