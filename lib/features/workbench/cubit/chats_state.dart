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
  const ChatsLoading(this.projectRoot);

  final String projectRoot;

  @override
  List<Object?> get props => [projectRoot];
}

class ChatsReady extends ChatsState {
  const ChatsReady({
    required this.projectRoot,
    required this.chats,
    this.activeChatId,
  });

  final String projectRoot;
  final List<ChatRow> chats;
  final String? activeChatId;

  ChatsReady copyWith({
    String? projectRoot,
    List<ChatRow>? chats,
    String? activeChatId,
  }) =>
      ChatsReady(
        projectRoot: projectRoot ?? this.projectRoot,
        chats: chats ?? this.chats,
        activeChatId: activeChatId ?? this.activeChatId,
      );

  @override
  List<Object?> get props => [projectRoot, chats, activeChatId];
}

class ChatsError extends ChatsState {
  const ChatsError(this.message);

  final String message;

  @override
  List<Object?> get props => [message];
}
