import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

class _FakeRunner extends Mock implements ProcessRunner {}

void main() {
  late _FakeRunner runner;
  late DeviceDiscoveryService service;

  setUp(() {
    runner = _FakeRunner();
    service = DeviceDiscoveryService(runner);
  });

  ProcessResult ok(String stdout) => ProcessResult(0, 0, stdout, '');
  ProcessResult fail(String stderr) => ProcessResult(0, 1, '', stderr);
  const bootedIosJson = '''
{
  "devices": {
    "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
      {
        "udid": "A1B2C3D4-0000-1111-2222-333344445555",
        "name": "iPhone 16",
        "state": "Booted",
        "isAvailable": true
      },
      {
        "udid": "UNAVAILABLE",
        "name": "iPhone unavailable",
        "state": "Booted",
        "isAvailable": false
      }
    ]
  }
}
''';
  const webDevicesJson = '''
[
  {
    "name": "Chrome",
    "id": "chrome",
    "isSupported": true,
    "targetPlatform": "web-javascript",
    "emulator": false,
    "sdk": "Google Chrome"
  },
  {
    "name": "Web Server",
    "id": "web-server",
    "isSupported": true,
    "targetPlatform": "web-javascript",
    "emulator": false
  },
  {
    "name": "Linux",
    "id": "linux",
    "isSupported": true,
    "targetPlatform": "linux-x64",
    "emulator": false
  }
]
''';

  test('listAvds parses flutter emulators --machine JSON', () async {
    final json =
        await File('test/fixtures/flutter_emulators.json').readAsString();
    when(() => runner.run('flutter', ['emulators', '--machine']))
        .thenAnswer((_) async => ok(json));
    final avds = await service.listAvds();
    expect(avds, hasLength(2));
    expect(avds.first.id, 'Pixel_5_API_34');
    expect(avds.first.name, 'Pixel 5 API 34');
  });

  test('listAvds returns empty on non-zero exit', () async {
    when(() => runner.run('flutter', ['emulators', '--machine']))
        .thenAnswer((_) async => fail('boom'));
    expect(await service.listAvds(), isEmpty);
  });

  test('listAvds returns empty when flutter binary missing', () async {
    when(() => runner.run(any(), any()))
        .thenThrow(ProcessRunnerException('flutter', 'ENOENT'));
    expect(await service.listAvds(), isEmpty);
  });

  test('listRunningDevices parses adb devices -l', () async {
    const raw = '''
List of devices attached
R58M1234567	device usb:1-1 product:oriole model:Pixel_6 device:oriole transport_id:1
emulator-5554	device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:2
emulator-5556	offline
''';
    when(() => runner.run('adb', ['devices', '-l']))
        .thenAnswer((_) async => ok(raw));
    when(() => runner.run('adb', ['-s', 'emulator-5554', 'emu', 'avd', 'name']))
        .thenAnswer((_) async => ok('Pixel_5_API_34\nOK\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5556', 'emu', 'avd', 'name']))
        .thenAnswer((_) async => fail(''));
    final devs = await service.listRunningDevices();
    expect(devs, hasLength(3));
    expect(devs[0].serial, 'R58M1234567');
    expect(devs[0].kind, AndroidDeviceKind.physical);
    expect(devs[0].model, 'Pixel 6');
    expect(devs[0].state, 'device');
    expect(devs[1].serial, 'emulator-5554');
    expect(devs[1].kind, AndroidDeviceKind.emulator);
    expect(devs[1].state, 'device');
    expect(devs[2].serial, 'emulator-5556');
    expect(devs[2].state, 'offline');
    verifyNever(
      () => runner.run('adb', ['-s', 'R58M1234567', 'emu', 'avd', 'name']),
    );
  });

  test('listRunningDevices returns empty when no emulators', () async {
    final raw =
        await File('test/fixtures/adb_devices_empty.txt').readAsString();
    when(() => runner.run('adb', ['devices', '-l']))
        .thenAnswer((_) async => ok(raw));
    expect(await service.listRunningDevices(), isEmpty);
  });

  test('listRunningIosSimulators parses booted simctl devices', () async {
    when(
      () => runner.run(
        'xcrun',
        ['simctl', 'list', 'devices', 'booted', '--json'],
      ),
    ).thenAnswer((_) async => ok(bootedIosJson));

    final devices = await service.listRunningIosSimulators();

    expect(devices, hasLength(1));
    expect(devices.single.serial, 'A1B2C3D4-0000-1111-2222-333344445555');
    expect(devices.single.displayName, 'iPhone 16');
    expect(devices.single.kind, AndroidDeviceKind.iosSimulator);
    expect(devices.single.asDeviceAvd.platform, iosSimulatorPlatform);
  });

  test('listWebTargets parses flutter devices web targets', () async {
    when(() => runner.run('flutter', ['devices', '--machine']))
        .thenAnswer((_) async => ok(webDevicesJson));

    final devices = await service.listWebTargets();

    expect(devices, hasLength(2));
    expect(devices.first.serial, flutterWebChromeId);
    expect(devices.first.displayName, 'Chrome');
    expect(devices.first.kind, AndroidDeviceKind.web);
    expect(devices.first.asDeviceAvd.platform, flutterWebPlatform);
  });

  test('snapshot composes both lists', () async {
    final emusJson =
        await File('test/fixtures/flutter_emulators.json').readAsString();
    final adbRaw =
        await File('test/fixtures/adb_devices_two.txt').readAsString();
    when(() => runner.run('flutter', ['emulators', '--machine']))
        .thenAnswer((_) async => ok(emusJson));
    when(() => runner.run('adb', ['devices', '-l']))
        .thenAnswer((_) async => ok(adbRaw));
    when(() => runner.run('adb', ['-s', 'emulator-5554', 'emu', 'avd', 'name']))
        .thenAnswer((_) async => ok('Pixel_5_API_34\nOK\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5556', 'emu', 'avd', 'name']))
        .thenAnswer((_) async => fail(''));
    when(
      () => runner.run(
        'xcrun',
        ['simctl', 'list', 'devices', 'booted', '--json'],
      ),
    ).thenAnswer((_) async => ok(bootedIosJson));
    when(() => runner.run('flutter', ['devices', '--machine']))
        .thenAnswer((_) async => ok(webDevicesJson));
    final snap = await service.snapshot();
    expect(snap.avds, hasLength(2));
    expect(snap.running, hasLength(5));
    expect(snap.runningFor(snap.avds.first)?.serial, 'emulator-5554');
    expect(snap.iosSimulators.single.displayName, 'iPhone 16');
    expect(snap.webTargets.map((device) => device.serial), [
      flutterWebChromeId,
      flutterWebServerId,
    ]);
  });
}
