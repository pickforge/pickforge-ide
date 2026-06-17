# Milestone 1 · Slice 1D — Storage settings UI, override persistence, copy-on-switch, docs

Final slice of Milestone 1. Codex drafted the brief; this is the contract +
confirmed decisions. Depends on 1A/1B/1C (done, suite green at 832). Invariants:
FVM, infra in `lib/core`, features in `lib/features`, injectable+get_it (build_runner
after annotations), Drift persistence, design-system rules are BINDING for UI
(tokens only, one ember, reuse `lib/shared/components/`, honor ReduceMotion, review
goldens). Shell: `command grep`, `find`.

## Confirmed decisions

- **Persistence**: Drift `project_settings` += two nullable columns
  `context_storage_mode TEXT?`, `context_storage_custom_path TEXT?`; schemaVersion
  9 → 10 (additive migration; null rows → auto-detect = legacy-safe).
- **Mode switch**: **offer to copy existing data** from the old resolved location to
  the new one (leave originals in place; never delete). Confirmation dialog shows
  counts (e.g. "Copy N chats + M runs to Home?").

## Progress (implemented by Claude; Codex review pending after Stage 4/5)

- **Stage 1 (persistence) — DONE, green.** `project_settings` += `context_storage_mode`,
  `context_storage_custom_path`; schema v9→v10 (defensive, table-guarded migration);
  DAO `setContextStorage`; repo `get/setContextStorageLocation`; v9→v10 migration test;
  repo round-trip tests; `pickforge_database_v10.json` snapshot.
- **Stage 2 (override resolution) — DONE, green.** `resolve()` precedence: explicit
  `location:` → persisted override → auto-detect. **DI gotcha fixed**: the override is
  read via a LAZY `settingsProvider` closure (registered manually in `injection.dart`
  before `getIt.init()`), NOT an injected repo — otherwise eager singletons
  (`SkillStore`, `AgentLauncher`) construct `ContextStorageService` at init and force the
  Drift DB (`path_provider`) to build, which crashes headless tests. A failed override
  read falls back to auto-detect (resolution is load-bearing). 5 override-precedence tests.
- **Stage 3 (copy-on-switch) — DONE, green.** `ContextStorageMigrator` with `plan()`
  (counts) + `copy()` — copies top-level context files (skips the `.gitignore` marker)
  and each subtree (chats/runs/pastes/skills/prompt-templates), never deletes, never
  clobbers. 4 tests. Full suite green at **846 passing**.

- **Stage 4 (settings cubit + UI + dialog) — DONE, green.** `SettingsCubit` now
  injects `ContextStorageService` + `ContextStorageMigrator`; `load` surfaces the
  resolved mode + `resolvedContextDir`; `setContextStorageLocation` validates via
  `ensure` before persisting (errors surfaced, not persisted) and exposes a copy
  offer when the old location holds data. New
  `lib/features/settings/view/context_storage_settings.dart`
  (`SegmentedButton<ContextStorageMode>` Home/Project-local/Custom + folder chooser
  via `file_selector.getDirectoryPath` + inline project-local repo-write warning +
  resolved absolute dir + ReduceMotion-aware copy-confirm dialog), wired into
  `settings_view.dart`. `ContextStorageMigrator` registered via a `StorageModule`.
  l10n strings added + `gen-l10n`. Tests: 4 cubit storage tests + 3 storage widget
  tests + a `context_storage_settings` golden (baseline regenerated; `settings`
  baseline updated to include the new section).
- **Stage 5 (docs) — DONE.** `README.md` (default Home, opt-in project-local,
  copy-on-switch), `docs/architecture/storage.md` (Home/custom layout first,
  marker rule project-local-only, boundaries + no-live-migration), `embedded-terminal.md`
  ("resolved context storage" + `PICKFORGE_*` env table), `pickforge-mcp.md`
  (env-based discovery; no assumed `.pickforge`). `target-adapters.md` deferred to M2.

Full suite green at **854 passing** (was 846). Then Codex review of the whole 1D diff.

## Build order (implement in stages, verify each)

### Stage 1 — Persistence
- `lib/core/drift/tables/project_settings.dart`: add the two nullable text columns.
- `lib/core/drift/pickforge_database.dart`: bump `schemaVersion` 9→10; v9→v10
  migration via `m.addColumn(...)` for both columns.
- `lib/core/drift/dao/project_settings_dao.dart`: read/write methods for the columns.
- `lib/core/settings/project_settings_repository.dart`:
  `getContextStorageLocation(projectRoot)` / `setContextStorageLocation(projectRoot, ContextStorageLocation?)`
  using `ContextStorageLocation.fromWire(mode, customPath: ...)`.
