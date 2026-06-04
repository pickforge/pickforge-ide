import 'package:drift/drift.dart';
import 'package:pickforge/core/chats/chat_metadata.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/drift/tables/chats.dart';
import 'package:uuid/uuid.dart';

part 'chats_dao.g.dart';

@DriftAccessor(tables: [Chats])
class ChatsDao extends DatabaseAccessor<PickforgeDatabase>
    with _$ChatsDaoMixin {
  ChatsDao(super.attachedDatabase, {Uuid? uuid}) : _uuid = uuid ?? const Uuid();

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
            (c) => OrderingTerm(
                  expression: c.lastActivityAt,
                  mode: OrderingMode.desc,
                ),
          ]))
        .get();
  }

  Future<List<ChatRow>> all({int limit = 100}) {
    return (select(chats)
          ..orderBy([
            (c) => OrderingTerm(
                  expression: c.lastActivityAt,
                  mode: OrderingMode.desc,
                ),
            (c) => OrderingTerm(expression: c.title),
          ])
          ..limit(limit))
        .get();
  }

  Future<void> rename(String chatId, String title) =>
      (update(chats)..where((c) => c.chatId.equals(chatId)))
          .write(ChatsCompanion(title: Value(title)));

  Future<void> setSessionId(String chatId, String? sessionId) =>
      (update(chats)..where((c) => c.chatId.equals(chatId)))
          .write(ChatsCompanion(sessionId: Value(sessionId)));

  Future<void> setSkillId(String chatId, String skillId) =>
      (update(chats)..where((c) => c.chatId.equals(chatId)))
          .write(ChatsCompanion(skillId: Value(skillId)));

  Future<void> setTaskStatus(String chatId, ChatTaskStatus status) =>
      (update(chats)..where((c) => c.chatId.equals(chatId)))
          .write(ChatsCompanion(status: Value(status.name)));

  Future<void> setTaskBrief(String chatId, String? taskBrief) =>
      (update(chats)..where((c) => c.chatId.equals(chatId))).write(
        ChatsCompanion(taskBriefText: Value(normalizeTaskBrief(taskBrief))),
      );

  Future<void> setLabels(String chatId, List<String> labels) =>
      (update(chats)..where((c) => c.chatId.equals(chatId))).write(
        ChatsCompanion(labelsJson: Value(encodeChatLabels(labels))),
      );

  Future<void> touch(String chatId, DateTime now) =>
      (update(chats)..where((c) => c.chatId.equals(chatId)))
          .write(ChatsCompanion(lastActivityAt: Value(now)));

  Future<void> remove(String chatId) =>
      (delete(chats)..where((c) => c.chatId.equals(chatId))).go();
}
