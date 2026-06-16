import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';

/// A pluggable target the workbench can drive (a Flutter app, a generic
/// project, etc.).
///
/// 2A defines only the identity, detection, and capability surface needed by
/// the registry. Operation surfaces (context build, logs, screenshots,
/// inspection) are added as capability-gated methods/mixins once there is a
/// concrete implementer.
abstract class TargetAdapter {
  /// Stable identifier, e.g. `'generic'` or `'flutter'`.
  String get id;

  /// User-facing name.
  String get displayName;

  TargetCapabilities get capabilities;

  /// Detection priority — higher wins; the generic fallback adapter is lowest.
  int get priority;

  Future<TargetDetection?> detect(String projectRoot);
}
