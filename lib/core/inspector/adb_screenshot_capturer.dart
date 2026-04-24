import 'dart:io';

import 'package:pickforge/core/terminal/terminal_detector.dart';

/// Function type for running a process — abstracted for testing.
typedef AdbProcessRunner = Future<ProcessResult> Function(
  String executable,
  List<String> arguments,
);

/// Captures screenshots from Android emulators via adb.
///
/// NOT annotated with `@lazySingleton` — wired via `@module` in injection.dart
/// because of the optional `processRunner` parameter.
class AdbScreenshotCapturer {
  AdbScreenshotCapturer(
    this._detector, {
    AdbProcessRunner? processRunner,
  }) : _processRunner = processRunner ?? Process.run;

  final TerminalDetector _detector;
  final AdbProcessRunner _processRunner;

  /// Captures a screenshot from a connected emulator.
  ///
  /// 1. Check `adb` is on PATH via detector
  /// 2. Run `adb devices`, parse for `emulator-XXX\tdevice` line
  /// 3. Run `adb -s <serial> exec-out screencap -p`
  /// 4. Write PNG bytes to `{outputDir}/device-screen.png`
  /// 5. Return path or null on failure
  Future<String?> capture({required String outputDir}) async {
    // 1. Check adb on PATH
    final adbOnPath = await _detector.isBinaryOnPath('adb');
    if (!adbOnPath) return null;

    // 2. Find emulator
    final devicesResult = await _processRunner('adb', ['devices']);
    if (devicesResult.exitCode != 0) return null;

    final devicesOutput = devicesResult.stdout.toString();
    String? emulatorSerial;
    for (final line in devicesOutput.split('\n')) {
      final trimmed = line.trim();
      if (trimmed.startsWith('emulator-') && trimmed.endsWith('\tdevice')) {
        emulatorSerial = trimmed.split('\t').first;
        break;
      }
    }
    if (emulatorSerial == null) return null;

    // 3. Capture screencap
    final screencapResult = await _processRunner(
      'adb',
      ['-s', emulatorSerial, 'exec-out', 'screencap', '-p'],
    );
    if (screencapResult.exitCode != 0) return null;

    final pngBytes = screencapResult.stdout;
    if (pngBytes is! List<int> || pngBytes.isEmpty) return null;

    // 4. Write to file
    final outputDirObj = Directory(outputDir);
    if (!outputDirObj.existsSync()) {
      outputDirObj.createSync(recursive: true);
    }

    final outputPath = '$outputDir/device-screen.png';
    await File(outputPath).writeAsBytes(pngBytes);

    // 5. Return path
    return outputPath;
  }
}
