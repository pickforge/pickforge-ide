import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

void main() {
  test('snapshot reports tool availability', () async {
    final service = DiagnosticsService(
      _FakeRunner({
        'adb': 0,
        'git': 0,
        'fvm': 1,
        'emulator': 0,
        'claude': 1,
        'codex': 0,
        'opencode': 1,
      }),
    );

    final snapshot = await service.snapshot();

    expect(snapshot.adbAvailable, isTrue);
    expect(snapshot.gitAvailable, isTrue);
    expect(snapshot.flutterAvailable, isFalse);
    expect(snapshot.emulatorAvailable, isTrue);
    expect(snapshot.claudeAvailable, isFalse);
    expect(snapshot.codexAvailable, isTrue);
    expect(snapshot.openCodeAvailable, isFalse);
  });

  test('support bundle excludes source and redacts logs', () async {
    final service = DiagnosticsService(
      _FakeRunner({
        'adb': 0,
        'git': 0,
        'fvm': 0,
        'emulator': 1,
        'claude': 1,
        'codex': 1,
        'opencode': 1,
      }),
    )..recordLog('error', 'token=super-secret');

    final bundle = await service.buildSupportBundle(
      activeProjectRoot: '/home/me/project',
      lastVmError: 'apiKey=secret',
    );

    expect(
      bundle,
      contains('Source files, prompts, screenshots, and secrets: excluded'),
    );
    expect(bundle, contains('- Project: project'));
    expect(bundle, contains('token=[REDACTED]'));
    expect(bundle, contains('apiKey=[REDACTED]'));
    expect(bundle, isNot(contains('super-secret')));
    expect(bundle, isNot(contains('/home/me/project')));
  });
}

class _FakeRunner implements ProcessRunner {
  _FakeRunner(this.exitCodes);

  final Map<String, int> exitCodes;

  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async {
    return ProcessResult(1, exitCodes[executable] ?? 1, '', '');
  }

  @override
  Future<RunningProcess> spawn(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) {
    throw UnimplementedError();
  }
}
