# PickForge — instructions for Claude

The repository conventions live in [`AGENTS.md`](AGENTS.md) — read it first;
everything there applies to you.

## Quick reference

- **Tooling:** FVM is pinned (`.fvmrc`, Flutter 3.41.7). Always use `fvm flutter`
  / `fvm dart`. Standard checks: `fvm flutter analyze`, `fvm flutter test`,
  `fvm dart format --set-exit-if-changed .`. Codegen:
  `fvm dart run build_runner build --delete-conflicting-outputs` and
  `fvm flutter gen-l10n`.
- **Architecture:** feature-first `lib/features/<feature>/`, infra in
  `lib/core/`, reusable design system in `lib/shared/`. BLoC/Cubit + GoRouter +
  GetIt/Injectable + Drift. Don't hand-edit generated files.

## Design system (do this before touching UI)

Read [`docs/design-system/`](docs/design-system/README.md). The ten rules in its
README are binding. In short:

1. Tokens only — no raw hex / sizes / radii / durations in widgets.
2. One ember per composition (`PickforgeColors.ember`).
3. Geist is the default font; Geist Mono is the machine voice.
4. Compose with `lib/shared/components/` (MonoEyebrow, EmberButton, StatusPill,
   SelectionBracket, HairlinePanel, BlueprintGrid).
5. One easing (`PickforgeMotion.forge`); every animation honors `ReduceMotion`.
6. Embedded terminal must render Claude/Codex with correct colors and no
   underlines (`docs/design-system/terminal.md`).
7. Verify UI with the golden tests (`test/goldens/`), reviewing the PNGs.

## Agent models

Spawned agents are pinned to fast models by default (Claude → Haiku 4.5,
Codex → GPT-5.3 Codex Spark) via `lib/core/agent/agent_model_settings.dart` and
the Settings → "Agent models" picker. Prefer these (and GPT-5.4 Mini) for
testing/dogfooding to keep runs cheap.
