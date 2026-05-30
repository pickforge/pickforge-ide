import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/device_models.dart';

void main() {
  test('Avd equality + props', () {
    const a = Avd(id: 'Pixel_5', name: 'Pixel 5', platform: 'android');
    const b = Avd(id: 'Pixel_5', name: 'Pixel 5', platform: 'android');
    const c = Avd(id: 'Pixel_7', name: 'Pixel 7', platform: 'android');
    expect(a, equals(b));
    expect(a, isNot(equals(c)));
  });

  test('DeviceListSnapshot.runningById matches by AVD name', () {
    const avd = Avd(
      id: 'Pixel_5_API_34',
      name: 'Pixel 5 API 34',
      platform: 'android',
    );
    const running = RunningAndroidDevice(
      serial: 'emulator-5554',
      avdName: 'Pixel_5_API_34',
      state: 'device',
    );
    const snap = DeviceListSnapshot(avds: [avd], running: [running]);
    expect(snap.runningFor(avd)?.serial, 'emulator-5554');
  });

  test('DeviceListSnapshot.runningFor returns null when no match', () {
    const avd = Avd(
      id: 'Pixel_5_API_34',
      name: 'Pixel 5 API 34',
      platform: 'android',
    );
    const snap = DeviceListSnapshot(avds: [avd], running: []);
    expect(snap.runningFor(avd), isNull);
  });
}
