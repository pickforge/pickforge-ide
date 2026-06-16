import 'package:pickforge/core/targets/react_native/react_native_command.dart';
import 'package:pickforge/core/targets/react_native/react_native_project_detector.dart';

/// Builds the deterministic process commands for driving a React Native
/// Android project.
///
/// Metro uses the canonical, package-manager-agnostic community CLI launcher
/// (`npx @react-native-community/cli start`, confirmed via the React Native
/// docs). The package manager governs the app-run script (`<pm> run android`),
/// which is the project's own toolchain; the community CLI `run-android` is a
/// fallback only when the project has no `android` script.
class ReactNativeCommandBuilder {
  const ReactNativeCommandBuilder();

  ReactNativeCommand metroStart({
    required ReactNativeProjectInfo project,
    ReactNativeMetroOptions options = const ReactNativeMetroOptions(),
  }) {
    if (project.isExpo) return expoStart(project: project, options: options);
    return ReactNativeCommand(
      executable: 'npx',
      arguments: [
        '@react-native-community/cli',
        'start',
        '--port',
        '${options.port}',
        '--host',
        options.host,
        '--projectRoot',
        project.projectRoot,
        if (options.resetCache) '--reset-cache',
      ],
      cwd: project.projectRoot,
    );
  }

  /// The project's own `android` run script, run through its package manager.
  ///
  /// Returns `null` when the project declares no `android` script — callers
  /// fall back to [localCliRunAndroid].
  ReactNativeCommand? androidRun({required ReactNativeProjectInfo project}) {
    if (!project.hasAndroidScript) return null;
    return ReactNativeCommand(
      executable: _packageManagerExecutable(project.packageManager),
      arguments: const ['run', 'android'],
      cwd: project.projectRoot,
    );
  }

  /// The community CLI fallback (`npx @react-native-community/cli run-android`),
  /// used only when the project has no `android` script. A device serial is
  /// passed through `--deviceId` because the CLI accepts it reliably.
  ReactNativeCommand localCliRunAndroid({
    required ReactNativeProjectInfo project,
    String? serial,
  }) {
    return ReactNativeCommand(
      executable: 'npx',
      arguments: [
        '@react-native-community/cli',
        'run-android',
        if (serial != null) ...['--deviceId', serial],
      ],
      cwd: project.projectRoot,
    );
  }

  /// Starts the Expo dev server (`<runner> expo start --port [--clear]`).
  ReactNativeCommand expoStart({
    required ReactNativeProjectInfo project,
    ReactNativeMetroOptions options = const ReactNativeMetroOptions(),
  }) {
    return ReactNativeCommand(
      executable: _expoExecutable(project.packageManager),
      arguments: [
        'expo',
        'start',
        '--port',
        '${options.port}',
        if (options.resetCache) '--clear',
      ],
      cwd: project.projectRoot,
    );
  }

  /// Builds/installs/launches the Expo Android app (`<runner> expo run:android`).
  ///
  /// No device target: Expo's `--device` resolves a device NAME (AVD/model),
  /// not an ADB serial, so PickForge can't pass its serial here — Expo selects
  /// the device (a known MVP limitation for multi-device setups).
  ReactNativeCommand expoRunAndroid({
    required ReactNativeProjectInfo project,
  }) {
    return ReactNativeCommand(
      executable: _expoExecutable(project.packageManager),
      arguments: const ['expo', 'run:android'],
      cwd: project.projectRoot,
    );
  }

  // npm invokes the local bin via `npx`; the other managers run it directly.
  String _expoExecutable(ReactNativePackageManager pm) {
    return pm == ReactNativePackageManager.npm
        ? 'npx'
        : _packageManagerExecutable(pm);
  }

  String _packageManagerExecutable(ReactNativePackageManager pm) {
    switch (pm) {
      case ReactNativePackageManager.npm:
        return 'npm';
      case ReactNativePackageManager.yarn:
        return 'yarn';
      case ReactNativePackageManager.pnpm:
        return 'pnpm';
      case ReactNativePackageManager.bun:
        return 'bun';
    }
  }
}
