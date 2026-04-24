import 'dart:io' as io;

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/profiles/alacritty_profile.dart';
import 'package:pickforge/core/terminal/profiles/env_fallback_profile.dart';
import 'package:pickforge/core/terminal/profiles/ghostty_profile.dart';
import 'package:pickforge/core/terminal/profiles/gnome_terminal_profile.dart';
import 'package:pickforge/core/terminal/profiles/iterm2_profile.dart';
import 'package:pickforge/core/terminal/profiles/kitty_profile.dart';
import 'package:pickforge/core/terminal/profiles/terminal_app_profile.dart';
import 'package:pickforge/core/terminal/profiles/wezterm_profile.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';

void main() {
  const spec = TerminalLaunchSpec(
    id: TerminalProfileId.ghostty,
    scriptPath: '/tmp/run.sh',
    workingDir: '/home/me/project',
    env: {},
  );

  TerminalDetector fakeDetector() => TerminalDetector(
        processRunner: (_, __) async => io.ProcessResult(0, 0, '', ''),
      );

  group('Unix profile buildInvocation', () {
    test('GhosttyProfile produces correct invocation', () {
      final profile = GhosttyProfile(fakeDetector());
      final invocation = profile.buildInvocation(spec);
      expect(invocation.binary, 'ghostty');
      expect(invocation.arguments, ['-e', '/tmp/run.sh']);
    });

    test('WezTermProfile produces correct invocation', () {
      final profile = WezTermProfile(fakeDetector());
      final invocation = profile.buildInvocation(spec);
      expect(invocation.binary, 'wezterm');
      expect(invocation.arguments, [
        'start',
        '--cwd',
        '/home/me/project',
        '--',
        '/tmp/run.sh',
      ]);
    });

    test('AlacrittyProfile produces correct invocation', () {
      final profile = AlacrittyProfile(fakeDetector());
      final invocation = profile.buildInvocation(spec);
      expect(invocation.binary, 'alacritty');
      expect(invocation.arguments, ['-e', '/tmp/run.sh']);
    });

    test('KittyProfile produces correct invocation (no -e)', () {
      final profile = KittyProfile(fakeDetector());
      final invocation = profile.buildInvocation(spec);
      expect(invocation.binary, 'kitty');
      expect(invocation.arguments, ['/tmp/run.sh']);
    });

    test('GnomeTerminalProfile produces correct invocation', () {
      final profile = GnomeTerminalProfile(fakeDetector());
      final invocation = profile.buildInvocation(spec);
      expect(invocation.binary, 'gnome-terminal');
      expect(invocation.arguments, ['--', '/tmp/run.sh']);
    });

    test('ITerm2Profile produces correct invocation', () {
      final profile = ITerm2Profile(fakeDetector());
      final invocation = profile.buildInvocation(spec);
      expect(invocation.binary, 'open');
      expect(invocation.arguments, ['-a', 'iTerm.app', '/tmp/run.sh']);
    });

    test('TerminalAppProfile produces correct invocation', () {
      final profile = TerminalAppProfile(fakeDetector());
      final invocation = profile.buildInvocation(spec);
      expect(invocation.binary, 'open');
      expect(invocation.arguments, ['-a', 'Terminal.app', '/tmp/run.sh']);
    });
  });

  group('Unix profile metadata', () {
    test('GhosttyProfile has correct id and displayName', () {
      final profile = GhosttyProfile(fakeDetector());
      expect(profile.id, 'ghostty');
      expect(profile.displayName, 'Ghostty');
    });

    test('WezTermProfile has correct id and displayName', () {
      final profile = WezTermProfile(fakeDetector());
      expect(profile.id, 'wezterm');
      expect(profile.displayName, 'WezTerm');
    });

    test('AlacrittyProfile has correct id and displayName', () {
      final profile = AlacrittyProfile(fakeDetector());
      expect(profile.id, 'alacritty');
      expect(profile.displayName, 'Alacritty');
    });

    test('KittyProfile has correct id and displayName', () {
      final profile = KittyProfile(fakeDetector());
      expect(profile.id, 'kitty');
      expect(profile.displayName, 'Kitty');
    });

    test('GnomeTerminalProfile has correct id and displayName', () {
      final profile = GnomeTerminalProfile(fakeDetector());
      expect(profile.id, 'gnome-terminal');
      expect(profile.displayName, 'GNOME Terminal');
    });

    test('ITerm2Profile has correct id and displayName', () {
      final profile = ITerm2Profile(fakeDetector());
      expect(profile.id, 'iterm2');
      expect(profile.displayName, 'iTerm2');
    });

    test('TerminalAppProfile has correct id and displayName', () {
      final profile = TerminalAppProfile(fakeDetector());
      expect(profile.id, 'terminal-app');
      expect(profile.displayName, 'Terminal.app');
    });
  });

  group('EnvFallbackProfile', () {
    test('throws StateError when TERMINAL env var unset', () {
      // This test depends on the actual environment; skip if TERMINAL is set
      if (io.Platform.environment['TERMINAL']?.isNotEmpty ?? false) {
        return;
      }
      final profile = EnvFallbackProfile(fakeDetector());
      expect(() => profile.buildInvocation(spec), throwsA(isA<StateError>()));
    });

    test('id and displayName are correct', () {
      final profile = EnvFallbackProfile(fakeDetector());
      expect(profile.id, 'env-fallback');
      expect(profile.displayName, contains('TERMINAL'));
    });
  });
}
