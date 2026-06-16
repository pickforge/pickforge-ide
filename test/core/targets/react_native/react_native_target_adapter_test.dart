import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/flutter_target_adapter.dart';
import 'package:pickforge/core/targets/generic_project_adapter.dart';
import 'package:pickforge/core/targets/react_native/react_native_project_detector.dart';
import 'package:pickforge/core/targets/react_native/react_native_target_adapter.dart';
import 'package:pickforge/core/targets/target_adapter_registry.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';

Future<Directory> _rnProject({
  bool reactNativeDep = true,
  bool inDevDeps = false,
  bool android = true,
  bool androidScript = true,
  String? lockfile,
}) async {
  final dir = await Directory.systemTemp.createTemp('rn_adapter_test');
  final deps = reactNativeDep && !inDevDeps
      ? {'react-native': '0.74.0'}
      : <String, String>{};
  final devDeps = reactNativeDep && inDevDeps
      ? {'react-native': '0.74.0'}
      : <String, String>{};
  final scripts = androidScript
      ? {'android': 'react-native run-android'}
      : <String, String>{};
  await File(p.join(dir.path, 'package.json')).writeAsString(
    jsonEncode({
      'name': 'demo',
      'dependencies': deps,
      'devDependencies': devDeps,
      'scripts': scripts,
    }),
  );
  if (android) {
    await Directory(p.join(dir.path, 'android')).create();
  }
  if (lockfile != null) {
    await File(p.join(dir.path, lockfile)).writeAsString('# lock\n');
  }
  return dir;
}

void main() {
  const adapter = ReactNativeTargetAdapter();
  const detector = ReactNativeProjectDetector();

  group('ReactNativeProjectDetector', () {
    test('detects react-native in dependencies', () async {
      final dir = await _rnProject(lockfile: 'yarn.lock');
      addTearDown(() => dir.delete(recursive: true));
      final info = await detector.detect(dir.path);
      expect(info, isNotNull);
      expect(info!.packageManager, ReactNativePackageManager.yarn);
      expect(info.hasAndroidProject, isTrue);
      expect(info.hasAndroidScript, isTrue);
    });

    test('detects react-native in devDependencies', () async {
      final dir = await _rnProject(inDevDeps: true);
      addTearDown(() => dir.delete(recursive: true));
      expect(await detector.detect(dir.path), isNotNull);
    });

    test('returns null when react-native is absent', () async {
      final dir = await _rnProject(reactNativeDep: false);
      addTearDown(() => dir.delete(recursive: true));
      expect(await detector.detect(dir.path), isNull);
    });

    test('returns null without package.json', () async {
      final dir = await Directory.systemTemp.createTemp('rn_empty');
      addTearDown(() => dir.delete(recursive: true));
      expect(await detector.detect(dir.path), isNull);
    });

    test('returns null for malformed package.json', () async {
      final dir = await Directory.systemTemp.createTemp('rn_bad');
      addTearDown(() => dir.delete(recursive: true));
      await File(p.join(dir.path, 'package.json')).writeAsString('{not json');
      expect(await detector.detect(dir.path), isNull);
    });

    test('infers package manager by lockfile precedence', () async {
      Future<ReactNativePackageManager> pm(List<String> lockfiles) async {
        final dir = await Directory.systemTemp.createTemp('rn_pm');
        addTearDown(() => dir.delete(recursive: true));
        await File(p.join(dir.path, 'package.json')).writeAsString(
          jsonEncode({
            'dependencies': {'react-native': '*'},
          }),
        );
        for (final f in lockfiles) {
          await File(p.join(dir.path, f)).writeAsString('x\n');
        }
        return (await detector.detect(dir.path))!.packageManager;
      }

      expect(
        await pm(['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json']),
        ReactNativePackageManager.pnpm,
      );
      expect(
        await pm(['yarn.lock', 'package-lock.json']),
        ReactNativePackageManager.yarn,
      );
      expect(await pm(['package-lock.json']), ReactNativePackageManager.npm);
      expect(
        await pm(['package-lock.json', 'bun.lockb']),
        ReactNativePackageManager.npm,
      );
      expect(await pm(['bun.lockb']), ReactNativePackageManager.bun);
      expect(await pm(['bun.lock']), ReactNativePackageManager.bun);
      expect(await pm([]), ReactNativePackageManager.npm);
    });
  });

  group('ReactNativeTargetAdapter', () {
    test('declares only the capabilities 4A actually backs', () {
      bool can(TargetCapability c) => adapter.capabilities.has(c);
      expect(adapter.id, 'react_native_android');
      expect(adapter.priority, 80);
      // Capabilities grow as each slice lands its backing infrastructure.
      expect(can(TargetCapability.detect), isTrue);
      expect(can(TargetCapability.streamLogs), isTrue); // 4B Metro logs
      expect(can(TargetCapability.launch), isTrue); // 4C ADB launch
      expect(can(TargetCapability.stop), isTrue); // 4C
      expect(can(TargetCapability.captureScreenshot), isTrue); // 4C screenshot
      expect(can(TargetCapability.inspectSelection), isFalse);
      // Never declared for the RN MVP (roadmap STOP: no exact source mapping).
      expect(can(TargetCapability.mapSelectionToSource), isFalse);
      expect(can(TargetCapability.hotReload), isFalse);
      expect(can(TargetCapability.exposeMcpTools), isFalse);
    });

    test('detects an RN Android project as exact with details', () async {
      final dir = await _rnProject(lockfile: 'pnpm-lock.yaml');
      addTearDown(() => dir.delete(recursive: true));
      final detection = await adapter.detect(dir.path);
      expect(detection, isNotNull);
      expect(detection!.targetId, 'react_native_android');
      expect(detection.confidence, DetectionConfidence.exact);
      expect(detection.details?['packageManager'], 'pnpm');
      expect(detection.details?['hasAndroidScript'], 'true');
    });

    test('surfaces hasAndroidScript=false when no android script', () async {
      final dir = await _rnProject(androidScript: false);
      addTearDown(() => dir.delete(recursive: true));
      final detection = await adapter.detect(dir.path);
      expect(detection, isNotNull);
      expect(detection!.confidence, DetectionConfidence.exact);
      expect(detection.details?['hasAndroidScript'], 'false');
    });

    test('does not claim an RN project without an android/ dir', () async {
      final dir = await _rnProject(android: false);
      addTearDown(() => dir.delete(recursive: true));
      expect(await adapter.detect(dir.path), isNull);
    });

    test('does not claim a non-RN project', () async {
      final dir = await _rnProject(reactNativeDep: false);
      addTearDown(() => dir.delete(recursive: true));
      expect(await adapter.detect(dir.path), isNull);
    });
  });

  group('in the real registry', () {
    final registry = TargetAdapterRegistry(const [
      FlutterTargetAdapter(),
      ReactNativeTargetAdapter(),
      GenericProjectAdapter(),
    ]);

    test('priority order is flutter > react_native_android > generic', () {
      expect(
        registry.all.map((a) => a.id),
        ['flutter', 'react_native_android', 'generic'],
      );
    });

    test('an RN Android project resolves to the RN adapter', () async {
      final dir = await _rnProject(lockfile: 'yarn.lock');
      addTearDown(() => dir.delete(recursive: true));
      final resolved = await registry.detectFor(dir.path);
      expect(resolved.id, 'react_native_android');
    });

    test('a plain directory still falls back to generic', () async {
      final dir = await Directory.systemTemp.createTemp('rn_plain');
      addTearDown(() => dir.delete(recursive: true));
      final resolved = await registry.detectFor(dir.path);
      expect(resolved.id, 'generic');
    });
  });
}
