import 'dart:io';

import 'package:pickforge/core/terminal/models.dart';

/// Supported operating systems for terminal profile detection.
enum OperatingSystem { linux, macos, windows }

/// Detects the current OS at runtime.
OperatingSystem get currentOs {
  if (Platform.isLinux) return OperatingSystem.linux;
  if (Platform.isMacOS) return OperatingSystem.macos;
  if (Platform.isWindows) return OperatingSystem.windows;
  throw UnsupportedError('Unsupported platform');
}

/// Abstract base for all terminal profiles.
abstract class TerminalProfile {
  const TerminalProfile();

  /// Unique identifier for this profile.
  String get id;

  /// Human-readable name shown in UI.
  String get displayName;

  /// Set of OSes where this terminal can run.
  Set<OperatingSystem> get supportedPlatforms;

  /// Returns true if the terminal is installed on this machine.
  Future<bool> isInstalled();

  /// Build the command-line invocation to launch this terminal
  /// with the given spec.
  LaunchInvocation buildInvocation(TerminalLaunchSpec spec);
}

/// Result of building a terminal invocation.
class LaunchInvocation {
  const LaunchInvocation({
    required this.binary,
    required this.arguments,
  });

  /// The executable to run.
  final String binary;

  /// Arguments to pass to the executable.
  final List<String> arguments;
}
