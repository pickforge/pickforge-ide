import 'dart:io';

import 'package:pickforge/core/targets/target_adapter.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';

/// The lowest-priority fallback adapter.
///
/// Any existing directory resolves to this adapter when no richer adapter
/// (Flutter, later RN/Android/iOS/Web) detects the project. Generic mode is
/// terminal + manual context attachments + file tree/search + prompt
/// templates — none of which are adapter-gated yet — so this adapter only
/// provides identity, detection, and an honest capability set. It declares no
/// automatic target operations (launch/stop/reload/screenshot/logs/inspect/
/// source-map): the only capability is being detectable.
class GenericProjectAdapter implements TargetAdapter {
  const GenericProjectAdapter();

  @override
  String get id => 'generic';

  @override
  String get displayName => 'Generic project';

  /// Lowest priority — only wins when no richer adapter detects the project.
  @override
  int get priority => 0;

  /// Generic mode is terminal + manual context only; it exposes no automatic
  /// target operations, so the only capability is being detectable.
  @override
  TargetCapabilities get capabilities =>
      const TargetCapabilities({TargetCapability.detect});

  /// Any existing directory is a generic project (fallback confidence).
  @override
  Future<TargetDetection?> detect(String projectRoot) async {
    if (!Directory(projectRoot).existsSync()) return null;
    return const TargetDetection(
      targetId: 'generic',
      confidence: DetectionConfidence.fallback,
    );
  }
}
