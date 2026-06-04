import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

void main() {
  test('snapshot reports tool availability', () async {
    final service = DiagnosticsService(
      _FakeRunner(
        {
          'adb': 0,
          'git': 0,
          'fvm': 1,
          'emulator': 0,
          'claude': 1,
          'codex': 0,
          'opencode': 1,
          'agent': 0,
          'gemini': 1,
        },
        stdout: {
          'fvm': 'Flutter 3.41.7 • channel stable\nTools',
        },
      ),
      appVersion: '9.8.7+6',
      buildMetadata: const DiagnosticsBuildMetadata(
        commitSha: 'abc123',
        refName: 'main',
      ),
    )
      ..recordVmError('apiKey=vm-secret')
      ..recordPerformance('fileExplorer.scan', const Duration(milliseconds: 12))
      ..recordPerformance('fileExplorer.scan', const Duration(milliseconds: 8));

    final snapshot = await service.snapshot();

    expect(snapshot.appVersion, '9.8.7+6');
    expect(snapshot.buildMetadata.commitSha, 'abc123');
    expect(snapshot.buildMetadata.refName, 'main');
    expect(snapshot.adbAvailable, isTrue);
    expect(snapshot.gitAvailable, isTrue);
    expect(snapshot.flutterAvailable, isFalse);
    expect(snapshot.flutterVersion, isNull);
    expect(snapshot.emulatorAvailable, isTrue);
    expect(snapshot.claudeAvailable, isFalse);
    expect(snapshot.codexAvailable, isTrue);
    expect(snapshot.openCodeAvailable, isFalse);
    expect(snapshot.cursorAvailable, isTrue);
    expect(snapshot.geminiAvailable, isFalse);
    expect(snapshot.lastVmError, 'apiKey=[REDACTED]');
    expect(snapshot.failures, hasLength(1));
    expect(snapshot.failures.single.kind, DiagnosticsFailureKind.connection);
    expect(snapshot.failures.single.message, 'apiKey=[REDACTED]');
    expect(snapshot.performanceCounters, hasLength(1));
    expect(snapshot.performanceCounters.single.name, 'fileExplorer.scan');
    expect(
      snapshot.performanceCounters.single.lastDuration,
      const Duration(milliseconds: 8),
    );
    expect(
      snapshot.performanceCounters.single.maxDuration,
      const Duration(milliseconds: 12),
    );
    expect(snapshot.performanceCounters.single.sampleCount, 2);
  });

  test('support bundle excludes source and redacts logs', () async {
    final service = DiagnosticsService(
      _FakeRunner(
        {
          'adb': 0,
          'git': 0,
          'fvm': 0,
          'emulator': 1,
          'claude': 1,
          'codex': 1,
          'opencode': 1,
          'agent': 1,
          'gemini': 1,
        },
        stdout: {
          'fvm': 'Flutter 3.41.7 • channel stable\nTools',
        },
      ),
      appVersion: '1.2.3+4',
      buildMetadata: const DiagnosticsBuildMetadata(
        commitSha: 'abc123',
        refName: 'main',
        workflow: 'CI',
        runId: '987654321',
        runNumber: '42',
        buildUrl: 'https://example.test/build/42',
      ),
    )
      ..recordLog('error', 'token=super-secret')
      ..recordVmError('password=vm-secret')
      ..recordRunError('run token=super-secret')
      ..recordAgentError('agent apiKey=agent-secret')
      ..recordPerformance(
        'fileExplorer.scan',
        const Duration(milliseconds: 42),
      );

    final bundle = await service.buildSupportBundle(
      activeProjectRoot: '/home/me/project',
    );

    expect(
      bundle,
      contains('Source files, prompts, screenshots, and secrets: excluded'),
    );
    expect(bundle, contains('- App version: 1.2.3+4'));
    expect(bundle, contains('- Build commit: abc123'));
    expect(bundle, contains('- Build ref: main'));
    expect(bundle, contains('- Build workflow: CI'));
    expect(bundle, contains('- Build run: 42 (987654321)'));
    expect(bundle, contains('- Build URL: https://example.test/build/42'));
    expect(bundle, contains('- Flutter/FVM: Flutter 3.41.7 • channel stable'));
    expect(bundle, contains('- Project: project'));
    expect(bundle, contains('token=[REDACTED]'));
    expect(bundle, contains('password=[REDACTED]'));
    expect(bundle, contains('## Recent failures'));
    expect(bundle, contains('[connection] password=[REDACTED]'));
    expect(bundle, contains('[run] run token=[REDACTED]'));
    expect(bundle, contains('[agent] agent apiKey=[REDACTED]'));
    expect(bundle, contains('## Performance counters'));
    expect(
      bundle,
      contains('- fileExplorer.scan: last 42ms, max 42ms, 1 sample'),
    );
    expect(bundle, isNot(contains('super-secret')));
    expect(bundle, isNot(contains('vm-secret')));
    expect(bundle, isNot(contains('agent-secret')));
    expect(bundle, isNot(contains('/home/me/project')));
  });
}

class _FakeRunner implements ProcessRunner {
  _FakeRunner(this.exitCodes, {this.stdout = const {}});

  final Map<String, int> exitCodes;
  final Map<String, String> stdout;

  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async {
    return ProcessResult(
      1,
      exitCodes[executable] ?? 1,
      stdout[executable] ?? '',
      '',
    );
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
