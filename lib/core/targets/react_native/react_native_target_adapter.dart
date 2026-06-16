import 'package:pickforge/core/targets/react_native/react_native_project_detector.dart';
import 'package:pickforge/core/targets/target_adapter.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';

/// The React Native Android target — PickForge's first non-Flutter vertical.
///
/// Capabilities are declared as their backing lands, not promised up front:
/// 4A backs only `detect`. Later M4 slices add `streamLogs` (Metro/logcat),
/// `launch`/`stop`/`captureScreenshot` (ADB), and `inspectSelection`
/// (UIAutomator). It deliberately never declares `mapSelectionToSource` (RN
/// yields likely source candidates, not exact mapping — a roadmap STOP
/// condition), nor hot reload / MCP tooling, which are out of the MVP scope.
class ReactNativeTargetAdapter implements TargetAdapter {
  const ReactNativeTargetAdapter({
    ReactNativeProjectDetector detector = const ReactNativeProjectDetector(),
  }) : _detector = detector;

  final ReactNativeProjectDetector _detector;

  @override
  String get id => 'react_native_android';

  @override
  String get displayName => 'React Native (Android)';

  /// Between Flutter's deep support (100) and the generic fallback (0).
  @override
  int get priority => 80;

  @override
  TargetCapabilities get capabilities => const TargetCapabilities({
        TargetCapability.detect,
        // 4B: Metro run + log streaming infrastructure.
        TargetCapability.streamLogs,
        // 4C: ADB launch / stop / screenshot infrastructure.
        TargetCapability.launch,
        TargetCapability.stop,
        TargetCapability.captureScreenshot,
        // 4D: UIAutomator hierarchy inspection.
        TargetCapability.inspectSelection,
      });

  /// Claims a project only when it is React Native AND has an `android/`
  /// sub-project this Android adapter can actually drive.
  @override
  Future<TargetDetection?> detect(String projectRoot) async {
    final info = await _detector.detect(projectRoot);
    if (info == null || !info.hasAndroidProject) return null;
    final expoConfigPath = info.expo?.configPath;
    return TargetDetection(
      targetId: id,
      confidence: DetectionConfidence.exact,
      details: {
        'packageManager': info.packageManager.name,
        'hasAndroidScript': info.hasAndroidScript.toString(),
        'isExpo': info.isExpo.toString(),
        if (expoConfigPath != null) 'expoConfigPath': expoConfigPath,
      },
    );
  }
}
