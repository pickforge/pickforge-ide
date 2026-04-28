import 'dart:io';

import 'package:pickforge/core/process/user_shell_environment.dart';

/// Function type for running a process — abstracted for testing.
typedef ProcessRunner = Future<ProcessResult> Function(
  String executable,
  List<String> arguments,
);

typedef EnvironmentLoader = Future<Map<String, String>> Function();

/// Detects whether binaries are available on PATH.
///
/// Uses `which` on Unix and `where` on Windows.
///
/// Resolves PATH from the user's interactive login shell so that binaries
/// installed via tooling that mutates PATH only in `~/.bashrc` / `~/.zshrc`
/// (bun, npm-global, asdf, mise, volta, etc.) are still detected when the
/// app is launched from a desktop session.
///
/// NOT annotated with `@lazySingleton` — wired via `@module` in injection.dart
/// because of the optional constructor parameters.
class BinaryDetector {
  BinaryDetector({
    ProcessRunner? processRunner,
    EnvironmentLoader? environmentLoader,
  })  : _processRunner = processRunner,
        _envLoader = environmentLoader;

  final ProcessRunner? _processRunner;
  final EnvironmentLoader? _envLoader;

  /// Returns true if [binary] is found on PATH.
  Future<bool> isBinaryOnPath(String binary) async {
    try {
      final executable = Platform.isWindows ? 'where' : 'which';
      if (_processRunner != null) {
        final result = await _processRunner(executable, [binary]);
        return result.exitCode == 0;
      }
      final env = await (_envLoader ?? UserShellEnvironment.instance.load)();
      final result = await Process.run(
        executable,
        [binary],
        environment: env,
      );
      return result.exitCode == 0;
    } on ProcessException {
      return false;
    }
  }
}
