import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

class WezTermProfile extends TerminalProfile {
  WezTermProfile(this._detector);
  final TerminalDetector _detector;

  @override
  String get id => TerminalProfileId.wezterm.value;

  @override
  String get displayName => 'WezTerm';

  @override
  Set<OperatingSystem> get supportedPlatforms => {
        OperatingSystem.linux,
        OperatingSystem.macos,
      };

  @override
  Future<bool> isInstalled() => _detector.isBinaryOnPath('wezterm');

  @override
  LaunchInvocation buildInvocation(TerminalLaunchSpec spec) => LaunchInvocation(
        binary: 'wezterm',
        arguments: ['start', '--cwd', spec.workingDir, '--', spec.scriptPath],
      );
}
