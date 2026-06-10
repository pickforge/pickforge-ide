# Pickforge Repository Instructions

These instructions apply to the entire repository. They are inferred from the current codebase and should override personal/global defaults when they conflict.

## Project overview

Pickforge is a local Flutter desktop app for selecting widgets in a running Flutter app, writing widget context into `.pickforge/`, and pasting that context into an embedded terminal. The terminal is shell-first: it runs the user's `$SHELL` in the project root, with quick-launch chips that type agent CLI commands (claude/codex/…) for the user to run.

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

## Design system & branding

PickForge has a first-class design system — read
[`docs/design-system/`](docs/design-system/README.md) before any UI work, and
keep new UI consistent with it. It implements the brand defined in
[`../branding-visual/`](../branding-visual).

- **Tokens only — never raw values.** Use `PickforgeColors`, `PickforgeSpacing`,
  `PickforgeElevation` (`lib/shared/theme/`) and `PickforgeMotion`
  (`lib/shared/motion/`). No raw hex, font sizes, radii, or `Duration`s in
  widgets. Type comes from `Theme.of(context).textTheme.*` (Geist) or
  `PickforgeText.*` (Geist Mono); don't set `fontFamily` by hand.
- **One ember per composition.** `PickforgeColors.ember` is the only accent —
  reserve it for the single most important element (primary CTA, active/selected,
  live status). Everything else is surface / text / hairline / semantic status.
- **Compose with the signature components** in `lib/shared/components/`
  (`MonoEyebrow`, `EmberButton`, `StatusPill`, `EmberDot`, `SelectionBracket`,
  `HairlinePanel`, `BlueprintGrid`) before hand-rolling UI. Section labels are
  `MonoEyebrow`.
- **Motion uses one easing** (`PickforgeMotion.forge`) and **every animation
  honors reduced motion** via `ReduceMotion` (`lib/shared/motion/reduce_motion.dart`).
- **The theme is the single source of truth** (`PickforgeTheme` in `main.dart`),
  dark-first; it fully populates the M3 `ColorScheme` so Material defaults never
  leak. Don't reintroduce raw `ColorScheme`/`TextStyle` defaults.
- **Embedded terminal:** Claude/Codex must render with correct colors and no
  stray underlines — see [`docs/design-system/terminal.md`](docs/design-system/terminal.md).
  Default font `GeistMono`, theme `pickforgeEmber`.
- **Verify visuals via goldens.** After UI changes run
  `fvm flutter test test/goldens/ --update-goldens`, then review the PNGs under
  `test/goldens/baselines/` (they cover every key screen + a component gallery +
  the terminal) before committing.

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
