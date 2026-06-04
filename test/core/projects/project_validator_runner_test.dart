import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/projects/project_validator_runner.dart';

void main() {
  test('runs configured command through platform shell in project root',
      () async {
    final runner = _FakeRunner(
      result: ProcessResult(12, 0, 'ok', ''),
    );
    final validator = ProjectValidatorRunner(runner: runner);

    final result = await validator.run(
      projectRoot: '/tmp/project',
      command: 'fvm flutter analyze',
    );

    expect(runner.executable, Platform.isWindows ? 'cmd' : '/bin/sh');
    expect(
      runner.arguments,
      Platform.isWindows
          ? ['/C', 'fvm flutter analyze']
          : ['-lc', 'fvm flutter analyze'],
    );
    expect(runner.cwd, '/tmp/project');
    expect(result.exitCode, 0);
    expect(result.passed, isTrue);
    expect(result.stdout, 'ok');
  });

  test('returns failed result when command cannot start', () async {
    final validator = ProjectValidatorRunner(
      runner: _FakeRunner(
        exception: ProcessRunnerException('shell', 'missing'),
      ),
    );

    final result = await validator.run(
      projectRoot: '/tmp/project',
      command: 'missing-validator',
    );

    expect(result.exitCode, isNull);
    expect(result.passed, isFalse);
    expect(result.stderr, contains('missing'));
  });
}

class _FakeRunner implements ProcessRunner {
  _FakeRunner({this.result, this.exception});

  final ProcessResult? result;
  final ProcessRunnerException? exception;
  String? executable;
  List<String>? arguments;
  String? cwd;

  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async {
    this.executable = executable;
    this.arguments = arguments;
    this.cwd = cwd;
    final exception = this.exception;
    if (exception != null) throw exception;
    return result ?? ProcessResult(1, 0, '', '');
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
