import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/shell_invocation.dart';

void main() {
  ShellInvocationResolver resolver({
    String? shell,
    Set<String> existing = const {},
    bool isMacOS = false,
  }) =>
      ShellInvocationResolver(
        environment: {if (shell != null) 'SHELL': shell},
        fileExists: existing.contains,
        isMacOS: isMacOS,
      );

  group('ShellInvocationResolver', () {
    test(r'uses $SHELL when set and present on disk', () {
      final invocation = resolver(
        shell: '/usr/bin/fish',
        existing: {'/usr/bin/fish', '/bin/zsh'},
      ).resolve();
      expect(invocation.executable, '/usr/bin/fish');
    });

    test(r'falls back to zsh when $SHELL is missing from disk', () {
      final invocation = resolver(
        shell: '/usr/bin/fish',
        existing: {'/bin/zsh', '/bin/bash'},
      ).resolve();
      expect(invocation.executable, '/bin/zsh');
    });

    test('falls back through bash to sh', () {
      expect(
        resolver(existing: {'/bin/bash', '/bin/sh'}).resolve().executable,
        '/bin/bash',
      );
      expect(
        resolver(existing: {'/bin/sh'}).resolve().executable,
        '/bin/sh',
      );
    });

    test('defaults to /bin/sh when nothing is found', () {
      expect(resolver().resolve().executable, '/bin/sh');
    });

    test(r'ignores empty $SHELL', () {
      final invocation = resolver(shell: '', existing: {'/bin/zsh'}).resolve();
      expect(invocation.executable, '/bin/zsh');
    });

    test('passes no arguments on Linux', () {
      final invocation =
          resolver(shell: '/bin/zsh', existing: {'/bin/zsh'}).resolve();
      expect(invocation.arguments, isEmpty);
    });

    test('requests a login shell on macOS', () {
      final invocation = resolver(
        shell: '/bin/zsh',
        existing: {'/bin/zsh'},
        isMacOS: true,
      ).resolve();
      expect(invocation.arguments, ['-l']);
    });
  });
}
