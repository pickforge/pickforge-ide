import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/targets/react_native/react_native_app_launcher.dart';
import 'package:pickforge/core/targets/react_native/react_native_project_detector.dart';

class _FakeRunner extends Mock implements ProcessRunner {}

ReactNativeProjectInfo _project({
  bool androidScript = true,
  ExpoProjectInfo? expo,
}) {
  return ReactNativeProjectInfo(
    projectRoot: '/app',
    packageManager: ReactNativePackageManager.pnpm,
    hasAndroidProject: true,
    hasAndroidScript: androidScript,
    expo: expo,
  );
}

void main() {
  setUpAll(() {
    registerFallbackValue(<String>[]);
  });

  late _FakeRunner runner;

  setUp(() {
    runner = _FakeRunner();
    when(
      () => runner.run(
        any(),
        any(),
        cwd: any(named: 'cwd'),
        env: any(named: 'env'),
      ),
    ).thenAnswer((_) async => ProcessResult(0, 0, '', ''));
  });

  test('prefers the project android script when no device is selected',
      () async {
    final launcher = ReactNativeAppLauncher(runner);
    final result = await launcher.launch(project: _project());

    expect(result.usedProjectScript, isTrue);
    expect(result.succeeded, isTrue);
    expect(result.command.executable, 'pnpm');
    expect(result.command.arguments, ['run', 'android']);
    expect(result.command.cwd, '/app');
  });

  test('routes an explicit serial through the CLI for reliable targeting',
      () async {
    final launcher = ReactNativeAppLauncher(runner);
    // Project HAS an android script, but a device was chosen, so the CLI wins.
    final result = await launcher.launch(
      project: _project(),
      serial: 'emulator-5554',
    );

    expect(result.usedProjectScript, isFalse);
    expect(result.command.executable, 'npx');
    expect(result.command.arguments, [
      '@react-native-community/cli',
      'run-android',
      '--deviceId',
      'emulator-5554',
    ]);
  });

  test('falls back to the community CLI when there is no android script',
      () async {
    final launcher = ReactNativeAppLauncher(runner);
    final result =
        await launcher.launch(project: _project(androidScript: false));

    expect(result.usedProjectScript, isFalse);
    expect(result.command.executable, 'npx');
    expect(result.command.arguments, [
      '@react-native-community/cli',
      'run-android',
    ]);
  });

  test('routes an Expo project through expo run:android (serial ignored)',
      () async {
    final launcher = ReactNativeAppLauncher(runner);
    final result = await launcher.launch(
      project: _project(expo: const ExpoProjectInfo()),
      serial: 'emulator-5554',
    );

    expect(result.usedProjectScript, isFalse);
    expect(result.command.arguments, ['expo', 'run:android']);
  });

  test('reports failure when the launch command exits non-zero', () async {
    when(
      () => runner.run(
        any(),
        any(),
        cwd: any(named: 'cwd'),
        env: any(named: 'env'),
      ),
    ).thenAnswer((_) async => ProcessResult(0, 1, '', 'boom'));
    final launcher = ReactNativeAppLauncher(runner);

    final result = await launcher.launch(project: _project());
    expect(result.succeeded, isFalse);
    expect(result.exitCode, 1);
  });
}
