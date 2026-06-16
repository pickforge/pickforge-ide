import 'package:pickforge/core/targets/native_ios/ios_command.dart';
import 'package:pickforge/core/targets/native_ios/ios_project_detector.dart';

/// Builds the deterministic xcodebuild / `xcrun simctl` commands for a native
/// iOS project. Pure (testable anywhere); the caller executes them only on
/// macOS.
class IosCommandBuilder {
  const IosCommandBuilder();

  static const _simulatorReady = 'platform=iOS Simulator,name=iPhone 15';

  /// Runs `xcodebuild ... build` for the workspace (preferred) or project with
  /// the given scheme and destination (Apple TN2339).
  IosCommand build({
    required IosProjectInfo project,
    required String scheme,
    String destination = _simulatorReady,
  }) {
    final input = project.workspace != null
        ? ['-workspace', project.workspace!]
        : ['-project', project.xcodeproj!];
    return IosCommand(
      executable: 'xcodebuild',
      arguments: [
        ...input,
        '-scheme',
        scheme,
        '-destination',
        destination,
        'build',
      ],
      cwd: project.projectRoot,
    );
  }

  /// `xcodebuild -list -json` — discovers schemes/targets/configurations.
  IosCommand listSchemes({required IosProjectInfo project}) {
    final input = project.workspace != null
        ? ['-workspace', project.workspace!]
        : ['-project', project.xcodeproj!];
    return IosCommand(
      executable: 'xcodebuild',
      arguments: [...input, '-list', '-json'],
      cwd: project.projectRoot,
    );
  }

  IosCommand simctlListDevices() => const IosCommand(
        executable: 'xcrun',
        arguments: ['simctl', 'list', 'devices', 'available', '--json'],
      );

  IosCommand simctlBoot(String udid) =>
      IosCommand(executable: 'xcrun', arguments: ['simctl', 'boot', udid]);

  IosCommand simctlInstall(String udid, String appPath) => IosCommand(
        executable: 'xcrun',
        arguments: ['simctl', 'install', udid, appPath],
      );

  IosCommand simctlLaunch(String udid, String bundleId) => IosCommand(
        executable: 'xcrun',
        arguments: ['simctl', 'launch', udid, bundleId],
      );

  IosCommand simctlScreenshot(String udid, String outputPath) => IosCommand(
        executable: 'xcrun',
        arguments: ['simctl', 'io', udid, 'screenshot', outputPath],
      );

  IosCommand simctlLogStream(String udid) => IosCommand(
        executable: 'xcrun',
        arguments: [
          'simctl',
          'spawn',
          udid,
          'log',
          'stream',
          '--style',
          'compact',
        ],
      );
}
