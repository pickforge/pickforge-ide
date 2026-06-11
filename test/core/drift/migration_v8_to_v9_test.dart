import 'package:drift/drift.dart' show Variable;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  test('v8 -> v9 adds projects.archived_at', () async {
    final raw = NativeDatabase.memory(
      setup: (s) {
        s
          ..execute('''
            CREATE TABLE projects (
              project_root TEXT NOT NULL PRIMARY KEY,
              display_name TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              last_opened_at INTEGER NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0
            );
          ''')
          ..execute('PRAGMA user_version = 8;')
          ..execute(
            'INSERT INTO projects '
            '(project_root, display_name, created_at, last_opened_at) '
            "VALUES ('/tmp/app', 'app', 0, 0);",
          );
      },
    );

    final db = PickforgeDatabase.forTesting(raw);

    final cols = await db.customSelect('PRAGMA table_info(projects);').get();
    final names = cols.map((r) => r.read<String>('name')).toSet();
    expect(names.contains('archived_at'), isTrue);

    final row = await db.customSelect(
      'SELECT display_name, archived_at FROM projects '
      'WHERE project_root = ?',
      variables: [Variable.withString('/tmp/app')],
    ).getSingle();
    expect(row.read<String>('display_name'), 'app');
    expect(row.readNullable<int>('archived_at'), isNull);

    await db.close();
  });
}
