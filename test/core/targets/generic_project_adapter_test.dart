import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/generic_project_adapter.dart';
import 'package:pickforge/core/targets/target_adapter.dart';
import 'package:pickforge/core/targets/target_adapter_registry.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';

class _FakeAdapter implements TargetAdapter {
  _FakeAdapter({
    required this.id,
    required this.priority,
    this.detection,
  });

  @override
  final String id;

  @override
  final int priority;

  final TargetDetection? detection;

  @override
  String get displayName => 'Fake $id';

  @override
  TargetCapabilities get capabilities => TargetCapabilities.none;

  @override
  Future<TargetDetection?> detect(String projectRoot) async => detection;
}

void main() {
  group('GenericProjectAdapter', () {
    const adapter = GenericProjectAdapter();

    test('identity', () {
      expect(adapter.id, 'generic');
      expect(adapter.displayName, 'Generic project');
      expect(adapter.priority, 0);
    });

    test('declares only the detect capability', () {
      expect(adapter.capabilities.has(TargetCapability.detect), isTrue);
      expect(adapter.capabilities.has(TargetCapability.launch), isFalse);
      expect(adapter.capabilities.has(TargetCapability.stop), isFalse);
      expect(adapter.capabilities.has(TargetCapability.hotReload), isFalse);
      expect(adapter.capabilities.has(TargetCapability.hotRestart), isFalse);
      expect(
        adapter.capabilities.has(TargetCapability.captureScreenshot),
        isFalse,
      );
      expect(adapter.capabilities.has(TargetCapability.streamLogs), isFalse);
      expect(
        adapter.capabilities.has(TargetCapability.inspectSelection),
        isFalse,
      );
      expect(
        adapter.capabilities.has(TargetCapability.mapSelectionToSource),
        isFalse,
      );
      expect(
        adapter.capabilities.has(TargetCapability.exposeMcpTools),
        isFalse,
      );
    });

    test('detect returns a fallback detection for an existing directory',
        () async {
      final dir = await Directory.systemTemp.createTemp('generic_adapter_test');
      addTearDown(() => dir.delete(recursive: true));

      final detection = await adapter.detect(dir.path);

      expect(detection, isNotNull);
      expect(detection!.targetId, 'generic');
      expect(detection.confidence, DetectionConfidence.fallback);
    });

    test('detect returns null for a non-existent path', () async {
      final missing = '${Directory.systemTemp.path}'
          '/pickforge_does_not_exist_${DateTime.now().microsecondsSinceEpoch}';

      expect(await adapter.detect(missing), isNull);
    });
  });

  group('GenericProjectAdapter in a registry', () {
    test('a higher-priority adapter wins when it detects', () async {
      final dir = await Directory.systemTemp.createTemp('generic_registry_win');
      addTearDown(() => dir.delete(recursive: true));

      final flutter = _FakeAdapter(
        id: 'flutter',
        priority: 100,
        detection: const TargetDetection(
          targetId: 'flutter',
          confidence: DetectionConfidence.exact,
        ),
      );
      final registry = TargetAdapterRegistry(
        [flutter, const GenericProjectAdapter()],
      );

      final resolved = await registry.detectFor(dir.path);
      expect(resolved.id, 'flutter');
    });

    test('the generic adapter wins when the higher-priority one returns null',
        () async {
      final dir =
          await Directory.systemTemp.createTemp('generic_registry_fallback');
      addTearDown(() => dir.delete(recursive: true));

      final flutter = _FakeAdapter(id: 'flutter', priority: 100);
      final registry = TargetAdapterRegistry(
        [flutter, const GenericProjectAdapter()],
      );

      final resolved = await registry.detectFor(dir.path);
      expect(resolved.id, 'generic');
    });

    test('sorts the generic adapter last regardless of insertion order', () {
      final flutter = _FakeAdapter(id: 'flutter', priority: 100);
      final registry = TargetAdapterRegistry(
        [const GenericProjectAdapter(), flutter],
      );

      expect(
        registry.all.map((a) => a.id).toList(),
        ['flutter', 'generic'],
      );
    });
  });
}
