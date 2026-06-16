import 'package:pickforge/core/targets/native_ios/ios_project_detector.dart';
import 'package:pickforge/core/targets/target_adapter.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';

/// The native iOS (Xcode / iOS Simulator) target.
///
/// Detection is filesystem-only and works on any OS, but all RUNTIME features
/// (xcodebuild / `xcrun simctl`) are macOS-only — later slices declare those
/// capabilities only behind `Platform.isMacOS`. It never declares
/// `mapSelectionToSource`: iOS source mapping is best-effort search, not exact.
/// 7A backs detection only.
class IosTargetAdapter implements TargetAdapter {
  const IosTargetAdapter({
    IosProjectDetector detector = const IosProjectDetector(),
  }) : _detector = detector;

  final IosProjectDetector _detector;

  @override
  String get id => 'native_ios';

  @override
  String get displayName => 'Native iOS';

  /// Below the Android targets; iOS and Android detect disjoint markers, so the
  /// exact value only needs to sit above the generic fallback.
  @override
  int get priority => 55;

  @override
  TargetCapabilities get capabilities =>
      const TargetCapabilities({TargetCapability.detect});

  @override
  Future<TargetDetection?> detect(String projectRoot) async {
    final info = await _detector.detect(projectRoot);
    if (info == null) return null;
    return TargetDetection(
      targetId: id,
      confidence:
          info.isExact ? DetectionConfidence.exact : DetectionConfidence.likely,
      details: {
        if (info.workspace != null) 'workspace': info.workspace!,
        if (info.xcodeproj != null) 'xcodeproj': info.xcodeproj!,
        'hasAppPackage': info.hasAppPackage.toString(),
      },
    );
  }
}
