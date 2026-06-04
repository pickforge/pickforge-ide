import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/process/user_shell_environment.dart';

void main() {
  test('load returns inherited environment when override is enabled', () async {
    var shellWasRun = false;
    final environment = UserShellEnvironment(
      environment: const {
        'PATH': '/tmp/bin',
        'PICKFORGE_INHERITED_ENV_ONLY': '1',
        'SHELL': '/bin/zsh',
      },
      fileExists: (_) => true,
      shellRunner: (_, __) async {
        shellWasRun = true;
        return ProcessResult(1, 0, 'PATH=/shell/bin\n', '');
      },
    );

    final resolved = await environment.load();

    expect(resolved['PATH'], '/tmp/bin');
    expect(shellWasRun, isFalse);
  });

  test('load merges login shell environment by default', () async {
    final environment = UserShellEnvironment(
      environment: const {
        'PATH': '/tmp/bin',
        'SHELL': '/bin/zsh',
      },
      fileExists: (_) => true,
      shellRunner: (_, __) async {
        return ProcessResult(
          1,
          0,
          'PATH=/shell/bin\nEXTRA_TOOL_HOME=/tools\n',
          '',
        );
      },
    );

    final resolved = await environment.load();

    expect(resolved['PATH'], '/shell/bin');
    expect(resolved['EXTRA_TOOL_HOME'], '/tools');
  });
}
