import 'dart:io';

import 'package:pickforge/core/targets/native_android/native_android_command.dart';
import 'package:pickforge/core/targets/native_android/native_android_project_detector.dart';

/// Builds the deterministic Gradle/ADB commands for a native Android project.
///
/// The Gradle wrapper is preferred (`./gradlew` on Unix, `gradlew.bat` on
/// Windows); `gradle` on PATH is the fallback when no wrapper is present.
/// The device serial is passed via the `ANDROID_SERIAL` env var (which Gradle
/// and ADB both honor) rather than Gradle CLI args.
class NativeAndroidCommandBuilder {
  const NativeAndroidCommandBuilder({bool? isWindows}) : _isWindows = isWindows;

  final bool? _isWindows;

  bool get _windows => _isWindows ?? Platform.isWindows;

  NativeAndroidCommand assembleDebug({
    required NativeAndroidProjectInfo project,
    required String gradlePath,
  }) {
    return _gradleCommand(project, _task(gradlePath, 'assembleDebug'));
  }

  NativeAndroidCommand installDebug({
    required NativeAndroidProjectInfo project,
    required String gradlePath,
    String? serial,
  }) {
    return _gradleCommand(
      project,
      _task(gradlePath, 'installDebug'),
      serial: serial,
    );
  }

  /// Launches an already-installed app via the monkey LAUNCHER intent — no
  /// launcher-activity name needed (it isn't reliably knowable statically).
  NativeAndroidCommand monkeyLaunch({
    required NativeAndroidProjectInfo project,
    required String applicationId,
    String? serial,
  }) {
    return NativeAndroidCommand(
      executable: 'adb',
      arguments: [
        if (serial != null) ...['-s', serial],
        'shell',
        'monkey',
        '-p',
        applicationId,
        '-c',
        'android.intent.category.LAUNCHER',
        '1',
      ],
      cwd: project.projectRoot,
    );
  }

  NativeAndroidCommand _gradleCommand(
    NativeAndroidProjectInfo project,
    String task, {
    String? serial,
  }) {
    return NativeAndroidCommand(
      executable: _gradleExecutable(project),
      arguments: [task],
      cwd: project.projectRoot,
      env: serial == null ? null : {'ANDROID_SERIAL': serial},
    );
  }

  String _gradleExecutable(NativeAndroidProjectInfo project) {
    if (!project.hasGradleWrapper) return 'gradle';
    return _windows ? r'.\gradlew.bat' : './gradlew';
  }

  String _task(String gradlePath, String name) {
    return gradlePath == ':' ? name : '$gradlePath:$name';
  }
}
