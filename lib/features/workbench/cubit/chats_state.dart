import 'package:equatable/equatable.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

sealed class ChatsState extends Equatable {
  const ChatsState();

  @override
  List<Object?> get props => [];
}

class ChatsInitial extends ChatsState {
  const ChatsInitial();
}

class ChatsLoading extends ChatsState {
  const ChatsLoading();
}

class ChatsReady extends ChatsState {
  const ChatsReady({
    required this.chatsByProject,
    required this.expanded,
    this.activeChatId,
  });

  final Map<String, List<ChatRow>> chatsByProject;
  final Set<String> expanded;
  final String? activeChatId;

  ChatRow? get activeChat {
    if (activeChatId == null) return null;
    for (final list in chatsByProject.values) {
      for (final c in list) {
        if (c.chatId == activeChatId) return c;
      }
    }
    return null;
  }

  ChatsReady copyWith({
    Map<String, List<ChatRow>>? chatsByProject,
    Set<String>? expanded,
    Object? activeChatId = _sentinel,
  }) =>
      ChatsReady(
        chatsByProject: chatsByProject ?? this.chatsByProject,
        expanded: expanded ?? this.expanded,
        activeChatId: identical(activeChatId, _sentinel)
            ? this.activeChatId
            : activeChatId as String?,
      );

  @override
  List<Object?> get props => [chatsByProject, expanded, activeChatId];
}

class ChatsError extends ChatsState {
  const ChatsError(this.message);

  final String message;

  @override
  List<Object?> get props => [message];
}

const _sentinel = Object();
