import 'dart:convert';
import 'dart:io';

import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/process/user_shell_environment.dart';

Future<void> main(List<String> args) async {
  final parsed = _Args.parse(args);
  if (parsed == null) {
    stderr.writeln(
      'Usage: fvm dart run tool/diagnostics_probe.dart '
      '--path <path> [--expect-missing <tool>] '
      '[--expect-available <tool>]',
    );
    exitCode = 64;
    return;
  }

  final environment = {
    ...Platform.environment,
    'PATH': parsed.path,
    'PICKFORGE_INHERITED_ENV_ONLY': '1',
  };
  final diagnostics = DiagnosticsService(
    RealProcessRunner(
      shellEnv: UserShellEnvironment(environment: environment),
    ),
  );
  final snapshot = await diagnostics.snapshot();
  final availability = _availability(snapshot);
  final failures = <String>[];
  for (final tool in parsed.expectMissing) {
    if (availability[tool] ?? false) {
      failures.add('Expected $tool to be missing.');
    }
  }
  for (final tool in parsed.expectAvailable) {
    if (!(availability[tool] ?? false)) {
      failures.add('Expected $tool to be available.');
    }
  }

  stdout.writeln(const JsonEncoder.withIndent('  ').convert(availability));
  if (failures.isNotEmpty) {
    failures.forEach(stderr.writeln);
    exitCode = 1;
  }
}

Map<String, bool> _availability(DiagnosticsSnapshot snapshot) => {
      'adb': snapshot.adbAvailable,
      'agent': snapshot.cursorAvailable,
      'claude': snapshot.claudeAvailable,
      'codex': snapshot.codexAvailable,
      'emulator': snapshot.emulatorAvailable,
      'fvm': snapshot.flutterAvailable,
      'gemini': snapshot.geminiAvailable,
      'git': snapshot.gitAvailable,
      'opencode': snapshot.openCodeAvailable,
    };

class _Args {
  const _Args({
    required this.path,
    required this.expectMissing,
    required this.expectAvailable,
  });

  final String path;
  final List<String> expectMissing;
  final List<String> expectAvailable;

  static _Args? parse(List<String> args) {
    String? path;
    final expectMissing = <String>[];
    final expectAvailable = <String>[];
    for (var index = 0; index < args.length; index++) {
      final arg = args[index];
      switch (arg) {
        case '--path':
          if (index + 1 >= args.length) return null;
          path = args[++index];
        case '--expect-missing':
          if (index + 1 >= args.length) return null;
          expectMissing.add(args[++index]);
        case '--expect-available':
          if (index + 1 >= args.length) return null;
          expectAvailable.add(args[++index]);
        default:
          return null;
      }
    }
    if (path == null) return null;
    return _Args(
      path: path,
      expectMissing: expectMissing,
      expectAvailable: expectAvailable,
    );
  }
}
