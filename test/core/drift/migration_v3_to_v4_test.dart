import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  test('v3 -> v4 adds run_session_log.target_file', () async {
    final raw = NativeDatabase.memory(
      setup: (s) {
        s
          ..execute('''
            CREATE TABLE run_session_log (
              session_id TEXT NOT NULL PRIMARY KEY,
              project_root TEXT NOT NULL,
              started_at INTEGER NOT NULL,
              ended_at INTEGER,
              avd_id TEXT,
              avd_name TEXT,
              serial TEXT,
              vm_service_url TEXT,
              connection_mode TEXT NOT NULL,
              exit_reason TEXT,
              exit_code INTEGER,
              hot_reload_count INTEGER NOT NULL DEFAULT 0,
              hot_restart_count INTEGER NOT NULL DEFAULT 0,
              error_count INTEGER NOT NULL DEFAULT 0,
              last_error TEXT
            );
          ''')
          ..execute('PRAGMA user_version = 3;');
      },
    );

    final db = PickforgeDatabase.forTesting(raw);
    final cols =
        await db.customSelect('PRAGMA table_info(run_session_log);').get();
    final names = cols.map((r) => r.read<String>('name')).toSet();
    expect(names.contains('target_file'), isTrue);

    await db.close();
  });
}
