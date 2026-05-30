# Testing and Validation Rules

## Test structure

- Mirror production structure under `test/`:
  - `test/core/...`
  - `test/features/...`
  - `test/shared/...`
- Use `flutter_test` for widget and Flutter unit tests.
- Use `test` where pure Dart tests are appropriate.
- Use `bloc_test` for Cubit behavior.
- Use `mocktail` for mocks and fakes, matching existing tests.

## Test setup conventions

- Reset `getIt` in tests that configure DI.
- Use `SharedPreferences.setMockInitialValues({})` where settings or repositories touch shared preferences.
- Widget tests commonly wrap widgets with `MaterialApp`, localization delegates, and required Bloc providers.
- Tests that depend on Drift persistence should prefer in-memory databases unless a filesystem behavior is explicitly under test.
- Emulator E2E tests are opt-in and require `PICKFORGE_E2E_AVD`.

## Validation

- For code changes, run the most relevant focused tests first, then the standard validation before finishing:
  - `fvm dart format --set-exit-if-changed .`
  - `fvm flutter analyze`
  - `fvm flutter test`
- For generated-code changes, also run:
  - `fvm dart run build_runner build --delete-conflicting-outputs`
  - `fvm flutter gen-l10n`
  - `git diff` to inspect generated drift.
- For context-only changes under `AGENTS.md` or `.factory/`, at minimum inspect `git diff` and run `git diff --check`.
