# Milestone 1 · Slice 1A — Context storage core (additive only)

Part of `plans/001-multi-framework-agent-suite-roadmap.md`. This slice adds the
storage-resolution core. It is **additive only**: no existing caller is rewired
(that is Slice 1B). All existing tests must still pass unchanged.

## Project invariants (must follow)

- Flutter desktop app, FVM-pinned. Always use `fvm dart` / `fvm flutter`.
- Infra lives under `lib/core/`. This slice goes under `lib/core/storage/`.
- DI is get_it + injectable. `lib/core/di/injection.config.dart` is GENERATED —
  never hand-edit it. After adding a `@lazySingleton`, run
  `fvm dart run build_runner build --delete-conflicting-outputs` to regenerate.
- Never hand-edit generated files (`*.g.dart`, `*.freezed.dart`, `*.config.dart`).
- Style: 2-space indent, single quotes, trailing commas, `import 'package:path/path.dart' as p;`,
  value types extend `Equatable`. No comments that merely restate code. Match repo style.
- Do NOT add any new pub dependency. `equatable` and `path` are already present;
  `crypto` is NOT a direct dependency — do not use it (use the FNV-1a hash below).
- ADDITIVE ONLY: the only acceptable change to a pre-existing file is the
  auto-regenerated `injection.config.dart`.

## Background

Today everything is written to `<projectRoot>/.pickforge/`.
`lib/core/projects/pickforge_project_directory.dart` is the source of truth:
`PickforgeProjectDirectory.ensure(projectRoot)` returns `<projectRoot>/.pickforge`,
enforcing the marker rule — the dir is accepted only if it contains a `.gitignore`
whose exact contents are `*\n`, else it throws `PickforgeDirConflictException`; on
create it writes that `*\n` marker. It also throws if `projectRoot` does not exist.
`PickforgeProjectDirectory.ensureDirectory(Directory)` applies the marker rule to a
given directory.

We add resolution to one of THREE storage locations, defaulting via safe
auto-detection, without changing current behavior.

## Files to create

### `lib/core/storage/context_storage_location.dart`

- `enum ContextStorageMode { pickforgeHome, projectLocal, customPath }`
- `class ContextStorageLocation extends Equatable`:
  - private const `_(this.mode, this.customPath)`
  - named const ctors `.pickforgeHome()`, `.projectLocal()`, `.custom(String path)`
  - fields `final ContextStorageMode mode; final String? customPath;`
  - `String get wireName` → `'home' | 'project-local' | 'custom'` (used for the
    future `PICKFORGE_STORAGE_MODE` env var and persistence)
  - `static ContextStorageLocation? fromWire(String? wire, {String? customPath})`
    — inverse of `wireName`; `'custom'` returns null when customPath is null;
    unknown returns null
  - `props => [mode, customPath]`

### `lib/core/storage/pickforge_home.dart`

- `class PickforgeHome` (private const ctor):
  - `static String resolve({Map<String, String>? environment, bool? isWindows})`
    - env defaults to `Platform.environment`; isWindows to `Platform.isWindows`
    - if `env['PICKFORGE_HOME']` is non-empty (trimmed) → return it
    - Windows: base = non-empty `env['USERPROFILE']` else
      `p.join(env['HOMEDRIVE'] ?? '', env['HOMEPATH'] ?? '')`; return `p.join(base, '.pickforge')`
    - POSIX: home = trimmed `env['HOME']`; if null/empty throw
      `const PickforgeHomeUnavailableException()`; else `p.join(home, '.pickforge')`
- `class PickforgeHomeUnavailableException implements Exception` — const ctor, clear `toString()`.

### `lib/core/storage/project_id.dart`

- `class ProjectId` (private const ctor):
  - `static String forRoot(String projectRoot, {String? repoRemoteUrl})`
    - `canonical = p.canonicalize(projectRoot)`
    - basis = canonical, or `'<canonical> <remote>'` (space-joined) when
      repoRemoteUrl is non-empty (trimmed)
    - `hash = _stableHash(basis)` (16 hex chars)
    - `slug = _slug(p.basename(canonical))`
    - return `slug.isEmpty ? hash : '<slug>-<hash>'`
  - `_slug`: lowercase → replace runs of `[^a-z0-9]+` with `-` → trim leading/trailing `-`
  - `_stableHash`: deterministic FNV-1a 64-bit over `utf8.encode(input)`:
    - start `0xcbf29ce484222325`, prime `0x100000001b3`
    - per byte: `hash ^= byte; hash = (hash * prime) & 0xFFFFFFFFFFFFFFFF;`
    - return as UNSIGNED 16 hex chars via two 32-bit halves (NEVER a leading
      `-`): `final high = (hash >>> 32) & 0xFFFFFFFF; final low = hash & 0xFFFFFFFF;
      return high.toRadixString(16).padLeft(8, '0') + low.toRadixString(16).padLeft(8, '0');`
      Do NOT use `hash.toUnsigned(64).toRadixString(16)` — on a 64-bit Dart int
      that is a no-op and emits a leading `-` for high-bit-set hashes.
    - MUST be stable across runs/platforms — do NOT use `String.hashCode`
      (randomized per isolate in Dart). Output is always `^[0-9a-f]{16}$`.

### `lib/core/storage/resolved_context_directory.dart`

