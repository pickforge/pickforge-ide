import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  test(
      'v2 -> v3 adds emulator columns + run_session_log; backfills connectionMode=manual',
      () async {
    final raw = NativeDatabase.memory(setup: (s) {
      s
        ..execute('''
          CREATE TABLE project_settings (
            project_root TEXT NOT NULL PRIMARY KEY,
            vm_service_url TEXT,
            default_agent_id TEXT,
            last_chat_id TEXT,
            pane_sizes TEXT,
            last_used_at INTEGER
          );
        ''')
        ..execute(
            'CREATE TABLE projects (project_root TEXT PRIMARY KEY, display_name TEXT, created_at INTEGER, last_opened_at INTEGER);')
        ..execute('CREATE TABLE chats (id TEXT PRIMARY KEY);')
        ..execute(
            'CREATE TABLE pick_history (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT);')
        ..execute(
            'CREATE TABLE agent_run_log (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER, hot_reload_count INTEGER NOT NULL DEFAULT 0, wrapper_script_path TEXT NOT NULL, pick_id INTEGER NOT NULL);')
        ..execute('PRAGMA user_version = 2;')
        ..execute(
          'INSERT INTO project_settings (project_root, vm_service_url) '
          "VALUES ('/tmp/manual', 'ws://x/ws');",
        )
        ..execute(
          "INSERT INTO project_settings (project_root) VALUES ('/tmp/empty');",
        );
    });

    final db = PickforgeDatabase.forTesting(raw);

    final cols =
        await db.customSelect('PRAGMA table_info(project_settings);').get();
    final names = cols.map((r) => r.read<String>('name')).toSet();
    expect(names.contains('avd_id'), isTrue);
    expect(names.contains('avd_name'), isTrue);
    expect(names.contains('connection_mode'), isTrue);
    expect(names.contains('flutter_run_args'), isTrue);
    expect(names.contains('target_file'), isTrue);
    expect(names.contains('auto_boot_on_select'), isTrue);
    expect(names.contains('first_run_celebrated'), isTrue);

    final logCols =
        await db.customSelect('PRAGMA table_info(run_session_log);').get();
    expect(logCols, isNotEmpty);

    final manual = await db
        .customSelect(
          "SELECT connection_mode FROM project_settings WHERE project_root='/tmp/manual'",
        )
        .getSingle();
    expect(manual.read<String>('connection_mode'), 'manual');

    final empty = await db
        .customSelect(
          "SELECT connection_mode FROM project_settings WHERE project_root='/tmp/empty'",
        )
        .getSingle();
    expect(empty.read<String>('connection_mode'), 'auto');

    await db.close();
  });
}
