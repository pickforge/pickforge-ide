import 'package:pickforge/core/targets/target_adapter.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';
import 'package:pickforge/core/targets/web/web_project_detector.dart';

/// The web (browser) target.
///
/// Inspection is via the browser's built-in CDP endpoint (no heavy automation
/// dependency — a roadmap STOP condition). It never declares
/// `mapSelectionToSource`; source mapping is best-effort (source maps / search).
/// 8A backs detection only.
class WebTargetAdapter implements TargetAdapter {
  const WebTargetAdapter({
    WebProjectDetector detector = const WebProjectDetector(),
  }) : _detector = detector;

  final WebProjectDetector _detector;

  @override
  String get id => 'web';

  @override
  String get displayName => 'Web';

  /// Above the generic fallback; native targets detect disjoint markers.
  @override
  int get priority => 50;

  @override
  TargetCapabilities get capabilities =>
      const TargetCapabilities({TargetCapability.detect});

  @override
  Future<TargetDetection?> detect(String projectRoot) async {
    final info = await _detector.detect(projectRoot);
    if (info == null) return null;
    return TargetDetection(
      targetId: id,
      confidence: info.hasWebFramework
          ? DetectionConfidence.exact
          : DetectionConfidence.likely,
      details: {
        'hasWebFramework': info.hasWebFramework.toString(),
        if (info.devScript != null) 'devScript': info.devScript!,
      },
    );
  }
}