- `class ResolvedContextDirectory extends Equatable`, const ctor, final fields:
  `projectRoot`, `projectId`, `storageLocation` (ContextStorageLocation),
  `contextDir` (absolute), `runsDir` (absolute), `chatsDir` (absolute),
  `isProjectLocal` (bool).
- `String get ipcSockPath => p.join(contextDir, 'ipc.sock-path');`
- `props` lists all seven fields.

### `lib/core/storage/context_storage_service.dart`

- `@lazySingleton class ContextStorageService`:
  - default `ContextStorageService();`
  - `@visibleForTesting ContextStorageService.forTesting({Map<String, String>? environment, bool? isWindows})`
    storing nullable `_environment`, `_isWindows`; default ctor leaves them null
    so production reads `Platform.environment` / `Platform.isWindows` at call time.
    Import `package:meta/meta.dart`.
  - `Future<ResolvedContextDirectory> resolve(String projectRoot, {ContextStorageLocation? location})`:
    - `effective = location ?? _autoDetect(projectRoot)`
    - `id = ProjectId.forRoot(projectRoot)`
    - per mode:
      - projectLocal: base = `p.join(projectRoot, '.pickforge')`; contextDir = base;
        runsDir = `p.join(base, 'runs')`; chatsDir = `p.join(base, 'chats')`
      - pickforgeHome: base = `p.join(PickforgeHome.resolve(environment: _environment, isWindows: _isWindows), 'projects', id)`;
        contextDir = `p.join(base, 'context')`; runsDir = `p.join(base, 'runs')`;
        chatsDir = `p.join(base, 'chats')`
      - customPath: base = `p.join(effective.customPath!, 'projects', id)`; same
        sub-layout as home
    - `isProjectLocal: effective.mode == ContextStorageMode.projectLocal`
  - `ContextStorageLocation _autoDetect(String projectRoot)`: if
    `File(p.join(projectRoot, '.pickforge', '.gitignore'))` exists AND contents
    == `'*\n'` → `const ContextStorageLocation.projectLocal()`; else
    `const ContextStorageLocation.pickforgeHome()` (keeps existing project-local
    users compatible with zero migration).
  - `Future<ResolvedContextDirectory> ensure(String projectRoot, {ContextStorageLocation? location})`:
    - first: `if (!Directory(projectRoot).existsSync()) throw PickforgeDirConflictException('Project folder does not exist: $projectRoot');`
      (import the exception from `pickforge_project_directory.dart`)
    - `resolved = await resolve(projectRoot, location: location)`
    - if `resolved.isProjectLocal`: `await PickforgeProjectDirectory.ensure(projectRoot);`
      (enforces marker conflict rule, creates `<root>/.pickforge`; runs/chats stay
      lazily created by their writers — preserves current flat-layout behavior)
    - else (home/custom): create all three of `resolved.contextDir`,
      `resolved.runsDir`, `resolved.chatsDir` recursively (each if `!existsSync`),
      writing NO `.gitignore` marker. A missing PickForge Home / custom root is
      CREATED here (not an error) — only a missing `projectRoot` throws.
    - return resolved

## Tests to create under `test/core/storage/`

Use `flutter_test`. Mirror `test/core/agent/pickforge_context_writer_test.dart`
(systemTemp.createTemp + tearDown delete). For home/custom, ALWAYS point
`PICKFORGE_HOME` at a temp dir via `ContextStorageService.forTesting(environment:
{'PICKFORGE_HOME': tmpHome.path})` so tests never touch the real `~/.pickforge`.

- `context_storage_location_test.dart`: wireName per mode; fromWire round-trips;
  `fromWire('custom')` with null customPath → null; `fromWire('garbage')` → null; equality.
- `pickforge_home_test.dart`: PICKFORGE_HOME override wins; POSIX HOME →
  `<home>/.pickforge`; Windows USERPROFILE → `<userprofile>\.pickforge`; missing
  HOME on POSIX throws `PickforgeHomeUnavailableException`.
- `project_id_test.dart`: deterministic; different roots → different ids; id
  contains a slug from basename; same root+same remote stable; changing remote
  changes id; slug lowercases and dashes non-alphanumerics.
- `context_storage_service_test.dart`:
  - auto-detect projectLocal when `.pickforge/.gitignore` == `*\n` exists
    (contextDir == `<root>/.pickforge`)
  - auto-detect pickforgeHome for a clean project (contextDir/runsDir/chatsDir
    under `<tmpHome>/projects/<id>/{context,runs,chats}`)
  - explicit `.custom(tmp)` → contextDir under `<tmp>/projects/<id>/context`
  - explicit `.projectLocal()` → flat `.pickforge` paths even without a marker
  - `ensure()` home mode creates contextDir, writes NO `.gitignore` marker
  - `ensure()` project-local creates `<root>/.pickforge` with `.gitignore` == `*\n`
  - `ensure()` project-local with an existing `.pickforge` lacking the marker
    throws `PickforgeDirConflictException`
  - `ensure()` throws `PickforgeDirConflictException` when projectRoot is missing

## Verification (run, fix until green, report exact results)

1. `fvm dart run build_runner build --delete-conflicting-outputs`
2. `fvm dart format .`
3. `fvm flutter analyze` (0 errors)
4. `fvm flutter test test/core/storage/`
5. `fvm flutter test test/core/agent/pickforge_context_writer_test.dart test/core/projects/ test/core/emulator/ test/core/mcp/`
   (regression — must stay green, proving additive)

The only modified pre-existing file must be `injection.config.dart`.
