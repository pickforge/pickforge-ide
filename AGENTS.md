# Pickforge Repository Instructions

These instructions apply to the entire repository. They are inferred from the current codebase and should override personal/global defaults when they conflict.

## Project overview

Pickforge is a local Flutter desktop app for selecting widgets in a running Flutter app, writing widget context into `.pickforge/`, and sending that context to an embedded agent CLI terminal.

## Tooling

- Use FVM for Flutter and Dart commands because `.fvmrc` pins Flutter `3.41.7`.
- Use `fvm dart` and `fvm flutter`; do not call raw `dart` or `flutter` for repo work.
- Standard checks:
  - `fvm dart format --set-exit-if-changed .`
  - `fvm flutter analyze`
  - `fvm flutter test`
- Codegen:
  - `fvm dart run build_runner build --delete-conflicting-outputs`
  - `fvm flutter gen-l10n`

## Architecture

- Keep the current single-package, feature-first structure:
  - `lib/features/<feature>/` for feature Cubits, views, and widgets.
  - `lib/core/` for infrastructure, repositories, persistence, VM service, terminal, emulator, agent, and DI code.
  - `lib/shared/` for reusable theme, motion, and UI utilities.
- Use `package:pickforge/...` imports for project code.
- Prefer repository/service seams under `lib/core/` instead of embedding platform, process, database, or VM-service logic in widgets.

## State, DI, and routing

- Use `flutter_bloc`/Cubit for feature state.
- Use `freezed` for union states and model/codegen-heavy state; simple states may use manual `Equatable` classes when that matches nearby code.
- Use `get_it` + `injectable` for app-wide services and repositories. Cubits are typically registered with `@injectable`; long-lived services/repositories are typically `@lazySingleton` or module-provided.
- Keep routes centralized in `lib/core/router/app_router.dart` with `go_router` and `AppRoutes` constants.

## Persistence, generated files, and localization

- Drift is the app persistence layer. Tables live in `lib/core/drift/tables/`, DAOs in `lib/core/drift/dao/`, and the database in `lib/core/drift/pickforge_database.dart`.
- Generated Drift, Freezed, JSON, and Injectable files are tracked in this repo. Do not hand-edit generated files; update sources and run codegen.
- Localization uses ARB files under `lib/l10n` and generated output under `lib/l10n/generated`.

## Testing

- Mirror source structure under `test/core`, `test/features`, and `test/shared`.
- Use `flutter_test`, `test`, `bloc_test`, and `mocktail` according to existing nearby tests.
- Reset `getIt` and mock `SharedPreferences` in tests that configure DI.
- Emulator E2E tests require `PICKFORGE_E2E_AVD`; do not assume they run in normal local/CI checks.

## Additional repo context

Read `.factory/rules/` and `.factory/memories.md` for more detailed repo-specific conventions before making non-trivial changes.
