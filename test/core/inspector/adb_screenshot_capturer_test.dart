import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/device_models.dart';
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
        final result = await capturer.capture(
          outputDir: tempDir.path,
          isProjectLocal: false,
        );
        expect(result, isNull);
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('returns null when no device found', () async {
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
        final result = await capturer.capture(
          outputDir: tempDir.path,
          isProjectLocal: false,
        );
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
        final result = await capturer.capture(
          outputDir: tempDir.path,
          isProjectLocal: false,
        );

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

    test('uses binary runner for adb screencap stdout', () async {
      final pngHeader = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      var binaryCalled = false;

      Future<ProcessResult> textRunner(
        String executable,
        List<String> args,
      ) async {
        if (args.contains('devices')) {
          return ProcessResult(
            0,
            0,
            'List of devices attached\nemulator-5554\tdevice\n',
            '',
          );
        }
        if (args.contains('screencap')) {
          throw const FormatException('Unexpected extension byte at offset 0');
        }
        return ProcessResult(0, 0, '/usr/bin/adb', '');
      }

      Future<ProcessResult> binaryRunner(
        String executable,
        List<String> args,
      ) async {
        binaryCalled = true;
        expect(args, ['-s', 'emulator-5554', 'exec-out', 'screencap', '-p']);
        return ProcessResult(0, 0, pngHeader, '');
      }

      final detector = BinaryDetector(processRunner: textRunner);
      final capturer = AdbScreenshotCapturer(
        detector,
        processRunner: textRunner,
        binaryProcessRunner: binaryRunner,
      );

      final tempDir = Directory.systemTemp.createTempSync('adb_test_');
      try {
        final result = await capturer.capture(
          outputDir: tempDir.path,
          isProjectLocal: false,
        );

        expect(binaryCalled, isTrue);
        expect(File(result!).readAsBytesSync(), pngHeader);
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('captures screenshot with custom output name', () async {
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
        return ProcessResult(0, 0, '/usr/bin/adb', '');
      }

      final detector = BinaryDetector(processRunner: runner);
      final capturer = AdbScreenshotCapturer(
        detector,
        processRunner: runner,
      );

      final tempDir = Directory.systemTemp.createTempSync('adb_test_');
      try {
        final result = await capturer.capture(
          outputDir: tempDir.path,
          isProjectLocal: false,
          outputName: AdbScreenshotCapturer.afterHotReloadOutputName,
        );

        expect(result, isNotNull);
        expect(
          result,
          contains(AdbScreenshotCapturer.afterHotReloadOutputName),
        );
        expect(File(result!).readAsBytesSync(), equals(pngHeader));
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('captures from provided physical device serial', () async {
      final pngHeader = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      final calls = <List<String>>[];

      Future<ProcessResult> runner(String executable, List<String> args) async {
        calls.add(args);
        if (args.contains('devices')) {
          return ProcessResult(1, 1, '', 'should not query devices');
        }
        if (args.contains('screencap')) {
          return ProcessResult(0, 0, pngHeader, '');
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
        final result = await capturer.capture(
          outputDir: tempDir.path,
          isProjectLocal: false,
          serial: 'R58M1234567',
        );

        expect(result, isNotNull);
        expect(
          calls,
          contains(
            equals(['-s', 'R58M1234567', 'exec-out', 'screencap', '-p']),
          ),
        );
        expect(calls, isNot(contains(equals(['devices']))));
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('uses first connected physical device when serial is omitted',
        () async {
      final pngHeader = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      final calls = <List<String>>[];

      Future<ProcessResult> runner(String executable, List<String> args) async {
        calls.add(args);
        if (args.contains('devices')) {
          return ProcessResult(
            0,
            0,
            'List of devices attached\nR58M1234567\tdevice\n',
            '',
          );
        }
        if (args.contains('screencap')) {
          return ProcessResult(0, 0, pngHeader, '');
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
        final result = await capturer.capture(
          outputDir: tempDir.path,
          isProjectLocal: false,
        );

        expect(result, isNotNull);
        expect(
          calls,
          contains(
            equals(['-s', 'R58M1234567', 'exec-out', 'screencap', '-p']),
          ),
        );
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('captures iOS simulator screenshot with simctl', () async {
      final pngHeader = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      final calls = <({String executable, List<String> args})>[];

      Future<ProcessResult> runner(String executable, List<String> args) async {
        calls.add((executable: executable, args: args));
        if (executable == 'xcrun' && args.contains('screenshot')) {
          await File(args.last).writeAsBytes(pngHeader);
          return ProcessResult(0, 0, '', '');
        }
        return ProcessResult(0, 0, '/usr/bin/$executable', '');
      }

      final detector = BinaryDetector(processRunner: runner);
      final capturer = AdbScreenshotCapturer(
        detector,
        processRunner: runner,
      );

      final tempDir = Directory.systemTemp.createTempSync('simctl_test_');
      try {
        final result = await capturer.capture(
          outputDir: tempDir.path,
          isProjectLocal: false,
          serial: 'A1B2C3D4-0000-1111-2222-333344445555',
          platform: iosSimulatorPlatform,
        );

        expect(result, isNotNull);
        expect(File(result!).readAsBytesSync(), pngHeader);
        expect(
          calls.map((call) => call.executable),
          isNot(contains('adb')),
        );
        expect(
          calls.map((call) => call.args),
          contains(
            equals([
              'simctl',
              'io',
              'A1B2C3D4-0000-1111-2222-333344445555',
              'screenshot',
              result,
            ]),
          ),
        );
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('returns null for web targets without invoking device tools',
        () async {
      Future<ProcessResult> runner(String executable, List<String> args) async {
        fail('unexpected process call: $executable ${args.join(' ')}');
      }

      final detector = BinaryDetector(processRunner: runner);
      final capturer = AdbScreenshotCapturer(
        detector,
        processRunner: runner,
      );

      final tempDir = Directory.systemTemp.createTempSync('webshot_test_');
      try {
        final result = await capturer.capture(
          outputDir: tempDir.path,
          isProjectLocal: false,
          serial: flutterWebChromeId,
          platform: flutterWebPlatform,
        );

        expect(result, isNull);
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('captures desktop screenshot with flutter screenshot', () async {
      final pngHeader = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
      final calls = <({String executable, List<String> args})>[];

      Future<ProcessResult> runner(String executable, List<String> args) async {
        calls.add((executable: executable, args: args));
        if (executable == 'flutter' && args.contains('screenshot')) {
          await File(args.last).writeAsBytes(pngHeader);
          return ProcessResult(0, 0, '', '');
        }
        return ProcessResult(0, 0, '/usr/bin/${args.single}', '');
      }

      final detector = BinaryDetector(processRunner: runner);
      final capturer = AdbScreenshotCapturer(
        detector,
        processRunner: runner,
      );

      final tempDir = Directory.systemTemp.createTempSync('desktopshot_test_');
      try {
        final result = await capturer.capture(
          outputDir: tempDir.path,
          isProjectLocal: false,
          serial: flutterLinuxDeviceId,
          platform: flutterDesktopPlatform,
        );

        expect(result, isNotNull);
        expect(File(result!).readAsBytesSync(), pngHeader);
        expect(
          calls.map((call) => call.executable),
          isNot(contains('adb')),
        );
        expect(
          calls.map((call) => call.executable),
          isNot(contains('xcrun')),
        );
        expect(
          calls.map((call) => call.args),
          contains(
            equals([
              'screenshot',
              '-d',
              flutterLinuxDeviceId,
              '-o',
              result,
            ]),
          ),
        );
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
        final result = await capturer.capture(
          outputDir: tempDir.path,
          isProjectLocal: false,
        );
        expect(result, isNull);
      } finally {
        tempDir.deleteSync(recursive: true);
      }
    });

    test(
        'parity: project-local context dir is guarded by the .pickforge marker',
        () async {
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
        return ProcessResult(0, 0, '/usr/bin/adb', '');
      }

      final detector = BinaryDetector(processRunner: runner);
      final capturer = AdbScreenshotCapturer(detector, processRunner: runner);

      final project = Directory.systemTemp.createTempSync('adb_pl_');
      try {
        final contextDir = p.join(project.path, '.pickforge');
        final result = await capturer.capture(outputDir: contextDir);

        expect(result, p.join(contextDir, 'device-screen.png'));
        expect(File(result!).readAsBytesSync(), pngHeader);
        expect(
          File(p.join(contextDir, '.gitignore')).readAsStringSync(),
          '*\n',
        );
      } finally {
        project.deleteSync(recursive: true);
      }
    });

    test('home mode: non-project-local context dir writes no marker', () async {
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
        return ProcessResult(0, 0, '/usr/bin/adb', '');
      }

      final detector = BinaryDetector(processRunner: runner);
      final capturer = AdbScreenshotCapturer(detector, processRunner: runner);

      final home = Directory.systemTemp.createTempSync('adb_home_');
      try {
        final contextDir = p.join(home.path, 'projects', 'proj', 'context');
        final result = await capturer.capture(
          outputDir: contextDir,
          isProjectLocal: false,
        );

        expect(result, p.join(contextDir, 'device-screen.png'));
        expect(File(result!).readAsBytesSync(), pngHeader);
        expect(File(p.join(contextDir, '.gitignore')).existsSync(), isFalse);
      } finally {
        home.deleteSync(recursive: true);
      }
    });
  });
}
