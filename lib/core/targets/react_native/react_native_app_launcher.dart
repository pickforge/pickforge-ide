import 'package:equatable/equatable.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/targets/react_native/react_native_command.dart';
import 'package:pickforge/core/targets/react_native/react_native_command_builder.dart';
import 'package:pickforge/core/targets/react_native/react_native_project_detector.dart';

/// The outcome of launching the React Native Android app.
class ReactNativeLaunchResult extends Equatable {
  const ReactNativeLaunchResult({
    required this.command,
    required this.exitCode,
    required this.usedProjectScript,
  });

  final ReactNativeCommand command;
  final int exitCode;

  /// Whether the project's own `android` script ran (vs. the CLI fallback).
  final bool usedProjectScript;

  bool get succeeded => exitCode == 0;

  @override
  List<Object?> get props => [command, exitCode, usedProjectScript];
}

/// Runs a React Native Android app build/install/launch.
///
/// `react-native run-android` (and the project's `android` script) is a
/// one-shot build → install → launch that exits, so this uses
/// `ProcessRunner.run`.
///
/// Device targeting wins over convenience: when a `serial` is given, the
/// community CLI `run-android --deviceId <serial>` is used so the app reliably
/// lands on the chosen device (the project `android` script can't be passed a
/// device portably). With no serial, the project's own script is preferred and
/// the CLI is the fallback only when there is no `android` script.
class ReactNativeAppLauncher {
  ReactNativeAppLauncher(
    this._runner, {
    ReactNativeCommandBuilder commands = const ReactNativeCommandBuilder(),
  }) : _commands = commands;

  final ProcessRunner _runner;
  final ReactNativeCommandBuilder _commands;

  Future<ReactNativeLaunchResult> launch({
    required ReactNativeProjectInfo project,
    String? serial,
  }) async {
    final projectScript =
        serial == null ? _commands.androidRun(project: project) : null;
    final command = projectScript ??
        _commands.localCliRunAndroid(project: project, serial: serial);
    final result = await _runner.run(
      command.executable,
      command.arguments,
      cwd: command.cwd,
      env: command.env,
    );
    return ReactNativeLaunchResult(
      command: command,
      exitCode: result.exitCode,
      usedProjectScript: projectScript != null,
    );
  }
}
