import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/target_adapter.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';

/// The deep-support reference adapter for Flutter projects.
///
/// Declares the Flutter target's identity, full capability set, and detection.
/// The live inspector / run / screenshot work stays owned by the established
/// services (`InspectorRepository`, the run session, `AdbScreenshotCapturer`);
/// `FlutterSelectionMapper` projects a pick onto the generic `TargetSelection`.
/// A stateful adapter-owned `TargetSession` is deferred until a second target
/// (React Native, M4) proves the shared operation surface.
class FlutterTargetAdapter implements TargetAdapter {
  const FlutterTargetAdapter();

  @override
  String get id => 'flutter';

  @override
  String get displayName => 'Flutter';

  /// Above the generic fallback (priority 0).
  @override
  int get priority => 100;

  /// Flutter is the deep-support reference adapter — it can do everything.
  @override
  TargetCapabilities get capabilities => const TargetCapabilities({
        TargetCapability.detect,
        TargetCapability.launch,
        TargetCapability.stop,
        TargetCapability.hotReload,
        TargetCapability.hotRestart,
        TargetCapability.captureScreenshot,
        TargetCapability.streamLogs,
        TargetCapability.inspectSelection,
        TargetCapability.mapSelectionToSource,
        TargetCapability.exposeMcpTools,
      });

  /// A Flutter project declares the Flutter SDK dependency in `pubspec.yaml`.
  ///
  /// Requiring the `sdk: flutter` dependency — not merely a `pubspec.yaml` —
  /// keeps plain Dart packages from false-positiving as Flutter targets.
  @override
  Future<TargetDetection?> detect(String projectRoot) async {
    final pubspec = File(p.join(projectRoot, 'pubspec.yaml'));
    if (!pubspec.existsSync()) return null;
    final content = await pubspec.readAsString();
    final declaresFlutterSdk =
        RegExp(r'^\s*sdk:\s*flutter\s*$', multiLine: true).hasMatch(content);
    if (!declaresFlutterSdk) return null;
    return const TargetDetection(
      targetId: 'flutter',
      confidence: DetectionConfidence.exact,
    );
  }
}
