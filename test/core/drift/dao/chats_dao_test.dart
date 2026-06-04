import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/chats/chat_metadata.dart';
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

  test('setTaskStatus + setTaskBrief + setLabels updates task metadata',
      () async {
    final id = await dao.insert(
      projectRoot: '/tmp/app',
      title: 'Task',
      agentId: 'codex',
      now: DateTime(2026, 4, 25),
    );

    await dao.setTaskStatus(id, ChatTaskStatus.waiting);
    await dao.setTaskBrief(id, '  Polish the sidebar  ');
    await dao.setLabels(id, ['ui', 'ui', 'release']);

    final row = (await dao.byProject('/tmp/app')).single;
    expect(row.taskStatus, ChatTaskStatus.waiting);
    expect(row.taskBrief, 'Polish the sidebar');
    expect(row.taskLabels, ['ui', 'release']);
  });
}
