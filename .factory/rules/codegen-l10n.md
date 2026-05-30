# Codegen and Localization Rules

## Codegen

- The repo uses build runner for Freezed, JSON serialization, Drift, and Injectable.
- Run codegen with:
  - `fvm dart run build_runner build --delete-conflicting-outputs`
- `scripts/gen.sh` runs build runner and Flutter localization generation.
- Generated `.freezed.dart`, `.g.dart`, and `lib/core/di/injection.config.dart` files are intentionally tracked.
- Do not hand-edit generated files. Change the source file and regenerate.
- After codegen, check for unintended drift with `git diff`.

## Drift

- Drift tables live in `lib/core/drift/tables/`.
- DAOs live in `lib/core/drift/dao/`.
- The database class and schema version live in `lib/core/drift/pickforge_database.dart`.
- Add migration tests when changing schema versions.

## Localization

- Localization config lives in `l10n.yaml`.
- ARB files live under `lib/l10n`.
- Generated localization output is configured under `lib/l10n/generated`.
- Import generated localizations as `package:pickforge/l10n/generated/app_localizations.dart`.
- Add or update ARB entries for new user-visible strings when editing UI.
