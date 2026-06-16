import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/flutter_target_adapter.dart';
import 'package:pickforge/core/targets/generic_project_adapter.dart';
import 'package:pickforge/core/targets/native_android/native_android_project_detector.dart';
import 'package:pickforge/core/targets/native_android/native_android_target_adapter.dart';
import 'package:pickforge/core/targets/react_native/react_native_target_adapter.dart';
import 'package:pickforge/core/targets/target_adapter_registry.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';

Future<Directory> _androidProject({
  bool settingsKts = false,
  bool appModule = true,
  bool appKts = false,
  bool exactApp = true,
  bool wrapper = true,
}) async {
  final dir = await Directory.systemTemp.createTemp('native_android');
  final settingsName = settingsKts ? 'settings.gradle.kts' : 'settings.gradle';
  await File(p.join(dir.path, settingsName)).writeAsString("include ':app'\n");
  await File(p.join(dir.path, 'build.gradle')).writeAsString('// root build\n');
  if (appModule) {
    final app = Directory(p.join(dir.path, 'app'))..createSync();
    final plugin = appKts
        ? 'plugins { id("com.android.application") }'
        : "plugins { id 'com.android.application' }";
    final content = exactApp
        ? '$plugin\nandroid { namespace "com.demo" }\n'
        : 'android {\n  compileSdk 34\n}\n';
    await File(p.join(app.path, appKts ? 'build.gradle.kts' : 'build.gradle'))
        .writeAsString(content);
  }
  if (wrapper) {
    await File(p.join(dir.path, 'gradlew')).writeAsString('#!/bin/sh\n');
  }
  return dir;
}

