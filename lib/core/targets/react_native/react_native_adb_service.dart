import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/process/binary_detector.dart' hide ProcessRunner;
import 'package:pickforge/core/process/user_shell_environment.dart';

/// A binary-safe one-shot process function (stdout is raw bytes, not decoded).
///
/// `ProcessRunner.run` decodes stdout as UTF-8, which corrupts the PNG bytes
/// from `screencap`; screenshots therefore go through this seam (the same
/// reason the Flutter `AdbScreenshotCapturer` keeps its own binary runner).
typedef ReactNativeBinaryProcessRunner = Future<ProcessResult> Function(
  String executable,
  List<String> arguments,
);

/// An Android device visible to ADB.
class RunningAndroidDevice extends Equatable {
  const RunningAndroidDevice({
    required this.serial,
    required this.state,
    this.model,
  });

  final String serial;

  /// The ADB connection state, e.g. `device`, `offline`, `unauthorized`.
  final String state;
  final String? model;

  /// Only `device`-state targets are launchable / inspectable.
  bool get isOnline => state == 'device';

  @override
  List<Object?> get props => [serial, state, model];
}

/// Self-contained ADB support for the React Native Android target.
///
/// Intentionally NOT shared with the Flutter `AdbScreenshotCapturer` yet — RN
/// also needs logcat and (later) UIAutomator flows Flutter does not, so a
/// shared Android client is a later refactor once both paths are proven.
class ReactNativeAdbService {
  ReactNativeAdbService(
    this._runner,
    this._detector, {
    ReactNativeBinaryProcessRunner? screencapRunner,
  }) : _screencapRunner = screencapRunner ?? _defaultScreencapRunner;

  final ProcessRunner _runner;
  final BinaryDetector _detector;
  final ReactNativeBinaryProcessRunner _screencapRunner;

  /// The recognized `adb devices` connection states. Anything else (notably the
  /// `* daemon not running ...` startup noise adb prints to stdout) is ignored.
  static const _knownStates = {
    'device',
    'offline',
    'unauthorized',
    'bootloader',
    'recovery',
    'sideload',
    'authorizing',
    'connecting',
    'host',
    'disconnected',
  };

  Future<List<RunningAndroidDevice>> listDevices() async {
    if (!await _detector.isBinaryOnPath('adb')) return const [];
    final result = await _runner.run('adb', const ['devices', '-l']);
    if (result.exitCode != 0) return const [];
    return _parseDevices(result.stdout.toString());
  }

  /// Captures a PNG screenshot of [serial] into [outputDir]/[outputName].
  Future<String?> captureScreenshot({
    required String serial,
    required String outputDir,
    String outputName = 'device-screen.png',
  }) async {
    if (outputName.isEmpty || p.basename(outputName) != outputName) {
      throw ArgumentError.value(
        outputName,
        'outputName',
        'must be a file name',
      );
    }
    if (!await _detector.isBinaryOnPath('adb')) return null;
    final ProcessResult result;
    try {
      result = await _screencapRunner(
        'adb',
        ['-s', serial, 'exec-out', 'screencap', '-p'],
      );
    } on ProcessException {
      return null;
    }
    if (result.exitCode != 0) return null;
    final bytes = result.stdout;
    if (bytes is! List<int> || bytes.isEmpty) return null;

    final dir = await Directory(outputDir).create(recursive: true);
    final outputPath = p.join(dir.path, outputName);
    await File(outputPath).writeAsBytes(bytes);
    return outputPath;
  }

  /// Dumps the device-side UIAutomator hierarchy XML for [serial], or `null`.
  ///
  /// `exec-out uiautomator dump /dev/tty` streams the XML to stdout (with a
  /// trailing status line the parser tolerates); no file is written to the
  /// device.
  Future<String?> dumpUiAutomatorXml({required String serial}) async {
    if (!await _detector.isBinaryOnPath('adb')) return null;
    final result = await _runner.run(
      'adb',
      ['-s', serial, 'exec-out', 'uiautomator', 'dump', '/dev/tty'],
    );
    if (result.exitCode != 0) return null;
    final output = result.stdout.toString();
    return output.contains('<') ? output : null;
  }

  /// Spawns `adb logcat` for [serial]. Returns `null` when adb is unavailable.
  ///
  /// The caller OWNS the returned process: pipe its lines through
  /// `ReactNativeLogParser.logcatEvent` and `kill()` it to stop streaming —
  /// `adb logcat` runs unbounded otherwise.
  Future<RunningProcess?> streamLogcat({required String serial}) async {
    if (!await _detector.isBinaryOnPath('adb')) return null;
    return _runner.spawn('adb', ['-s', serial, 'logcat', '-v', 'threadtime']);
  }

  List<RunningAndroidDevice> _parseDevices(String output) {
    final devices = <RunningAndroidDevice>[];
    for (final raw in output.split('\n')) {
      final line = raw.trim();
      // Skip the header and the `* daemon not running ...` startup noise adb
      // prints to stdout before the device list.
      if (line.isEmpty ||
          line.startsWith('List of devices') ||
          line.startsWith('*')) {
        continue;
      }
      final parts = line.split(RegExp(r'\s+'));
      if (parts.length < 2) continue;
      final serial = parts[0];
      final state = parts[1];
      if (!_knownStates.contains(state)) continue;
      String? model;
      for (final token in parts.skip(2)) {
        if (token.startsWith('model:')) {
          model = token.substring('model:'.length);
          break;
        }
      }
      devices.add(
        RunningAndroidDevice(serial: serial, state: state, model: model),
      );
    }
    return devices;
  }

  static Future<ProcessResult> _defaultScreencapRunner(
    String executable,
    List<String> arguments,
  ) async {
    // Use the same resolved login-shell PATH as BinaryDetector/ProcessRunner so
    // adb found by detection is also found here.
    final environment = await UserShellEnvironment.instance.load();
    return Process.run(
      executable,
      arguments,
      stdoutEncoding: null,
      environment: environment,
    );
  }
}
