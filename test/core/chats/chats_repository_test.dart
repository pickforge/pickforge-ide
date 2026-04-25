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
    await pDao.upsert(
      projectRoot: '/tmp/p',
      displayName: 'p',
      now: DateTime(2026, 4, 25),
    );
    repo = ChatsRepository(ChatsDao(db));
  });

  tearDown(() async => db.close());

  test('newChat uses default title and agent', () async {
    final id = await repo.newChat(
      projectRoot: '/tmp/p',
      defaultAgentId: 'claude-code',
    );
    final all = await repo.list('/tmp/p');
    expect(all, hasLength(1));
    expect(all.single.chatId, id);
    expect(all.single.title, 'Chat 1');
    expect(all.single.agentId, 'claude-code');
  });

  test('newChat increments title counter', () async {
    await repo.newChat(projectRoot: '/tmp/p', defaultAgentId: 'codex');
    await repo.newChat(projectRoot: '/tmp/p', defaultAgentId: 'codex');
    final titles = (await repo.list('/tmp/p')).map((c) => c.title).toList()
      ..sort();
    expect(titles, ['Chat 1', 'Chat 2']);
  });
}
