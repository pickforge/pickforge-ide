import 'dart:io';

/// Function type for running a process — abstracted for testing.
typedef ProcessRunner = Future<ProcessResult> Function(
  String executable,
  List<String> arguments,
);

/// Detects whether binaries are available on PATH.
///
/// Uses `which` on Unix and `where` on Windows.
///
/// NOT annotated with `@lazySingleton` — wired via `@module` in injection.dart
/// because of the optional `processRunner` parameter.
class BinaryDetector {
  BinaryDetector({ProcessRunner? processRunner})
      : _processRunner = processRunner ?? Process.run;

  final ProcessRunner _processRunner;

  /// Returns true if [binary] is found on PATH.
  Future<bool> isBinaryOnPath(String binary) async {
    try {
      final executable = Platform.isWindows ? 'where' : 'which';
      final result = await _processRunner(executable, [binary]);
      return result.exitCode == 0;
    } on ProcessException {
      return false;
    }
  }
}
