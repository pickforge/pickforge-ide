import 'dart:io';

import 'package:pickforge/core/terminal/models.dart';
import 'package:pickforge/core/terminal/terminal_detector.dart';
import 'package:pickforge/core/terminal/terminal_profile.dart';

class EnvFallbackProfile extends TerminalProfile {
  EnvFallbackProfile(this._detector);
  final TerminalDetector _detector;

  @override
  String get id => TerminalProfileId.envFallback.value;

  @override
  String get displayName => 'System Default (\$TERMINAL)';

  @override
  Set<OperatingSystem> get supportedPlatforms => {
        OperatingSystem.linux,
        OperatingSystem.macos,
      };

  @override
  Future<bool> isInstalled() async {
    final term = Platform.environment['TERMINAL'];
    if (term == null || term.isEmpty) return false;
    return _detector.isBinaryOnPath(term);
  }

  @override
  LaunchInvocation buildInvocation(TerminalLaunchSpec spec) {
    final term = Platform.environment['TERMINAL'];
    if (term == null || term.isEmpty) {
      throw StateError('TERMINAL environment variable is not set');
    }
    return LaunchInvocation(
      binary: term,
      arguments: ['-e', spec.scriptPath],
    );
  }
}
