import 'package:pickforge/core/targets/native_android/native_android_project_detector.dart';
import 'package:pickforge/core/targets/target_adapter.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';

/// The native Android (Gradle / Android Studio) target.
///
/// Best-effort support: run/log/screenshot/UIAutomator inspection with
/// search-based source hints. It never declares `mapSelectionToSource` — there
/// is no stable external API for exact View/Compose source mapping. Capabilities
/// grow as each M6 slice lands its backing; 6-1 backs detection only.
class NativeAndroidTargetAdapter implements TargetAdapter {
  const NativeAndroidTargetAdapter({
    NativeAndroidProjectDetector detector =
        const NativeAndroidProjectDetector(),
  }) : _detector = detector;

  final NativeAndroidProjectDetector _detector;

  @override
  String get id => 'native_android';

  @override
  String get displayName => 'Native Android';

  /// Below React Native (80); a project that is also RN/Flutter is claimed by
  /// those higher-priority adapters first.
  @override
  int get priority => 60;

  @override
  TargetCapabilities get capabilities =>
      const TargetCapabilities({TargetCapability.detect});

  @override
  Future<TargetDetection?> detect(String projectRoot) async {
    final info = await _detector.detect(projectRoot);
    if (info == null) return null;
    return TargetDetection(
      targetId: id,
      confidence: info.hasExactApplicationModule
          ? DetectionConfidence.exact
          : DetectionConfidence.likely,
      details: {
        'settingsFile': info.settingsFile,
        'rootBuildFile': info.rootBuildFile,
        'hasGradleWrapper': info.hasGradleWrapper.toString(),
        'applicationModules':
            info.applicationModules.map((m) => m.gradlePath).join(','),
      },
    );
  }
}
