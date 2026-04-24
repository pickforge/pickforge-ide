import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

class GhosttyProfile extends TerminalProfile {
  GhosttyProfile(this._detector);
  final TerminalDetector _detector;

  @override
  String get id => TerminalProfileId.ghostty.value;

  @override
  String get displayName => 'Ghostty';

  @override
  Set<OperatingSystem> get supportedPlatforms => {
        OperatingSystem.linux,
        OperatingSystem.macos,
      };

  @override
  Future<bool> isInstalled() => _detector.isBinaryOnPath('ghostty');

  @override
  LaunchInvocation buildInvocation(TerminalLaunchSpec spec) => LaunchInvocation(
        binary: 'ghostty',
        arguments: ['-e', spec.scriptPath],
      );
}
