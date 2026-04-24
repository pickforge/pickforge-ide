import 'dart:io';

import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

class TerminalAppProfile extends TerminalProfile {
  // Detector unused: Terminal.app always present on macOS.
  // ignore: avoid_unused_constructor_parameters
  TerminalAppProfile(TerminalDetector detector);

  @override
  String get id => TerminalProfileId.terminalApp.value;

  @override
  String get displayName => 'Terminal.app';

  @override
  Set<OperatingSystem> get supportedPlatforms => {OperatingSystem.macos};

  @override
  Future<bool> isInstalled() async => Platform.isMacOS;

  @override
  LaunchInvocation buildInvocation(TerminalLaunchSpec spec) => LaunchInvocation(
        binary: 'open',
        arguments: ['-a', 'Terminal.app', spec.scriptPath],
      );
}
