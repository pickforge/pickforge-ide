import 'package:injectable/injectable.dart';
import 'package:pickforge/core/chats/chat_metadata.dart';
import 'package:pickforge/core/drift/dao/chats_dao.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

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

  Future<void> rename(String chatId, String title) =>
      _dao.rename(chatId, title);

  Future<void> setSessionId(String chatId, String? sessionId) =>
      _dao.setSessionId(chatId, sessionId);

  Future<void> setSkillId(String chatId, String skillId) =>
      _dao.setSkillId(chatId, skillId);

  Future<void> setTaskStatus(String chatId, ChatTaskStatus status) =>
      _dao.setTaskStatus(chatId, status);

  Future<void> setTaskBrief(String chatId, String? taskBrief) =>
      _dao.setTaskBrief(chatId, taskBrief);

  Future<void> setLabels(String chatId, List<String> labels) =>
      _dao.setLabels(chatId, labels);

  Future<void> touch(String chatId) => _dao.touch(chatId, DateTime.now());

  Future<void> remove(String chatId) => _dao.remove(chatId);
}
