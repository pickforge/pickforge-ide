import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/profiles/windows_terminal_profile.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

void main() {
  const spec = TerminalLaunchSpec(
    id: TerminalProfileId.windowsTerminal,
    scriptPath: r'C:\tmp\run.bat',
    workingDir: r'C:\Users\me\project',
    env: {},
  );

  TerminalDetector fakeDetector() => TerminalDetector(
        processRunner: (_, __) async => ProcessResult(0, 0, '', ''),
      );

  group('WindowsTerminalProfile', () {
    test('has correct id and displayName', () {
      final profile = WindowsTerminalProfile(fakeDetector());
      expect(profile.id, 'windows-terminal');
      expect(profile.displayName, 'Windows Terminal');
    });

    test('supports only Windows', () {
      final profile = WindowsTerminalProfile(fakeDetector());
      expect(profile.supportedPlatforms, {OperatingSystem.windows});
    });

    test('buildInvocation produces correct args', () {
      final profile = WindowsTerminalProfile(fakeDetector());
      final invocation = profile.buildInvocation(spec);
      expect(invocation.binary, 'wt.exe');
      expect(invocation.arguments, [
        '-d',
        r'C:\Users\me\project',
        'cmd.exe',
        '/c',
        r'C:\tmp\run.bat',
      ]);
    });

    test('isInstalled probes PATH for wt.exe', () async {
      var probed = false;
      final detector = TerminalDetector(
        processRunner: (executable, arguments) async {
          probed = true;
          expect(arguments, ['wt.exe']);
          return ProcessResult(0, 0, '', '');
        },
      );
      final profile = WindowsTerminalProfile(detector);
      final result = await profile.isInstalled();
      expect(probed, isTrue);
      expect(result, isTrue);
    });
  });
}
