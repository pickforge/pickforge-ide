# Milestone 3 · Slice 3A — FlutterTargetAdapter (detection + capabilities)

Roadmap Milestone 3 (move current Flutter support behind `FlutterTargetAdapter`).
3A is ADDITIVE: it adds the adapter's identity, capability declaration, detection,
and registry registration — it does NOT move any existing Flutter inspector / run /
screenshot code (that is later 3x slices, each with a parity test). No Flutter
behavior changes in 3A. Invariants per `plans/m2-slices/2a-adapter-core.md`.
Shell: `command grep`, `find`.

## Goal

Make the registry meaningful: a Flutter project detects as `flutter` with the full
capability set (above the generic fallback); non-Flutter folders still fall back to
`generic`. This is the seam M3's later slices fill by delegating operations to the
existing `InspectorRepository`, run-session services, and `AdbScreenshotCapturer`.

## Before implementing

`command grep -rn` for any existing Flutter/pubspec detection (e.g. in
`lib/core/projects/`) and REUSE it if present rather than reinventing. Read the real
2A types in `lib/core/targets/` so signatures match.

## File to create

### `lib/core/targets/flutter_target_adapter.dart`
```dart
import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/target_adapter.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';

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

  /// A Flutter project declares the Flutter SDK dependency in pubspec.yaml.
  @override
  Future<TargetDetection?> detect(String projectRoot) async {
    final pubspec = File(p.join(projectRoot, 'pubspec.yaml'));
    if (!await pubspec.exists()) return null;
    final content = await pubspec.readAsString();
    final declaresFlutterSdk =
        RegExp(r'(?m)^\s*sdk:\s*flutter\s*$').hasMatch(content);
    if (!declaresFlutterSdk) return null;
    return const TargetDetection(
      targetId: 'flutter',
      confidence: DetectionConfidence.exact,
    );
  }
}
```
(Match the actual 2A signatures; adjust if they differ. If an existing detector
already identifies Flutter projects robustly, delegate to it instead of the regex.)

## DI wiring
In `lib/core/di/injection.dart`, `TargetsModule.targetAdapterRegistry()` currently
builds `TargetAdapterRegistry(const [GenericProjectAdapter()])`. Add the Flutter
adapter (order doesn't matter — the registry sorts by priority):
```dart
TargetAdapterRegistry(const [FlutterTargetAdapter(), GenericProjectAdapter()])
```
Keep `@lazySingleton`; regenerate `injection.config.dart` via build_runner.

## Tests (`test/core/targets/`)
- `flutter_target_adapter_test.dart`: `detect()` returns an `exact` detection
  (`targetId == 'flutter'`) for a temp dir whose `pubspec.yaml` contains a
  `sdk: flutter` dependency; returns `null` for a dir with a non-Flutter pubspec and
  for a dir with no pubspec; `capabilities.has(...)` true for launch/hotReload/
  inspectSelection/captureScreenshot etc.; `priority == 100`.
- Registry integration: with the real `[FlutterTargetAdapter(), GenericProjectAdapter()]`,
  `detectFor` on a Flutter project temp dir returns the Flutter adapter; on a plain
  temp dir returns the generic adapter.

## Verification
1. `fvm dart run build_runner build --delete-conflicting-outputs`
2. `fvm dart format --set-exit-if-changed .`
3. `fvm flutter analyze` (0 issues)
4. `fvm flutter test test/core/targets/`
5. `fvm flutter test` (full — additive, stays green)

## STOP conditions
- Do NOT move/rename existing Flutter inspector/run/screenshot code in 3A.
- No Flutter behavior change (3A only adds detection + capability declaration).
- Detection must not false-positive on non-Flutter Dart packages (require the
  Flutter SDK dependency, not merely a pubspec.yaml).