- Regenerate: `pickforge_database.g.dart`, `project_settings_dao.g.dart`, and the
  schema dump `test/core/drift/schema/pickforge_database_v10.json` (drift_dev).
- Tests: DAO column round-trip; repository get/set; `migration_v9_to_v10_test.dart`
  (v9 rows survive with null new columns).

### Stage 2 — Override resolution in the service
- `lib/core/storage/context_storage_service.dart`: `resolve()` precedence becomes
  (1) explicit `location:` param, (2) persisted DB override (via injected
  `ProjectSettingsRepository?`), (3) auto-detect. The repo is OPTIONAL (nullable) so
  the existing `forTesting` ctor + the MCP standalone `ContextStorageService()` keep
  working with no DB lookup. Reading the override is async (resolve already async).
- `lib/core/di/injection.dart` / module: inject `ProjectSettingsRepository` into the
  DI-provided `ContextStorageService`. (The separate MCP process keeps the no-repo
  ctor; it discovers via `PICKFORGE_CONTEXT_DIR` env, not the DB.)
- Tests (`context_storage_service_test.dart`): persisted home beats legacy marker;
  persisted project-local beats clean default; persisted custom resolves; explicit
  `location:` still wins; null repo → auto-detect unchanged (parity).

### Stage 3 — Copy-on-switch service
- New `lib/core/storage/context_storage_migrator.dart` (or similar):
  `CopyPlan plan(ResolvedContextDirectory from, ResolvedContextDirectory to)` →
  counts of chats/runs and presence of context files/screenshots/pastes; and
  `Future<void> copy(from, to)` that recursively copies context files, `chats/`,
  `runs/`, `pastes/`, `skills/`, `prompt-templates/` from old → new, NEVER deleting
  originals, skipping when source absent, not clobbering newer dest files (or
  overwrite — pick and document; recommend skip-if-exists to avoid data loss).
- Pure + testable with temp dirs. Tests: plan counts; copy creates dest tree; absent
  source no-ops; originals retained.

### Stage 4 — Settings cubit + UI + dialog
- `lib/features/settings/cubit/settings_cubit.dart` (+ state): inject
  `ContextStorageService` + `ProjectSettingsRepository` (+ migrator). Load surfaces
  the resolved/effective mode + resolvedContextDir. `setContextStorageLocation(loc)`:
  `ensure(projectRoot, location: loc)` to validate (surface errors, don't persist on
  failure); on success persist; if the OLD location has data, expose a copy offer.
- New `lib/features/settings/view/context_storage_settings.dart`: `SegmentedButton<ContextStorageMode>`
  (Home / Project-local / Custom), custom-folder chooser via `file_selector.getDirectoryPath`,
  inline WARNING when project-local writes into the repo, shows the resolved absolute
  context dir. Wire into `settings_view.dart`. Reuse `SettingsSection`/`SettingsField`/
  `settingsCompactButtonStyle` (pattern: `device_run_settings.dart`). Tokens only.
- Copy-on-switch confirmation dialog (design-system; honor ReduceMotion): shows counts
  from the migrator plan; on confirm runs copy; leaves originals.
- l10n: add strings to `lib/l10n/app_en.arb`; run `fvm flutter gen-l10n`.
- Tests: cubit (load surfaces mode; validate-before-persist; failure leaves state;
  copy offered when old data exists); widget tests (home selected; project-local
  warning visible; custom path shown); golden for the new settings section
  (`--update-goldens`, review PNG).

### Stage 5 — Docs
- `README.md` (~42-67): default Home storage + opt-in project-local; transcripts no
  longer always under `.pickforge`.
- `docs/architecture/storage.md` (~7-71): Home/custom layout first; `.gitignore`
  marker rule applies to project-local only; update boundaries.
- `docs/architecture/pickforge-mcp.md` (~77-120): env-based discovery; don't imply
  `.pickforge` always exists.
- `docs/architecture/embedded-terminal.md` (~49-75): "resolved context storage"; list
  the `PICKFORGE_*` env vars.
- (Defer `docs/architecture/target-adapters.md` to Milestone 2.)

## Edge cases (from brief + decision)
- project-local selected but `.pickforge/` lacks the marker → `ensure` throws → show
  error, do not persist.
- custom path inside the repo → allow after the warning.
- custom path deleted later → `ensure` recreates; surface FS errors, no silent fallback.
- active terminals/runs keep inherited paths until respawn (no live migration).
- copy is best-effort, additive, originals retained; switching back still shows old data.

## Verification
```
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter gen-l10n
fvm dart run drift_dev schema dump lib/core/drift/pickforge_database.dart test/core/drift/schema/pickforge_database_v10.json
fvm dart format --set-exit-if-changed .
fvm flutter analyze
fvm flutter test
fvm flutter test test/goldens/ --update-goldens   # review PNGs
```
