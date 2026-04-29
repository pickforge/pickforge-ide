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
