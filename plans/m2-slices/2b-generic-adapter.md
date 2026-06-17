# Milestone 2 · Slice 2B — GenericProjectAdapter

Depends on 2A (committed: `lib/core/targets/` core types + `TargetAdapterRegistry`).
Additive: registers the fallback adapter; no Flutter behavior change. Invariants per
`plans/m2-slices/2a-adapter-core.md`. Shell: `command grep`, `find`.

## Goal

`GenericProjectAdapter` is the lowest-priority fallback: ANY existing folder resolves
to it when no richer adapter (Flutter, later RN/Android/iOS/Web) detects the project.
Generic mode is terminal + manual context attachments + file tree/search + prompt
templates — all of which already exist and are NOT adapter-gated yet, so this adapter
mostly provides identity + detection + an HONEST capability set. It declares NO target
operations (launch/stop/reload/screenshot/logs/inspect/source-map) — only `detect`.
(Do not overstate support — a roadmap STOP condition.)

## File to create

### `lib/core/targets/generic_project_adapter.dart`
```dart
import 'dart:io';
import 'package:pickforge/core/targets/target_adapter.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_detection.dart';

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
    if (!await Directory(projectRoot).exists()) return null;
    return const TargetDetection(
      targetId: 'generic',
      confidence: DetectionConfidence.fallback,
    );
  }
}
```
(Match the actual `TargetAdapter` / `TargetDetection` / `DetectionConfidence` /
`TargetCapabilities` signatures from 2A — read those files first and adjust if they
differ from the sketch.)

## DI wiring

In `lib/core/di/injection.dart`, `TargetsModule.targetAdapterRegistry()` currently
builds the registry with an empty list. Change it to include the generic adapter:
```dart
@lazySingleton
TargetAdapterRegistry targetAdapterRegistry() =>
    TargetAdapterRegistry(const [GenericProjectAdapter()]);
```
(Keep `@lazySingleton`. Regenerate `injection.config.dart` via build_runner.)

## Tests (`test/core/targets/`)
- `generic_project_adapter_test.dart`: `detect()` returns a `fallback` `TargetDetection`
  with `targetId == 'generic'` for an existing temp dir; returns `null` for a
  non-existent path; `capabilities.has(TargetCapability.detect)` is true and e.g.
  `launch`/`captureScreenshot`/`inspectSelection` are false; `id`/`priority`/`displayName`.
- Extend `target_adapter_registry_test.dart` (or a new test): a registry containing the
  real `GenericProjectAdapter` plus a higher-priority fake — `detectFor` on an existing
  dir returns the higher-priority adapter when it detects, and the generic adapter when
  the higher-priority one returns null.

## Verification
1. `fvm dart run build_runner build --delete-conflicting-outputs`
2. `fvm dart format --set-exit-if-changed .`
3. `fvm flutter analyze` (0 issues)
4. `fvm flutter test test/core/targets/`
5. `fvm flutter test` (full — additive, stays green)

## STOP conditions
- Do NOT move terminal/attachments/file-tree/search/prompt-template code behind the
  adapter in this slice (that wiring is later). 2B only adds the adapter + registers it.
- Do NOT overstate generic capabilities.
