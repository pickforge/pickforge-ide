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
    'syncProjects emits Loading then Ready with chats grouped by project',
    setUp: () {
      when(() => repo.list('/p'))
          .thenAnswer((_) async => [_row('c1', '/p', 'Chat 1')]);
      when(() => repo.list('/q')).thenAnswer((_) async => <ChatRow>[]);
    },
    build: () => ChatsCubit(repo),
    act: (c) => c.syncProjects(['/p', '/q'], defaultExpand: '/p'),
    expect: () => [
      isA<ChatsLoading>(),
      isA<ChatsReady>()
          .having((s) => s.chatsByProject.keys.toList(), 'roots', ['/p', '/q'])
          .having((s) => s.chatsByProject['/p']!.length, 'p count', 1)
          .having((s) => s.expanded.contains('/p'), 'p expanded', true),
    ],
  );

  blocTest<ChatsCubit, ChatsState>(
    'newChat inserts and selects the new chat under its project',
    setUp: () {
      when(() => repo.list('/p')).thenAnswer((_) async => <ChatRow>[]);
      when(
        () => repo.newChat(
          projectRoot: '/p',
          defaultAgentId: 'codex',
          skillId: any(named: 'skillId'),
        ),
      ).thenAnswer((_) async => 'c-new');
    },
    build: () => ChatsCubit(repo),
    act: (c) async {
      await c.syncProjects(['/p']);
      when(() => repo.list('/p'))
          .thenAnswer((_) async => [_row('c-new', '/p', 'Chat 1')]);
      await c.newChat(projectRoot: '/p', defaultAgentId: 'codex');
    },
    skip: 2,
    expect: () => [
      isA<ChatsReady>()
          .having((s) => s.activeChatId, 'active', 'c-new')
          .having((s) => s.chatsByProject['/p']!.length, 'count', 1)
          .having((s) => s.expanded.contains('/p'), 'expanded', true),
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
      await c.syncProjects(['/p']);
      c.selectChat('c2');
    },
    skip: 2,
    expect: () => [
      isA<ChatsReady>().having((s) => s.activeChatId, 'active', 'c2'),
    ],
  );

  blocTest<ChatsCubit, ChatsState>(
    'toggleExpanded flips the expanded set for a project',
    setUp: () {
      when(() => repo.list('/p')).thenAnswer((_) async => <ChatRow>[]);
    },
    build: () => ChatsCubit(repo),
    act: (c) async {
      await c.syncProjects(['/p']);
      c.toggleExpanded('/p');
    },
    skip: 2,
    expect: () => [
      isA<ChatsReady>().having(
        (s) => s.expanded.contains('/p'),
        'expanded',
        true,
      ),
    ],
  );
}
