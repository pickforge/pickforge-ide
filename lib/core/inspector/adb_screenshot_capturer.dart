import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/process/binary_detector.dart';
import 'package:pickforge/core/projects/pickforge_project_directory.dart';

/// Function type for running a process — abstracted for testing.
typedef AdbProcessRunner = Future<ProcessResult> Function(
  String executable,
  List<String> arguments,
);

/// Captures screenshots from Android devices and iOS simulators.
///
/// NOT annotated with `@lazySingleton` — wired via `@module` in injection.dart
/// because of the optional `processRunner` parameter.
class AdbScreenshotCapturer {
  AdbScreenshotCapturer(
    this._detector, {
    AdbProcessRunner? processRunner,
  }) : _processRunner = processRunner ?? Process.run;

  static const defaultOutputName = 'device-screen.png';
  static const afterHotReloadOutputName = 'device-screen-after-hot-reload.png';

  final BinaryDetector _detector;
  final AdbProcessRunner _processRunner;

  /// Captures a screenshot from the selected Flutter target.
  Future<String?> capture({
    required String outputDir,
    String? serial,
    String? platform,
    String outputName = defaultOutputName,
  }) async {
    if (platform == iosSimulatorPlatform) {
      return _captureIosSimulator(
        outputDir: outputDir,
        simulatorId: serial,
        outputName: outputName,
      );
    }
    if (platform == flutterDesktopPlatform) {
      return _captureDesktop(
        outputDir: outputDir,
        targetId: serial,
        outputName: outputName,
      );
    }
    if (platform == flutterWebPlatform) return null;
    return _captureAndroid(
      outputDir: outputDir,
      serial: serial,
      outputName: outputName,
    );
  }

  Future<String?> _captureAndroid({
    required String outputDir,
    required String outputName,
    String? serial,
  }) async {
    // 1. Check adb on PATH
    final adbOnPath = await _detector.isBinaryOnPath('adb');
    if (!adbOnPath) return null;

    // 2. Find device
    final deviceSerial = serial ?? await _firstConnectedDeviceSerial();
    if (deviceSerial == null) return null;

    // 3. Capture screencap
    final screencapResult = await _processRunner(
      'adb',
      ['-s', deviceSerial, 'exec-out', 'screencap', '-p'],
    );
    if (screencapResult.exitCode != 0) return null;

    final pngBytes = screencapResult.stdout;
    if (pngBytes is! List<int> || pngBytes.isEmpty) return null;

    // 4. Write to file
    final outputPath = await _outputPath(outputDir, outputName: outputName);
    await File(outputPath).writeAsBytes(pngBytes);

    // 5. Return path
    return outputPath;
  }

  Future<String?> _firstConnectedDeviceSerial() async {
    final devicesResult = await _processRunner('adb', ['devices']);
    if (devicesResult.exitCode != 0) return null;

    final devicesOutput = devicesResult.stdout.toString();
    for (final line in devicesOutput.split('\n')) {
      final trimmed = line.trim();
      if (!trimmed.endsWith('\tdevice')) continue;
      return trimmed.split('\t').first;
    }
    return null;
  }

  Future<String?> _captureIosSimulator({
    required String outputDir,
    required String outputName,
    String? simulatorId,
  }) async {
    final xcrunOnPath = await _detector.isBinaryOnPath('xcrun');
    if (!xcrunOnPath) return null;

    final id = simulatorId ?? await _firstBootedIosSimulatorId();
    if (id == null) return null;

    final outputPath = await _outputPath(outputDir, outputName: outputName);
    final result = await _processRunner(
      'xcrun',
      ['simctl', 'io', id, 'screenshot', outputPath],
    );
    if (result.exitCode != 0) return null;

    final file = File(outputPath);
    if (!file.existsSync() || file.lengthSync() == 0) return null;
    return outputPath;
  }

  Future<String?> _firstBootedIosSimulatorId() async {
    final result = await _processRunner(
      'xcrun',
      ['simctl', 'list', 'devices', 'booted', '--json'],
    );
    if (result.exitCode != 0) return null;
    try {
      final decoded = jsonDecode(result.stdout.toString());
      if (decoded is! Map<String, dynamic>) return null;
      final devices = decoded['devices'];
      if (devices is! Map<String, dynamic>) return null;
      for (final runtimeDevices in devices.values) {
        if (runtimeDevices is! List) continue;
        for (final item in runtimeDevices.whereType<Map<String, dynamic>>()) {
          final udid = item['udid'] as String?;
          final state = item['state'] as String?;
          final available = item['isAvailable'] as bool? ?? true;
          if (udid == null || udid.isEmpty || !available) continue;
          if (state == null || state == 'Booted') return udid;
        }
      }
      return null;
    } on FormatException {
      return null;
    }
  }

  Future<String?> _captureDesktop({
    required String outputDir,
    required String outputName,
    String? targetId,
  }) async {
    final flutterOnPath = await _detector.isBinaryOnPath('flutter');
    if (!flutterOnPath) return null;

    final id = targetId ?? _hostDesktopTargetId();
    if (id == null) return null;

    final outputPath = await _outputPath(outputDir, outputName: outputName);
    final result = await _processRunner(
      'flutter',
      ['screenshot', '-d', id, '-o', outputPath],
    );
    if (result.exitCode != 0) return null;

    final file = File(outputPath);
    if (!file.existsSync() || file.lengthSync() == 0) return null;
    return outputPath;
  }

  String? _hostDesktopTargetId() {
    if (Platform.isLinux) return flutterLinuxDeviceId;
    if (Platform.isMacOS) return flutterMacosDeviceId;
    if (Platform.isWindows) return flutterWindowsDeviceId;
    return null;
  }

  Future<String> _outputPath(
    String outputDir, {
    required String outputName,
  }) async {
    if (outputName.isEmpty || p.basename(outputName) != outputName) {
      throw ArgumentError.value(
        outputName,
        'outputName',
        'must be a file name',
      );
    }
    final outputDirObj = p.basename(outputDir) == '.pickforge'
        ? await PickforgeProjectDirectory.ensureDirectory(Directory(outputDir))
        : await Directory(outputDir).create(recursive: true);
    return p.join(outputDirObj.path, outputName);
  }
}
