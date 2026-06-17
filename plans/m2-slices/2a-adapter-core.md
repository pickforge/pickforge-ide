# Milestone 2 — Adapter registry + Generic Project mode

Roadmap Milestone 2. Introduce a capability-based target-adapter layer WITHOUT
changing current Flutter behavior. Planned by Claude (Codex planning stalled);
Codex still reviews each slice. Invariants: FVM, infra in `lib/core`, features in
`lib/features`, injectable+get_it (build_runner after annotations; M1 added a manual
lazy-registration pattern), flutter_bloc, Drift, design-system rules binding for UI,
no new pub deps, never hand-edit generated files. Shell: `command grep`, `find`.

## Slice breakdown

- **2A — Core adapter types + registry (additive only).** This file. No existing
  code changes (except the generated DI registration of the registry). No behavior
  change. Foundation that 2B implements and M3's `FlutterTargetAdapter` will too.
- **2B — `GenericProjectAdapter`.** Detection fallback (any folder), embedded
  terminal, manual context attachments, file tree/search, prompt templates, NO auto
  UI inspection. Register it in the registry as the lowest-priority fallback. Tests.
- **2C — Capability badges UI + goldens.** Small workbench surface showing the active
  target's capabilities (Run/Logs/Screenshot/Inspect/Source map/Hot reload/MCP).

M3 (separate milestone) moves the current Flutter flow behind a `FlutterTargetAdapter`
— 2A only defines the seam; do NOT move Flutter code in M2.

## Slice 2A — files to create under `lib/core/targets/`

Value types extend `Equatable`. Keep interfaces MINIMAL and capability-gated; do not
speculatively design rich operations no one implements yet.

### `target_capability.dart`
```dart
enum TargetCapability {
  detect, launch, stop, hotReload, hotRestart, captureScreenshot,
  streamLogs, inspectSelection, mapSelectionToSource, exposeMcpTools,
}
```
Plus `TargetCapabilities extends Equatable` wrapping an unmodifiable
`Set<TargetCapability>`: `const TargetCapabilities(this.values)`, `bool has(c)`,
`static const none = TargetCapabilities({})`, `props => [values]`. Iteration order is
not relied upon (it's a Set).

### `target_detection.dart`
`TargetDetection extends Equatable`: `targetId` (String), `confidence`
(enum `DetectionConfidence { exact, likely, fallback }`), optional `details`
(`Map<String, String>`). A `TargetDetector` abstract class:
`Future<TargetDetection?> detect(String projectRoot)` (null = not this target).

### `target_selection.dart`
`TargetSelection extends Equatable` — the generic "current picked element" (a Flutter
widget, an a11y node, a DOM node...): `id` (String), `label` (String), optional
`sourcePath`/`sourceLine`, optional `propertiesJson` (String), optional
`screenshotPath`. Keep it generic; Flutter-specific richness stays in the Flutter
layer (M3) and is surfaced separately.

### `target_session.dart`
`TargetSession` abstract: `String get targetId; bool get isRunning; Future<void> stop();`
(minimal — launch/reload live behind capability-gated adapter methods later; do not
over-specify now).

### `target_adapter.dart`
```dart
abstract class TargetAdapter {
  String get id;            // stable, e.g. 'generic', 'flutter'
  String get displayName;   // user-facing
  TargetCapabilities get capabilities;
  /// Detection priority — higher wins; GenericProjectAdapter is lowest.
  int get priority;
  Future<TargetDetection?> detect(String projectRoot);
}
```
(Operation surfaces — context build, logs, screenshots, inspection — are added in
2B/M3 as capability-gated methods/mixins once there is a concrete implementer. 2A
only needs the identity + detection + capability surface for the registry.)

### `target_adapter_registry.dart`
`@lazySingleton TargetAdapterRegistry`:
- ctor takes `List<TargetAdapter> adapters` (injected; provided via a DI `@module`
  factory like `AgentProfileRegistry`/`HeadlessChatAdapterRegistry` do in
  `injection.dart`).
- `List<TargetAdapter> get all` (sorted by descending priority).
- `TargetAdapter? byId(String id)`.
- `Future<TargetAdapter> detectFor(String projectRoot)`: query adapters in priority
  order, return the first with a non-null `detect()`; ALWAYS falls back to the
  lowest-priority adapter that returns a `fallback` detection (the GenericProjectAdapter
  from 2B). For 2A (no adapters registered yet) the registry is constructed with an
  empty/dummy list in tests.

DI: add a `@module TargetsModule` in `injection.dart` providing
`TargetAdapterRegistry` from the injected adapter list. In 2A the adapter list is
empty (no adapters yet) — wire the module so 2B can add `GenericProjectAdapter`
without touching the registry. (If injectable needs at least one binding, register
the registry with `const []` for now and document that 2B populates it.)

## Tests (`test/core/targets/`)
- `target_capabilities_test.dart`: `has()`, equality, `none`.
- `target_adapter_registry_test.dart` (use simple fake `TargetAdapter`s):
  `all` sorted by priority desc; `byId`; `detectFor` returns highest-priority exact
  match; falls back to the lowest-priority fallback adapter; detection short-circuits
  on the first non-null in priority order.

## Verification
1. `fvm dart run build_runner build --delete-conflicting-outputs`
2. `fvm dart format --set-exit-if-changed .`
3. `fvm flutter analyze` (0 issues)
4. `fvm flutter test test/core/targets/`
5. `fvm flutter test` (full — proves additive, nothing regressed)

## STOP conditions (roadmap M2)
- No Flutter behavior change before a parity test exists (2A changes nothing).
- No broad renames of Flutter-specific classes in one diff.
- No rewrite of unrelated UI or persistence.
- Do NOT move current Flutter inspector/run code behind an adapter in M2 (that's M3).
