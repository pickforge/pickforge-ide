import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/pty_environment.dart';

void main() {
  test('normalizes inherited terminal capabilities for embedded PTY', () {
    final env = normalizePtyEnvironment(const {
      'PATH': '/usr/bin',
      'HOME': '/home/dev',
      'TERM': 'dumb',
      'NO_COLOR': '1',
      'ANSI_COLORS_DISABLED': '1',
    });

    expect(env['PATH'], '/usr/bin');
    expect(env['HOME'], '/home/dev');
    expect(env['TERM'], 'xterm-256color');
    expect(env['COLORTERM'], 'truecolor');
    expect(env['CLICOLOR'], '1');
    expect(env.containsKey('NO_COLOR'), isFalse);
    expect(env.containsKey('ANSI_COLORS_DISABLED'), isFalse);
  });

  test('preserves PICKFORGE_* discovery vars', () {
    final env = normalizePtyEnvironment(const {
      'PICKFORGE_HOME': '/home/.pickforge',
      'PICKFORGE_PROJECT_ROOT': '/home/dev/app',
      'PICKFORGE_CONTEXT_DIR': '/home/.pickforge/projects/app-x/context',
      'PICKFORGE_STORAGE_MODE': 'home',
      'PICKFORGE_IPC_ENDPOINT': '/run/pickforge.sock',
    });

    expect(env['PICKFORGE_HOME'], '/home/.pickforge');
    expect(env['PICKFORGE_PROJECT_ROOT'], '/home/dev/app');
    expect(
      env['PICKFORGE_CONTEXT_DIR'],
      '/home/.pickforge/projects/app-x/context',
    );
    expect(env['PICKFORGE_STORAGE_MODE'], 'home');
    expect(env['PICKFORGE_IPC_ENDPOINT'], '/run/pickforge.sock');
  });
}
