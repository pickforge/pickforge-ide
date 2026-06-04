import 'package:drift/drift.dart' show Variable;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/chats/chat_metadata.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  test('v6 -> v7 adds chat task organization metadata', () async {
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
          ..execute('''
            CREATE TABLE chats (
              chat_id TEXT NOT NULL PRIMARY KEY,
              project_root TEXT NOT NULL REFERENCES projects (project_root) ON DELETE CASCADE,
              title TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              skill_id TEXT,
              session_id TEXT,
              created_at INTEGER NOT NULL,
              last_activity_at INTEGER NOT NULL,
              sort_order INTEGER NOT NULL DEFAULT 0
            );
          ''')
          ..execute('PRAGMA user_version = 6;')
          ..execute(
            'INSERT INTO projects '
            '(project_root, display_name, created_at, last_opened_at) '
            "VALUES ('/tmp/app', 'app', 1, 1);",
          )
          ..execute(
            'INSERT INTO chats '
            '(chat_id, project_root, title, agent_id, created_at, '
            'last_activity_at) '
            "VALUES ('chat-1', '/tmp/app', 'Existing task', 'codex', 1, 1);",
          );
      },
    );

    final db = PickforgeDatabase.forTesting(raw);

    final cols = await db.customSelect('PRAGMA table_info(chats);').get();
    final names = cols.map((r) => r.read<String>('name')).toSet();
    expect(names, containsAll(['labels_json', 'status', 'task_brief_text']));

    final rawRow = await db.customSelect(
      'SELECT title, labels_json, status, task_brief_text '
      'FROM chats WHERE chat_id = ?',
      variables: [Variable.withString('chat-1')],
    ).getSingle();
    expect(rawRow.read<String>('title'), 'Existing task');
    expect(rawRow.readNullable<String>('labels_json'), isNull);
    expect(rawRow.readNullable<String>('status'), isNull);
    expect(rawRow.readNullable<String>('task_brief_text'), isNull);

    final chat = (await db.chatsDao.byProject('/tmp/app')).single;
    expect(chat.taskStatus, ChatTaskStatus.active);
    expect(chat.taskLabels, isEmpty);
    expect(chat.taskBrief, isNull);

    await db.close();
  });
}
