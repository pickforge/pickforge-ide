import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

class GnomeTerminalProfile extends TerminalProfile {
  GnomeTerminalProfile(this._detector);
  final TerminalDetector _detector;

  @override
  String get id => TerminalProfileId.gnomeTerminal.value;

  @override
  String get displayName => 'GNOME Terminal';

  @override
  Set<OperatingSystem> get supportedPlatforms => {OperatingSystem.linux};

  @override
  Future<bool> isInstalled() => _detector.isBinaryOnPath('gnome-terminal');

  @override
  LaunchInvocation buildInvocation(TerminalLaunchSpec spec) => LaunchInvocation(
        binary: 'gnome-terminal',
        arguments: ['--', spec.scriptPath],
      );
}
