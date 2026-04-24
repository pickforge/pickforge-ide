import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

class WindowsTerminalProfile extends TerminalProfile {
  WindowsTerminalProfile(this._detector);
  final TerminalDetector _detector;

  @override
  String get id => TerminalProfileId.windowsTerminal.value;

  @override
  String get displayName => 'Windows Terminal';

  @override
  Set<OperatingSystem> get supportedPlatforms => {OperatingSystem.windows};

  @override
  Future<bool> isInstalled() => _detector.isBinaryOnPath('wt.exe');

  @override
  LaunchInvocation buildInvocation(TerminalLaunchSpec spec) => LaunchInvocation(
        binary: 'wt.exe',
        arguments: ['-d', spec.workingDir, 'cmd.exe', '/c', spec.scriptPath],
      );
}
