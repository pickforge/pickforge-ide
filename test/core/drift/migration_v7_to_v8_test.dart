import 'package:drift/drift.dart' show Variable;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  test('v7 -> v8 adds project_settings.validator_command', () async {
    final raw = NativeDatabase.memory(
      setup: (s) {
        s
          ..execute('''
            CREATE TABLE project_settings (
              project_root TEXT NOT NULL PRIMARY KEY,
              vm_service_url TEXT,
              default_agent_id TEXT,
              last_chat_id TEXT,
              pane_sizes TEXT,
              last_used_at INTEGER,
              avd_id TEXT,
              avd_name TEXT,
              connection_mode TEXT NOT NULL DEFAULT 'auto',
              flutter_run_args TEXT,
              target_file TEXT,
              emulator_launch_options TEXT,
              emulator_idle_shutdown TEXT,
              auto_boot_on_select INTEGER NOT NULL DEFAULT 1,
              first_run_celebrated INTEGER NOT NULL DEFAULT 0
            );
          ''')
          ..execute('PRAGMA user_version = 7;')
          ..execute(
            'INSERT INTO project_settings '
            '(project_root, default_agent_id) '
            "VALUES ('/tmp/app', 'codex');",
          );
      },
    );

    final db = PickforgeDatabase.forTesting(raw);

    final cols =
        await db.customSelect('PRAGMA table_info(project_settings);').get();
    final names = cols.map((r) => r.read<String>('name')).toSet();
    expect(names.contains('validator_command'), isTrue);

    final row = await db.customSelect(
      'SELECT default_agent_id, validator_command '
      'FROM project_settings WHERE project_root = ?',
      variables: [Variable.withString('/tmp/app')],
    ).getSingle();
    expect(row.read<String>('default_agent_id'), 'codex');
    expect(row.readNullable<String>('validator_command'), isNull);

    await db.close();
  });
}
