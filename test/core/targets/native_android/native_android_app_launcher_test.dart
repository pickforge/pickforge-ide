import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/targets/native_android/native_android_app_launcher.dart';
import 'package:pickforge/core/targets/native_android/native_android_project_detector.dart';
import 'package:pickforge/core/targets/target_detection.dart';

class _FakeRunner extends Mock implements ProcessRunner {}

typedef _Invocation = ({
  String exe,
  List<String> args,
  String? cwd,
  Map<String, String>? env,
});

Future<(Directory, NativeAndroidProjectInfo)> _project({
  String appBuild =
      'android { defaultConfig { applicationId "com.demo.app" } }',
}) async {
  final dir = await Directory.systemTemp.createTemp('na_launch');
  final app = Directory(p.join(dir.path, 'app'))..createSync();
  await File(p.join(app.path, 'build.gradle')).writeAsString(appBuild);
  final info = NativeAndroidProjectInfo(
    projectRoot: dir.path,
    settingsFile: 'settings.gradle',
    rootBuildFile: 'build.gradle',
    hasGradleWrapper: true,
    applicationModules: [
      NativeAndroidModuleInfo(
        gradlePath: ':app',
        buildFile: p.join('app', 'build.gradle'),
        confidence: DetectionConfidence.exact,
      ),
    ],
  );
  return (dir, info);
}

void main() {
  setUpAll(() => registerFallbackValue(<String>[]));

  late _FakeRunner runner;
  late List<_Invocation> invocations;

  List<String> exes() => invocations.map((i) => i.exe).toList();

  void stub({int gradleExit = 0, int monkeyExit = 0}) {
    when(
      () => runner.run(
        any(),
        any(),
        cwd: any(named: 'cwd'),
        env: any(named: 'env'),
      ),
    ).thenAnswer((invocation) async {
      final exe = invocation.positionalArguments[0] as String;
      invocations.add(
        (
          exe: exe,
          args: (invocation.positionalArguments[1] as List).cast<String>(),
          cwd: invocation.namedArguments[#cwd] as String?,
          env: invocation.namedArguments[#env] as Map<String, String>?,
        ),
      );
      return ProcessResult(0, exe == 'adb' ? monkeyExit : gradleExit, '', '');
    });
  }

  setUp(() {
    runner = _FakeRunner();
    invocations = [];
  });

  test('installs then launches with the right install + monkey invocations',
      () async {
    stub();
    final (dir, project) = await _project();
    addTearDown(() => dir.delete(recursive: true));

    final result = await NativeAndroidAppLauncher(runner)
        .launch(project: project, serial: 'emulator-5554');

    expect(result.stage, NativeAndroidLaunchStage.launched);
    expect(result.applicationId, 'com.demo.app');
    expect(exes(), ['./gradlew', 'adb']);

    final install = invocations[0];
    expect(install.args, [':app:installDebug']);
    expect(install.cwd, project.projectRoot);
    expect(install.env, {'ANDROID_SERIAL': 'emulator-5554'});

    final monkey = invocations[1];
    expect(monkey.args, [
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

  test('resolves a Kotlin-DSL applicationId assignment', () async {
    stub();
    final (dir, project) =
        await _project(appBuild: 'android { applicationId = "com.demo.kts" }');
    addTearDown(() => dir.delete(recursive: true));
    final result =
        await NativeAndroidAppLauncher(runner).launch(project: project);
    expect(result.applicationId, 'com.demo.kts');
    expect(result.launched, isTrue);
  });

  test('falls back to namespace when no applicationId is declared', () async {
    stub();
    final (dir, project) =
        await _project(appBuild: 'android { namespace "com.demo.ns" }');
    addTearDown(() => dir.delete(recursive: true));
    final result =
        await NativeAndroidAppLauncher(runner).launch(project: project);
    expect(result.applicationId, 'com.demo.ns');
  });

  test('install-only when an applicationIdSuffix makes the id ambiguous',
      () async {
    stub();
    final (dir, project) = await _project(
      appBuild: 'android { defaultConfig { applicationId "com.demo.app" }\n'
          '  buildTypes { debug { applicationIdSuffix ".debug" } } }',
    );
    addTearDown(() => dir.delete(recursive: true));
    final result =
        await NativeAndroidAppLauncher(runner).launch(project: project);
    expect(result.stage, NativeAndroidLaunchStage.installedNoLaunch);
    expect(result.reason, 'application_id_unresolved');
    expect(exes(), ['./gradlew']); // never monkey-launches a wrong package
  });

  test('install-only when applicationId is dynamic (non-literal)', () async {
    stub();
    final (dir, project) =
        await _project(appBuild: 'android { applicationId computeId() }');
    addTearDown(() => dir.delete(recursive: true));
    final result =
        await NativeAndroidAppLauncher(runner).launch(project: project);
    expect(result.stage, NativeAndroidLaunchStage.installedNoLaunch);
    expect(exes(), ['./gradlew']);
  });

  test('ignores an applicationId inside a block comment', () async {
    stub();
    final (dir, project) = await _project(
      appBuild: '/* applicationId "com.commented.out" */\n'
          'android { namespace "com.demo.real" }',
    );
    addTearDown(() => dir.delete(recursive: true));
    final result =
        await NativeAndroidAppLauncher(runner).launch(project: project);
    expect(result.applicationId, 'com.demo.real');
  });

  test('ignores an applicationId inside a line comment', () async {
    stub();
    final (dir, project) = await _project(
      appBuild: '// applicationId "com.commented.out"\n'
          'android { namespace "com.demo.real" }',
    );
    addTearDown(() => dir.delete(recursive: true));
    final result =
        await NativeAndroidAppLauncher(runner).launch(project: project);
    expect(result.applicationId, 'com.demo.real');
  });

  test('ignores an ext.applicationId extension property', () async {
    stub();
    final (dir, project) = await _project(
      appBuild: 'ext.applicationId = "com.other.ext"\n'
          'android { namespace "com.demo.real" }',
    );
    addTearDown(() => dir.delete(recursive: true));
    final result =
        await NativeAndroidAppLauncher(runner).launch(project: project);
    expect(result.applicationId, 'com.demo.real');
  });

  test('reports install failure without attempting launch', () async {
    stub(gradleExit: 1);
    final (dir, project) = await _project();
    addTearDown(() => dir.delete(recursive: true));
    final result =
        await NativeAndroidAppLauncher(runner).launch(project: project);
    expect(result.stage, NativeAndroidLaunchStage.installFailed);
    expect(result.installed, isFalse);
    expect(exes(), ['./gradlew']);
  });

  test('reports launch failure after a successful install', () async {
    stub(monkeyExit: 1);
    final (dir, project) = await _project();
    addTearDown(() => dir.delete(recursive: true));
    final result =
        await NativeAndroidAppLauncher(runner).launch(project: project);
    expect(result.stage, NativeAndroidLaunchStage.installedNoLaunch);
    expect(result.reason, 'launch_failed');
    expect(result.installed, isTrue);
  });
}
