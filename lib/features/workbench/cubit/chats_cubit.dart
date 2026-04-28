import 'dart:io';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/chats/chats_repository.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';

@injectable
class ChatsCubit extends Cubit<ChatsState> {
  ChatsCubit(this._repo) : super(const ChatsInitial());

  final ChatsRepository _repo;

  Future<void> syncProjects(
    List<String> projectRoots, {
    String? defaultExpand,
  }) async {
    final firstSync = state is! ChatsReady;
    if (firstSync) emit(const ChatsLoading());

    final priorReady = state is ChatsReady ? state as ChatsReady : null;
    final priorChats = priorReady?.chatsByProject ?? const {};
    final priorExpanded = priorReady?.expanded ?? const <String>{};

    final newChats = <String, List<ChatRow>>{};
    for (final root in projectRoots) {
      newChats[root] = await _repo.list(root);
    }

    final expanded = <String>{
      ...priorExpanded.where(projectRoots.contains),
    };
    if (firstSync) {
      if (defaultExpand != null && projectRoots.contains(defaultExpand)) {
        expanded.add(defaultExpand);
      }
    } else {
      expanded.addAll(
        projectRoots.where((r) => !priorChats.containsKey(r)),
      );
    }

    final priorActive = priorReady?.activeChatId;
    final stillExists = priorActive != null &&
        newChats.values.any((l) => l.any((c) => c.chatId == priorActive));
    final activeId = stillExists ? priorActive : null;

    emit(
      ChatsReady(
        chatsByProject: newChats,
        expanded: expanded,
        activeChatId: activeId,
      ),
    );
  }

  Future<void> _refreshProject(String projectRoot) async {
    final s = state;
    if (s is! ChatsReady) return;
    final list = await _repo.list(projectRoot);
    emit(
      s.copyWith(
        chatsByProject: {...s.chatsByProject, projectRoot: list},
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
    final s = state;
    if (s is ChatsReady) {
      final list = await _repo.list(projectRoot);
      emit(
        s.copyWith(
          chatsByProject: {...s.chatsByProject, projectRoot: list},
          expanded: {...s.expanded, projectRoot},
          activeChatId: id,
        ),
      );
    }
    return id;
  }

  void selectChat(String chatId) {
    final s = state;
    if (s is! ChatsReady) return;
    emit(s.copyWith(activeChatId: chatId));
  }

  void toggleExpanded(String projectRoot) {
    final s = state;
    if (s is! ChatsReady) return;
    final next = {...s.expanded};
    if (!next.remove(projectRoot)) next.add(projectRoot);
    emit(s.copyWith(expanded: next));
  }

  Future<void> rename(String chatId, String title) async {
    final s = state;
    if (s is! ChatsReady) return;
    await _repo.rename(chatId, title);
    final root = _projectOfChat(s, chatId);
    if (root != null) await _refreshProject(root);
  }

  Future<void> remove(String chatId) async {
    final s = state;
    if (s is! ChatsReady) return;
    final root = _projectOfChat(s, chatId);
    await _repo.remove(chatId);
    if (root != null) {
      final dir = Directory(p.join(root, '.pickforge', 'chats', chatId));
      try {
        if (dir.existsSync()) await dir.delete(recursive: true);
      } on FileSystemException catch (e) {
        emit(ChatsError('Failed to delete transcript: ${e.message}'));
        return;
      }
      await _refreshProject(root);
      if (s.activeChatId == chatId) {
        final after = state;
        if (after is ChatsReady) {
          emit(after.copyWith(activeChatId: null));
        }
      }
    }
  }

  String? _projectOfChat(ChatsReady s, String chatId) {
    for (final entry in s.chatsByProject.entries) {
      if (entry.value.any((c) => c.chatId == chatId)) return entry.key;
    }
    return null;
  }
}
