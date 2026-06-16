import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/target_adapter.dart';
import 'package:pickforge/core/targets/target_adapter_registry.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';

class _FakeAdapter extends TargetAdapter {
  _FakeAdapter({
    required this.id,
    required this.priority,
    this.detection,
    this.onDetect,
  });

  @override
  final String id;

  @override
  final int priority;

  /// Detection returned by [detect]; `null` means "not this target".
  final TargetDetection? detection;

  /// Optional probe to assert detection short-circuiting / ordering.
  final void Function(String projectRoot)? onDetect;

  @override
  String get displayName => 'Fake $id';

  @override
  TargetCapabilities get capabilities => TargetCapabilities.none;

  @override
  Future<TargetDetection?> detect(String projectRoot) async {
    onDetect?.call(projectRoot);
    return detection;
  }
}

void main() {
  group('TargetAdapterRegistry', () {
    test('all is sorted by descending priority', () {
      final low = _FakeAdapter(id: 'low', priority: 0);
      final mid = _FakeAdapter(id: 'mid', priority: 50);
      final high = _FakeAdapter(id: 'high', priority: 100);

      final registry = TargetAdapterRegistry([low, high, mid]);

      expect(
        registry.all.map((a) => a.id).toList(),
        ['high', 'mid', 'low'],
      );
    });

    test('byId returns the matching adapter or null', () {
      final flutter = _FakeAdapter(id: 'flutter', priority: 100);
      final generic = _FakeAdapter(id: 'generic', priority: 0);
      final registry = TargetAdapterRegistry([flutter, generic]);

      expect(registry.byId('flutter'), same(flutter));
      expect(registry.byId('generic'), same(generic));
      expect(registry.byId('missing'), isNull);
    });

    test('detectFor returns the highest-priority exact match', () async {
      final generic = _FakeAdapter(
        id: 'generic',
        priority: 0,
        detection: const TargetDetection(
          targetId: 'generic',
          confidence: DetectionConfidence.fallback,
        ),
      );
      final flutter = _FakeAdapter(
        id: 'flutter',
        priority: 100,
        detection: const TargetDetection(
          targetId: 'flutter',
          confidence: DetectionConfidence.exact,
        ),
      );

      final registry = TargetAdapterRegistry([generic, flutter]);

      final resolved = await registry.detectFor('/some/project');
      expect(resolved.id, 'flutter');
    });

    test('detectFor falls back to the lowest-priority fallback adapter',
        () async {
      final flutter = _FakeAdapter(id: 'flutter', priority: 100);
      final web = _FakeAdapter(id: 'web', priority: 50);
      final generic = _FakeAdapter(
        id: 'generic',
        priority: 0,
        detection: const TargetDetection(
          targetId: 'generic',
          confidence: DetectionConfidence.fallback,
        ),
      );

      final registry = TargetAdapterRegistry([flutter, web, generic]);

      final resolved = await registry.detectFor('/some/project');
      expect(resolved.id, 'generic');
    });

    test('detectFor short-circuits on the first non-null in priority order',
        () async {
      final probed = <String>[];

      final flutter = _FakeAdapter(
        id: 'flutter',
        priority: 100,
        detection: const TargetDetection(
          targetId: 'flutter',
          confidence: DetectionConfidence.exact,
        ),
        onDetect: (_) => probed.add('flutter'),
      );
      final web = _FakeAdapter(
        id: 'web',
        priority: 50,
        detection: const TargetDetection(
          targetId: 'web',
          confidence: DetectionConfidence.exact,
        ),
        onDetect: (_) => probed.add('web'),
      );

      final registry = TargetAdapterRegistry([web, flutter]);

      final resolved = await registry.detectFor('/some/project');
      expect(resolved.id, 'flutter');
      expect(probed, ['flutter']);
    });

    test(
        'detectFor short-circuits on a fallback detection that is the first '
        'non-null hit', () async {
      final probed = <String>[];

      final flutter = _FakeAdapter(
        id: 'flutter',
        priority: 100,
        onDetect: (_) => probed.add('flutter'),
      );
      final generic = _FakeAdapter(
        id: 'generic',
        priority: 50,
        detection: const TargetDetection(
          targetId: 'generic',
          confidence: DetectionConfidence.fallback,
        ),
        onDetect: (_) => probed.add('generic'),
      );
      final never = _FakeAdapter(
        id: 'never',
        priority: 0,
        detection: const TargetDetection(
          targetId: 'never',
          confidence: DetectionConfidence.exact,
        ),
        onDetect: (_) => probed.add('never'),
      );

      final registry = TargetAdapterRegistry([never, generic, flutter]);

      final resolved = await registry.detectFor('/some/project');

      expect(resolved.id, 'generic');
      expect(probed, ['flutter', 'generic']);
    });

    test(
        'detectFor skips a higher-priority null adapter before the fallback '
        'fires', () async {
      final probed = <String>[];

      final flutter = _FakeAdapter(
        id: 'flutter',
        priority: 100,
        onDetect: (_) => probed.add('flutter'),
      );
      final generic = _FakeAdapter(
        id: 'generic',
        priority: 0,
        detection: const TargetDetection(
          targetId: 'generic',
          confidence: DetectionConfidence.fallback,
        ),
        onDetect: (_) => probed.add('generic'),
      );

      final registry = TargetAdapterRegistry([generic, flutter]);

      final resolved = await registry.detectFor('/some/project');

      expect(resolved.id, 'generic');
      expect(probed, ['flutter', 'generic']);
    });

    test('detectFor throws when nothing matches and no fallback exists',
        () async {
      final flutter = _FakeAdapter(id: 'flutter', priority: 100);
      final registry = TargetAdapterRegistry([flutter]);

      expect(
        () => registry.detectFor('/some/project'),
        throwsStateError,
      );
    });
  });
}
