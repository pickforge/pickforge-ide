# Pickforge Repository Memory

- Pickforge is a Flutter desktop app for widget-level AI context: select a widget in a running Flutter app, write context into `.pickforge/`, and send the prompt to an embedded agent CLI terminal.
- The app is a single Flutter package with feature-first folders under `lib/features`, infrastructure under `lib/core`, and shared UI/theme/motion code under `lib/shared`.
- Flutter is pinned through FVM (`.fvmrc` currently uses Flutter `3.41.7`); repo commands should use `fvm dart` and `fvm flutter`.
- The app uses `flutter_bloc`/Cubit for feature state, `get_it` + `injectable` for DI, `go_router` for routing, Drift for persistence, Freezed/JSON/generated Drift code for models and database plumbing, and ARB-based Flutter localization.
- Generated `.freezed.dart`, `.g.dart`, and `injection.config.dart` files are intentionally tracked. `lib/l10n/generated/` is ignored locally and generated from ARB files.
- Validation is defined by `scripts/check.sh`: format, analyze, and test through FVM. CI also runs dependency install, codegen drift checks, and coverage tests.
- Tests mirror source folders and use `flutter_test`, `test`, `bloc_test`, and `mocktail`. Emulator E2E coverage is opt-in via `PICKFORGE_E2E_AVD`.
