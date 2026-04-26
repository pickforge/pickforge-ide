import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/process/binary_detector.dart';

void main() {
  group('AdbScreenshotCapturer', () {
    test('returns null when adb not on PATH', () async {
      final detector = BinaryDetector(
        processRunner: (_, __) async => ProcessResult(1, 1, '', ''),
      );
      final capturer = AdbScreenshotCapturer(
        detector,
        processRunner: (_, __) async => ProcessResult(1, 1, '', ''),
      );

      final tempDir = Directory.systemTemp.createTempSync('adb_test_');
      try {
        final result = await capturer.capture(outputDir: tempDir.path);
        expect(result, isNull);
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('returns null when no emulator found', () async {
      Future<ProcessResult> runner(String executable, List<String> args) async {
        if (args.contains('devices')) {
          return ProcessResult(
            0,
            0,
            'List of devices attached\n',
            '',
          );
        }
        // which adb
        return ProcessResult(0, 0, '/usr/bin/adb', '');
      }

      final detector = BinaryDetector(processRunner: runner);
      final capturer = AdbScreenshotCapturer(
        detector,
        processRunner: runner,
      );

      final tempDir = Directory.systemTemp.createTempSync('adb_test_');
      try {
        final result = await capturer.capture(outputDir: tempDir.path);
        expect(result, isNull);
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('captures screenshot and writes PNG file', () async {
      final pngHeader = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

      Future<ProcessResult> runner(String executable, List<String> args) async {
        if (args.contains('devices')) {
          return ProcessResult(
            0,
            0,
            'List of devices attached\nemulator-5554\tdevice\n',
            '',
          );
        }
        if (args.contains('screencap')) {
          return ProcessResult(0, 0, pngHeader, '');
        }
        // which adb
        return ProcessResult(0, 0, '/usr/bin/adb', '');
      }

      final detector = BinaryDetector(processRunner: runner);
      final capturer = AdbScreenshotCapturer(
        detector,
        processRunner: runner,
      );

      final tempDir = Directory.systemTemp.createTempSync('adb_test_');
      try {
        final result = await capturer.capture(outputDir: tempDir.path);

        expect(result, isNotNull);
        expect(result, contains('device-screen.png'));

        final outputFile = File(result!);
        expect(outputFile.existsSync(), isTrue);
        final bytes = outputFile.readAsBytesSync();
        expect(bytes, equals(pngHeader));
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('returns null when screencap fails', () async {
      Future<ProcessResult> runner(String executable, List<String> args) async {
        if (args.contains('devices')) {
          return ProcessResult(
            0,
            0,
            'List of devices attached\nemulator-5554\tdevice\n',
            '',
          );
        }
        if (args.contains('screencap')) {
          return ProcessResult(1, 1, '', 'error');
        }
        return ProcessResult(0, 0, '/usr/bin/adb', '');
      }

      final detector = BinaryDetector(processRunner: runner);
      final capturer = AdbScreenshotCapturer(
        detector,
        processRunner: runner,
      );

      final tempDir = Directory.systemTemp.createTempSync('adb_test_');
      try {
        final result = await capturer.capture(outputDir: tempDir.path);
        expect(result, isNull);
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });
  });
}
