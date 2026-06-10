import 'dart:convert';
import 'dart:io';

/// Resolves the user's real interactive shell environment (PATH and friends).
///
/// GUI apps on Linux/macOS launched outside a terminal inherit a minimal
/// environment from the desktop session, which typically omits paths added by
/// `~/.bashrc` / `~/.zshrc` / `~/.profile` (bun, npm-global, cargo, pipx,
/// volta, asdf, mise, etc.). We fix this by spawning the user's login shell
/// once and reading its `env` output, then merging the result over the
/// process's own environment.
class UserShellEnvironment {
  UserShellEnvironment({
    Map<String, String>? environment,
    Future<ProcessResult> Function(String executable, List<String> arguments)?
        shellRunner,
    bool Function(String path)? fileExists,
    bool? isWindows,
  })  : _environment = environment,
        _shellRunner = shellRunner,
        _fileExists = fileExists,
        _isWindows = isWindows ?? Platform.isWindows;

  static final UserShellEnvironment instance = UserShellEnvironment();

  final Map<String, String>? _environment;
  final Future<ProcessResult> Function(String executable, List<String> args)?
      _shellRunner;
  final bool Function(String path)? _fileExists;
  final bool _isWindows;

  Future<Map<String, String>>? _pending;
  Map<String, String>? _cache;

  Future<Map<String, String>> load() {
    if (_cache != null) return Future.value(_cache);
    return _pending ??= _resolve().whenComplete(() => _pending = null);
  }

  Future<Map<String, String>> _resolve() async {
    final base = Map<String, String>.from(_environment ?? Platform.environment);
    if (_isWindows || base['PICKFORGE_INHERITED_ENV_ONLY'] == '1') {
      _cache = base;
      return base;
    }
    final shell = base['SHELL'];
    final exists = _fileExists ?? (path) => File(path).existsSync();
    if (shell == null || shell.isEmpty || !exists(shell)) {
      _cache = base;
      return base;
    }
    try {
      // `-i -l -c env` asks the shell to source the user's interactive +
      // login startup files (bashrc / zshrc / profile / etc.) and print the
      // resulting environment. A 3-second budget keeps us responsive even if
      // a misbehaving rc hangs.
      final runner = _shellRunner ?? Process.run;
      final result = await runner(shell, ['-ilc', 'env'])
          .timeout(const Duration(seconds: 3));
      if (result.exitCode != 0) {
        _cache = base;
        return base;
      }
      final shellEnv = _parseEnv(result.stdout.toString());
      base.addAll(shellEnv);
    } on Object {
      // If the shell explodes for any reason, fall back to the inherited env.
    }
    _cache = base;
    return base;
  }

  static Map<String, String> _parseEnv(String raw) {
    final out = <String, String>{};
    String? key;
    final value = StringBuffer();
    for (final line in const LineSplitter().convert(raw)) {
      final eq = line.indexOf('=');
      final looksLikeAssignment =
          eq > 0 && _isValidEnvName(line.substring(0, eq));
      if (looksLikeAssignment) {
        if (key != null) out[key] = value.toString();
        key = line.substring(0, eq);
        value
          ..clear()
          ..write(line.substring(eq + 1));
      } else if (key != null) {
        // Continuation line (e.g. multi-line function definitions exported
        // by some shells). Append with a newline to preserve the value.
        value
          ..write('\n')
          ..write(line);
      }
    }
    if (key != null) out[key] = value.toString();
    return out;
  }

  static bool _isValidEnvName(String s) {
    if (s.isEmpty) return false;
    final first = s.codeUnitAt(0);
    if (!_isAlphaOrUnderscore(first)) return false;
    for (var i = 1; i < s.length; i++) {
      final c = s.codeUnitAt(i);
      if (!_isAlphaOrUnderscore(c) && !(c >= 0x30 && c <= 0x39)) return false;
    }
    return true;
  }

  static bool _isAlphaOrUnderscore(int c) =>
      (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || c == 0x5F;
}
