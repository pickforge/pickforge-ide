import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/flutter_target_adapter.dart';
import 'package:pickforge/core/targets/generic_project_adapter.dart';
import 'package:pickforge/core/targets/target_adapter_registry.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';

Future<Directory> _projectWithPubspec(String contents) async {
  final dir = await Directory.systemTemp.createTemp('flutter_adapter_test');
  await File(p.join(dir.path, 'pubspec.yaml')).writeAsString(contents);
  return dir;
}

const _flutterPubspec = '''
name: example_app
environment:
  sdk: ^3.5.0
dependencies:
  flutter:
    sdk: flutter
''';

const _dartOnlyPubspec = '''
name: example_lib
environment:
  sdk: ^3.5.0
dependencies:
  meta: ^1.0.0
''';

void main() {
  group('FlutterTargetAdapter', () {
    const adapter = FlutterTargetAdapter();

    test('identity', () {
      expect(adapter.id, 'flutter');
      expect(adapter.displayName, 'Flutter');
      expect(adapter.priority, 100);
    });

    test('declares the full deep-support capability set', () {
      expect(adapter.capabilities.has(TargetCapability.detect), isTrue);
      expect(adapter.capabilities.has(TargetCapability.launch), isTrue);
      expect(adapter.capabilities.has(TargetCapability.stop), isTrue);
      expect(adapter.capabilities.has(TargetCapability.hotReload), isTrue);
      expect(adapter.capabilities.has(TargetCapability.hotRestart), isTrue);
      expect(
        adapter.capabilities.has(TargetCapability.captureScreenshot),
        isTrue,
      );
      expect(adapter.capabilities.has(TargetCapability.streamLogs), isTrue);
      expect(
        adapter.capabilities.has(TargetCapability.inspectSelection),
        isTrue,
      );
      expect(
        adapter.capabilities.has(TargetCapability.mapSelectionToSource),
        isTrue,
      );
      expect(
        adapter.capabilities.has(TargetCapability.exposeMcpTools),
        isTrue,
      );
    });

    test('detect returns an exact detection for a Flutter pubspec', () async {
      final dir = await _projectWithPubspec(_flutterPubspec);
      addTearDown(() => dir.delete(recursive: true));

      final detection = await adapter.detect(dir.path);

      expect(detection, isNotNull);
      expect(detection!.targetId, 'flutter');
      expect(detection.confidence, DetectionConfidence.exact);
    });

    test('detect returns null for a non-Flutter Dart pubspec', () async {
      final dir = await _projectWithPubspec(_dartOnlyPubspec);
      addTearDown(() => dir.delete(recursive: true));

      expect(await adapter.detect(dir.path), isNull);
    });

    test('detect returns null for a directory without a pubspec', () async {
      final dir = await Directory.systemTemp.createTemp('flutter_no_pubspec');
      addTearDown(() => dir.delete(recursive: true));

      expect(await adapter.detect(dir.path), isNull);
    });
  });

  group('FlutterTargetAdapter in the real registry', () {
    TargetAdapterRegistry buildRegistry() => TargetAdapterRegistry(
          const [FlutterTargetAdapter(), GenericProjectAdapter()],
        );

    test('a Flutter project resolves to the Flutter adapter', () async {
      final dir = await _projectWithPubspec(_flutterPubspec);
      addTearDown(() => dir.delete(recursive: true));

      final resolved = await buildRegistry().detectFor(dir.path);

      expect(resolved.id, 'flutter');
    });

    test('a non-Flutter directory falls back to the generic adapter', () async {
      final dir = await Directory.systemTemp.createTemp('flutter_registry_gen');
      addTearDown(() => dir.delete(recursive: true));

      final resolved = await buildRegistry().detectFor(dir.path);

      expect(resolved.id, 'generic');
    });
  });
}
