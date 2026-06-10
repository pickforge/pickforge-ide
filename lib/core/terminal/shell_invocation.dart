import 'dart:io';

class ShellInvocation {
  const ShellInvocation({required this.executable, required this.arguments});

  final String executable;
  final List<String> arguments;
}

/// Picks the shell the embedded terminal should spawn: the user's `$SHELL`
/// when it exists on disk, otherwise zsh → bash → sh.
class ShellInvocationResolver {
  ShellInvocationResolver({
    Map<String, String>? environment,
    bool Function(String path)? fileExists,
    bool? isMacOS,
  })  : _environment = environment,
        _fileExists = fileExists,
        _isMacOS = isMacOS;

  final Map<String, String>? _environment;
  final bool Function(String path)? _fileExists;
  final bool? _isMacOS;

  static const _fallbacks = ['/bin/zsh', '/bin/bash', '/bin/sh'];

  ShellInvocation resolve() {
    final env = _environment ?? Platform.environment;
    final exists = _fileExists ?? (path) => File(path).existsSync();
    final shell = env['SHELL'];
    final executable = [
      if (shell != null && shell.isNotEmpty) shell,
      ..._fallbacks,
    ].firstWhere(exists, orElse: () => '/bin/sh');
    // A PTY-attached shell is already interactive; macOS additionally expects
    // a login shell (Terminal.app convention) so /etc/paths et al. apply.
    final arguments =
        (_isMacOS ?? Platform.isMacOS) ? const ['-l'] : const <String>[];
    return ShellInvocation(executable: executable, arguments: arguments);
  }
}
