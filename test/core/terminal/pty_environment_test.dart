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
}
