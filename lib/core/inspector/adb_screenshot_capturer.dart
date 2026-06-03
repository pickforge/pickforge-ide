import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/process/binary_detector.dart';
import 'package:pickforge/core/projects/pickforge_project_directory.dart';

/// Function type for running a process — abstracted for testing.
typedef AdbProcessRunner = Future<ProcessResult> Function(
  String executable,
  List<String> arguments,
);

/// Captures screenshots from Android devices via adb.
///
/// NOT annotated with `@lazySingleton` — wired via `@module` in injection.dart
/// because of the optional `processRunner` parameter.
class AdbScreenshotCapturer {
  AdbScreenshotCapturer(
    this._detector, {
    AdbProcessRunner? processRunner,
  }) : _processRunner = processRunner ?? Process.run;

  final BinaryDetector _detector;
  final AdbProcessRunner _processRunner;

  /// Captures a screenshot from a connected Android device.
  ///
  /// 1. Check `adb` is on PATH via detector
  /// 2. Use the provided serial or parse the first connected device
  /// 3. Run `adb -s <serial> exec-out screencap -p`
  /// 4. Write PNG bytes to `{outputDir}/device-screen.png`
  /// 5. Return path or null on failure
  Future<String?> capture({required String outputDir, String? serial}) async {
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
    final outputDirObj = p.basename(outputDir) == '.pickforge'
        ? await PickforgeProjectDirectory.ensureDirectory(Directory(outputDir))
        : await Directory(outputDir).create(recursive: true);

    final outputPath = p.join(outputDirObj.path, 'device-screen.png');
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
}
