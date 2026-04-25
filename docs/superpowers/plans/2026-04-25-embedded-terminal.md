# Pickforge — Embedded Terminal & Project Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the external-terminal launching flow with a Pickforge-native three-pane shell: left rail (projects + chats), middle pane (forge compose strip + embedded PTY terminal), right pane (widget inspector). Each chat is a persistent agent-CLI session that survives chat switches and replays scrollback across app restarts.

**Architecture:** All changes land inside the existing feature-first single-package layout (`lib/features/*` + `lib/core/*`). A new `workbench` feature contains the persistent shell + cubits; a refactored `core/terminal` subsystem owns PTY lifecycle, scrollback persistence, and replay. The old terminal-profile registry, wrapper-script terminal-launcher, `connection` route, and `dock` route are deleted; the existing widget-picker / VM-service / agent-profile code is preserved and rehosted inside the new shell.

**Tech Stack:** Flutter desktop (Linux/macOS/Windows), Dart 3, Bloc + GetIt + Injectable, Drift (SQLite), GoRouter, `xterm` + `flutter_pty` (PTY), `multi_split_view` (resizable panes), `file_selector` (folder picker), `flutter_animate` + `animations` + `rive` (motion), `mocktail` + `bloc_test` (tests). Pinned via FVM (`.fvmrc` → Flutter 3.41.7).

**Spec:** `docs/superpowers/specs/2026-04-25-embedded-terminal-design.md`

---

## Navigation

