import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/process/binary_detector.dart';
import 'package:pickforge/core/targets/adapter_doctor.dart';

class _FakeDetector extends Mock implements BinaryDetector {}

void main() {
  late _FakeDetector detector;

  setUp(() {
    detector = _FakeDetector();
    when(() => detector.isBinaryOnPath(any())).thenAnswer((_) async => false);
  });

  DoctorCheck checkFor(List<DoctorCheck> checks, String label) =>
      checks.firstWhere((c) => c.label == label);

  test('reports OK for present binaries and Missing for absent', () async {
    when(() => detector.isBinaryOnPath('adb')).thenAnswer((_) async => true);
    when(() => detector.isBinaryOnPath('flutter'))
        .thenAnswer((_) async => true);

    final checks = await AdapterDoctor(detector, isMacOS: false).run();

    expect(checkFor(checks, 'ADB (Android)').status, DoctorStatus.ok);
    expect(checkFor(checks, 'Flutter SDK').status, DoctorStatus.ok);
    expect(checkFor(checks, 'Node / npm').status, DoctorStatus.missing);
  });

  test('Xcode is unknown off macOS and checked on macOS', () async {
    final offMac = await AdapterDoctor(detector, isMacOS: false).run();
    final xcodeOff = checkFor(offMac, 'Xcode (xcrun)');
    expect(xcodeOff.status, DoctorStatus.unknown);
    expect(xcodeOff.detail, 'macOS only');

    when(() => detector.isBinaryOnPath('xcrun')).thenAnswer((_) async => true);
    final onMac = await AdapterDoctor(detector, isMacOS: true).run();
    expect(checkFor(onMac, 'Xcode (xcrun)').status, DoctorStatus.ok);
  });

  test('the browser check accepts any known Chromium binary', () async {
    when(() => detector.isBinaryOnPath('chromium'))
        .thenAnswer((_) async => true);
    final checks = await AdapterDoctor(detector, isMacOS: false).run();
    expect(checkFor(checks, 'Browser (CDP)').status, DoctorStatus.ok);
  });
}
