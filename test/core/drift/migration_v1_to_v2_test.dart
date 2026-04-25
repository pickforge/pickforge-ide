import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  test(
    'v1 → v2 creates Projects, Chats; adds lastChatId, paneSizes, '
    'pick_history.chat_id; backfills Projects',
    () async {
      // Simulate v1 schema using NativeDatabase.memory's setup callback.
      final raw = NativeDatabase.memory(
        setup: (s) {
          s
            ..execute('''
              CREATE TABLE project_settings (
                project_root TEXT NOT NULL PRIMARY KEY,
                vm_service_url TEXT,
                default_agent_id TEXT,
                default_terminal_id TEXT,
                last_used_at INTEGER
              );
            ''')
            ..execute('''
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
            ''')
            ..execute('''
              CREATE TABLE agent_run_log (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                pick_id INTEGER NOT NULL,
                started_at INTEGER NOT NULL,
                finished_at INTEGER,
                exit_code INTEGER,
                hot_reload_count INTEGER NOT NULL DEFAULT 0,
                wrapper_script_path TEXT NOT NULL
              );
            ''')
            ..execute('PRAGMA user_version = 1;')
            ..execute(
              'INSERT INTO project_settings (project_root, vm_service_url, '
              'default_agent_id, default_terminal_id, last_used_at) '
              "VALUES ('/tmp/a', 'ws://x/ws', 'claude-code', 'ghostty', "
              '1714000000000);',
            );
        },
      );

      final db = PickforgeDatabase.forTesting(raw);

      // Touch the new tables / columns to trigger migration.
      final projects = await db.customSelect('SELECT * FROM projects').get();
      final chats = await db.customSelect('SELECT * FROM chats').get();
      final settingsCols =
          await db.customSelect('PRAGMA table_info(project_settings);').get();
      final pickCols =
          await db.customSelect('PRAGMA table_info(pick_history);').get();

      expect(projects, hasLength(1));
      expect(projects.single.read<String>('project_root'), '/tmp/a');
      expect(projects.single.read<String>('display_name'), 'a');

      expect(chats, isEmpty);

      final names = settingsCols.map((r) => r.read<String>('name')).toSet();
      expect(names.contains('last_chat_id'), isTrue);
      expect(names.contains('pane_sizes'), isTrue);
      expect(names.contains('default_terminal_id'), isFalse);

      final pickNames = pickCols.map((r) => r.read<String>('name')).toSet();
      expect(pickNames.contains('chat_id'), isTrue);

      await db.close();
    },
  );

  test('foreign keys cascade chats when project removed', () async {
    final raw = NativeDatabase.memory();
    final db = PickforgeDatabase.forTesting(raw);
    await db.customStatement('PRAGMA foreign_keys = ON;');

    await db.projectsDao.upsert(
      projectRoot: '/tmp/a',
      displayName: 'a',
      now: DateTime(2026, 4, 25),
    );
    await db.chatsDao.insert(
      projectRoot: '/tmp/a',
      title: 'C1',
      agentId: 'codex',
      now: DateTime(2026, 4, 25),
    );
    expect(await db.chatsDao.byProject('/tmp/a'), hasLength(1));

    await db.projectsDao.remove('/tmp/a');
    expect(await db.chatsDao.byProject('/tmp/a'), isEmpty);

    await db.close();
  });
}
