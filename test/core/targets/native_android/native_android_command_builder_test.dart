import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/native_android/native_android_command_builder.dart';
import 'package:pickforge/core/targets/native_android/native_android_project_detector.dart';
import 'package:pickforge/core/targets/target_detection.dart';

NativeAndroidProjectInfo _project({
  bool hasWrapper = true,
  String gradlePath = ':app',
}) {
  return NativeAndroidProjectInfo(
    projectRoot: '/app',
    settingsFile: 'settings.gradle',
    rootBuildFile: 'build.gradle',
    hasGradleWrapper: hasWrapper,
    applicationModules: [
      NativeAndroidModuleInfo(
        gradlePath: gradlePath,
        buildFile: 'app/build.gradle',
        confidence: DetectionConfidence.exact,
      ),
    ],
  );
}

void main() {
  group('gradle wrapper selection', () {
    test('uses ./gradlew on Unix', () {
      const builder = NativeAndroidCommandBuilder(isWindows: false);
      final command =
          builder.assembleDebug(project: _project(), gradlePath: ':app');
      expect(command.executable, './gradlew');
      expect(command.arguments, [':app:assembleDebug']);
      expect(command.cwd, '/app');
    });

    test('uses gradlew.bat on Windows', () {
      const builder = NativeAndroidCommandBuilder(isWindows: true);
      final command =
          builder.assembleDebug(project: _project(), gradlePath: ':app');
      expect(command.executable, r'.\gradlew.bat');
    });

    test('falls back to gradle on PATH without a wrapper', () {
      const builder = NativeAndroidCommandBuilder(isWindows: false);
      final command = builder.assembleDebug(
        project: _project(hasWrapper: false),
        gradlePath: ':app',
      );
      expect(command.executable, 'gradle');
    });

    test('uses a bare task name for the root project', () {
      const builder = NativeAndroidCommandBuilder(isWindows: false);
      final command =
          builder.assembleDebug(project: _project(), gradlePath: ':');
      expect(command.arguments, ['assembleDebug']);
    });
  });

  group('installDebug', () {
    test('passes the device serial via ANDROID_SERIAL env', () {
      const builder = NativeAndroidCommandBuilder(isWindows: false);
      final command = builder.installDebug(
        project: _project(),
        gradlePath: ':app',
        serial: 'emulator-5554',
      );
      expect(command.arguments, [':app:installDebug']);
      expect(command.env, {'ANDROID_SERIAL': 'emulator-5554'});
    });

    test('omits env when no serial is given', () {
      const builder = NativeAndroidCommandBuilder(isWindows: false);
      final command =
          builder.installDebug(project: _project(), gradlePath: ':app');
      expect(command.env, isNull);
    });
  });

  group('monkeyLaunch', () {
    test('launches via the monkey LAUNCHER intent', () {
      const builder = NativeAndroidCommandBuilder(isWindows: false);
      final command = builder.monkeyLaunch(
        project: _project(),
        applicationId: 'com.demo.app',
        serial: 'emulator-5554',
      );
      expect(command.executable, 'adb');
      expect(command.arguments, [
        '-s',
        'emulator-5554',
        'shell',
        'monkey',
        '-p',
        'com.demo.app',
        '-c',
        'android.intent.category.LAUNCHER',
        '1',
      ]);
    });

    test('omits -s when no serial is given', () {
      const builder = NativeAndroidCommandBuilder(isWindows: false);
      final command = builder.monkeyLaunch(
        project: _project(),
        applicationId: 'com.demo.app',
      );
      expect(command.arguments.take(2), ['shell', 'monkey']);
    });
  });
}
