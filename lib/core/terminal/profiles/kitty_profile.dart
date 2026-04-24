import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

class KittyProfile extends TerminalProfile {
  KittyProfile(this._detector);
  final TerminalDetector _detector;

  @override
  String get id => TerminalProfileId.kitty.value;

  @override
  String get displayName => 'Kitty';

  @override
  Set<OperatingSystem> get supportedPlatforms => {
        OperatingSystem.linux,
        OperatingSystem.macos,
      };

  @override
  Future<bool> isInstalled() => _detector.isBinaryOnPath('kitty');

  @override
  LaunchInvocation buildInvocation(TerminalLaunchSpec spec) => LaunchInvocation(
        binary: 'kitty',
        arguments: [spec.scriptPath],
      );
}