- [Phase 1 — Drift schema + repositories](#phase-1--drift-schema--repositories) · Tasks 1–7
- [Phase 2 — Pubspec additions + build smoke](#phase-2--pubspec-additions--build-smoke) · Tasks 8–9
- [Phase 3 — Core terminal subsystem](#phase-3--core-terminal-subsystem) · Tasks 10–17
- [Phase 4 — AgentLauncher refactor](#phase-4--agentlauncher-refactor) · Tasks 18–21
- [Phase 5 — Delete external-terminal subsystem](#phase-5--delete-external-terminal-subsystem) · Tasks 22–24
- [Phase 6 — Workbench feature](#phase-6--workbench-feature) · Tasks 25–32
- [Phase 7 — Animation pass](#phase-7--animation-pass) · Tasks 33–37
- [Phase 8 — Router + Settings](#phase-8--router--settings) · Tasks 38–39
- [Phase 9 — Goldens + integration test](#phase-9--goldens--integration-test) · Tasks 40–42
- [Phase 10 — Documentation](#phase-10--documentation) · Tasks 43–44

---

## Global conventions

These apply to every task. Do not repeat per-task unless deviating.

- **Toolchain:** every Dart/Flutter command runs as `fvm dart …` or `fvm flutter …` (this repo pins Flutter via `.fvmrc`).
- **Commits:** conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`), English, no AI/Claude/Co-Authored-By footers, no signing.
- **TDD:** write the failing test first → run it to confirm it fails → implement minimal code → run it to confirm it passes → commit. Every task follows this cadence unless explicitly noted.
- **Code gen:** any task that edits `freezed`, `json_serializable`, `drift`, or `injectable` annotations runs `fvm dart run build_runner build --delete-conflicting-outputs` before its commit step.
- **Lint/format:** every commit passes `fvm dart format .` and `fvm flutter analyze` with zero issues.
- **File size:** target ≤ 200 lines per Dart file. Split when a file outgrows its single responsibility.
- **L10n:** every new user-visible string goes through `context.l10n.someKey`. Add the English ARB entry in the same task that introduces the string.
- **Scope discipline:** do not touch files outside the lists in each task.
- **Spec is authoritative:** `docs/superpowers/specs/2026-04-25-embedded-terminal-design.md`. If a question arises that the plan doesn't answer, defer to the spec.

## Pre-execution readiness corrections

This plan has been reviewed against the current repo state on 2026-04-25. Do not start implementation until these corrections have been applied inline while executing the affected tasks.

- **Task 10:** `FlutterPtyAdapter` must compile against `flutter_pty 0.4.2`. Add `dart:typed_data` if using `Uint8List`. Pub.dev documents `pty.kill()` with no signal parameter; if the package API does not accept a signal, map `PtyProcess.kill([signal])` to `_pty.kill()` and document that signal-specific termination is handled at the `PtySession` policy layer only when the adapter supports it.
- **Task 14:** replace invalid Dart string multiplication (`'a' * 30`) with `List.filled(30, 'a').join()`. The sidecar file must match the spec: `transcript.spans.bin` is binary and varint-framed, not CSV text.
- **Tasks 14, 15, 30, 42:** add the missing live-output recording path. A `TranscriptRecorder` must subscribe to each active `PtySession.output` stream before UI integration; the integration test depends on this.
- **Task 18:** do not copy logic from `WrapperScriptGenerator`; it only generates wrapper scripts. Extract `.pickforge/` file-writing behavior from `PickforgeDirManager` + `AgentLauncher`, preserving the existing `.pickforge/.gitignore` conflict check from `PickforgeDirManager`.
- **Task 20:** refactor against current repo APIs: `AgentLauncher` currently depends on `AgentProfileRegistry`, `TerminalProfileRegistry`, `PickforgeDirManager`, `SkillStore`, `WidgetContextRenderer`, and `WrapperScriptGenerator`. Remove terminal-registry/script-generator/process-spawner dependencies only after tests prove `prepareContext` preserves current `.pickforge/` output.
- **Task 30:** `PtySessionPool.activate(...)` is core behavior, not UI behavior. Add it to `PtySessionPool` with unit tests before wiring `ChatWorkbenchPanel`.
- **Tasks 25-30, 38:** persist and restore cold-open state. `ProjectSettings.lastChatId` must be written on chat select/new-chat and read when loading `/workbench`. Project selection must default to most-recent `Projects.lastOpenedAt`.
- **Tasks 2-6:** ensure Drift migration tests exercise a realistic v1 schema and foreign-key behavior. If cascade-delete relies on SQLite FKs, explicitly enable or verify FK enforcement in the test database.
- **Task 7:** add DI wiring for Drift DAOs/repositories. `@lazySingleton` repositories cannot be generated unless their DAO dependencies are injectable or provided by a module.
- **Tasks 26-42:** replace shorthand instructions with concrete test code and implementation snippets before assigning those tasks. Current late-phase UI/animation/golden tasks are not agent-ready.
- **Task 37:** `.riv` asset authoring is not reliably agent-executable. Either provide assets before execution or replace Rive-dependent steps with deterministic placeholder vector/animation widgets, then wire real Rive assets in a follow-up task.

---

## Phase 1 — Drift schema + repositories

Goal: extend the existing Drift database with `Projects` and `Chats` tables, drop `defaultTerminalId`, add `lastChatId` / `paneSizes` columns, and ship a migration that synthesizes a `Projects` row per existing `ProjectSettings` row. Then expose two repositories (`ProjectsRepository`, `ChatsRepository`) that the rest of the app will consume.

### Task 1 — Add `uuid` package

**Files:**
- Modify: `pubspec.yaml`

- [ ] **Step 1: Add `uuid: ^4.5.1` to `dependencies` (alphabetical order, near `path` and `vm_service`).**

```yaml
  uuid: ^4.5.1
```

- [ ] **Step 2: Resolve packages.**

Run: `fvm flutter pub get`
Expected: success, lockfile updated.

- [ ] **Step 3: Commit.**

```bash
git add pubspec.yaml pubspec.lock
git commit -m "chore: add uuid for chat ids"
```

### Task 2 — `Projects` Drift table + dao

**Files:**
- Create: `lib/core/drift/tables/projects.dart`
- Create: `lib/core/drift/dao/projects_dao.dart`
- Create: `test/core/drift/dao/projects_dao_test.dart`

- [ ] **Step 1: Write the failing dao test.**

`test/core/drift/dao/projects_dao_test.dart`:

```dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/dao/projects_dao.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  late PickforgeDatabase db;
  late ProjectsDao dao;

  setUp(() {
    db = PickforgeDatabase.forTesting(NativeDatabase.memory());
    dao = ProjectsDao(db);
  });

  tearDown(() async => db.close());

  test('upsert then read returns the row', () async {
    await dao.upsert(
      projectRoot: '/tmp/app',
      displayName: 'app',
      now: DateTime(2026, 4, 25, 14, 30),
    );

    final rows = await dao.allOrderedByLastOpened();

    expect(rows, hasLength(1));
    expect(rows.single.projectRoot, '/tmp/app');
    expect(rows.single.displayName, 'app');
  });

  test('upsert is idempotent on projectRoot', () async {
    await dao.upsert(projectRoot: '/tmp/x', displayName: 'x', now: DateTime(2026, 4, 25));
    await dao.upsert(projectRoot: '/tmp/x', displayName: 'x renamed', now: DateTime(2026, 4, 26));

    final rows = await dao.allOrderedByLastOpened();
    expect(rows, hasLength(1));
    expect(rows.single.displayName, 'x renamed');
  });

  test('remove deletes the row', () async {
    await dao.upsert(projectRoot: '/tmp/y', displayName: 'y', now: DateTime(2026, 4, 25));
    await dao.remove('/tmp/y');
    expect(await dao.allOrderedByLastOpened(), isEmpty);
  });
}
```

- [ ] **Step 2: Run the test (should fail to compile — `Projects` and `ProjectsDao` don't exist yet).**

Run: `fvm flutter test test/core/drift/dao/projects_dao_test.dart`
Expected: FAIL — "Target of URI doesn't exist".

- [ ] **Step 3: Create the table.**

`lib/core/drift/tables/projects.dart`:

```dart
import 'package:drift/drift.dart';

@DataClassName('ProjectRow')
class Projects extends Table {
  TextColumn get projectRoot => text()();
  TextColumn get displayName => text()();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get lastOpenedAt => dateTime()();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();

  @override
  Set<Column<Object>> get primaryKey => {projectRoot};
}
```

- [ ] **Step 4: Create the dao.**

`lib/core/drift/dao/projects_dao.dart`:

```dart
import 'package:drift/drift.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/drift/tables/projects.dart';

part 'projects_dao.g.dart';

@DriftAccessor(tables: [Projects])
class ProjectsDao extends DatabaseAccessor<PickforgeDatabase> with _$ProjectsDaoMixin {
  ProjectsDao(super.db);

  Future<void> upsert({
    required String projectRoot,
    required String displayName,
    required DateTime now,
  }) {
    return into(projects).insertOnConflictUpdate(
      ProjectsCompanion(
        projectRoot: Value(projectRoot),
        displayName: Value(displayName),
        createdAt: Value(now),
        lastOpenedAt: Value(now),
      ),
    );
  }

  Future<void> touch(String projectRoot, DateTime now) {
    return (update(projects)..where((p) => p.projectRoot.equals(projectRoot)))
        .write(ProjectsCompanion(lastOpenedAt: Value(now)));
  }

  Future<void> rename(String projectRoot, String displayName) {
    return (update(projects)..where((p) => p.projectRoot.equals(projectRoot)))
        .write(ProjectsCompanion(displayName: Value(displayName)));
  }

  Future<void> remove(String projectRoot) {
    return (delete(projects)..where((p) => p.projectRoot.equals(projectRoot))).go();
  }

  Future<List<ProjectRow>> allOrderedByLastOpened() {
    return (select(projects)
          ..orderBy([
            (p) => OrderingTerm(expression: p.sortOrder),
            (p) => OrderingTerm(expression: p.lastOpenedAt, mode: OrderingMode.desc),
          ]))
        .get();
  }
}
```

- [ ] **Step 5: Wire the table into `PickforgeDatabase` (no schema bump yet — that lands in Task 6).**

Modify `lib/core/drift/pickforge_database.dart`:

```dart
import 'package:pickforge/core/drift/dao/projects_dao.dart';
import 'package:pickforge/core/drift/tables/projects.dart';

@DriftDatabase(
  tables: [ProjectSettings, PickHistory, AgentRunLog, Projects],
  daos: [ProjectSettingsDao, PickHistoryDao, AgentRunLogDao, ProjectsDao],
)
```

- [ ] **Step 6: Regenerate.**

Run: `fvm dart run build_runner build --delete-conflicting-outputs`
Expected: `projects_dao.g.dart` and updated `pickforge_database.g.dart`.

- [ ] **Step 7: Run the test.**

Run: `fvm flutter test test/core/drift/dao/projects_dao_test.dart`
Expected: PASS (3 tests).

- [ ] **Step 8: Format, analyze, commit.**

```bash
fvm dart format .
fvm flutter analyze
git add lib/core/drift/tables/projects.dart \
        lib/core/drift/dao/projects_dao.dart \
        lib/core/drift/dao/projects_dao.g.dart \
        lib/core/drift/pickforge_database.dart \
        lib/core/drift/pickforge_database.g.dart \
        test/core/drift/dao/projects_dao_test.dart
git commit -m "feat(drift): add Projects table and dao"
```

### Task 3 — `Chats` Drift table + dao

**Files:**
- Create: `lib/core/drift/tables/chats.dart`
- Create: `lib/core/drift/dao/chats_dao.dart`
- Create: `test/core/drift/dao/chats_dao_test.dart`

- [ ] **Step 1: Write failing dao tests.**

`test/core/drift/dao/chats_dao_test.dart`:

```dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/dao/chats_dao.dart';
import 'package:pickforge/core/drift/dao/projects_dao.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  late PickforgeDatabase db;
  late ChatsDao dao;
  late ProjectsDao projectsDao;

  setUp(() async {
    db = PickforgeDatabase.forTesting(NativeDatabase.memory());
    await db.customStatement('PRAGMA foreign_keys = ON;');
    dao = ChatsDao(db);
    projectsDao = ProjectsDao(db);
    await projectsDao.upsert(
      projectRoot: '/tmp/app',
      displayName: 'app',
      now: DateTime(2026, 4, 25),
    );
  });

  tearDown(() async => db.close());

  test('insert then byProject returns the chat', () async {
    final id = await dao.insert(
      projectRoot: '/tmp/app',
      title: 'Chat 1',
      agentId: 'claude-code',
      now: DateTime(2026, 4, 25, 14),
    );
    expect(id, isNotEmpty);

    final rows = await dao.byProject('/tmp/app');
    expect(rows, hasLength(1));
    expect(rows.single.title, 'Chat 1');
    expect(rows.single.agentId, 'claude-code');
  });

  test('cascade delete removes chats when project removed', () async {
    await dao.insert(
      projectRoot: '/tmp/app',
      title: 'Chat 1',
      agentId: 'codex',
      now: DateTime(2026, 4, 25),
    );
    await projectsDao.remove('/tmp/app');
    expect(await dao.byProject('/tmp/app'), isEmpty);
  });

  test('rename + setSessionId updates the row', () async {
    final id = await dao.insert(
      projectRoot: '/tmp/app',
      title: 'orig',
      agentId: 'opencode',
      now: DateTime(2026, 4, 25),
    );
    await dao.rename(id, 'renamed');
    await dao.setSessionId(id, 'sess-123');
    final row = (await dao.byProject('/tmp/app')).single;
    expect(row.title, 'renamed');
    expect(row.sessionId, 'sess-123');
  });
}
```

- [ ] **Step 2: Run, expect fail.**

Run: `fvm flutter test test/core/drift/dao/chats_dao_test.dart`
Expected: FAIL — missing classes.

- [ ] **Step 3: Create the table.**

`lib/core/drift/tables/chats.dart`:

```dart
import 'package:drift/drift.dart';
import 'package:pickforge/core/drift/tables/projects.dart';

@DataClassName('ChatRow')
class Chats extends Table {
  TextColumn get chatId => text()();
  TextColumn get projectRoot => text().references(Projects, #projectRoot, onDelete: KeyAction.cascade)();
  TextColumn get title => text()();
  TextColumn get agentId => text()();
  TextColumn get skillId => text().nullable()();
  TextColumn get sessionId => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get lastActivityAt => dateTime()();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();

  @override
  Set<Column<Object>> get primaryKey => {chatId};
}
```

- [ ] **Step 4: Create the dao.**

`lib/core/drift/dao/chats_dao.dart`:

```dart
import 'package:drift/drift.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/drift/tables/chats.dart';
import 'package:uuid/uuid.dart';

part 'chats_dao.g.dart';

@DriftAccessor(tables: [Chats])
class ChatsDao extends DatabaseAccessor<PickforgeDatabase> with _$ChatsDaoMixin {
  ChatsDao(super.db, {Uuid? uuid}) : _uuid = uuid ?? const Uuid();

  final Uuid _uuid;

  Future<String> insert({
    required String projectRoot,
    required String title,
    required String agentId,
    required DateTime now,
    String? skillId,
  }) async {
    final id = _uuid.v4();
    await into(chats).insert(
      ChatsCompanion(
        chatId: Value(id),
        projectRoot: Value(projectRoot),
        title: Value(title),
        agentId: Value(agentId),
        skillId: Value(skillId),
        createdAt: Value(now),
        lastActivityAt: Value(now),
      ),
    );
    return id;
  }

  Future<List<ChatRow>> byProject(String projectRoot) {
    return (select(chats)
          ..where((c) => c.projectRoot.equals(projectRoot))
          ..orderBy([
            (c) => OrderingTerm(expression: c.sortOrder),
            (c) => OrderingTerm(expression: c.lastActivityAt, mode: OrderingMode.desc),
          ]))
        .get();
  }

  Future<void> rename(String chatId, String title) =>
      (update(chats)..where((c) => c.chatId.equals(chatId))).write(ChatsCompanion(title: Value(title)));

  Future<void> setSessionId(String chatId, String? sessionId) => (update(chats)
        ..where((c) => c.chatId.equals(chatId)))
      .write(ChatsCompanion(sessionId: Value(sessionId)));

  Future<void> setSkillId(String chatId, String skillId) => (update(chats)
        ..where((c) => c.chatId.equals(chatId)))
      .write(ChatsCompanion(skillId: Value(skillId)));

  Future<void> touch(String chatId, DateTime now) => (update(chats)
        ..where((c) => c.chatId.equals(chatId)))
      .write(ChatsCompanion(lastActivityAt: Value(now)));

  Future<void> remove(String chatId) =>
      (delete(chats)..where((c) => c.chatId.equals(chatId))).go();
}
```

- [ ] **Step 5: Register in `PickforgeDatabase`.**

Modify `lib/core/drift/pickforge_database.dart`:

```dart
@DriftDatabase(
  tables: [ProjectSettings, PickHistory, AgentRunLog, Projects, Chats],
  daos: [ProjectSettingsDao, PickHistoryDao, AgentRunLogDao, ProjectsDao, ChatsDao],
)
```

- [ ] **Step 6: Regen + test.**

```bash
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter test test/core/drift/dao/chats_dao_test.dart
```

Expected: PASS (3 tests).

- [ ] **Step 7: Format, analyze, commit.**

```bash
fvm dart format .
fvm flutter analyze
git add lib/core/drift/tables/chats.dart \
        lib/core/drift/dao/chats_dao.dart \
        lib/core/drift/dao/chats_dao.g.dart \
        lib/core/drift/pickforge_database.dart \
        lib/core/drift/pickforge_database.g.dart \
        test/core/drift/dao/chats_dao_test.dart
git commit -m "feat(drift): add Chats table and dao"
```

### Task 4 — Modify `ProjectSettings` (drop `defaultTerminalId`, add `lastChatId` + `paneSizes`)

**Files:**
- Modify: `lib/core/drift/tables/project_settings.dart`
- Modify: `lib/core/drift/dao/project_settings_dao.dart`
- Modify: `test/core/drift/dao/project_settings_dao_test.dart`

- [ ] **Step 1: Update the table.**

`lib/core/drift/tables/project_settings.dart`:

```dart
import 'package:drift/drift.dart';

@DataClassName('ProjectSettingsRow')
class ProjectSettings extends Table {
  TextColumn get projectRoot => text()();
  TextColumn get vmServiceUrl => text().nullable()();
  TextColumn get defaultAgentId => text().nullable()();
  TextColumn get lastChatId => text().nullable()();
  TextColumn get paneSizes => text().nullable()(); // JSON: [leftPx, rightPx]
  DateTimeColumn get lastUsedAt => dateTime().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {projectRoot};
}
```

- [ ] **Step 2: Update the dao.**

In `lib/core/drift/dao/project_settings_dao.dart`:
- Remove any `defaultTerminalId` getter / setter.
- Add `Future<void> setLastChatId(String projectRoot, String? chatId)` and `Future<String?> lastChatId(String projectRoot)`.
- Add `Future<void> setPaneSizes(String projectRoot, String? json)` and `Future<String?> paneSizes(String projectRoot)`.

- [ ] **Step 3: Update the existing dao test file: remove any `defaultTerminalId` cases; add tests for `lastChatId` and `paneSizes` round-trips.**

Add e.g.:
```dart
test('setLastChatId then lastChatId round-trips', () async {
  await dao.upsert(projectRoot: '/tmp/x', now: DateTime(2026, 4, 25));
  await dao.setLastChatId('/tmp/x', 'chat-1');
  expect(await dao.lastChatId('/tmp/x'), 'chat-1');
});

test('setPaneSizes then paneSizes round-trips', () async {
  await dao.upsert(projectRoot: '/tmp/x', now: DateTime(2026, 4, 25));
  await dao.setPaneSizes('/tmp/x', '[260,300]');
  expect(await dao.paneSizes('/tmp/x'), '[260,300]');
});
```

- [ ] **Step 4: Regen + test.**

```bash
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter test test/core/drift/dao/project_settings_dao_test.dart
```

Expected: PASS.

- [ ] **Step 5: Format, analyze, commit.**

```bash
fvm dart format .
fvm flutter analyze
git add lib/core/drift/tables/project_settings.dart \
        lib/core/drift/dao/project_settings_dao.dart \
        lib/core/drift/dao/project_settings_dao.g.dart \
        lib/core/drift/pickforge_database.g.dart \
        test/core/drift/dao/project_settings_dao_test.dart
git commit -m "refactor(drift): drop defaultTerminalId; add lastChatId and paneSizes"
```

### Task 5 — Add `chatId` to `PickHistory`

**Files:**
- Modify: `lib/core/drift/tables/pick_history.dart`

- [ ] **Step 1: Add a nullable `chatId` text column to the table.**

```dart
TextColumn get chatId => text().nullable()();
```

- [ ] **Step 2: Regen.** Run `fvm dart run build_runner build --delete-conflicting-outputs`.

- [ ] **Step 3: Run existing pick-history tests to make sure nothing regresses.**

Run: `fvm flutter test test/core/drift/dao/pick_history_dao_test.dart`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add lib/core/drift/tables/pick_history.dart \
        lib/core/drift/pickforge_database.g.dart
git commit -m "feat(drift): add optional chatId to PickHistory for future cross-ref"
```

### Task 6 — Bump schema version + write `onUpgrade`

**Files:**
- Modify: `lib/core/drift/pickforge_database.dart`
- Create: `test/core/drift/migration_v1_to_v2_test.dart`

- [ ] **Step 1: Write the migration test against a v1 schema.**

`test/core/drift/migration_v1_to_v2_test.dart`:

```dart
import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  test('v1 → v2 creates Projects, Chats; drops defaultTerminalId; backfills Projects', () async {
    // Simulate v1: an existing project_settings row with defaultTerminalId set.
    final raw = NativeDatabase.memory();
    await raw.runCustom('''
      CREATE TABLE project_settings (
        project_root TEXT NOT NULL PRIMARY KEY,
        vm_service_url TEXT,
        default_agent_id TEXT,
        default_terminal_id TEXT,
        last_used_at INTEGER
      );
    ''', []);
    await raw.runCustom('''
      CREATE TABLE pick_history (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        project_root TEXT NOT NULL,
        widget_class TEXT NOT NULL,
        creation_file TEXT,
        creation_line INTEGER,
        skill_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        picked_at INTEGER NOT NULL,
        widget_context_json TEXT NOT NULL
      );
    ''', []);
    await raw.runCustom('''
      CREATE TABLE agent_run_log (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        pick_id INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        exit_code INTEGER,
        hot_reload_count INTEGER NOT NULL DEFAULT 0,
        wrapper_script_path TEXT NOT NULL
      );
    ''', []);
    await raw.runCustom('PRAGMA user_version = 1;', []);
    await raw.runCustom(
      "INSERT INTO project_settings (project_root, vm_service_url, default_agent_id, default_terminal_id, last_used_at) VALUES ('/tmp/a', 'ws://x/ws', 'claude-code', 'ghostty', 1714000000000);",
      [],
    );

    final db = PickforgeDatabase.forTesting(raw);
    // Trigger migration by issuing a query that touches the new tables.
    final projects = await db.customSelect('SELECT * FROM projects').get();
    final chats = await db.customSelect('SELECT * FROM chats').get();
    final settingsCols = await db.customSelect("PRAGMA table_info(project_settings);").get();

    expect(projects, hasLength(1));
    expect(projects.single.read<String>('project_root'), '/tmp/a');
    expect(projects.single.read<String>('display_name'), 'a');

    expect(chats, isEmpty);

    final names = settingsCols.map((r) => r.read<String>('name')).toSet();
    expect(names.contains('default_terminal_id'), isFalse);
    expect(names.contains('last_chat_id'), isTrue);
    expect(names.contains('pane_sizes'), isTrue);

    await db.close();
  });
}
```

- [ ] **Step 2: Run; expect fail.**

Run: `fvm flutter test test/core/drift/migration_v1_to_v2_test.dart`
Expected: FAIL — schemaVersion is still 1; columns not migrated.

- [ ] **Step 3: Bump schemaVersion and write `onUpgrade`.**

In `lib/core/drift/pickforge_database.dart`:

```dart
@override
int get schemaVersion => 2;

@override
MigrationStrategy get migration => MigrationStrategy(
      onCreate: (m) => m.createAll(),
      onUpgrade: (m, from, to) async {
        if (from < 2) {
          // Create new tables.
          await m.createTable(projects);
          await m.createTable(chats);

          // Add new columns to project_settings.
          await m.addColumn(projectSettings, projectSettings.lastChatId);
          await m.addColumn(projectSettings, projectSettings.paneSizes);

          // Drop legacy column.
          await customStatement('ALTER TABLE project_settings DROP COLUMN default_terminal_id;');

          // Backfill: synthesize a Projects row per existing ProjectSettings.
          final rows = await customSelect(
            'SELECT project_root, last_used_at FROM project_settings',
          ).get();
          for (final r in rows) {
            final root = r.read<String>('project_root');
            final lastTs = r.readNullable<int>('last_used_at');
            final last = lastTs != null
                ? DateTime.fromMillisecondsSinceEpoch(lastTs)
                : DateTime.now();
            final name = root.split(Platform.pathSeparator).last;
            await into(projects).insert(
              ProjectsCompanion(
                projectRoot: Value(root),
                displayName: Value(name.isEmpty ? root : name),
                createdAt: Value(last),
                lastOpenedAt: Value(last),
              ),
              mode: InsertMode.insertOrIgnore,
            );
          }
        }
      },
    );
```

Add `import 'dart:io';` for `Platform`.

- [ ] **Step 4: Run; expect pass.**

Run: `fvm flutter test test/core/drift/migration_v1_to_v2_test.dart`
Expected: PASS.

- [ ] **Step 5: Run the full Drift test directory to ensure no regressions.**

Run: `fvm flutter test test/core/drift/`
Expected: PASS.

- [ ] **Step 6: Format, analyze, commit.**

```bash
fvm dart format .
fvm flutter analyze
git add lib/core/drift/pickforge_database.dart \
        lib/core/drift/pickforge_database.g.dart \
        test/core/drift/migration_v1_to_v2_test.dart
git commit -m "feat(drift): bump schema to v2 (Projects, Chats, pane sizes, drop terminal id)"
```

### Task 7 — `ProjectsRepository` and `ChatsRepository`

**Files:**
- Create: `lib/core/projects/projects_repository.dart`
- Create: `lib/core/chats/chats_repository.dart`
- Modify: `lib/core/di/injection.dart`
- Create: `test/core/projects/projects_repository_test.dart`
- Create: `test/core/chats/chats_repository_test.dart`

- [ ] **Step 1: Write failing repo tests.**

`test/core/projects/projects_repository_test.dart`:

```dart
import 'dart:io';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/dao/projects_dao.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
import 'package:path/path.dart' as p;

void main() {
  late PickforgeDatabase db;
  late ProjectsRepository repo;
  late Directory tmp;

  setUp(() async {
    db = PickforgeDatabase.forTesting(NativeDatabase.memory());
    repo = ProjectsRepository(ProjectsDao(db));
    tmp = await Directory.systemTemp.createTemp('pf_proj_repo');
    File(p.join(tmp.path, 'pubspec.yaml')).writeAsStringSync('name: t');
  });

  tearDown(() async {
    await db.close();
    await tmp.delete(recursive: true);
  });

  test('add canonicalizes and de-dupes', () async {
    await repo.add(tmp.path);
    await repo.add('${tmp.path}/./'); // same path, non-canonical
    final all = await repo.list();
    expect(all, hasLength(1));
    expect(all.single.projectRoot, p.canonicalize(tmp.path));
  });

  test('add rejects folder without pubspec.yaml', () async {
    final empty = await Directory.systemTemp.createTemp('pf_empty');
    await expectLater(repo.add(empty.path), throwsA(isA<ProjectAddError>()));
    await empty.delete();
  });

  test('remove deletes the row', () async {
    await repo.add(tmp.path);
    await repo.remove(p.canonicalize(tmp.path));
    expect(await repo.list(), isEmpty);
  });
}
```

`test/core/chats/chats_repository_test.dart`:

```dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/chats/chats_repository.dart';
import 'package:pickforge/core/drift/dao/chats_dao.dart';
import 'package:pickforge/core/drift/dao/projects_dao.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  late PickforgeDatabase db;
  late ChatsRepository repo;

  setUp(() async {
    db = PickforgeDatabase.forTesting(NativeDatabase.memory());
    final pDao = ProjectsDao(db);
    await pDao.upsert(projectRoot: '/tmp/p', displayName: 'p', now: DateTime(2026, 4, 25));
    repo = ChatsRepository(ChatsDao(db));
  });

  tearDown(() async => db.close());

  test('newChat uses default title and agent', () async {
    final id = await repo.newChat(projectRoot: '/tmp/p', defaultAgentId: 'claude-code');
    final all = await repo.list('/tmp/p');
    expect(all, hasLength(1));
    expect(all.single.chatId, id);
    expect(all.single.title, 'Chat 1');
    expect(all.single.agentId, 'claude-code');
  });

  test('newChat increments title counter', () async {
    await repo.newChat(projectRoot: '/tmp/p', defaultAgentId: 'codex');
    await repo.newChat(projectRoot: '/tmp/p', defaultAgentId: 'codex');
    final titles = (await repo.list('/tmp/p')).map((c) => c.title).toList()..sort();
    expect(titles, ['Chat 1', 'Chat 2']);
  });
}
```

- [ ] **Step 2: Run; expect fail (missing types).**

- [ ] **Step 3: Implement `ProjectsRepository`.**

`lib/core/projects/projects_repository.dart`:

```dart
import 'dart:io';
import 'package:injectable/injectable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/drift/dao/projects_dao.dart';
import 'package:pickforge/core/drift/tables/projects.dart';

class ProjectAddError implements Exception {
  ProjectAddError(this.message);
  final String message;
  @override
  String toString() => 'ProjectAddError: $message';
}

@lazySingleton
class ProjectsRepository {
  ProjectsRepository(this._dao);
  final ProjectsDao _dao;

  Future<List<ProjectRow>> list() => _dao.allOrderedByLastOpened();

  Future<ProjectRow> add(String rawPath) async {
    final canonical = p.canonicalize(rawPath);
    final dir = Directory(canonical);
    if (!await dir.exists()) {
      throw ProjectAddError('Folder does not exist: $canonical');
    }
    final pubspec = File(p.join(canonical, 'pubspec.yaml'));
    if (!await pubspec.exists()) {
      throw ProjectAddError('Folder must contain pubspec.yaml');
    }
    final now = DateTime.now();
    await _dao.upsert(
      projectRoot: canonical,
      displayName: p.basename(canonical),
      now: now,
    );
    return (await _dao.allOrderedByLastOpened())
        .firstWhere((r) => r.projectRoot == canonical);
  }

  Future<void> touch(String projectRoot) => _dao.touch(projectRoot, DateTime.now());
  Future<void> rename(String projectRoot, String displayName) =>
      _dao.rename(projectRoot, displayName);
  Future<void> remove(String projectRoot) => _dao.remove(projectRoot);
}
```

- [ ] **Step 4: Implement `ChatsRepository`.**

`lib/core/chats/chats_repository.dart`:

```dart
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/drift/dao/chats_dao.dart';
import 'package:pickforge/core/drift/tables/chats.dart';

@lazySingleton
class ChatsRepository {
  ChatsRepository(this._dao);
  final ChatsDao _dao;

  Future<List<ChatRow>> list(String projectRoot) => _dao.byProject(projectRoot);

  Future<String> newChat({
    required String projectRoot,
    required String defaultAgentId,
    String? skillId,
  }) async {
    final existing = await _dao.byProject(projectRoot);
    final title = 'Chat ${existing.length + 1}';
    return _dao.insert(
      projectRoot: projectRoot,
      title: title,
      agentId: defaultAgentId,
      skillId: skillId,
      now: DateTime.now(),
    );
  }

  Future<void> rename(String chatId, String title) => _dao.rename(chatId, title);
  Future<void> setSessionId(String chatId, String? sessionId) =>
      _dao.setSessionId(chatId, sessionId);
  Future<void> setSkillId(String chatId, String skillId) => _dao.setSkillId(chatId, skillId);
  Future<void> touch(String chatId) => _dao.touch(chatId, DateTime.now());
  Future<void> remove(String chatId) => _dao.remove(chatId);
}
```

- [ ] **Step 5: Regen for injectable.**

Before regenerating, add a DI module in `lib/core/di/injection.dart` that exposes the Drift DAOs from `PickforgeDatabase`; otherwise `@lazySingleton` repository generation cannot resolve `ProjectsDao` and `ChatsDao`.

```dart
@module
abstract class DriftDaoModule {
  @lazySingleton
  ProjectsDao projectsDao(PickforgeDatabase db) => ProjectsDao(db);

  @lazySingleton
  ChatsDao chatsDao(PickforgeDatabase db) => ChatsDao(db);
}
```

Run: `fvm dart run build_runner build --delete-conflicting-outputs`

- [ ] **Step 6: Run repo tests.**

Run: `fvm flutter test test/core/projects/ test/core/chats/`
Expected: PASS.

- [ ] **Step 7: Format, analyze, commit.**

```bash
fvm dart format .
fvm flutter analyze
git add lib/core/projects/ lib/core/chats/ \
        test/core/projects/ test/core/chats/ \
        lib/core/di/injection.config.dart \
        lib/core/di/injection.dart
git commit -m "feat(core): add ProjectsRepository and ChatsRepository"
```

---

## Phase 2 — Pubspec additions + build smoke

Goal: add the new third-party packages, bump `rive`, confirm a clean build on the host platform before the bigger surgery.

### Task 8 — Add packages to `pubspec.yaml`

**Files:**
- Modify: `pubspec.yaml`

- [ ] **Step 1: Edit `dependencies` (alphabetical), bump `rive`.**

```yaml
  # embedded terminal
  xterm: ^4.0.0
  flutter_pty: ^0.4.2
  multi_split_view: ^3.6.1
  file_selector: ^1.1.0

  # design & motion
  flutter_animate: ^4.5.2
  animations: ^2.2.0
  rive: ^0.14.6   # bumped from ^0.14.5
```

(Place the four embedded-terminal lines as a new group; the design-and-motion lines already exist — only `rive` changes.)

- [ ] **Step 2: Resolve.**

Run: `fvm flutter pub get`
Expected: success.

- [ ] **Step 3: Commit.**

```bash
git add pubspec.yaml pubspec.lock
git commit -m "chore: add xterm, flutter_pty, multi_split_view, file_selector; bump rive"
```

### Task 9 — Build smoke test

**Files:** none (build only).

- [ ] **Step 1: Build for the host platform to surface any native plugin issues early.**

Run on the host's native platform — pick the line that matches:
```bash
fvm flutter build linux --debug   # Linux
fvm flutter build macos --debug   # macOS
fvm flutter build windows --debug # Windows
```

Expected: build succeeds. If `rive_native` fails on Linux, ensure `cmake`, `ninja-build`, and `libgtk-3-dev` are installed system-wide; document any new system requirements in `docs/release-checklist.md` if added.

- [ ] **Step 2: Run the existing test suite.**

Run: `fvm flutter test`
Expected: existing tests still pass; no new failures introduced by the dep additions.

- [ ] **Step 3: Commit only if `docs/release-checklist.md` was updated.**

```bash
git add docs/release-checklist.md
git commit -m "docs: note system deps for rive_native build"
```
(Skip the commit if no doc changes were needed.)

---

## Phase 3 — Core terminal subsystem

Goal: build the new `lib/core/terminal/` from scratch — PTY abstraction, session, pool, transcript recorder/replayer, embedded-terminal settings — fully unit-tested with `flutter_pty` mocked behind a `PtyProcess` interface. UI integration arrives later.

> **Note:** the *old* `lib/core/terminal/` (terminal profiles, registry, detector) is still present at this phase. We add the new files alongside the old; deletion happens in Phase 5. Do not touch `terminal_profile*.dart` or `profiles/` here.

### Task 10 — `PtyProcess` interface + `FlutterPtyAdapter`

**Files:**
- Create: `lib/core/terminal/pty_process.dart`
- Create: `lib/core/terminal/flutter_pty_adapter.dart`

- [ ] **Step 1: Define the abstraction.**

`lib/core/terminal/pty_process.dart`:

```dart
import 'dart:async';

abstract class PtyProcess {
  Stream<List<int>> get output;
  Future<int> get exitCode;
  void write(List<int> bytes);
  void resize({required int rows, required int cols});
  void kill([ProcessSignal signal = ProcessSignal.sigterm]);
}

enum ProcessSignal { sigint, sigterm, sigkill }

abstract class PtyProcessFactory {
  Future<PtyProcess> start({
    required String executable,
    required List<String> arguments,
    required String workingDirectory,
    Map<String, String>? environment,
    int rows = 30,
    int cols = 100,
  });
}
```

- [ ] **Step 2: Implement the `flutter_pty`-backed adapter.**

`lib/core/terminal/flutter_pty_adapter.dart`:

```dart
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_pty/flutter_pty.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/terminal/pty_process.dart';

class _FlutterPtyProcess implements PtyProcess {
  _FlutterPtyProcess(this._pty);
  final Pty _pty;

  @override
  Stream<List<int>> get output => _pty.output;

  @override
  Future<int> get exitCode => _pty.exitCode;

  @override
  void write(List<int> bytes) => _pty.write(Uint8List.fromList(bytes));

  @override
  void resize({required int rows, required int cols}) =>
      _pty.resize(rows, cols);

  @override
  void kill([ProcessSignal signal = ProcessSignal.sigterm]) {
    // flutter_pty 0.4.2 documents kill() with no signal argument.
    // If a future pinned API supports signals, map [signal] here.
    _pty.kill();
  }
}

@LazySingleton(as: PtyProcessFactory)
class FlutterPtyAdapter implements PtyProcessFactory {
  @override
  Future<PtyProcess> start({
    required String executable,
    required List<String> arguments,
    required String workingDirectory,
    Map<String, String>? environment,
    int rows = 30,
    int cols = 100,
  }) async {
    final pty = Pty.start(
      executable,
      arguments: arguments,
      workingDirectory: workingDirectory,
      environment: environment,
      rows: rows,
      columns: cols,
    );
    return _FlutterPtyProcess(pty);
  }
}
```

Verify the exact `Pty.start`, `resize`, and `kill` signatures against the pinned `flutter_pty 0.4.2` API while implementing. The adapter is the only file allowed to touch `flutter_pty` directly; tests must mock `PtyProcessFactory`, not `flutter_pty.Pty`.

- [ ] **Step 3: Regen DI.**

Run: `fvm dart run build_runner build --delete-conflicting-outputs`

- [ ] **Step 4: Format, analyze, commit.**

```bash
fvm dart format .
fvm flutter analyze
git add lib/core/terminal/pty_process.dart \
        lib/core/terminal/flutter_pty_adapter.dart \
        lib/core/di/injection.config.dart
git commit -m "feat(terminal): add PtyProcess abstraction over flutter_pty"
```

### Task 11 — `PtySession` (state machine + lifecycle)

**Files:**
- Create: `lib/core/terminal/pty_session_state.dart`
- Create: `lib/core/terminal/pty_session.dart`
- Create: `test/core/terminal/pty_session_test.dart`

- [ ] **Step 1: Failing test.**

`test/core/terminal/pty_session_test.dart`:

```dart
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/terminal/pty_process.dart';
import 'package:pickforge/core/terminal/pty_session.dart';
import 'package:pickforge/core/terminal/pty_session_state.dart';

class _MockFactory extends Mock implements PtyProcessFactory {}
class _MockProcess extends Mock implements PtyProcess {}

void main() {
  late _MockFactory factory;
  late _MockProcess process;
  late StreamController<List<int>> outputCtrl;
  late Completer<int> exitCompleter;

  setUp(() {
    factory = _MockFactory();
    process = _MockProcess();
    outputCtrl = StreamController<List<int>>.broadcast();
    exitCompleter = Completer<int>();
    when(() => process.output).thenAnswer((_) => outputCtrl.stream);
    when(() => process.exitCode).thenAnswer((_) => exitCompleter.future);
    when(() => factory.start(
          executable: any(named: 'executable'),
          arguments: any(named: 'arguments'),
          workingDirectory: any(named: 'workingDirectory'),
          environment: any(named: 'environment'),
          rows: any(named: 'rows'),
          cols: any(named: 'cols'),
        )).thenAnswer((_) async => process);
  });

  test('start transitions spawning -> running and emits output', () async {
    final session = PtySession(
      chatId: 'c1',
      executable: 'agent',
      arguments: const [],
      workingDirectory: '/tmp',
      factory: factory,
    );
    final states = <PtySessionState>[];
    session.state.listen(states.add);

    await session.start();
    outputCtrl.add([72, 105]); // 'Hi'
    await pumpEventQueue();

    expect(states.any((s) => s is PtyRunning), isTrue);
  });

  test('exit code 0 -> exited(0)', () async {
    final session = PtySession(
      chatId: 'c2',
      executable: 'agent',
      arguments: const [],
      workingDirectory: '/tmp',
      factory: factory,
    );
    final states = <PtySessionState>[];
    session.state.listen(states.add);

    await session.start();
    exitCompleter.complete(0);
    await pumpEventQueue();

    expect(states.last, isA<PtyExited>().having((e) => e.code, 'code', 0));
  });

  test('factory throw -> failed(BinaryNotFound)', () async {
    when(() => factory.start(
          executable: any(named: 'executable'),
          arguments: any(named: 'arguments'),
          workingDirectory: any(named: 'workingDirectory'),
          environment: any(named: 'environment'),
          rows: any(named: 'rows'),
          cols: any(named: 'cols'),
        )).thenThrow(const ProcessException('agent', [], 'No such file', 2));

    final session = PtySession(
      chatId: 'c3',
      executable: 'agent',
      arguments: const [],
      workingDirectory: '/tmp',
      factory: factory,
    );
    final states = <PtySessionState>[];
    session.state.listen(states.add);

    await session.start();
    await pumpEventQueue();

    expect(states.last, isA<PtyFailed>().having((f) => f.reason, 'reason', PtyFailReason.binaryNotFound));
  });
}
```

- [ ] **Step 2: Run; expect fail.**

- [ ] **Step 3: Implement state classes.**

`lib/core/terminal/pty_session_state.dart`:

```dart
import 'package:equatable/equatable.dart';

sealed class PtySessionState extends Equatable {
  const PtySessionState();
  @override
  List<Object?> get props => [];
}

class PtyParked extends PtySessionState { const PtyParked(); }
class PtySpawning extends PtySessionState { const PtySpawning(); }
class PtyRunning extends PtySessionState { const PtyRunning(); }
class PtyExited extends PtySessionState {
  const PtyExited(this.code);
  final int code;
  @override List<Object?> get props => [code];
}

enum PtyFailReason { binaryNotFound, spawnTimeout, unknown }
class PtyFailed extends PtySessionState {
  const PtyFailed(this.reason, this.message);
  final PtyFailReason reason;
  final String message;
  @override List<Object?> get props => [reason, message];
}
```

- [ ] **Step 4: Implement `PtySession`.**

`lib/core/terminal/pty_session.dart`:

```dart
import 'dart:async';
import 'dart:io' as io;
import 'package:pickforge/core/terminal/pty_process.dart';
import 'package:pickforge/core/terminal/pty_session_state.dart';

class PtySession {
  PtySession({
    required this.chatId,
    required this.executable,
    required this.arguments,
    required this.workingDirectory,
    required PtyProcessFactory factory,
    this.environment,
    Duration spawnTimeout = const Duration(seconds: 8),
  })  : _factory = factory,
        _spawnTimeout = spawnTimeout;

  final String chatId;
  final String executable;
  final List<String> arguments;
  final String workingDirectory;
  final Map<String, String>? environment;
  final PtyProcessFactory _factory;
  final Duration _spawnTimeout;

  final _stateCtrl = StreamController<PtySessionState>.broadcast();
  final _outputCtrl = StreamController<List<int>>.broadcast();
  PtyProcess? _process;
  PtySessionState _last = const PtyParked();

  Stream<PtySessionState> get state {
    return Stream<PtySessionState>.multi((sub) {
      sub.add(_last);
      final s = _stateCtrl.stream.listen(sub.add);
      sub.onCancel = s.cancel;
    });
  }

  Stream<List<int>> get output => _outputCtrl.stream;

  bool get isRunning => _last is PtyRunning;

  Future<void> start() async {
    _emit(const PtySpawning());
    try {
      _process = await _factory
          .start(
            executable: executable,
            arguments: arguments,
            workingDirectory: workingDirectory,
            environment: environment,
          )
          .timeout(_spawnTimeout);
      _process!.output.listen(_outputCtrl.add);
      unawaited(_process!.exitCode.then((c) => _emit(PtyExited(c))));
      _emit(const PtyRunning());
    } on TimeoutException {
      _emit(const PtyFailed(PtyFailReason.spawnTimeout, 'Agent did not start in 8s'));
    } on io.ProcessException catch (e) {
      final reason = e.message.contains('No such file')
          ? PtyFailReason.binaryNotFound
          : PtyFailReason.unknown;
      _emit(PtyFailed(reason, e.message));
    } catch (e) {
      _emit(PtyFailed(PtyFailReason.unknown, e.toString()));
    }
  }

  void write(List<int> bytes) {
    if (_process == null || !isRunning) return;
    _process!.write(bytes);
  }

  void resize(int rows, int cols) => _process?.resize(rows: rows, cols: cols);

  Future<void> stop({Duration grace = const Duration(milliseconds: 300)}) async {
    if (_process == null) return;
    _process!.kill(ProcessSignal.sigterm);
    final exited = await _process!.exitCode.timeout(grace, onTimeout: () => -1);
    if (exited == -1) _process!.kill(ProcessSignal.sigkill);
  }

  Future<void> dispose() async {
    await stop();
    await _stateCtrl.close();
    await _outputCtrl.close();
  }

  void _emit(PtySessionState s) {
    _last = s;
    _stateCtrl.add(s);
  }
}
```

- [ ] **Step 5: Run tests; expect pass.**

Run: `fvm flutter test test/core/terminal/pty_session_test.dart`
Expected: PASS (3 tests).

- [ ] **Step 6: Format, analyze, commit.**

```bash
git add lib/core/terminal/pty_session.dart \
        lib/core/terminal/pty_session_state.dart \
        test/core/terminal/pty_session_test.dart
git commit -m "feat(terminal): add PtySession lifecycle and state machine"
```

### Task 12 — `PtySessionPool`

**Files:**
- Create: `lib/core/terminal/pty_session_pool.dart`
- Create: `test/core/terminal/pty_session_pool_test.dart`

- [ ] **Step 1: Failing test.**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/terminal/pty_session.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';

class _Fake extends Mock implements PtySession {
  _Fake(this.chatId);
  @override final String chatId;
  bool stopped = false;
  @override Future<void> stop({Duration grace = const Duration(milliseconds: 300)}) async {
    stopped = true;
  }
  @override Future<void> dispose() async => stopped = true;
}

void main() {
  test('parkAll stops every session and clears the pool', () async {
    final pool = PtySessionPool();
    final a = _Fake('a');
    final b = _Fake('b');
    pool.attach(a);
    pool.attach(b);

    await pool.parkAll();

    expect(a.stopped, isTrue);
    expect(b.stopped, isTrue);
    expect(pool.session('a'), isNull);
    expect(pool.session('b'), isNull);
  });

  test('sendPrompt writes to the named session', () {
    final pool = PtySessionPool();
    final s = _Fake('a');
    when(() => s.write(any())).thenReturn(null);
    pool.attach(s);

    pool.sendPrompt('a', 'hello');

    final captured = verify(() => s.write(captureAny())).captured.single as List<int>;
    expect(String.fromCharCodes(captured), 'hello\r');
  });
}
```

- [ ] **Step 2: Run; expect fail.**

- [ ] **Step 3: Implement.**

`lib/core/terminal/pty_session_pool.dart`:

```dart
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/terminal/pty_session.dart';

@lazySingleton
class PtySessionPool {
  final _sessions = <String, PtySession>{};

  PtySession? session(String chatId) => _sessions[chatId];

  void attach(PtySession s) {
    _sessions[s.chatId] = s;
  }

  Future<void> detach(String chatId) async {
    final s = _sessions.remove(chatId);
    await s?.dispose();
  }

  Future<void> parkAll() async {
    final all = List<PtySession>.from(_sessions.values);
    _sessions.clear();
    await Future.wait(all.map((s) => s.dispose()));
  }

  void sendPrompt(String chatId, String prompt) {
    final s = _sessions[chatId];
    if (s == null) return;
    s.write('$prompt\r'.codeUnits);
  }

  void resize(String chatId, int rows, int cols) =>
      _sessions[chatId]?.resize(rows, cols);
}
```

- [ ] **Step 4: Run; expect pass; commit.**

```bash
fvm flutter test test/core/terminal/pty_session_pool_test.dart
fvm dart format . && fvm flutter analyze
fvm dart run build_runner build --delete-conflicting-outputs
git add lib/core/terminal/pty_session_pool.dart \
        test/core/terminal/pty_session_pool_test.dart \
        lib/core/di/injection.config.dart
git commit -m "feat(terminal): add PtySessionPool with prompt injection"
```

### Task 12A — `PtySessionPool.activate` + recorder wiring

**Files:**
- Modify: `lib/core/terminal/pty_session_pool.dart`
- Modify: `test/core/terminal/pty_session_pool_test.dart`

- [ ] **Step 1: Add a failing unit test for `activate`.**

```dart
test('activate returns existing session without spawning a duplicate', () async {
  final pool = PtySessionPool();
  final existing = _Fake('a');
  pool.attach(existing);

  final result = await pool.activate(
    chatId: 'a',
    create: () => throw StateError('must not spawn'),
  );

  expect(result, same(existing));
});

test('activate creates, attaches, starts, and returns new session', () async {
  final pool = PtySessionPool();
  final created = _Fake('b');
  when(() => created.start()).thenAnswer((_) async {});

  final result = await pool.activate(chatId: 'b', create: () => created);

  expect(result, same(created));
  expect(pool.session('b'), same(created));
  verify(() => created.start()).called(1);
});
```

- [ ] **Step 2: Implement `activate`.**

```dart
Future<PtySession> activate({
  required String chatId,
  required PtySession Function() create,
}) async {
  final existing = _sessions[chatId];
  if (existing != null) return existing;
  final session = create();
  attach(session);
  await session.start();
  return session;
}
```

Do not put agent-profile lookup, transcript replay, or UI state in this method. UI code composes those concerns by passing a fully configured `PtySession` through `create`.

- [ ] **Step 3: Run tests and commit.**

```bash
fvm flutter test test/core/terminal/pty_session_pool_test.dart
git add lib/core/terminal/pty_session_pool.dart test/core/terminal/pty_session_pool_test.dart
git commit -m "feat(terminal): add PtySessionPool activation"
```

### Task 13 — ANSI strip + SGR span parser

**Files:**
- Create: `lib/core/terminal/ansi.dart`
- Create: `test/core/terminal/ansi_test.dart`

- [ ] **Step 1: Failing tests.**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/ansi.dart';

void main() {
  test('strip removes CSI sequences', () {
    expect(stripAnsi('[31mred[0m plain'), 'red plain');
  });

  test('strip removes cursor-movement sequences', () {
    expect(stripAnsi('start[2J[Hend'), 'startend');
  });

  test('parseSpans returns ranges in stripped-text coordinates', () {
    const raw = '[31mred[0m[1mbold[0m';
    final r = parseAnsi(raw);
    expect(r.text, 'redbold');
    expect(r.spans, hasLength(2));
    expect(r.spans[0].start, 0);
    expect(r.spans[0].end, 3);
    expect(r.spans[0].fg, 1); // red
    expect(r.spans[1].start, 3);
    expect(r.spans[1].end, 7);
    expect(r.spans[1].bold, isTrue);
  });
}
```

- [ ] **Step 2: Run; expect fail.**

- [ ] **Step 3: Implement.**

`lib/core/terminal/ansi.dart`:

```dart
class AnsiSpan {
  AnsiSpan({
    required this.start,
    required this.end,
    this.fg,
    this.bg,
    this.bold = false,
    this.italic = false,
    this.underline = false,
  });
  final int start;
  final int end;
  final int? fg; // 0-15 ANSI palette
  final int? bg;
  final bool bold;
  final bool italic;
  final bool underline;
}

class AnsiResult {
  AnsiResult(this.text, this.spans);
  final String text;
  final List<AnsiSpan> spans;
}

final _ansiRegex = RegExp(r'\x1B(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07]*\x07|\][^\x1B]*\x1B\\|[NOPX^_])');

String stripAnsi(String input) => input.replaceAll(_ansiRegex, '');

AnsiResult parseAnsi(String input) {
  final spans = <AnsiSpan>[];
  final out = StringBuffer();
  int? fg;
  int? bg;
  bool bold = false, italic = false, underline = false;
  int spanStart = 0;

  void flush() {
    if (out.length > spanStart && (fg != null || bg != null || bold || italic || underline)) {
      spans.add(AnsiSpan(
        start: spanStart,
        end: out.length,
        fg: fg,
        bg: bg,
        bold: bold,
        italic: italic,
        underline: underline,
      ));
    }
    spanStart = out.length;
  }

  int i = 0;
  while (i < input.length) {
    final m = _ansiRegex.matchAsPrefix(input, i);
    if (m != null) {
      flush();
      final seq = m.group(0)!;
      if (seq.startsWith('[') && seq.endsWith('m')) {
        final params = seq.substring(2, seq.length - 1).split(';').map((s) => s.isEmpty ? 0 : int.tryParse(s) ?? 0).toList();
        for (final p in params) {
          if (p == 0) {
            fg = null; bg = null; bold = false; italic = false; underline = false;
          } else if (p == 1) bold = true;
          else if (p == 3) italic = true;
          else if (p == 4) underline = true;
          else if (p == 22) bold = false;
          else if (p == 23) italic = false;
          else if (p == 24) underline = false;
          else if (p >= 30 && p <= 37) fg = p - 30;
          else if (p >= 40 && p <= 47) bg = p - 40;
          else if (p == 39) fg = null;
          else if (p == 49) bg = null;
          else if (p >= 90 && p <= 97) fg = p - 90 + 8;
          else if (p >= 100 && p <= 107) bg = p - 100 + 8;
        }
      }
      i = m.end;
    } else {
      out.write(input[i]);
      i++;
    }
  }
  flush();
  return AnsiResult(out.toString(), spans);
}
```

- [ ] **Step 4: Run; expect pass; commit.**

```bash
fvm flutter test test/core/terminal/ansi_test.dart
fvm dart format . && fvm flutter analyze
git add lib/core/terminal/ansi.dart test/core/terminal/ansi_test.dart
git commit -m "feat(terminal): add ANSI strip and SGR span parser"
```

### Task 14 — `TranscriptRecorder`

**Files:**
- Create: `lib/core/terminal/transcript_recorder.dart`
- Create: `test/core/terminal/transcript_recorder_test.dart`

- [ ] **Step 1: Failing test.**

```dart
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/terminal/transcript_recorder.dart';

void main() {
  late Directory tmp;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('pf_recorder');
  });

  tearDown(() async => tmp.delete(recursive: true));

  test('writes stripped text and meta', () async {
    final rec = TranscriptRecorder(
      projectRoot: tmp.path,
      chatId: 'c1',
      maxBytes: 1024 * 1024,
    );
    await rec.open();
    rec.append('[31mred[0m plain'.codeUnits);
    await rec.close();

    final log = File(p.join(tmp.path, '.pickforge', 'chats', 'c1', 'transcript.log'));
    final meta = File(p.join(tmp.path, '.pickforge', 'chats', 'c1', 'meta.json'));
    expect(log.existsSync(), isTrue);
    expect(log.readAsStringSync(), 'red plain');
    expect(meta.existsSync(), isTrue);
  });

  test('head-truncates when over cap', () async {
    final rec = TranscriptRecorder(
      projectRoot: tmp.path,
      chatId: 'c2',
      maxBytes: 16,
      truncateAt: 24,
    );
    await rec.open();
    rec.append(List.filled(30, 'a').join());
    await rec.flush();
    final log = File(p.join(tmp.path, '.pickforge', 'chats', 'c2', 'transcript.log'));
    expect(log.lengthSync(), lessThanOrEqualTo(16));
    await rec.close();
  });
}
```

(Note: `append` accepts both `String` and `List<int>` by taking `Object` and validating the runtime type. The spans sidecar must be binary, not CSV text, to match the spec.)

- [ ] **Step 2: Run; expect fail.**

- [ ] **Step 3: Implement.**

`lib/core/terminal/transcript_recorder.dart`:

```dart
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/terminal/ansi.dart';

class TranscriptRecorder {
  TranscriptRecorder({
    required this.projectRoot,
    required this.chatId,
    this.maxBytes = 5 * 1024 * 1024,
    int? truncateAt,
  }) : truncateAt = truncateAt ?? (maxBytes + (1024 * 1024));

  final String projectRoot;
  final String chatId;
  final int maxBytes;
  final int truncateAt;

  late final String _dir = p.join(projectRoot, '.pickforge', 'chats', chatId);
  late final File _log = File(p.join(_dir, 'transcript.log'));
  late final File _spans = File(p.join(_dir, 'transcript.spans.bin'));
  late final File _meta = File(p.join(_dir, 'meta.json'));
  IOSink? _logSink;
  IOSink? _spansSink;

  Future<void> open() async {
    await Directory(_dir).create(recursive: true);
    _logSink = _log.openWrite(mode: FileMode.append);
    _spansSink = _spans.openWrite(mode: FileMode.append);
  }

  /// Accepts either a Dart string or raw bytes from a PTY.
  void append(Object data) {
    final raw = data is String ? data : utf8.decode(data as List<int>, allowMalformed: true);
    final r = parseAnsi(raw);
    _logSink?.add(utf8.encode(r.text));
    for (final s in r.spans) {
      _spansSink?.add(_encodeSpan(s));
    }
  }

  List<int> _encodeSpan(AnsiSpan s) {
    final style = (s.bold ? 1 : 0) |
        (s.italic ? 2 : 0) |
        (s.underline ? 4 : 0);
    return [
      ..._varint(s.start),
      ..._varint(s.end - s.start),
      ..._varint(s.fg ?? 255),
      ..._varint(s.bg ?? 255),
      ..._varint(style),
    ];
  }

  List<int> _varint(int value) {
    final out = <int>[];
    var v = value;
    while (v >= 0x80) {
      out.add((v & 0x7f) | 0x80);
      v >>= 7;
    }
    out.add(v);
    return out;
  }

  Future<void> flush() async {
    await _logSink?.flush();
    await _spansSink?.flush();
    await _maybeTruncate();
    await _writeMeta();
  }

  Future<void> close() async {
    await flush();
    await _logSink?.close();
    await _spansSink?.close();
    _logSink = null;
    _spansSink = null;
  }

  Future<void> _maybeTruncate() async {
    if (!_log.existsSync()) return;
    final size = _log.lengthSync();
    if (size <= truncateAt) return;
    final bytes = _log.readAsBytesSync();
    final keep = bytes.sublist(bytes.length - maxBytes);
    await _log.writeAsBytes(keep, flush: true);
  }

  Future<void> _writeMeta() async {
    final size = _log.existsSync() ? _log.lengthSync() : 0;
    final json = jsonEncode({
      'schemaVersion': 1,
      'bytes': size,
      'updatedAt': DateTime.now().toIso8601String(),
    });
    await _meta.writeAsString(json, flush: true);
  }
}
```

- [ ] **Step 4: Run; expect pass; commit.**

```bash
fvm flutter test test/core/terminal/transcript_recorder_test.dart
git add lib/core/terminal/transcript_recorder.dart \
        test/core/terminal/transcript_recorder_test.dart
git commit -m "feat(terminal): add TranscriptRecorder with stripped text + spans + meta"
```

### Task 15 — `TranscriptReplayer`

**Files:**
- Create: `lib/core/terminal/transcript_replayer.dart`
- Create: `test/core/terminal/transcript_replayer_test.dart`

- [ ] **Step 1: Failing test.**

```dart
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/terminal/transcript_replayer.dart';

void main() {
  late Directory tmp;
  setUp(() async => tmp = await Directory.systemTemp.createTemp('pf_replay'));
  tearDown(() async => tmp.delete(recursive: true));

  test('replay yields chunks of recorded text', () async {
    final dir = Directory(p.join(tmp.path, '.pickforge', 'chats', 'c1'))..createSync(recursive: true);
    File(p.join(dir.path, 'transcript.log')).writeAsStringSync('hello world');
    final r = TranscriptReplayer(projectRoot: tmp.path, chatId: 'c1', chunkBytes: 4);
    final chunks = <String>[];
    await for (final ch in r.replay()) {
      chunks.add(String.fromCharCodes(ch));
    }
    expect(chunks.join(), 'hello world');
    expect(chunks.length, greaterThan(1));
  });

  test('replay returns empty stream for missing transcript', () async {
    final r = TranscriptReplayer(projectRoot: tmp.path, chatId: 'missing');
    expect(await r.replay().toList(), isEmpty);
  });
}
```

- [ ] **Step 2: Run; expect fail.**

- [ ] **Step 3: Implement.**

`lib/core/terminal/transcript_replayer.dart`:

```dart
import 'dart:io';
import 'package:path/path.dart' as p;

class TranscriptReplayer {
  TranscriptReplayer({
    required this.projectRoot,
    required this.chatId,
    this.chunkBytes = 64 * 1024,
  });
  final String projectRoot;
  final String chatId;
  final int chunkBytes;

  Stream<List<int>> replay() async* {
    final f = File(p.join(projectRoot, '.pickforge', 'chats', chatId, 'transcript.log'));
    if (!f.existsSync()) return;
    final raf = f.openSync();
    try {
      while (true) {
        final chunk = raf.readSync(chunkBytes);
        if (chunk.isEmpty) break;
        yield chunk;
      }
    } finally {
      raf.closeSync();
    }
  }
}
```

- [ ] **Step 4: Run; expect pass; commit.**

```bash
fvm flutter test test/core/terminal/transcript_replayer_test.dart
git add lib/core/terminal/transcript_replayer.dart test/core/terminal/transcript_replayer_test.dart
git commit -m "feat(terminal): add TranscriptReplayer"
```

### Task 15A — Attach transcript recording to PTY sessions

**Files:**
- Modify: `lib/core/terminal/pty_session.dart`
- Modify: `test/core/terminal/pty_session_test.dart`

- [ ] **Step 1: Add a failing test that passes an `onOutput` callback to `PtySession`, emits process bytes, and verifies the callback receives the same bytes before UI code sees them.**

```dart
test('output is mirrored to recorder callback', () async {
  final seen = <List<int>>[];
  final session = PtySession(
    chatId: 'c4',
    executable: 'agent',
    arguments: const [],
    workingDirectory: '/tmp',
    factory: factory,
    onOutput: seen.add,
  );

  await session.start();
  outputCtrl.add([111, 107]);
  await pumpEventQueue();

  expect(seen.single, [111, 107]);
});
```

- [ ] **Step 2: Implement `PtySession.onOutput`.**

Add an optional callback to the constructor and call it inside the process output listener before `_outputCtrl.add(bytes)`.

```dart
final void Function(List<int> bytes)? onOutput;

// In start():
_process!.output.listen((bytes) {
  onOutput?.call(bytes);
  _outputCtrl.add(bytes);
});
```

- [ ] **Step 3: Run terminal tests and commit.**

```bash
fvm flutter test test/core/terminal/pty_session_test.dart
git add lib/core/terminal/pty_session.dart test/core/terminal/pty_session_test.dart
git commit -m "feat(terminal): mirror PTY output for transcript recording"
```

### Task 16 — `EmbeddedTerminalSettings` model + repository

**Files:**
- Create: `lib/core/terminal/embedded_terminal_settings.dart`
- Modify: `lib/core/drift/tables/` — add an `app_settings` key/value table (or extend an existing one — see step 1).
- Create: `test/core/terminal/embedded_terminal_settings_test.dart`

- [ ] **Step 1: Decide on storage.** Use `shared_preferences` (already in `pubspec`) for the three small settings — no new Drift table needed. Keys: `terminal.fontFamily`, `terminal.fontSize`, `terminal.themeId`.

- [ ] **Step 2: Write failing test.**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('defaults when nothing stored', () async {
    final repo = EmbeddedTerminalSettingsRepository(await SharedPreferences.getInstance());
    final s = await repo.load();
    expect(s.fontSize, 13.0);
    expect(s.themeId, TerminalThemeId.pickforgeEmber);
  });

  test('save then load round-trips', () async {
    final repo = EmbeddedTerminalSettingsRepository(await SharedPreferences.getInstance());
    await repo.save(const EmbeddedTerminalSettings(
      fontFamily: 'JetBrains Mono',
      fontSize: 14,
      themeId: TerminalThemeId.solarizedDark,
    ));
    final s = await repo.load();
    expect(s.fontFamily, 'JetBrains Mono');
    expect(s.fontSize, 14);
    expect(s.themeId, TerminalThemeId.solarizedDark);
  });
}
```

- [ ] **Step 3: Implement.**

`lib/core/terminal/embedded_terminal_settings.dart`:

```dart
import 'package:equatable/equatable.dart';
import 'package:injectable/injectable.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum TerminalThemeId { pickforgeEmber, draculaDark, solarizedDark }

class EmbeddedTerminalSettings extends Equatable {
  const EmbeddedTerminalSettings({
    required this.fontFamily,
    required this.fontSize,
    required this.themeId,
  });

  static const defaults = EmbeddedTerminalSettings(
    fontFamily: 'monospace',
    fontSize: 13,
    themeId: TerminalThemeId.pickforgeEmber,
  );

  final String fontFamily;
  final double fontSize;
  final TerminalThemeId themeId;

  @override
  List<Object?> get props => [fontFamily, fontSize, themeId];
}

@lazySingleton
class EmbeddedTerminalSettingsRepository {
  EmbeddedTerminalSettingsRepository(this._prefs);
  final SharedPreferences _prefs;

  Future<EmbeddedTerminalSettings> load() async {
    return EmbeddedTerminalSettings(
      fontFamily: _prefs.getString('terminal.fontFamily') ?? EmbeddedTerminalSettings.defaults.fontFamily,
      fontSize: _prefs.getDouble('terminal.fontSize') ?? EmbeddedTerminalSettings.defaults.fontSize,
      themeId: TerminalThemeId.values.firstWhere(
        (t) => t.name == _prefs.getString('terminal.themeId'),
        orElse: () => EmbeddedTerminalSettings.defaults.themeId,
      ),
    );
  }

  Future<void> save(EmbeddedTerminalSettings s) async {
    await _prefs.setString('terminal.fontFamily', s.fontFamily);
    await _prefs.setDouble('terminal.fontSize', s.fontSize);
    await _prefs.setString('terminal.themeId', s.themeId.name);
  }
}
```

- [ ] **Step 4: Run; pass; commit.**

```bash
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter test test/core/terminal/embedded_terminal_settings_test.dart
git add lib/core/terminal/embedded_terminal_settings.dart \
        test/core/terminal/embedded_terminal_settings_test.dart \
        lib/core/di/injection.config.dart
git commit -m "feat(terminal): add EmbeddedTerminalSettings repo"
```

### Task 17 — DI module for the new core terminal subsystem

**Files:**
- Create: `lib/core/di/modules/terminal_runtime_module.dart`
- Modify: `lib/core/di/injection.dart` (only if needed)

- [ ] **Step 1: Create the module exposing `SharedPreferences` (singleton) so the settings repo can inject it cleanly.**

`lib/core/di/modules/terminal_runtime_module.dart`:

```dart
import 'package:injectable/injectable.dart';
import 'package:shared_preferences/shared_preferences.dart';

@module
abstract class TerminalRuntimeModule {
  @preResolve
  Future<SharedPreferences> get prefs => SharedPreferences.getInstance();
}
```

- [ ] **Step 2: Regen.**

Run: `fvm dart run build_runner build --delete-conflicting-outputs`

- [ ] **Step 3: Format, analyze, commit.**

```bash
fvm dart format .
fvm flutter analyze
git add lib/core/di/modules/terminal_runtime_module.dart \
        lib/core/di/injection.config.dart
git commit -m "feat(di): expose SharedPreferences for terminal runtime"
```

---

## Phase 4 — AgentLauncher refactor

Goal: make `AgentLauncher` produce a *prompt + manifest of files written* instead of spawning an external terminal. Surface PTY-friendly invocation args on `AgentProfile`. Keep all `.pickforge/`-writing behavior intact (it's still useful — agents read those files at startup).

### Task 18 — Extract `PickforgeContextWriter` from `WrapperScriptGenerator`

**Files:**
- Create: `lib/core/agent/pickforge_context_writer.dart`
- Modify: `lib/core/agent/wrapper_script_generator.dart` (becomes a thin facade for now; deleted in Phase 5)

- [ ] **Step 1: Read the existing `PickforgeDirManager` and `AgentLauncher` write paths. Extract the `.pickforge/` file-writing behavior into `PickforgeContextWriter`. Do not copy from `WrapperScriptGenerator`; it only generates wrapper scripts. Preserve the existing `.pickforge/.gitignore` conflict check from `PickforgeDirManager.ensure`.**

`lib/core/agent/pickforge_context_writer.dart`:

```dart
import 'dart:io';
import 'package:injectable/injectable.dart';
import 'package:path/path.dart' as p;

class WrittenContext {
  WrittenContext({
    required this.skillPath,
    required this.widgetContextPath,
    this.widgetScreenshotPath,
    this.deviceScreenPath,
    required this.initialPromptPath,
  });
  final String skillPath;
  final String widgetContextPath;
  final String? widgetScreenshotPath;
  final String? deviceScreenPath;
  final String initialPromptPath;
}

@lazySingleton
class PickforgeContextWriter {
  Future<WrittenContext> write({
    required String projectRoot,
    required String skillMarkdown,
    required String widgetContextMarkdown,
    required String initialPrompt,
    List<int>? widgetScreenshotPng,
    List<int>? deviceScreenPng,
  }) async {
    final dir = Directory(p.join(projectRoot, '.pickforge'));
    await _ensurePickforgeDir(dir);

    final skill = File(p.join(dir.path, 'skill-active.md'));
    final widget = File(p.join(dir.path, 'widget-context.md'));
    final initial = File(p.join(dir.path, 'initial-prompt.md'));

    await skill.writeAsString(skillMarkdown, flush: true);
    await widget.writeAsString(widgetContextMarkdown, flush: true);
    await initial.writeAsString(initialPrompt, flush: true);

    String? widgetShotPath;
    if (widgetScreenshotPng != null) {
      final f = File(p.join(dir.path, 'screenshot.png'));
      await f.writeAsBytes(widgetScreenshotPng, flush: true);
      widgetShotPath = f.path;
    }
    String? devicePath;
    if (deviceScreenPng != null) {
      final f = File(p.join(dir.path, 'device-screen.png'));
      await f.writeAsBytes(deviceScreenPng, flush: true);
      devicePath = f.path;
    }

    return WrittenContext(
      skillPath: skill.path,
      widgetContextPath: widget.path,
      widgetScreenshotPath: widgetShotPath,
      deviceScreenPath: devicePath,
      initialPromptPath: initial.path,
    );
  }

  Future<void> _ensurePickforgeDir(Directory dir) async {
    final gitignore = File(p.join(dir.path, '.gitignore'));
    if (dir.existsSync()) {
      if (gitignore.existsSync() && gitignore.readAsStringSync() == '*\n') {
        return;
      }
      throw StateError(
        '.pickforge/ exists without Pickforge .gitignore marker. '
        'Remove or rename the directory and try again.',
      );
    }
    await dir.create(recursive: true);
    await gitignore.writeAsString('*\n', flush: true);
  }
}
```

- [ ] **Step 2: Add a unit test.**

`test/core/agent/pickforge_context_writer_test.dart`: assert all five files are created with the supplied content; assert `.gitignore` is `*`; assert an existing `.pickforge/` without that marker throws `StateError`. Use a temp directory.

- [ ] **Step 3: Regen, run tests, commit.**

```bash
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter test test/core/agent/pickforge_context_writer_test.dart
git add lib/core/agent/pickforge_context_writer.dart \
        test/core/agent/pickforge_context_writer_test.dart \
        lib/core/di/injection.config.dart
git commit -m "feat(agent): extract PickforgeContextWriter"
```

### Task 19 — Add `ptyArgsFor` to `AgentProfile`

**Files:**
- Modify: `lib/core/agent/agent_profile.dart`
- Modify: `lib/core/agent/profiles/codex_profile.dart`
- Modify: `lib/core/agent/profiles/opencode_profile.dart`
- Modify: `lib/core/agent/profiles/claude_code_profile.dart` (if it exists)

- [ ] **Step 1: Add the method to the abstract class.**

In `lib/core/agent/agent_profile.dart`:

```dart
class PtyInvocation {
  const PtyInvocation({required this.executable, required this.arguments});
  final String executable;
  final List<String> arguments;
}

abstract class AgentProfile {
  // ... existing members ...

  /// Args used to spawn this agent under a PTY for an interactive session.
  /// Used by the embedded terminal pane.
  PtyInvocation ptyArgsFor({String? resumeSessionId});
}
```

- [ ] **Step 2: Implement per-profile.**

`codex_profile.dart`: `executable: 'codex'`, args minimal (no flags) — Codex starts a REPL by default.
`opencode_profile.dart`: `executable: 'opencode'`, args minimal.
`claude_code_profile.dart`: `executable: 'claude'`, args `['--resume', resumeSessionId!]` if `resumeSessionId != null`.

- [ ] **Step 3: Add tests for each profile's `ptyArgsFor`.**

In `test/core/agent/profiles/codex_profile_test.dart` etc.:

```dart
test('ptyArgsFor returns codex invocation', () {
  final p = CodexProfile();
  final inv = p.ptyArgsFor();
  expect(inv.executable, 'codex');
});
```

- [ ] **Step 4: Run profile tests; pass; commit.**

```bash
fvm flutter test test/core/agent/profiles/
git add lib/core/agent/agent_profile.dart \
        lib/core/agent/profiles/ \
        test/core/agent/profiles/
git commit -m "feat(agent): expose ptyArgsFor for embedded PTY invocation"
```

### Task 20 — Refactor `AgentLauncher.launch` → `prepareContext`

**Files:**
- Modify: `lib/core/agent/agent_launcher.dart`
- Modify: `test/core/agent/agent_launcher_test.dart`

- [ ] **Step 1: Update tests to expect a `WrittenContext` return value, not an external-process spawn.**

```dart
test('prepareContext writes files and returns paths', () async {
  // existing setUp creates a stub skill, widget, etc.
  final ctx = await launcher.prepareContext(req);
  expect(ctx.skillPath, endsWith('skill-active.md'));
  expect(ctx.widgetContextPath, endsWith('widget-context.md'));
});
```

- [ ] **Step 2: Refactor `AgentLauncher`.**

Rename `launch` → `prepareContext`. Keep current request/profile APIs intact: resolve the agent through `AgentProfileRegistry`, load skills through `SkillStore.loadSkill(req.skill, projectRoot: req.projectRoot)`, render widget context from `req.widget`, and use `agent.buildInitialPrompt(...)` for the returned prompt body. Drop `TerminalProfileRegistry`, `WrapperScriptGenerator`, `ProcessSpawner`, `_resolveBinaryPath`, wrapper-file creation, chmod, `TerminalLaunchSpec`, and process spawning only after the tests prove `.pickforge/` output is preserved. Wire `.pickforge/` writes to `PickforgeContextWriter`. Return a value that includes `WrittenContext` and `initialPrompt`.

```dart
@lazySingleton
class AgentLauncher {
  AgentLauncher(this._agentRegistry, this._writer, this._skills, this._renderer);
  final AgentProfileRegistry _agentRegistry;
  final PickforgeContextWriter _writer;
  final SkillStore _skills;
  final WidgetContextRenderer _renderer;

  Future<PreparedAgentContext> prepareContext(ForgeRequest req) async {
    final agent = _agentRegistry.get(req.agentId);
    final skillMarkdown = await _skills.loadSkill(
      req.skill,
      projectRoot: req.projectRoot,
    );
    final widgetMd = _renderer.render(req.widget);

    final initial = agent.buildInitialPrompt(
      pickforgeDirRelative: '.pickforge',
      skillFilename: '${req.skill.value}.md',
      widgetContextFilename: 'widget-context.md',
      screenshotFilename: req.widget.screenshotPath != null ? 'screenshot.png' : null,
      deviceScreenFilename: req.widget.adbScreenshotPath != null ? 'device-screen.png' : null,
    );

    final written = await _writer.write(
      projectRoot: req.projectRoot,
      skillMarkdown: skillMarkdown,
      widgetContextMarkdown: widgetMd,
      initialPrompt: initial,
    );

    return PreparedAgentContext(written: written, initialPrompt: initial);
  }
}

class PreparedAgentContext {
  const PreparedAgentContext({required this.written, required this.initialPrompt});
  final WrittenContext written;
  final String initialPrompt;
}
```

- [ ] **Step 3: Run; pass; commit.**

```bash
fvm flutter test test/core/agent/agent_launcher_test.dart
fvm dart format . && fvm flutter analyze
git add lib/core/agent/agent_launcher.dart test/core/agent/agent_launcher_test.dart
git commit -m "refactor(agent): launch -> prepareContext (no more terminal spawn)"
```

### Task 21 — Update `ForgeCubit` to dispatch via `PtySessionPool`

**Files:**
- Modify: `lib/features/forge/cubit/forge_cubit.dart`
- Modify: `test/features/forge/cubit/forge_cubit_test.dart`

- [ ] **Step 1: Update the cubit.**

Inject `PtySessionPool`. Replace `AgentLauncher.launch(...)` (now removed) with:

```dart
final ctx = await _launcher.prepareContext(req);
_pool.sendPrompt(state.activeChatId!, _initialPromptFor(ctx, req));
```

The cubit now requires `activeChatId` in its state — add a `selectChat(String id)` method or take the chat id from `ChatsCubit` (Phase 6 will introduce that). For now: take the chat id as a parameter to `forge(chatId)`.

- [ ] **Step 2: Update the cubit's bloc tests to mock `PtySessionPool` and verify `sendPrompt` is called with the right args, the right chat id, and the right prompt body.**

- [ ] **Step 3: Run, pass, commit.**

```bash
fvm flutter test test/features/forge/
git add lib/features/forge/cubit/forge_cubit.dart \
        test/features/forge/cubit/forge_cubit_test.dart
git commit -m "refactor(forge): dispatch prompt through PtySessionPool"
```

---

## Phase 5 — Delete external-terminal subsystem

Goal: remove every file related to the old "spawn external terminal app" flow now that no caller needs it.

### Task 22 — Delete `lib/core/terminal/profiles/*` and friends

**Files (delete):**
- `lib/core/terminal/profiles/alacritty_profile.dart`
- `lib/core/terminal/profiles/env_fallback_profile.dart`
- `lib/core/terminal/profiles/ghostty_profile.dart`
- `lib/core/terminal/profiles/gnome_terminal_profile.dart`
- `lib/core/terminal/profiles/iterm2_profile.dart`
- `lib/core/terminal/profiles/kitty_profile.dart`
- `lib/core/terminal/profiles/terminal_app_profile.dart`
- `lib/core/terminal/profiles/warp_profile.dart`
- `lib/core/terminal/profiles/wezterm_profile.dart`
- `lib/core/terminal/profiles/windows_terminal_profile.dart`
- `lib/core/terminal/terminal_detector.dart`
- `lib/core/terminal/terminal_profile.dart`
- `lib/core/terminal/terminal_profile_registry.dart`
- `lib/core/terminal/models/` (only if `git ls-files lib/core/terminal/models` shows tracked files)
- `lib/core/terminal/models.dart`
- All matching tests under `test/core/terminal/profiles/`, `test/core/terminal/terminal_*`.

- [ ] **Step 1: Delete the files.**

```bash
git rm -r lib/core/terminal/profiles \
         lib/core/terminal/terminal_detector.dart \
         lib/core/terminal/terminal_profile.dart \
         lib/core/terminal/terminal_profile_registry.dart \
         lib/core/terminal/models \
         lib/core/terminal/models.dart \
         test/core/terminal/profiles \
         test/core/terminal/terminal_detector_test.dart \
         test/core/terminal/terminal_profile_registry_test.dart 2>/dev/null || true
```

(Use `-f` only after `git ls-files` confirms each path; do not blindly add `-f`. If a path doesn't exist, the matching `rm` is skipped.)

- [ ] **Step 2: Search for residual imports/references.**

Run: `grep -rn "TerminalProfile\|terminalProfile\|TerminalDetector" lib/ test/`
Expected: no matches.

- [ ] **Step 3: Build to surface dangling references.**

Run: `fvm flutter analyze`
Expected: clean. Fix any straggler imports (most likely in `lib/features/forge/view/forge_panel.dart` — remove the terminal picker UI; in `lib/core/di/injection.dart` — remove `TerminalProfileModule`).

- [ ] **Step 4: Commit.**

```bash
fvm dart format .
fvm flutter analyze
git add -A
git commit -m "refactor: delete external terminal profile subsystem"
```

### Task 23 — Delete `wrapper_script_generator.dart`

**Files (delete):**
- `lib/core/agent/wrapper_script_generator.dart`
- `test/core/agent/wrapper_script_generator_test.dart`

- [ ] **Step 1: Confirm no callers.**

Run: `grep -rn "WrapperScriptGenerator\|wrapper_script_generator" lib/ test/`
Expected: only the file itself and its test (now ready to delete).

- [ ] **Step 2: Delete.**

```bash
git rm lib/core/agent/wrapper_script_generator.dart \
       test/core/agent/wrapper_script_generator_test.dart
```

- [ ] **Step 3: Analyze, commit.**

```bash
fvm flutter analyze
git add -A
git commit -m "refactor(agent): remove WrapperScriptGenerator (replaced by PickforgeContextWriter)"
```

### Task 24 — DI cleanup

**Files:**
- Modify: `lib/core/di/injection.dart` (remove `TerminalProfileModule` if a manual entry exists)
- Regen: `lib/core/di/injection.config.dart`

- [ ] **Step 1: Open `lib/core/di/injection.dart`. Remove any references to terminal profile modules.**

- [ ] **Step 2: Regen.**

Run: `fvm dart run build_runner build --delete-conflicting-outputs`

- [ ] **Step 3: Boot test — make sure DI configures cleanly.**

Run: `fvm flutter test`
Expected: PASS (all existing + new tests). DI should still wire up.

- [ ] **Step 4: Commit.**

```bash
git add lib/core/di/injection.dart lib/core/di/injection.config.dart
git commit -m "chore(di): drop terminal profile module wiring"
```

---

## Phase 6 — Workbench feature

Goal: build the new `lib/features/workbench/` shell — three cubits and four panels — wired to the now-existing repos and PTY subsystem. By the end of this phase, `fvm flutter run -d <host>` opens the new shell and the user can: add a project, create chats, send forge prompts to a live agent CLI in xterm, see the inspector when connected.

### Task 25 — `WorkbenchLayoutCubit` (pane sizes + collapse)

**Files:**
- Create: `lib/features/workbench/cubit/workbench_layout_cubit.dart`
- Create: `lib/features/workbench/cubit/workbench_layout_state.dart`
- Create: `test/features/workbench/cubit/workbench_layout_cubit_test.dart`

- [ ] **Step 1: Failing test.**

```dart
import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/drift/dao/project_settings_dao.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_state.dart';

class _MockDao extends Mock implements ProjectSettingsDao {}

void main() {
  late _MockDao dao;
  setUp(() => dao = _MockDao());

  blocTest<WorkbenchLayoutCubit, WorkbenchLayoutState>(
    'load reads JSON pane sizes',
    setUp: () {
      when(() => dao.paneSizes('/p')).thenAnswer((_) async => '[200,310]');
    },
    build: () => WorkbenchLayoutCubit(dao),
    act: (c) => c.load('/p'),
    expect: () => [
      isA<WorkbenchLayoutState>().having((s) => s.leftWidth, 'left', 200).having(
            (s) => s.rightWidth,
            'right',
            310,
          ),
    ],
  );

  blocTest<WorkbenchLayoutCubit, WorkbenchLayoutState>(
    'updateSizes persists JSON',
    setUp: () {
      when(() => dao.setPaneSizes('/p', any())).thenAnswer((_) async {});
    },
    build: () => WorkbenchLayoutCubit(dao),
    act: (c) async {
      await c.load('/p');
      c.updateSizes(left: 240, right: 320);
    },
    verify: (_) {
      verify(() => dao.setPaneSizes('/p', '[240.0,320.0]')).called(1);
    },
  );
}
```

- [ ] **Step 2: Run; expect fail.**

- [ ] **Step 3: Implement.**

`lib/features/workbench/cubit/workbench_layout_state.dart`:

```dart
import 'package:equatable/equatable.dart';

class WorkbenchLayoutState extends Equatable {
  const WorkbenchLayoutState({
    required this.projectRoot,
    required this.leftWidth,
    required this.rightWidth,
    required this.rightCollapsed,
  });
  final String? projectRoot;
  final double leftWidth;
  final double rightWidth;
  final bool rightCollapsed;

  static const initial = WorkbenchLayoutState(
    projectRoot: null,
    leftWidth: 220,
    rightWidth: 320,
    rightCollapsed: false,
  );

  WorkbenchLayoutState copyWith({
    String? projectRoot,
    double? leftWidth,
    double? rightWidth,
    bool? rightCollapsed,
  }) =>
      WorkbenchLayoutState(
        projectRoot: projectRoot ?? this.projectRoot,
        leftWidth: leftWidth ?? this.leftWidth,
        rightWidth: rightWidth ?? this.rightWidth,
        rightCollapsed: rightCollapsed ?? this.rightCollapsed,
      );

  @override
  List<Object?> get props => [projectRoot, leftWidth, rightWidth, rightCollapsed];
}
```

`lib/features/workbench/cubit/workbench_layout_cubit.dart`:

```dart
import 'dart:convert';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/drift/dao/project_settings_dao.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_state.dart';

@injectable
class WorkbenchLayoutCubit extends Cubit<WorkbenchLayoutState> {
  WorkbenchLayoutCubit(this._dao) : super(WorkbenchLayoutState.initial);
  final ProjectSettingsDao _dao;

  Future<void> load(String projectRoot) async {
    final raw = await _dao.paneSizes(projectRoot);
    if (raw == null) {
      emit(state.copyWith(projectRoot: projectRoot));
      return;
    }
    final parsed = jsonDecode(raw) as List<dynamic>;
    emit(state.copyWith(
      projectRoot: projectRoot,
      leftWidth: (parsed[0] as num).toDouble(),
      rightWidth: (parsed[1] as num).toDouble(),
    ));
  }

  void updateSizes({required double left, required double right}) {
    emit(state.copyWith(leftWidth: left, rightWidth: right));
    _persist();
  }

  void toggleRightCollapsed() {
    emit(state.copyWith(rightCollapsed: !state.rightCollapsed));
  }

  Future<void> _persist() async {
    final root = state.projectRoot;
    if (root == null) return;
    await _dao.setPaneSizes(root, '[${state.leftWidth},${state.rightWidth}]');
  }
}
```

- [ ] **Step 4: Run, regen, commit.**

```bash
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter test test/features/workbench/cubit/
git add lib/features/workbench/cubit/ test/features/workbench/cubit/ \
        lib/core/di/injection.config.dart
git commit -m "feat(workbench): add WorkbenchLayoutCubit"
```

### Task 26 — `ProjectsCubit`

**Files:**
- Create: `lib/features/workbench/cubit/projects_cubit.dart` and `projects_state.dart`
- Create: `test/features/workbench/cubit/projects_cubit_test.dart`

- [ ] **Step 1: Failing test.**

```dart
blocTest<ProjectsCubit, ProjectsState>(
  'load emits Loading then Ready',
  setUp: () {
    when(() => repo.list()).thenAnswer((_) async => [aRow('/p')]);
  },
  build: () => ProjectsCubit(repo),
  act: (c) => c.load(),
  expect: () => [
    isA<ProjectsLoading>(),
    isA<ProjectsReady>().having((s) => s.projects.length, 'count', 1),
  ],
);

blocTest<ProjectsCubit, ProjectsState>(
  'add invokes repo and reloads',
  setUp: () {
    when(() => repo.add('/x')).thenAnswer((_) async => aRow('/x'));
    when(() => repo.list()).thenAnswer((_) async => [aRow('/x')]);
  },
  build: () => ProjectsCubit(repo),
  act: (c) => c.add('/x'),
  expect: () => [isA<ProjectsLoading>(), isA<ProjectsReady>()],
);
```

- [ ] **Step 2: Implement state (sealed): `ProjectsInitial`, `ProjectsLoading`, `ProjectsReady(projects, active)`, `ProjectsError(message)`.**

- [ ] **Step 3: Implement cubit with methods `load()`, `selectProject(root)`, `add(rawPath)`, `rename(root, name)`, `remove(root)`. On `selectProject`, also `repo.touch(root)`.

- [ ] **Step 4: Run, commit.**

```bash
fvm flutter test test/features/workbench/cubit/projects_cubit_test.dart
git add lib/features/workbench/cubit/ test/features/workbench/cubit/
git commit -m "feat(workbench): add ProjectsCubit"
```

### Task 27 — `ChatsCubit`

**Files:**
- Create: `lib/features/workbench/cubit/chats_cubit.dart` and `chats_state.dart`
- Create: `test/features/workbench/cubit/chats_cubit_test.dart`

- [ ] **Step 1: Tests cover `load(projectRoot)`, `newChat(agentId, skillId?)`, `selectChat(chatId)`, `rename`, `duplicate`, `remove` (cascades transcript dir delete).**

- [ ] **Step 2: Implement state (sealed): `ChatsInitial`, `ChatsLoading(projectRoot)`, `ChatsReady(projectRoot, chats, active)`.**

- [ ] **Step 3: `remove` deletes the on-disk `<projectRoot>/.pickforge/chats/<chatId>/` directory after dao delete; failures are logged and surfaced via a `ChatsError` event without blocking the dao delete.

- [ ] **Step 4: Run, commit.**

```bash
fvm flutter test test/features/workbench/cubit/chats_cubit_test.dart
git add lib/features/workbench/cubit/ test/features/workbench/cubit/
git commit -m "feat(workbench): add ChatsCubit"
```

### Task 28 — `AppShellView` (three-pane skeleton)

**Files:**
- Create: `lib/features/workbench/view/app_shell_view.dart`
- Create: `test/features/workbench/view/app_shell_view_test.dart`

- [ ] **Step 1: Failing widget test.**

```dart
testWidgets('renders three panes inside MultiSplitView', (tester) async {
  await tester.pumpWidget(MaterialApp(
    home: MultiBlocProvider(
      providers: [
        BlocProvider(create: (_) => layoutCubit),
        BlocProvider(create: (_) => projectsCubit),
        BlocProvider(create: (_) => chatsCubit),
      ],
      child: const AppShellView(),
    ),
  ));
  expect(find.byKey(const Key('workbench-left')), findsOneWidget);
  expect(find.byKey(const Key('workbench-middle')), findsOneWidget);
  expect(find.byKey(const Key('workbench-right')), findsOneWidget);
});
```

- [ ] **Step 2: Implement skeleton with `multi_split_view`.**

```dart
class AppShellView extends StatelessWidget {
  const AppShellView({super.key});

  @override
  Widget build(BuildContext context) {
    final layout = context.watch<WorkbenchLayoutCubit>().state;
    return Scaffold(
      body: MultiSplitView(
        controller: MultiSplitViewController(
          areas: [
            Area(size: layout.leftWidth, min: 180, max: 360),
            Area(min: 320),
            if (!layout.rightCollapsed) Area(size: layout.rightWidth, min: 240, max: 480),
          ],
        ),
        onWeightChange: (sizes) {
          // Persist on drag end; Task 34 can add debounce if drag spam is measurable.
          context.read<WorkbenchLayoutCubit>().updateSizes(
                left: sizes[0]!,
                right: sizes.length > 2 ? sizes[2]! : layout.rightWidth,
              );
        },
        children: const [
          ProjectsChatsPanel(key: Key('workbench-left')),
          ChatWorkbenchPanel(key: Key('workbench-middle')),
          InspectorPanel(key: Key('workbench-right')),
        ],
      ),
    );
  }
}
```

(If `multi_split_view`'s 3.x API differs, follow the package's current docs — the structure is identical.)

- [ ] **Step 3: Stub `ProjectsChatsPanel`, `ChatWorkbenchPanel`, `InspectorPanel` as empty `Container`s with their keys for now (full panel implementations come in Tasks 29–31).**

- [ ] **Step 4: Run, commit.**

```bash
fvm flutter test test/features/workbench/view/app_shell_view_test.dart
git add lib/features/workbench/view/ test/features/workbench/view/
git commit -m "feat(workbench): add AppShellView three-pane skeleton"
```

### Task 29 — `ProjectsChatsPanel`

**Files:**
- Modify: `lib/features/workbench/view/projects_chats_panel.dart`
- Create: `test/features/workbench/view/projects_chats_panel_test.dart`

- [ ] **Step 1: Failing widget tests** — projects rendered, `+ Add project` opens `getDirectoryPath` (mocked via `FileSelectorPlatform`); chats list renders for active project; `+ New chat` shows inline form.

- [ ] **Step 2: Implement** the projects section (header + list + `+`), the chats section (header + list + `+ New chat`), the empty states ("Add your first project" / "Start your first chat"). Use `flutter_animate` for hover-reveal `⋯` icons. Use `lucide_icons_flutter` for glyphs.

- [ ] **Step 3: All user-visible strings go through `context.l10n.workbenchProjectsHeader` etc. Add ARB entries.**

- [ ] **Step 4: Run, commit.**

```bash
fvm flutter test test/features/workbench/view/projects_chats_panel_test.dart
git add lib/features/workbench/view/projects_chats_panel.dart \
        lib/l10n/app_en.arb \
        lib/l10n/generated/ \
        test/features/workbench/view/projects_chats_panel_test.dart
git commit -m "feat(workbench): add ProjectsChatsPanel"
```

### Task 30 — `ChatWorkbenchPanel`

**Files:**
- Modify: `lib/features/workbench/view/chat_workbench_panel.dart`
- Create: `test/features/workbench/view/chat_workbench_panel_test.dart`

- [ ] **Step 1: Failing widget test** — renders the forge compose strip + an `xterm.TerminalView`; clicking Forge It (with a picked widget) calls `ForgeCubit.forge(activeChatId)`.

- [ ] **Step 2: Implement.** Forge compose strip uses the existing `ForgePanel` widgets where possible (skill/agent chips already exist) but rehosted in a Scaffold's `appBar`. The terminal body wires `xterm.Terminal` to the active chat's `PtySession`:

```dart
final terminal = Terminal(maxLines: 10000);
chatActivePtySession.output.listen((bytes) => terminal.write(String.fromCharCodes(bytes)));
terminal.onOutput = (data) => chatActivePtySession.write(data.codeUnits);
```

Activate a chat by calling the `PtySessionPool.activate` method from Task 12A. Build the `PtySession` in `ChatWorkbenchPanel` (or a small local helper) from the active project root, chat row, selected `AgentProfile.ptyArgsFor(resumeSessionId: chat.sessionId)`, `PtyProcessFactory`, and a `TranscriptRecorder.append` callback. Do not add agent/profile/UI state into `PtySessionPool`.

- [ ] **Step 3: Cold-start replay**: on a "freshly attached" session with no live PTY, run `TranscriptReplayer.replay(...)` and feed bytes to xterm before spawning.

- [ ] **Step 4: Run, commit.**

```bash
fvm flutter test test/features/workbench/view/chat_workbench_panel_test.dart
git add lib/features/workbench/view/chat_workbench_panel.dart \
        lib/core/terminal/pty_session_pool.dart \
        test/features/workbench/view/chat_workbench_panel_test.dart \
        test/core/terminal/pty_session_pool_test.dart
git commit -m "feat(workbench): add ChatWorkbenchPanel with embedded xterm terminal"
```

### Task 31 — `InspectorPanel`

**Files:**
- Modify: `lib/features/workbench/view/inspector_panel.dart`
- Create: `test/features/workbench/view/inspector_panel_test.dart`

- [ ] **Step 1: Failing widget test** — connection pill renders correctly across `connecting / connected / error / idle` states; disconnected state shows `DiscoveredDevicesList` inline; connected state with a selection shows props/screenshot/tree.

- [ ] **Step 2: Implement.** Reuse the existing `WidgetDetailsPanel` body (it already exists in `lib/features/widget_picker/widgets/`) — import it directly. Connection pill is a new small widget. Disconnected fallback embeds the existing `DiscoveredDevicesList` from `lib/features/connection/widgets/`.

- [ ] **Step 3: Wire `WidgetPickerCubit` from the existing `lib/features/widget_picker/` directory unchanged.**

- [ ] **Step 4: Run, commit.**

```bash
fvm flutter test test/features/workbench/view/inspector_panel_test.dart
git add lib/features/workbench/view/inspector_panel.dart \
        test/features/workbench/view/inspector_panel_test.dart
git commit -m "feat(workbench): add InspectorPanel with connection pill"
```

### Task 32 — `OnboardingView`

**Files:**
- Create: `lib/features/workbench/view/onboarding_view.dart`
- Create: `test/features/workbench/view/onboarding_view_test.dart`

- [ ] **Step 1: One-screen view: brand mark + heading "Add your first Flutter project" + a single `+ Pick folder` button that opens `file_selector.getDirectoryPath()`. On success, calls `ProjectsCubit.add(path)`. On error, shows an inline message.**

- [ ] **Step 2: Failing widget test** — "Pick folder" button visible when projects list is empty; clicking it calls `ProjectsCubit.add` with the path returned by mocked `FileSelectorPlatform`.

- [ ] **Step 3: Implement; run; commit.**

```bash
fvm flutter test test/features/workbench/view/onboarding_view_test.dart
git add lib/features/workbench/view/onboarding_view.dart \
        test/features/workbench/view/onboarding_view_test.dart
git commit -m "feat(workbench): add OnboardingView"
```

---

## Phase 7 — Animation pass

Goal: implement the animation inventory from §6 of the spec. Every animation respects reduce-motion.

### Task 33 — `ReduceMotion` utility

**Files:**
- Create: `lib/shared/motion/reduce_motion.dart`
- Create: `test/shared/motion/reduce_motion_test.dart`

- [ ] **Step 1: Implement.**

```dart
class ReduceMotion {
  static bool of(BuildContext context) =>
      MediaQuery.of(context).disableAnimations;

  static Duration duration(BuildContext context, Duration normal) =>
      of(context) ? Duration.zero : normal;
}
```

- [ ] **Step 2: Test that `ReduceMotion.duration` returns `Duration.zero` when `disableAnimations` is true.**

- [ ] **Step 3: Commit.**

```bash
fvm flutter test test/shared/motion/reduce_motion_test.dart
git add lib/shared/motion/ test/shared/motion/
git commit -m "feat(motion): add ReduceMotion utility"
```

### Task 34 — Shell-wide + left-rail animations

**Files:**
- Modify: `lib/features/workbench/view/app_shell_view.dart`
- Modify: `lib/features/workbench/view/projects_chats_panel.dart`

- [ ] **Step 1: First-mount stagger.** Wrap each pane in `flutter_animate` chained `.fadeIn().slideX()` with 60 ms staggers. Skip when `ReduceMotion.of(context)` is true.

- [ ] **Step 2: Right-pane collapse.** Replace the Area-add/remove with `AnimatedContainer(duration: ReduceMotion.duration(context, 320.ms), curve: Curves.easeOutCubic)` controlling pane width.

- [ ] **Step 3: Active-row indicator pill.** A `Stack` overlay positioned via `AnimatedAlign` that targets the active row; spring physics via `Curves.easeOutCubic` 220 ms.

- [ ] **Step 4: Chats list cross-fade on project switch.** Wrap the chats `ListView` in a `PageTransitionSwitcher` with `FadeThroughTransition` (`animations` package), 360 ms.

- [ ] **Step 5: New chat / delete chat insertion-removal.** Convert chats `ListView.builder` → `AnimatedList` driven by a `ChatsState` listener.

- [ ] **Step 6: Status-dot color tween + spawning shimmer.** Map `PtySessionState` → an `AnimatedContainer` color (gray/amber/green/red) with a `flutter_animate.shimmer()` overlay only when `Spawning`.

- [ ] **Step 7: Run animation tests with reduce-motion enabled** to confirm zero-duration short-circuits.

- [ ] **Step 8: Commit.**

```bash
git add lib/features/workbench/view/app_shell_view.dart \
        lib/features/workbench/view/projects_chats_panel.dart
git commit -m "feat(workbench): shell + left-rail animations"
```

### Task 35 — Middle-pane animations

**Files:**
- Modify: `lib/features/workbench/view/chat_workbench_panel.dart`

- [ ] **Step 1: Forge compose strip "armed" divider.** A 1-px divider whose color and `BoxShadow` blur tween to brand-ember when `WidgetPickerState` has a selection.

- [ ] **Step 2: Forge It button.** Slow `flutter_animate.shimmer(duration: 4s)` ambient; `.scale()` press feedback; on dispatch, replace label with a `Rive` checkmark micro-asset (Task 37 ships the `.riv`).

- [ ] **Step 3: Skill chip indicator slide.** `AnimatedAlign` between selected segments.

- [ ] **Step 4: Inline chat-title edit.** `AnimatedSize` for width transition; opacity tween on the underline.

- [ ] **Step 5: Chat switch — terminal cross-fade.** Wrap `TerminalView` in `AnimatedSwitcher` keyed by `chatId` with `FadeThroughTransition` 240 ms.

- [ ] **Step 6: PTY status overlay.** Bottom-right slide-up + fade via `flutter_animate.slideY(begin: 1, end: 0).fadeIn()`. Spawning state shows a Rive 3-dot bouncer (Task 37).

- [ ] **Step 7: Commit.**

```bash
git add lib/features/workbench/view/chat_workbench_panel.dart
git commit -m "feat(workbench): middle-pane animations"
```

### Task 36 — Right-pane animations

**Files:**
- Modify: `lib/features/workbench/view/inspector_panel.dart`

- [ ] **Step 1: Connection pill color tween.** `AnimatedContainer` 280 ms; on idle→connected, play a one-shot Rive radar-ping micro-asset (Task 37).

- [ ] **Step 2: Select-widget toggle pulse.** A 1.5 Hz opacity oscillation (`flutter_animate.scale().then().scale()` looped) when armed.

- [ ] **Step 3: New widget selection — props block fade-up.** `flutter_animate.fadeIn().slideY(begin: 8.0, end: 0)` 240 ms.

- [ ] **Step 4: Widget tree highlight slide.** `AnimatedPositioned` between active nodes 200 ms; brief 1.04 scale on first arrival.

- [ ] **Step 5: Screenshot swap with blur falloff.** `AnimatedSwitcher` cross-fade combined with `ImageFiltered(BackdropFilter)` blur tween 4 → 0 px.

- [ ] **Step 6: Tree expand/collapse via `AnimatedSize`.**

- [ ] **Step 7: Discovered-devices list stagger-fade.** `flutter_animate` per-item 60 ms apart, 240 ms each.

- [ ] **Step 8: Commit.**

```bash
git add lib/features/workbench/view/inspector_panel.dart
git commit -m "feat(workbench): right-pane animations"
```

### Task 37 — Author Rive assets

**Files:**
- Create: `assets/rive/dot_pulse.riv`
- Create: `assets/rive/spawning_dots.riv`
- Create: `assets/rive/reconnect_radar.riv`
- Create: `assets/rive/forge_success_check.riv`
- Create: `assets/rive/folder_pick.riv`
- Modify: `pubspec.yaml` (`flutter:` → `assets:` already includes `assets/`; add `assets/rive/` if not covered).

- [ ] **Step 1: Add the five `.riv` files supplied by the project owner to match the inventory in §6.2 of the spec. Total payload < 200 KB. If assets are not supplied, stop and ask before continuing.**

- [ ] **Step 2: Add the directory to pubspec assets** if not already covered.

```yaml
flutter:
  assets:
    - assets/rive/
```

- [ ] **Step 3: Wire each asset to its consumer** in the panel widgets:
- `dot_pulse.riv` — left-rail status dot for `Spawning`.
- `spawning_dots.riv` — middle-pane PTY status overlay.
- `reconnect_radar.riv` — inspector connection pill on `connecting → connected` transition.
- `forge_success_check.riv` — Forge It button success morph.
- `folder_pick.riv` — onboarding hero illustration.

- [ ] **Step 4: Run a debug build and verify each asset loads** (rive `RiveAnimation.asset(...)` paths resolve).

- [ ] **Step 5: Commit.**

```bash
git add assets/rive/ pubspec.yaml \
        lib/features/workbench/view/
git commit -m "feat(motion): add rive micro-assets and wire to consumers"
```

---

## Phase 8 — Router + Settings

Goal: rewire the router to land users in the new shell, drop the old gateway routes, and add the embedded-terminal settings page.

### Task 38 — Update the router

**Files:**
- Modify: `lib/core/router/app_router.dart`
- Delete: `lib/features/connection/view/connection_view.dart` and matching test (`DiscoveredDevicesList` already moved to inspector panel).
- Delete: `lib/features/widget_picker/view/dock_view.dart` and matching test.
- Delete: `lib/features/history/` (entire feature — replaced by per-chat history).

- [ ] **Step 1: Replace router contents.**

```dart
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:get_it/get_it.dart';
import 'package:go_router/go_router.dart';
import 'package:pickforge/features/settings/view/settings_view.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/view/app_shell_view.dart';
import 'package:pickforge/features/workbench/view/onboarding_view.dart';

class AppRoutes {
  const AppRoutes._();
  static const root = '/';
  static const workbench = '/workbench';
  static const onboarding = '/onboarding';
  static const settings = '/settings';
}

GoRouter buildAppRouter() {
  return GoRouter(
    initialLocation: AppRoutes.root,
    redirect: (context, state) async {
      if (state.matchedLocation != AppRoutes.root) return null;
      final cubit = GetIt.I<ProjectsCubit>();
      // Force a load if not yet ready.
      if (cubit.state is! ProjectsReady) await cubit.load();
      final ready = cubit.state;
      if (ready is ProjectsReady && ready.projects.isEmpty) {
        return AppRoutes.onboarding;
      }
      return AppRoutes.workbench;
    },
    routes: [
      GoRoute(path: AppRoutes.root, redirect: (_, __) => null, builder: (_, __) => const SizedBox()),
      GoRoute(path: AppRoutes.onboarding, builder: (_, __) => const OnboardingView()),
      GoRoute(path: AppRoutes.workbench, builder: (_, __) => const AppShellView()),
      GoRoute(path: AppRoutes.settings, builder: (_, __) => const SettingsView()),
    ],
  );
}
```

- [ ] **Step 2: Delete obsolete views and tests.**

```bash
git rm -r lib/features/history \
         lib/features/connection/view/connection_view.dart \
         lib/features/widget_picker/view/dock_view.dart \
         test/features/history \
         test/features/connection/view/connection_view_test.dart \
         test/features/widget_picker/view/dock_view_test.dart 2>/dev/null || true
```

(`DiscoveredDevicesList` and `device_discovery_cubit` STAY — they're now consumed by `InspectorPanel`. Don't delete those.)

- [ ] **Step 3: Search for any imports of the deleted files; remove or repoint.**

Run: `grep -rn "ConnectionView\|DockView\|HistoryView\|/history" lib/ test/`
Expected: no matches.

- [ ] **Step 4: Run the full test suite.**

Run: `fvm flutter test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
fvm dart format . && fvm flutter analyze
git add -A
git commit -m "refactor(router): land at workbench/onboarding; drop connect, dock, history routes"
```

### Task 39 — Settings: Embedded Terminal section

**Files:**
- Modify: `lib/features/settings/view/settings_view.dart`
- Modify: `lib/features/settings/cubit/settings_cubit.dart`
- Modify: `test/features/settings/cubit/settings_cubit_test.dart`

- [ ] **Step 1: Add a new "Embedded Terminal" section in `SettingsView` with three controls bound to `EmbeddedTerminalSettingsRepository`:**
- Font family dropdown — `monospace`, `JetBrains Mono`, `Berkeley Mono`, system fallback.
- Font size slider 10–18 px.
- Theme dropdown — `pickforgeEmber`, `draculaDark`, `solarizedDark`.

- [ ] **Step 2: Wire `SettingsCubit` to load on init and save on change.**

- [ ] **Step 3: Run cubit tests; commit.**

```bash
fvm flutter test test/features/settings/
git add lib/features/settings/ test/features/settings/
git commit -m "feat(settings): expose embedded terminal preferences"
```

---

## Phase 9 — Goldens + integration test

Goal: lock in visual regressions on the shell, validate the end-to-end PTY path with a stub agent.

### Task 40 — Shell layout goldens

**Files:**
- Create: `test/golden/workbench_shell_default_light.png`
- Create: `test/golden/workbench_shell_default_dark.png`
- Create: `test/golden/workbench_shell_narrow.png`
- Create: `test/golden/workbench_shell_right_collapsed.png`
- Create: `test/features/workbench/view/app_shell_view_golden_test.dart`

- [ ] **Step 1: Write the golden test** that pumps `AppShellView` with stubbed cubit states, takes goldens at three viewport widths and both themes, compares to fixture files.

- [ ] **Step 2: Generate the goldens on Linux.**

Run: `fvm flutter test --update-goldens test/features/workbench/view/app_shell_view_golden_test.dart`

- [ ] **Step 3: Verify they match on a fresh run.**

Run: `fvm flutter test test/features/workbench/view/app_shell_view_golden_test.dart`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add test/golden/ test/features/workbench/view/app_shell_view_golden_test.dart
git commit -m "test(workbench): add shell layout goldens"
```

### Task 41 — Inspector pill state goldens

**Files:**
- Create: `test/golden/inspector_pill_*.png` for each state (`connecting`, `connected`, `error`, `idle`).
- Create: `test/features/workbench/view/inspector_panel_golden_test.dart`

- [ ] **Step 1: Pump `InspectorPanel` with each state in turn; capture goldens.**

- [ ] **Step 2: Generate, verify, commit.**

```bash
fvm flutter test --update-goldens test/features/workbench/view/inspector_panel_golden_test.dart
fvm flutter test test/features/workbench/view/inspector_panel_golden_test.dart
git add test/golden/ test/features/workbench/view/inspector_panel_golden_test.dart
git commit -m "test(workbench): add inspector pill state goldens"
```

### Task 42 — Integration test (PTY stub)

**Files:**
- Create: `integration_test/embedded_terminal_test.dart`
- Create: `integration_test/fixtures/stub_agent.sh` (executable; an `echo` loop)

- [ ] **Step 1: Stub agent script.**

```bash
#!/usr/bin/env bash
while IFS= read -r line; do
  echo "[stub] you said: $line"
done
```

`chmod +x integration_test/fixtures/stub_agent.sh`. Skip on Windows; gate the test with `if (!Platform.isWindows)`.

- [ ] **Step 2: Integration test** that boots a minimal app, adds a project pointing at `integration_test/fixtures/`, creates a chat that uses `stub_agent.sh` as its `executable`, sends a prompt via `PtySessionPool.sendPrompt`, asserts the xterm buffer contains `[stub] you said:`, and asserts the `transcript.log` file on disk contains the same text.

- [ ] **Step 3: Run.**

Run: `fvm flutter test integration_test/embedded_terminal_test.dart`
Expected: PASS on Linux/macOS.

- [ ] **Step 4: Commit.**

```bash
git add integration_test/
git commit -m "test: integration coverage for embedded PTY happy path"
```

---

## Phase 10 — Documentation

### Task 43 — Update README quick-start

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Drop terminal-profile detection mention. Reframe to "Pickforge is the terminal." Add a `+ Add project` first-step screenshot if available.**

- [ ] **Step 2: Commit.**

```bash
git add README.md
git commit -m "docs(readme): refresh quick-start for embedded terminal"
```

### Task 44 — Architecture doc

**Files:**
- Create: `docs/architecture/embedded-terminal.md`

- [ ] **Step 1: Write the doc** — one file summarizing the PTY pool, scrollback persistence model, and chat lifecycle for future contributors. Cross-reference `docs/superpowers/specs/2026-04-25-embedded-terminal-design.md` for the full design rationale and `NOTES.md` for decisions.

Structure:
- **Overview** (1 paragraph)
- **Lifecycle of a chat** (state diagram in ascii or mermaid)
- **PTY pool policy** (when chats live, when they park)
- **Transcript on disk** (file layout, truncation)
- **Forge It data flow** (diagram)
- **Where to read code** (file paths)

- [ ] **Step 2: Commit.**

```bash
git add docs/architecture/embedded-terminal.md
git commit -m "docs: add embedded-terminal architecture overview"
```

---

## Self-Review Checklist (run after the last commit)

- [ ] Spec §3 (architecture) — every component named has a corresponding task. ✅
- [ ] Spec §4 (data model) — Drift changes covered in Tasks 2–6. ✅
- [ ] Spec §5 (layout) — Tasks 28–32 ship the panes. ✅
- [ ] Spec §6 (animations) — Tasks 33–37. ✅
- [ ] Spec §7 (dependencies) — Tasks 1, 8. ✅
- [ ] Spec §8 (error handling) — partially covered inside the relevant cubit/PTY tasks. Before execution, add concrete tests for project-missing, transcript corruption, write-to-closed-PTY toast, and Drift migration failure recovery; binary-not-found is covered in Task 11.
- [ ] Spec §9 (security) — credential isolation is structural (not a code change); covered by the PTY abstraction. No task needed beyond the design choice.
- [ ] Spec §10 (performance) — `RepaintBoundary` placement must be made explicit in Tasks 28–31 before UI execution; recorder isolate / async-map choice remains deferred but must not block PTY reads.
- [ ] Spec §11 (testing) — every task ends in a test cycle; goldens (Tasks 40–41); integration (Task 42).
- [ ] Spec §12 (rollout) — 10 phases match the spec's 10 sub-commits.
- [ ] Spec §13 (documentation) — Tasks 43–44.
- [ ] Spec §14 (out of scope) — none of these appear in the plan. ✅
- [ ] Spec §15 (success criteria) — verified at the end of Phase 9.

---

**End of plan.** 44 tasks across 10 phases. Begin with Phase 1, Task 1.
