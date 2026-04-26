import 'dart:io';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/chats/chats_repository.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';

@injectable
class ChatsCubit extends Cubit<ChatsState> {
  ChatsCubit(this._repo) : super(const ChatsInitial());

  final ChatsRepository _repo;

  Future<void> load(String projectRoot, {String? selectChatId}) async {
    emit(ChatsLoading(projectRoot));
    final chats = await _repo.list(projectRoot);
    final active =
        selectChatId ?? (chats.isNotEmpty ? chats.first.chatId : null);
    emit(
      ChatsReady(
        projectRoot: projectRoot,
        chats: chats,
        activeChatId: active,
      ),
    );
  }

  Future<String?> newChat({
    required String projectRoot,
    required String defaultAgentId,
    String? skillId,
  }) async {
    final id = await _repo.newChat(
      projectRoot: projectRoot,
      defaultAgentId: defaultAgentId,
      skillId: skillId,
    );
    await load(projectRoot, selectChatId: id);
    return id;
  }

  void selectChat(String chatId) {
    final s = state;
    if (s is! ChatsReady) return;
    emit(s.copyWith(activeChatId: chatId));
  }

  Future<void> rename(String chatId, String title) async {
    final s = state;
    if (s is! ChatsReady) return;
    await _repo.rename(chatId, title);
    await load(s.projectRoot, selectChatId: s.activeChatId);
  }

  Future<void> remove(String chatId) async {
    final s = state;
    if (s is! ChatsReady) return;
    await _repo.remove(chatId);
    final dir = Directory(
      p.join(s.projectRoot, '.pickforge', 'chats', chatId),
    );
    try {
      if (dir.existsSync()) await dir.delete(recursive: true);
    } on FileSystemException catch (e) {
      emit(ChatsError('Failed to delete transcript: ${e.message}'));
    }
    await load(s.projectRoot);
  }
}
