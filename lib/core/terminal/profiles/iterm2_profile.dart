import 'dart:io';

import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

class ITerm2Profile extends TerminalProfile {
  ITerm2Profile(this._detector);
  final TerminalDetector _detector;

  @override
  String get id => TerminalProfileId.iterm2.value;

  @override
  String get displayName => 'iTerm2';

  @override
  Set<OperatingSystem> get supportedPlatforms => {OperatingSystem.macos};

  @override
  Future<bool> isInstalled() async => Platform.isMacOS;

  @override
  LaunchInvocation buildInvocation(TerminalLaunchSpec spec) => LaunchInvocation(
        binary: 'open',
        arguments: ['-a', 'iTerm.app', spec.scriptPath],
      );
}
