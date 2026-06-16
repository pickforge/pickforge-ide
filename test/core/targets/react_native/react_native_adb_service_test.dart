import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/process/binary_detector.dart' hide ProcessRunner;
import 'package:pickforge/core/targets/react_native/react_native_adb_service.dart';

class _FakeRunner extends Mock implements ProcessRunner {}

class _FakeDetector extends Mock implements BinaryDetector {}

class _FakeProc implements RunningProcess {
  @override
  int get pid => 1;
  @override
  Stream<List<int>> get stdout => const Stream.empty();
  @override
  Stream<List<int>> get stderr => const Stream.empty();
  @override
  Future<int> get exitCode async => 0;
  @override
  void writeStdin(List<int> bytes) {}
  @override
  Future<void> kill({ProcessSignal signal = ProcessSignal.sigterm}) async {}
}

const _devicesOutput = '''
List of devices attached
emulator-5554          device product:sdk_gphone model:Pixel_5 transport_id:1
0A1B2C3D               device product:redfin model:Pixel_4a transport_id:2
FA8GH0301234           offline transport_id:3
''';

void main() {
  late _FakeRunner runner;
  late _FakeDetector detector;

  setUp(() {
    runner = _FakeRunner();
    detector = _FakeDetector();
    when(() => detector.isBinaryOnPath('adb')).thenAnswer((_) async => true);
  });

  group('listDevices', () {
    test('parses adb devices -l with state and model', () async {
      when(() => runner.run('adb', const ['devices', '-l'])).thenAnswer(
        (_) async => ProcessResult(0, 0, _devicesOutput, ''),
      );
      final service = ReactNativeAdbService(runner, detector);

      final devices = await service.listDevices();

      expect(devices, hasLength(3));
      expect(devices[0].serial, 'emulator-5554');
      expect(devices[0].state, 'device');
      expect(devices[0].model, 'Pixel_5');
      expect(devices[0].isOnline, isTrue);
      expect(devices[2].serial, 'FA8GH0301234');
      expect(devices[2].isOnline, isFalse);
      expect(devices[2].model, isNull);
    });

    test('ignores adb daemon startup noise and unknown states', () async {
      const noisy = '''
* daemon not running; starting now at tcp:5037
* daemon started successfully
List of devices attached
emulator-5554          device product:sdk_gphone model:Pixel_5 transport_id:1
banana                 weirdstate transport_id:9
''';
      when(() => runner.run('adb', const ['devices', '-l'])).thenAnswer(
        (_) async => ProcessResult(0, 0, noisy, ''),
      );
      final service = ReactNativeAdbService(runner, detector);

      final devices = await service.listDevices();
      expect(devices, hasLength(1));
      expect(devices.single.serial, 'emulator-5554');
      expect(devices.single.state, 'device');
    });

    test('returns empty when adb is not on PATH', () async {
      when(() => detector.isBinaryOnPath('adb')).thenAnswer((_) async => false);
      final service = ReactNativeAdbService(runner, detector);
      expect(await service.listDevices(), isEmpty);
      verifyNever(() => runner.run(any(), any()));
    });

    test('returns empty on adb failure', () async {
      when(() => runner.run('adb', const ['devices', '-l'])).thenAnswer(
        (_) async => ProcessResult(0, 1, '', 'error'),
      );
      final service = ReactNativeAdbService(runner, detector);
      expect(await service.listDevices(), isEmpty);
    });
  });

  group('captureScreenshot', () {
    test('writes screencap PNG bytes to the output dir', () async {
      final dir = await Directory.systemTemp.createTemp('rn_shot');
      addTearDown(() => dir.delete(recursive: true));
      final pngBytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a];
      final service = ReactNativeAdbService(
        runner,
        detector,
        screencapRunner: (executable, arguments) async {
          expect(executable, 'adb');
          expect(arguments, [
            '-s',
            'emulator-5554',
            'exec-out',
            'screencap',
            '-p',
          ]);
          return ProcessResult(0, 0, pngBytes, '');
        },
      );

      final path = await service.captureScreenshot(
        serial: 'emulator-5554',
        outputDir: dir.path,
      );

      expect(path, p.join(dir.path, 'device-screen.png'));
      expect(await File(path!).readAsBytes(), pngBytes);
    });

    test('returns null on capture failure', () async {
      final dir = await Directory.systemTemp.createTemp('rn_shot_fail');
      addTearDown(() => dir.delete(recursive: true));
      final service = ReactNativeAdbService(
        runner,
        detector,
        screencapRunner: (_, __) async => ProcessResult(0, 1, <int>[], ''),
      );
      expect(
        await service.captureScreenshot(
          serial: 'emulator-5554',
          outputDir: dir.path,
        ),
        isNull,
      );
    });

    test('rejects a non-basename output name', () async {
      final service = ReactNativeAdbService(runner, detector);
      expect(
        () => service.captureScreenshot(
          serial: 's',
          outputDir: '/tmp',
          outputName: 'sub/shot.png',
        ),
        throwsArgumentError,
      );
    });
  });

  group('streamLogcat', () {
    test('spawns adb logcat for the serial', () async {
      final proc = _FakeProc();
      when(
        () => runner.spawn(
          'adb',
          ['-s', 'emulator-5554', 'logcat', '-v', 'threadtime'],
        ),
      ).thenAnswer((_) async => proc);
      final service = ReactNativeAdbService(runner, detector);

      final result = await service.streamLogcat(serial: 'emulator-5554');
      expect(result, same(proc));
    });

    test('returns null when adb is not on PATH', () async {
      when(() => detector.isBinaryOnPath('adb')).thenAnswer((_) async => false);
      final service = ReactNativeAdbService(runner, detector);
      expect(await service.streamLogcat(serial: 's'), isNull);
    });
  });
}
