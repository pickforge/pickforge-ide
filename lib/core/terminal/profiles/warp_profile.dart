import 'dart:io';

import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

class WarpProfile extends TerminalProfile {
  WarpProfile(this._detector);
  final TerminalDetector _detector;

  @override
  String get id => TerminalProfileId.warp.value;

  @override
  String get displayName => 'Warp';

  @override
  Set<OperatingSystem> get supportedPlatforms => {
        OperatingSystem.linux,
        OperatingSystem.macos,
      };

  @override
  Future<bool> isInstalled() async {
    if (Platform.isMacOS) {
      return Directory('/Applications/Warp.app').existsSync();
    }
    if (Platform.isLinux) {
      return _detector.isBinaryOnPath('warp-terminal');
    }
    return false;
  }

  @override
  LaunchInvocation buildInvocation(TerminalLaunchSpec spec) {
    final url =
        'warp://action/new_tab?path=${Uri.encodeComponent(spec.workingDir)}'
        '&command=${Uri.encodeComponent(spec.scriptPath)}';

    if (Platform.isMacOS) {
      return LaunchInvocation(
        binary: 'open',
        arguments: [url],
      );
    }

    return LaunchInvocation(
      binary: 'xdg-open',
      arguments: [url],
    );
  }
}
