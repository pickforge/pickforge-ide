import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/profiles/warp_profile.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

void main() {
  const spec = TerminalLaunchSpec(
    id: TerminalProfileId.warp,
    scriptPath: '/tmp/run.sh',
    workingDir: '/home/me/project',
    env: {},
  );

  TerminalDetector _fakeDetector() => TerminalDetector(
        processRunner: (_, __) async => ProcessResult(0, 0, '', ''),
      );

  group('WarpProfile', () {
    test('has correct id and displayName', () {
      final profile = WarpProfile(_fakeDetector());
      expect(profile.id, 'warp');
      expect(profile.displayName, 'Warp');
    });

    test('supports Linux and macOS', () {
      final profile = WarpProfile(_fakeDetector());
      expect(profile.supportedPlatforms, {
        OperatingSystem.linux,
        OperatingSystem.macos,
      });
    });

    test('buildInvocation returns open with warp URL on macOS', () {
      // We can't easily mock Platform.isMacOS, so just verify the URL structure
      final profile = WarpProfile(_fakeDetector());
      final invocation = profile.buildInvocation(spec);

      // On Linux (where tests run), it uses xdg-open
      // On macOS, it would use open
      expect(invocation.arguments, hasLength(1));
      expect(invocation.arguments.first, contains('warp://action/new_tab'));
      expect(invocation.arguments.first, contains('path='));
      expect(invocation.arguments.first, contains('command='));
    });

    test('isInstalled probes PATH for warp-terminal on Linux', () async {
      var probed = false;
      final detector = TerminalDetector(
        processRunner: (executable, arguments) async {
          probed = true;
          expect(arguments, ['warp-terminal']);
          return ProcessResult(0, 0, '', '');
        },
      );
      final profile = WarpProfile(detector);
      final result = await profile.isInstalled();
      // On Linux, it should probe PATH
      expect(probed, isTrue);
      expect(result, isTrue);
    });
  });
}