void main() {
  const adapter = NativeAndroidTargetAdapter();
  const detector = NativeAndroidProjectDetector();

  group('NativeAndroidProjectDetector', () {
    test('detects a standard app module as exact', () async {
      final dir = await _androidProject();
      addTearDown(() => dir.delete(recursive: true));
      final info = await detector.detect(dir.path);
      expect(info, isNotNull);
      expect(info!.settingsFile, 'settings.gradle');
      expect(info.hasGradleWrapper, isTrue);
      expect(info.hasExactApplicationModule, isTrue);
      expect(info.applicationModules.single.gradlePath, ':app');
    });

    test('detects a Kotlin-DSL project', () async {
      final dir = await _androidProject(settingsKts: true, appKts: true);
      addTearDown(() => dir.delete(recursive: true));
      final info = await detector.detect(dir.path);
      expect(info!.settingsFile, 'settings.gradle.kts');
      expect(info.hasExactApplicationModule, isTrue);
    });

    test('detects an android module without the plugin id as likely', () async {
      final dir = await _androidProject(exactApp: false);
      addTearDown(() => dir.delete(recursive: true));
      final info = await detector.detect(dir.path);
      expect(info, isNotNull);
      expect(info!.hasExactApplicationModule, isFalse);
      expect(
        info.applicationModules.single.confidence,
        DetectionConfidence.likely,
      );
    });

    test('does not claim a pure Android LIBRARY project', () async {
      final dir = await Directory.systemTemp.createTemp('android_lib');
      addTearDown(() => dir.delete(recursive: true));
      await File(p.join(dir.path, 'settings.gradle'))
          .writeAsString("include ':lib'\n");
      await File(p.join(dir.path, 'build.gradle')).writeAsString(
        'plugins { id "com.android.library" }\n'
        'android { namespace "com.demo.lib"\n  compileSdk 34\n}\n',
      );
      expect(await detector.detect(dir.path), isNull);
    });

    test('detects a single-module app whose root applies the app plugin',
        () async {
      final dir = await Directory.systemTemp.createTemp('android_root_app');
      addTearDown(() => dir.delete(recursive: true));
      await File(p.join(dir.path, 'settings.gradle')).writeAsString('\n');
      await File(p.join(dir.path, 'build.gradle')).writeAsString(
        "plugins { id 'com.android.application' }\nandroid { }\n",
      );
      final info = await detector.detect(dir.path);
      expect(info, isNotNull);
      expect(info!.hasExactApplicationModule, isTrue);
      expect(info.applicationModules.single.gradlePath, ':');
    });

    test('takes a single :app module when both gradle variants exist',
        () async {
      final dir = await _androidProject();
      addTearDown(() => dir.delete(recursive: true));
      await File(p.join(dir.path, 'app', 'build.gradle.kts'))
          .writeAsString('plugins { id("com.android.application") }\n');
      final info = await detector.detect(dir.path);
      expect(
        info!.applicationModules.where((m) => m.gradlePath == ':app'),
        hasLength(1),
      );
    });

    test('ignores a commented-out application plugin', () async {
      final dir = await Directory.systemTemp.createTemp('android_commented');
      addTearDown(() => dir.delete(recursive: true));
      await File(p.join(dir.path, 'settings.gradle')).writeAsString('\n');
      await File(p.join(dir.path, 'build.gradle')).writeAsString(
        "// id 'com.android.application'\n/* apply plugin: "
        '"com.android.application" */\n',
      );
      expect(await detector.detect(dir.path), isNull);
    });

    test('excludes an Android library module in app/', () async {
      final dir = await _androidProject(appModule: false);
      addTearDown(() => dir.delete(recursive: true));
      final app = Directory(p.join(dir.path, 'app'))..createSync();
      await File(p.join(app.path, 'build.gradle')).writeAsString(
        'plugins { id "com.android.library" }\nandroid { compileSdk 34 }\n',
      );
      expect(await detector.detect(dir.path), isNull);
    });

    test('root soft android markers without the app plugin are not enough',
        () async {
      final dir = await Directory.systemTemp.createTemp('android_root_soft');
      addTearDown(() => dir.delete(recursive: true));
      await File(p.join(dir.path, 'settings.gradle')).writeAsString('\n');
      await File(p.join(dir.path, 'build.gradle'))
          .writeAsString('android { compileSdk 34 }\n');
      expect(await detector.detect(dir.path), isNull);
    });

    test('returns null without a root settings.gradle', () async {
      final dir = await Directory.systemTemp.createTemp('no_settings');
      addTearDown(() => dir.delete(recursive: true));
      await File(p.join(dir.path, 'build.gradle')).writeAsString('// x\n');
      expect(await detector.detect(dir.path), isNull);
    });

    test('returns null when no module looks like an Android app', () async {
      final dir = await _androidProject(appModule: false);
      addTearDown(() => dir.delete(recursive: true));
      // root build.gradle has no android markers and there is no app module.
      expect(await detector.detect(dir.path), isNull);
    });

    test('does not claim a Flutter root (settings.gradle lives under android/)',
        () async {
      final dir = await Directory.systemTemp.createTemp('flutter_root');
      addTearDown(() => dir.delete(recursive: true));
      await File(p.join(dir.path, 'pubspec.yaml'))
          .writeAsString('name: demo\n');
      final android = Directory(p.join(dir.path, 'android'))..createSync();
      await File(p.join(android.path, 'settings.gradle'))
          .writeAsString("include ':app'\n");
      expect(await detector.detect(dir.path), isNull);
    });
  });

  group('NativeAndroidTargetAdapter', () {
    test('identity and honest capabilities', () {
      expect(adapter.id, 'native_android');
      expect(adapter.priority, 60);
      expect(adapter.capabilities.has(TargetCapability.detect), isTrue);
      expect(adapter.capabilities.has(TargetCapability.launch), isTrue); // 6-3
      expect(
        adapter.capabilities.has(TargetCapability.mapSelectionToSource),
        isFalse,
      );
    });

    test('detect surfaces gradle facts in the details', () async {
      final dir = await _androidProject();
      addTearDown(() => dir.delete(recursive: true));
      final detection = await adapter.detect(dir.path);
      expect(detection!.targetId, 'native_android');
      expect(detection.confidence, DetectionConfidence.exact);
      expect(detection.details?['settingsFile'], 'settings.gradle');
      expect(detection.details?['hasGradleWrapper'], 'true');
      expect(detection.details?['applicationModules'], ':app');
    });
  });

  group('in the real registry', () {
    final registry = TargetAdapterRegistry(const [
      FlutterTargetAdapter(),
      ReactNativeTargetAdapter(),
      NativeAndroidTargetAdapter(),
      GenericProjectAdapter(),
    ]);

    test('priority order slots native android below RN', () {
      expect(
        registry.all.map((a) => a.id),
        ['flutter', 'react_native_android', 'native_android', 'generic'],
      );
    });

    test('an Android project resolves to the native android adapter', () async {
      final dir = await _androidProject();
      addTearDown(() => dir.delete(recursive: true));
      expect((await registry.detectFor(dir.path)).id, 'native_android');
    });
  });
}
