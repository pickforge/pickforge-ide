import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/chats/chats_repository.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';

class _MockRepo extends Mock implements ChatsRepository {}

ChatRow _row(String id, String project, String title) => ChatRow(
      chatId: id,
      projectRoot: project,
      title: title,
      agentId: 'codex',
      createdAt: DateTime(2026, 4, 25),
      lastActivityAt: DateTime(2026, 4, 25),
      sortOrder: 0,
    );

void main() {
  late _MockRepo repo;
  setUp(() => repo = _MockRepo());

  blocTest<ChatsCubit, ChatsState>(
    'load emits Loading then Ready with first chat active',
    setUp: () {
      when(() => repo.list('/p'))
          .thenAnswer((_) async => [_row('c1', '/p', 'Chat 1')]);
    },
    build: () => ChatsCubit(repo),
    act: (c) => c.load('/p'),
    expect: () => [
      isA<ChatsLoading>(),
      isA<ChatsReady>()
          .having((s) => s.chats.length, 'count', 1)
          .having((s) => s.activeChatId, 'active', 'c1'),
    ],
  );

  blocTest<ChatsCubit, ChatsState>(
    'newChat inserts and selects the new chat',
    setUp: () {
      when(
        () => repo.newChat(
          projectRoot: '/p',
          defaultAgentId: 'codex',
          skillId: any(named: 'skillId'),
        ),
      ).thenAnswer((_) async => 'c-new');
      when(() => repo.list('/p'))
          .thenAnswer((_) async => [_row('c-new', '/p', 'Chat 1')]);
    },
    build: () => ChatsCubit(repo),
    act: (c) => c.newChat(projectRoot: '/p', defaultAgentId: 'codex'),
    expect: () => [
      isA<ChatsLoading>(),
      isA<ChatsReady>().having((s) => s.activeChatId, 'active', 'c-new'),
    ],
  );

  blocTest<ChatsCubit, ChatsState>(
    'selectChat updates active without reloading',
    setUp: () {
      when(() => repo.list('/p')).thenAnswer(
        (_) async => [_row('c1', '/p', 'Chat 1'), _row('c2', '/p', 'Chat 2')],
      );
    },
    build: () => ChatsCubit(repo),
    act: (c) async {
      await c.load('/p');
      c.selectChat('c2');
    },
    skip: 2,
    expect: () => [
      isA<ChatsReady>().having((s) => s.activeChatId, 'active', 'c2'),
    ],
  );
}
