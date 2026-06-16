import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/react_native/react_native_command.dart';
import 'package:pickforge/core/targets/react_native/react_native_command_builder.dart';
import 'package:pickforge/core/targets/react_native/react_native_project_detector.dart';

ReactNativeProjectInfo _project({
  ReactNativePackageManager pm = ReactNativePackageManager.yarn,
  bool androidScript = true,
}) {
  return ReactNativeProjectInfo(
    projectRoot: '/app',
    packageManager: pm,
    hasAndroidProject: true,
    hasAndroidScript: androidScript,
  );
}

void main() {
  const builder = ReactNativeCommandBuilder();

  group('metroStart', () {
    test('uses the community CLI launcher with default flags', () {
      final command = builder.metroStart(project: _project());
      expect(command.executable, 'npx');
      expect(command.arguments, [
        '@react-native-community/cli',
        'start',
        '--port',
        '8081',
        '--host',
        '127.0.0.1',
        '--projectRoot',
        '/app',
      ]);
      expect(command.cwd, '/app');
    });

    test('honors custom options and appends --reset-cache', () {
      final command = builder.metroStart(
        project: _project(),
        options: const ReactNativeMetroOptions(
          port: 9000,
          host: '0.0.0.0',
          resetCache: true,
        ),
      );
      expect(command.arguments, [
        '@react-native-community/cli',
        'start',
        '--port',
        '9000',
        '--host',
        '0.0.0.0',
        '--projectRoot',
        '/app',
        '--reset-cache',
      ]);
    });
  });

  group('androidRun', () {
    test('runs the project android script through the package manager', () {
      for (final entry in {
        ReactNativePackageManager.npm: 'npm',
        ReactNativePackageManager.yarn: 'yarn',
        ReactNativePackageManager.pnpm: 'pnpm',
        ReactNativePackageManager.bun: 'bun',
      }.entries) {
        final command = builder.androidRun(project: _project(pm: entry.key));
        expect(command, isNotNull);
        expect(command!.executable, entry.value);
        expect(command.arguments, ['run', 'android']);
        expect(command.cwd, '/app');
      }
    });

    test('returns null when there is no android script', () {
      expect(
        builder.androidRun(project: _project(androidScript: false)),
        isNull,
      );
    });
  });

  group('localCliRunAndroid', () {
    test('passes the device serial through --deviceId', () {
      final command = builder.localCliRunAndroid(
        project: _project(),
        serial: 'emulator-5554',
      );
      expect(command.executable, 'npx');
      expect(command.arguments, [
        '@react-native-community/cli',
        'run-android',
        '--deviceId',
        'emulator-5554',
      ]);
    });

    test('omits --deviceId when no serial is given', () {
      final command = builder.localCliRunAndroid(project: _project());
      expect(command.arguments, ['@react-native-community/cli', 'run-android']);
    });
  });
}
