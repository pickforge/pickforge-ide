import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/cancel_token.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

class _FakeRunner extends Mock implements ProcessRunner {}

void main() {
  late _FakeRunner runner;
  late BootReadinessPoller poller;

  setUp(() {
    runner = _FakeRunner();
    poller = BootReadinessPoller(runner);
  });

  ProcessResult ok(String stdout) => ProcessResult(0, 0, stdout, '');

  test('emits ready with serial when AVD name matches and pm path succeeds',
      () async {
    when(() => runner.run('adb', ['devices', '-l'])).thenAnswer(
      (_) async => ok('List of devices attached\nemulator-5554\tdevice\n'),
    );
    when(
      () => runner.run('adb', [
        '-s',
        'emulator-5554',
        'shell',
        'getprop',
        'sys.boot_completed',
      ]),
    ).thenAnswer((_) async => ok('1\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5554', 'emu', 'avd', 'name']))
        .thenAnswer((_) async => ok('Pixel_5_API_34\nOK\n'));
    when(
      () => runner.run(
        'adb',
        ['-s', 'emulator-5554', 'shell', 'pm', 'path', 'android'],
      ),
    ).thenAnswer(
      (_) async => ok('package:/system/framework/framework-res.apk\n'),
    );

    final events = await poller
        .poll(
          avdId: 'Pixel_5_API_34',
          interval: const Duration(milliseconds: 10),
          timeout: const Duration(seconds: 1),
        )
        .toList();

    expect(events.last, isA<BootReady>());
    expect((events.last as BootReady).serial, 'emulator-5554');
  });

  test('emits timeout when boot never completes', () async {
    when(() => runner.run('adb', ['devices', '-l'])).thenAnswer(
      (_) async => ok('List of devices attached\nemulator-5554\tdevice\n'),
    );
    when(
      () => runner.run('adb', [
        '-s',
        'emulator-5554',
        'shell',
        'getprop',
        'sys.boot_completed',
      ]),
    ).thenAnswer((_) async => ok('0\n'));

    final events = await poller
        .poll(
          avdId: 'Pixel_5_API_34',
          interval: const Duration(milliseconds: 10),
          timeout: const Duration(milliseconds: 50),
        )
        .toList();

    expect(events.last, isA<BootTimeout>());
  });

  test('emits cancelled when token cancelled mid-flight', () async {
    when(() => runner.run('adb', ['devices', '-l'])).thenAnswer(
      (_) async => ok('List of devices attached\nemulator-5554\tdevice\n'),
    );
    when(
      () => runner.run('adb', [
        '-s',
        'emulator-5554',
        'shell',
        'getprop',
        'sys.boot_completed',
      ]),
    ).thenAnswer((_) async => ok('0\n'));
    final token = CancelToken();

    final stream = poller.poll(
      avdId: 'Pixel_5_API_34',
      interval: const Duration(milliseconds: 10),
      timeout: const Duration(seconds: 5),
      cancel: token,
    );
    final events = <BootReadinessEvent>[];
    final sub = stream.listen(events.add);
    Future<void>.delayed(const Duration(milliseconds: 30), token.cancel);
    await sub.asFuture<void>();
    await sub.cancel();

    expect(events.last, isA<BootCancelled>());
  });

  test('skips emulator whose AVD name does not match', () async {
    when(() => runner.run('adb', ['devices', '-l'])).thenAnswer(
      (_) async => ok(
        'List of devices attached\n'
        'emulator-5554\tdevice\n'
        'emulator-5556\tdevice\n',
      ),
    );
    when(
      () => runner.run('adb', [
        '-s',
        'emulator-5554',
        'shell',
        'getprop',
        'sys.boot_completed',
      ]),
    ).thenAnswer((_) async => ok('1\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5554', 'emu', 'avd', 'name']))
        .thenAnswer((_) async => ok('Tablet_API_33\nOK\n'));
    when(
      () => runner.run('adb', [
        '-s',
        'emulator-5556',
        'shell',
        'getprop',
        'sys.boot_completed',
      ]),
    ).thenAnswer((_) async => ok('1\n'));
    when(() => runner.run('adb', ['-s', 'emulator-5556', 'emu', 'avd', 'name']))
        .thenAnswer((_) async => ok('Pixel_5_API_34\nOK\n'));
    when(
      () => runner.run(
        'adb',
        ['-s', 'emulator-5556', 'shell', 'pm', 'path', 'android'],
      ),
    ).thenAnswer(
      (_) async => ok('package:/system/framework/framework-res.apk\n'),
    );

    final events = await poller
        .poll(
          avdId: 'Pixel_5_API_34',
          interval: const Duration(milliseconds: 10),
          timeout: const Duration(seconds: 1),
        )
        .toList();

    expect((events.last as BootReady).serial, 'emulator-5556');
  });
}
