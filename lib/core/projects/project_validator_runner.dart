import 'dart:io';

import 'package:pickforge/core/emulator/process_runner.dart';

class ProjectValidatorRunResult {
  const ProjectValidatorRunResult({
    required this.command,
    required this.exitCode,
    required this.stdout,
    required this.stderr,
    required this.duration,
  });

  final String command;
  final int? exitCode;
  final String stdout;
  final String stderr;
  final Duration duration;

  bool get passed => exitCode == 0;

  String get combinedOutput {
    final parts = [
      if (stdout.trim().isNotEmpty) stdout.trim(),
      if (stderr.trim().isNotEmpty) stderr.trim(),
    ];
    return parts.join('\n');
  }
}

class ProjectValidatorRunner {
  ProjectValidatorRunner({required ProcessRunner runner}) : _runner = runner;

  final ProcessRunner _runner;

  Future<ProjectValidatorRunResult> run({
    required String projectRoot,
    required String command,
  }) async {
    final stopwatch = Stopwatch()..start();
    try {
      final result = await _runner.run(
        _shellExecutable,
        _shellArguments(command),
        cwd: projectRoot,
      );
      stopwatch.stop();
      return ProjectValidatorRunResult(
        command: command,
        exitCode: result.exitCode,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
        duration: stopwatch.elapsed,
      );
    } on ProcessRunnerException catch (e) {
      stopwatch.stop();
      return ProjectValidatorRunResult(
        command: command,
        exitCode: null,
        stdout: '',
        stderr: e.toString(),
        duration: stopwatch.elapsed,
      );
    }
  }

  String get _shellExecutable => Platform.isWindows ? 'cmd' : '/bin/sh';

  List<String> _shellArguments(String command) =>
      Platform.isWindows ? ['/C', command] : ['-lc', command];
}
