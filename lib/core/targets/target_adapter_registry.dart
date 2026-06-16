import 'package:pickforge/core/targets/target_adapter.dart';

/// Holds the registered [TargetAdapter]s and resolves the right one for a
/// project root.
///
/// Adapters are injected via a DI `@module` factory (see `TargetsModule` in
/// `injection.dart`). In 2A the list is empty; 2B registers the
/// `GenericProjectAdapter` as the lowest-priority fallback.
class TargetAdapterRegistry {
  TargetAdapterRegistry(List<TargetAdapter> adapters)
      : _adapters = List.unmodifiable(
          adapters.toList()..sort((a, b) => b.priority.compareTo(a.priority)),
        );

  final List<TargetAdapter> _adapters;

  /// All adapters, sorted by descending priority.
  List<TargetAdapter> get all => _adapters;

  TargetAdapter? byId(String id) {
    for (final adapter in _adapters) {
      if (adapter.id == id) {
        return adapter;
      }
    }
    return null;
  }

  /// Detects the best adapter for [projectRoot].
  ///
  /// Adapters are queried in descending priority order and the first non-null
  /// detection wins (short-circuit) — regardless of its `DetectionConfidence`.
  /// The `fallback` adapter (the `GenericProjectAdapter` from 2B) is not
  /// special-cased; it simply sits at the lowest priority, so it only wins when
  /// no higher-priority adapter detected the project first.
  Future<TargetAdapter> detectFor(String projectRoot) async {
    for (final adapter in _adapters) {
      final detection = await adapter.detect(projectRoot);
      if (detection != null) {
        return adapter;
      }
    }
    throw StateError(
      'No TargetAdapter could detect project at $projectRoot '
      'and no fallback adapter is registered.',
    );
  }
}
