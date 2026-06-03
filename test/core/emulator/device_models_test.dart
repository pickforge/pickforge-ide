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

  test('physical device exposes display AVD and matches by serial', () {
    const device = RunningAndroidDevice(
      serial: 'R58M1234567',
      avdName: null,
      state: 'device',
      kind: AndroidDeviceKind.physical,
      model: 'Pixel 6',
    );
    final avd = device.asDeviceAvd;
    const snap = DeviceListSnapshot(avds: [], running: [device]);

    expect(device.displayName, 'Pixel 6');
    expect(avd.id, 'R58M1234567');
    expect(avd.platform, androidPhysicalPlatform);
    expect(snap.runningFor(avd), device);
  });

  test('iOS simulator exposes display AVD and matches generic Flutter target',
      () {
    const device = RunningAndroidDevice(
      serial: 'A1B2C3D4-0000-1111-2222-333344445555',
      avdName: 'iPhone 16',
      state: 'device',
      kind: AndroidDeviceKind.iosSimulator,
      model: 'iPhone 16',
    );
    const flutterTarget = Avd(
      id: iosFlutterSimulatorId,
      name: 'iOS Simulator',
      platform: iosSimulatorPlatform,
    );
    final avd = device.asDeviceAvd;
    const snap = DeviceListSnapshot(avds: [flutterTarget], running: [device]);

    expect(device.displayName, 'iPhone 16');
    expect(device.isConnectedDevice, isTrue);
    expect(avd.platform, iosSimulatorPlatform);
    expect(snap.runningFor(flutterTarget), device);
  });
}
