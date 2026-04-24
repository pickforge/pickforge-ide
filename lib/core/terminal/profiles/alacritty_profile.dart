import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

class AlacrittyProfile extends TerminalProfile {
  AlacrittyProfile(this._detector);
  final TerminalDetector _detector;

  @override
  String get id => TerminalProfileId.alacritty.value;

  @override
  String get displayName => 'Alacritty';

  @override
  Set<OperatingSystem> get supportedPlatforms => {
        OperatingSystem.linux,
        OperatingSystem.macos,
      };

  @override
  Future<bool> isInstalled() => _detector.isBinaryOnPath('alacritty');

  @override
  LaunchInvocation buildInvocation(TerminalLaunchSpec spec) => LaunchInvocation(
        binary: 'alacritty',
        arguments: ['-e', spec.scriptPath],
      );
}
