import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/avd_shutdown_controller.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

class _Runner extends Mock implements ProcessRunner {}

void main() {
  late _Runner runner;
  late AvdShutdownController controller;

  setUp(() {
    runner = _Runner();
    controller = AvdShutdownController(runner);
  });

  test('shutdown sends adb emu kill to the serial', () async {
    when(() => runner.run('adb', ['-s', 'emulator-5554', 'emu', 'kill']))
        .thenAnswer((_) async => ProcessResult(0, 0, '', ''));

    await controller.shutdown('emulator-5554');

    verify(
      () => runner.run('adb', ['-s', 'emulator-5554', 'emu', 'kill']),
    ).called(1);
  });

  test('shutdown throws on non-zero adb exit', () async {
    when(() => runner.run('adb', ['-s', 'emulator-5554', 'emu', 'kill']))
        .thenAnswer((_) async => ProcessResult(0, 1, '', 'denied'));

    await expectLater(
      controller.shutdown('emulator-5554'),
      throwsA(isA<AvdShutdownException>()),
    );
  });
}
