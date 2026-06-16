import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/react_native/react_native_command.dart';
import 'package:pickforge/core/targets/react_native/react_native_command_builder.dart';
import 'package:pickforge/core/targets/react_native/react_native_project_detector.dart';

ReactNativeProjectInfo _project({
  ReactNativePackageManager pm = ReactNativePackageManager.yarn,
  bool androidScript = true,
  ExpoProjectInfo? expo,
}) {
  return ReactNativeProjectInfo(
    projectRoot: '/app',
    packageManager: pm,
    hasAndroidProject: true,
    hasAndroidScript: androidScript,
    expo: expo,
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

  group('expo', () {
    const expo = ExpoProjectInfo(configPath: 'app.json');

    test('expoStart uses the package runner and --port', () {
      final command = builder.expoStart(
        project: _project(pm: ReactNativePackageManager.npm, expo: expo),
      );
      expect(command.executable, 'npx');
      expect(command.arguments, ['expo', 'start', '--port', '8081']);
    });

    test('expoStart maps reset-cache to --clear', () {
      final command = builder.expoStart(
        project: _project(expo: expo),
        options: const ReactNativeMetroOptions(resetCache: true),
      );
      expect(command.executable, 'yarn');
      expect(command.arguments, [
        'expo',
        'start',
        '--port',
        '8081',
        '--clear',
      ]);
    });

    test('metroStart delegates to expoStart for an Expo project', () {
      final command = builder.metroStart(
        project: _project(pm: ReactNativePackageManager.pnpm, expo: expo),
      );
      expect(command.executable, 'pnpm');
      expect(command.arguments, ['expo', 'start', '--port', '8081']);
    });

    test('expoRunAndroid builds without an unusable ADB serial device flag',
        () {
      final command = builder.expoRunAndroid(project: _project(expo: expo));
      expect(command.executable, 'yarn');
      expect(command.arguments, ['expo', 'run:android']);
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
