import 'dart:io';

import 'package:pickforge/core/targets/native_ios/ios_project_detector.dart';
import 'package:pickforge/core/targets/target_adapter.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';

/// The native iOS (Xcode / iOS Simulator) target.
///
/// Detection is filesystem-only and works on any OS, but all RUNTIME features
/// (xcodebuild / `xcrun simctl`) are macOS-only, so build/screenshot/log
/// capabilities are declared ONLY when running on macOS. It never declares
/// `mapSelectionToSource`: iOS source mapping is best-effort search, not exact.
class IosTargetAdapter implements TargetAdapter {
  const IosTargetAdapter({
    IosProjectDetector detector = const IosProjectDetector(),
    bool? isMacOS,
  })  : _detector = detector,
        _isMacOSOverride = isMacOS;

  final IosProjectDetector _detector;
  final bool? _isMacOSOverride;

  bool get _isMacOS => _isMacOSOverride ?? Platform.isMacOS;

  @override
  String get id => 'native_ios';

  @override
  String get displayName => 'Native iOS';

  /// Below the Android targets; iOS and Android detect disjoint markers, so the
  /// exact value only needs to sit above the generic fallback.
  @override
  int get priority => 55;

  /// Detection works anywhere; the xcodebuild/simctl-backed runtime features
  /// (7B) are only offered on macOS where they can actually run.
  @override
  TargetCapabilities get capabilities => _isMacOS
      ? const TargetCapabilities({
          TargetCapability.detect,
          TargetCapability.launch,
          TargetCapability.captureScreenshot,
          TargetCapability.streamLogs,
        })
      : const TargetCapabilities({TargetCapability.detect});

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
